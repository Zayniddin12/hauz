/**
 * Session cookie handling and "who is the current viewer".
 *
 * The cookie holds the Appwrite session secret. It is httpOnly (JS cannot read
 * it), SameSite=Lax (not sent on cross-site POSTs) and Secure in production.
 */
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'

import type { PersonalAccount, Viewer } from '#/lib/types'

import { callPersonalAccount, getUser } from './appwrite.server'

const COOKIE = 'hauz_session'

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
})

export const readSessionSecret = () => getCookie(COOKIE)

export function writeSessionCookie(secret: string, expire: string) {
  const expires = new Date(expire)
  setCookie(COOKIE, secret, {
    ...cookieOptions(),
    // Match the Appwrite session lifetime; fall back to a session cookie.
    ...(Number.isNaN(expires.getTime()) ? {} : { expires }),
  })
}

export const clearSessionCookie = () => deleteCookie(COOKIE, cookieOptions())

/** Fetches the account through the Function. 404 = not onboarded yet. */
export async function fetchPersonalAccount(
  secret: string,
): Promise<PersonalAccount | null> {
  const { status, json } = await callPersonalAccount(secret, 'GET')
  if (status === 200) return json as PersonalAccount
  if (status === 404) return null
  throw new Error(`personal-account GET answered ${status}`)
}

/**
 * Resolves the viewer for the current request, or null if signed out.
 *
 * Any failure to load the Appwrite user (expired, revoked, malformed cookie,
 * network error...) is treated as signed out AND the cookie is deleted, so we
 * never stay half-authenticated.
 *
 * A failure to load only the Personal Account does not sign the person out:
 * the session is valid, the profile lookup is a separate concern.
 */
export async function getViewer(): Promise<Viewer | null> {
  const secret = readSessionSecret()
  return secret ? loadViewer(secret) : null
}

/** Same as getViewer, for a secret we already hold (e.g. just created at sign-in). */
export async function loadViewer(secret: string): Promise<Viewer | null> {
  let user: { id: string; email: string }
  try {
    user = await getUser(secret)
  } catch (error) {
    console.error('[auth] loading current user failed, clearing cookie', error)
    clearSessionCookie()
    return null
  }

  let account: PersonalAccount | null = null
  try {
    account = await fetchPersonalAccount(secret)
  } catch (error) {
    console.error('[auth] loading personal account failed', error)
  }

  return { ...user, account }
}
