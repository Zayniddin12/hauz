# NOTES

## Architecture

**Auth = Appwrite email OTP, driven entirely from the TanStack Start server.**
- `sendCodeFn` (`src/lib/auth.functions.ts`) → `account.createEmailToken` (`src/server/appwrite.server.ts`). Same call for new and returning users: Appwrite creates the user if the email is unknown and ignores our random `userId` otherwise.
- `verifyCodeFn` → `account.createSession({userId, secret: code})` using the API-key client (Appwrite only returns the session secret to a key-authenticated caller), then sets the cookie.
- Two Appwrite clients, both in `appwrite.server.ts`: an *admin* client (API key; only for token + session creation) and a per-call *session* client (`setSession(secret)`; for `account.get`, logout and Function executions).

**Session cookie** (`src/server/session.server.ts`): `hauz_session`, holds the Appwrite session secret, `httpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, expiry = Appwrite session expiry. JS can't read it (verified: `document.cookie` is empty after login). Nothing is in localStorage or query strings.

**Secrets**: `APPWRITE_API_KEY` etc. are plain (non-`VITE_`) env vars read via `process.env` in `*.server.ts` files, which Start refuses to bundle for the client. I checked `dist/client` contains neither the key name, `node-appwrite`, nor the cookie name. `vite.config.ts` copies `.env` into `process.env` for dev (dev server doesn't do it for non-`VITE_` vars); nothing is `define`d into the client.

**SSR auth**: root route `beforeLoad` (`src/routes/__root.tsx`) calls `getViewerFn` → cookie → `account.get()` + Function `GET`. The result (`viewer`) is in router context, serialized into the HTML, and `<Header>` renders from it. So the first byte of a hard refresh already says "Sign in" or "Ali". Verified from raw SSR HTML (`curl` + headless Chrome). On client navigations `beforeLoad` re-runs, so expired sessions are noticed on the next navigation. Child routes read `context.viewer` for guards.

**Function calls** (`src/lib/account.functions.ts`): browser → server function → `functions.createExecution` with the *user's session*, so Appwrite injects `x-appwrite-user-id`. The browser never touches the `personal_accounts` table and holds no Appwrite credentials. Server functions return `{ok, data | code, message, fieldErrors}` instead of throwing, so raw Appwrite errors/stack traces never reach the UI (they go to `console.error` on the server).

## Flows & decisions

- **Onboarding duplicates**: three layers. (1) button disabled while pending/after success; (2) a synchronous `useRef` guard in `onboarding.tsx`, because React state is too late for a very fast double click; (3) the real protection: the Function's `POST` is idempotent (lookup, then unique index `uniq_appwrite_user_id`; the race loser re-reads and returns 200). Verified: a double `click()` produced exactly one `POST`.
- **Role immutability**: UI shows role as text; `updateAccountFn`'s schema has no role field; Function `PATCH` ignores unknown keys; `POST` with a different role → 409, shown as "role cannot be changed".
- **Clearing fields**: the profile form sends `null` for empty contact email/bio (never `""`, which the Function rejects). Verified the request body carries `null` and the form reads back empty after refresh.
- **`redirect` param** (`src/lib/redirect.ts`): accepted only if it starts with a single `/` and has no `//` prefix, backslash or control chars, and still resolves to our own origin. Sanitised once in each route's `validateSearch`, so everything downstream only sees a safe path; invalid → `/`. `?redirect=https://example.com` and `//evil.com` are dropped (verified). Post-login destination: the redirect if it's valid, else `/`; users without an account go to `/onboarding?redirect=…` first. Signed-in users who open `/sign-in` are bounced on.
- **Profile guard**: `/profile` `beforeLoad` redirects signed-out visitors to `/sign-in?redirect=/profile` (server-side 307 on hard refresh). Loader then fetches the account via the Function: 401 → sign-in, 404 → onboarding.
- **Logout** (`logoutFn`): `deleteSession('current')` in Appwrite, and in a `finally` always delete the cookie even if Appwrite fails. Client then clears the Query cache, navigates to `/`, and invalidates the router, so the header flips immediately; a hard refresh stays signed out because the cookie is gone.
- **Loading current user fails** (`getViewer` in `session.server.ts`): *any* error from `account.get()` (expired, revoked, garbage cookie, network) → viewer `null` + cookie deleted in the same response (verified: `set-cookie: hauz_session=; Max-Age=0`). A failure of only the Personal Account lookup does *not* log the person out (valid session, separate concern); the header falls back to the email.

## Disagreements with the brief

1. **"Send the signed-in user's id with profile changes"**: I do not. A client-supplied id would be an IDOR hole if trusted. The Function already derives identity from `x-appwrite-user-id`, which Appwrite sets from the session and which callers can't forge. The browser sends only the four editable fields; if it sent an id the Function would ignore it anyway.
2. **"Redirect to whatever `redirect` names"**: restricted to internal paths (open redirect).
3. **"Delete the cookie if loading the user fails for any reason"**: followed literally, which means a transient Appwrite outage signs people out. Accepted trade-off since the brief explicitly asks for it.

## Appwrite Function changes

**None.** I reviewed it: identity comes only from `x-appwrite-user-id`; POST is idempotent and race-safe via the unique index; PATCH distinguishes omitted/`null`, rejects `""`; role isn't in the update schema; errors are sanitised. Nothing needed changing. (Its 409 uses the code `personal_account_inconsistent`; I map by HTTP status.)

## Other changes to existing code

`src/router.tsx`: the `QueryClient` was created at module level. With SSR that instance is shared by all requests, so user A's cached account could be served to user B. It is now created inside `getRouter()`. The client cache is also cleared on login/logout.

## Verification status

`npm run typecheck` and `npm run build` are clean. There are no lint/test scripts.

**Verified against the real Appwrite project** (Fra Cloud, scripted with node-appwrite + headless Chrome):
- `createEmailToken` succeeds (and with the API key the response *does* contain the OTP `secret`, which is why `sendEmailCode` returns only `userId`). Invalid email → `400 general_argument_invalid`.
- `createSession` succeeds and returns the session secret; a wrong code → `401 user_invalid_token`; a malformed userId → `400`. These match the mapping in `describeAuthError`.
- `account.get`, `deleteSession('current')` (the old secret is rejected afterwards, 401) and the deployed Function (`GET` 404 → `POST` 201 → `GET` 200 → `PATCH` with `null`) all work.
- Full app flow with a real session cookie: signed-in-without-account → `/profile` redirects to onboarding; double-clicked Continue → profile; SSR header shows the first name; edit/clear persist; logout → "Sign in", cookie gone, refresh stays signed out; garbage cookie → signed out and cookie deleted.

**Not verified:** reading the OTP from a real inbox and typing it in (the session in my test was minted with `users.createToken`, which goes through the same `createSession` call), and `Secure` cookies over HTTPS. The test left two orphan rows in `personal_accounts` for deleted test users (the API key has no rows scope to remove them).

## Trade-offs / next steps

- `beforeLoad` hits Appwrite (2 calls: user + account) on every navigation; fine here, I'd cache per request/short TTL in production.
- Per-IP rate limiting of "send code" relies on Appwrite; all requests come from our server's IP, so I'd add our own throttling (per email/IP) and forward the client IP.
- No CSRF token beyond `SameSite=Lax` + POST-only mutations; add an Origin check on server functions.
- Add tests (redirect validator, Function handlers), a `notFoundComponent`, and an e2e suite on a test Appwrite project.
- Header name falls back to the email if the account lookup fails or the user hasn't onboarded.

## Interview Walkthrough

A. **Visit**: request hits TanStack Start; root `beforeLoad` runs on the server.
B. **Auth state**: `getViewerFn` → `getViewer()` reads `hauz_session`, calls `account.get()` and the Function `GET`. No cookie → `null`.
C. **Header**: `RootLayout` passes `viewer` to `Header`; "Sign in" or first name + "Log out", already in the SSR HTML.
D. **Sign in**: `/sign-in` → `sendCodeFn` (email token) → user types code → `verifyCodeFn`.
E. **Session**: `createSession` returns the secret; `setCookie` (httpOnly). We load the viewer from the secret directly because `getCookie` still sees the old request cookie (bug I hit in testing).
F. **Account check**: the viewer carries `account` (Function `GET`; 404 → `null`).
G. **Routing**: account → `redirect` (validated) or `/`; none → `/onboarding?redirect=…`, then POST (idempotent) and on to the destination.
H. **Profile**: `/profile` guard → loader `getAccountFn` through the Function → form with defaults.
I. **Update**: `updateAccountFn` → Function `PATCH` with four fields (`null` to clear); no user id from the client; `router.invalidate()` refreshes the header.
J. **Logout**: `logoutFn` deletes the Appwrite session + cookie; client clears cache, goes to `/`.
K. **Invalid session**: next `beforeLoad` → `account.get()` throws → viewer `null` + cookie deleted → header "Sign in"; guarded routes redirect to `/sign-in?redirect=…`.
