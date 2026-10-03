/**
 * The only place that talks to Appwrite. Server-only: the `.server.ts` suffix
 * makes TanStack Start fail the build if a client module imports this file.
 *
 * Two kinds of client:
 *  - admin client: has the API key. Used only to mint an email token and
 *    exchange it for a session (Appwrite only returns the session secret to a
 *    key-authenticated caller).
 *  - session client: acts as the signed-in user via their session secret. Used
 *    for account.get() and for executing the Function, so that Appwrite injects
 *    the real user id (`x-appwrite-user-id`) into the Function.
 */
import { Account, Client, ExecutionMethod, Functions, ID } from 'node-appwrite'

function env(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable ${name}`)
  }
  return value
}

function baseClient() {
  return new Client()
    .setEndpoint(env('APPWRITE_ENDPOINT'))
    .setProject(env('APPWRITE_PROJECT_ID'))
}

const adminAccount = () =>
  new Account(baseClient().setKey(env('APPWRITE_API_KEY')))

const sessionClient = (secret: string) => baseClient().setSession(secret)

/** Sends the one-time code. Same call for new and returning users. */
export async function sendEmailCode(email: string) {
  const token = await adminAccount().createEmailToken({
    userId: ID.unique(), // ignored by Appwrite if the email already has an account
    email,
  })
  return { userId: token.userId }
}

/** Exchanges userId + code for a session. `secret` is the session secret. */
export async function createSessionFromCode(userId: string, code: string) {
  const session = await adminAccount().createSession({ userId, secret: code })
  return { secret: session.secret, expire: session.expire }
}

export async function getUser(sessionSecret: string) {
  const user = await new Account(sessionClient(sessionSecret)).get()
  return { id: user.$id, email: user.email }
}

export async function deleteCurrentSession(sessionSecret: string) {
  await new Account(sessionClient(sessionSecret)).deleteSession({
    sessionId: 'current',
  })
}

/** Executes the personal-account Function as the signed-in user. */
export async function callPersonalAccount(
  sessionSecret: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: object,
): Promise<{ status: number; json: unknown }> {
  const execution = await new Functions(
    sessionClient(sessionSecret),
  ).createExecution({
    functionId: process.env.APPWRITE_FUNCTION_ID || 'personal-account',
    xpath: '/personal-account',
    method: ExecutionMethod[method],
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
    async: false,
  })

  let json: unknown = null
  try {
    json = JSON.parse(execution.responseBody)
  } catch {
    // Non-JSON body (e.g. platform error). Callers treat a null body as unexpected.
  }
  return { status: execution.responseStatusCode, json }
}
