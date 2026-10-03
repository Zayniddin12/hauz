import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import type { PersonalAccount, Result } from './types'

/**
 * Every call goes browser -> server function -> Appwrite Function (as the
 * signed-in user). The browser never sees the session secret, and the user id
 * is NOT sent by the client: Appwrite injects it into the Function.
 */

const createSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  role: z.enum(['property_owner', 'realtor']),
})

// null clears an optional field; the Function rejects "".
const updateSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  contactEmail: z.email('Enter a valid email address').max(254).nullable(),
  bio: z.string().trim().min(1).max(2000).nullable(),
})

type AccountResult = Result<PersonalAccount>

async function run(
  method: 'GET' | 'POST' | 'PATCH',
  body?: object,
): Promise<AccountResult> {
  const session = await import('#/server/session.server')
  const secret = session.readSessionSecret()
  if (!secret) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in again.' }
  }

  try {
    const { callPersonalAccount } = await import('#/server/appwrite.server')
    const { status, json } = await callPersonalAccount(secret, method, body)
    const error = (json ?? {}) as { error?: string; issues?: { field: string; message: string }[] }

    if (status === 200 || status === 201) {
      return { ok: true, data: json as PersonalAccount }
    }
    if (status === 401) {
      session.clearSessionCookie() // Appwrite says the session is not valid: stop sending it
      return { ok: false, code: 'unauthorized', message: 'Your session has expired. Please sign in again.' }
    }
    if (status === 404) {
      return { ok: false, code: 'not_found', message: 'You have not finished setting up your account yet.' }
    }
    if (status === 409) {
      return {
        ok: false,
        code: 'role_conflict',
        message: 'Your account already exists with a different role. The role cannot be changed.',
      }
    }
    if (status === 400) {
      const fieldErrors = Object.fromEntries((error.issues ?? []).map((i) => [i.field, i.message]))
      return { ok: false, code: 'invalid_request', message: 'Please check the highlighted fields.', fieldErrors }
    }
    console.error('[account] unexpected Function response', status, json)
  } catch (error) {
    console.error('[account] Function call failed', error)
  }
  return { ok: false, code: 'unexpected', message: 'Something went wrong. Please try again.' }
}

const invalid = (error: z.ZodError): AccountResult => ({
  ok: false,
  code: 'invalid_request',
  message: 'Please check the highlighted fields.',
  fieldErrors: Object.fromEntries(error.issues.map((i) => [i.path.join('.'), i.message])),
})

export const getAccountFn = createServerFn({ method: 'GET' }).handler(() => run('GET'))

export const createAccountFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => createSchema.safeParse(input))
  .handler(({ data }) => (data.success ? run('POST', data.data) : invalid(data.error)))

export const updateAccountFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => updateSchema.safeParse(input))
  .handler(({ data }) => (data.success ? run('PATCH', data.data) : invalid(data.error)))
