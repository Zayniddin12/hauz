import { createServerFn } from '@tanstack/react-start'
import { AppwriteException } from 'node-appwrite'
import { z } from 'zod'

import type { Result, Viewer } from './types'

const emailSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) })
const codeSchema = z.object({
    userId: z.string().min(1).max(36),
    code: z.string().trim().min(1).max(64),
})

/** Maps Appwrite errors to messages that are safe to show. Details stay in server logs. */
function describeAuthError(error: unknown, action: 'send' | 'verify') {
    console.error(`[auth] ${action} code failed`, error)
    if (error instanceof AppwriteException) {
        if (error.code === 429) {
            return { code: 'rate_limited', message: 'Too many attempts. Please wait a minute and try again.' }
        }
        if (action === 'verify' && (error.code === 401 || error.code === 400)) {
            return { code: 'invalid_code', message: 'That code is invalid or has expired. Check it or request a new one.' }
        }
        if (action === 'send' && error.code === 400) {
            return { code: 'invalid_email', message: 'Please enter a valid email address.' }
        }
    }
    return {
        code: 'unexpected',
        message:
            action === 'send'
                ? 'We could not send the code. Please try again.'
                : 'We could not sign you in. Please try again.',
    }
}

/** Current viewer (or null). Called from the root route on the server and on client navigations. */
export const getViewerFn = createServerFn({ method: 'GET' }).handler(
    async (): Promise<Viewer | null> => {
        const { getViewer } = await import('#/server/session.server')
        return getViewer()
    },
)

export const sendCodeFn = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => emailSchema.safeParse(input))
    .handler(async ({ data }): Promise<Result<{ userId: string }>> => {
        if (!data.success) {
            return { ok: false, code: 'invalid_email', message: 'Please enter a valid email address.' }
        }

        const { checkLimits } = await import('#/server/rate-limit.server')
        const { getClientIp } = await import('#/server/request-ip.server')
        const email = data.data.email
        const ip = getClientIp()

        const limited = checkLimits([
            { key: `send:cooldown:${email}`, limit: 1, windowMs: 60_000 },
            { key: `send:email:${email}`, limit: 5, windowMs: 60 * 60_000 },
            { key: `send:ip:${ip}`, limit: 10, windowMs: 10 * 60_000 },
        ])
        if (!limited.ok) {
            return {
                ok: false,
                code: 'rate_limited',
                message: `Too many attempts. Please try again in ${limited.retryAfterSec} seconds.`,
            }
        }

        const { sendEmailCode } = await import('#/server/appwrite.server')
        try {
            return { ok: true, data: await sendEmailCode(email) }
        } catch (error) {
            return { ok: false, ...describeAuthError(error, 'send') }
        }
    })

/** Verifies the code, sets the httpOnly session cookie, returns the viewer. */
export const verifyCodeFn = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => codeSchema.safeParse(input))
    .handler(async ({ data }): Promise<Result<Viewer>> => {
        if (!data.success) {
            return { ok: false, code: 'invalid_code', message: 'Please enter the code from your email.' }
        }

        const { checkLimits } = await import('#/server/rate-limit.server')
        const { getClientIp } = await import('#/server/request-ip.server')

        const limited = checkLimits([
            { key: `verify:user:${data.data.userId}`, limit: 5, windowMs: 10 * 60_000 },
            { key: `verify:ip:${getClientIp()}`, limit: 20, windowMs: 10 * 60_000 },
        ])
        if (!limited.ok) {
            return {
                ok: false,
                code: 'rate_limited',
                message: `Too many attempts. Please try again in ${limited.retryAfterSec} seconds.`,
            }
        }

        const { createSessionFromCode } = await import('#/server/appwrite.server')
        const session = await import('#/server/session.server')
        let secret: string
        try {
            const created = await createSessionFromCode(data.data.userId, data.data.code)
            secret = created.secret
            session.writeSessionCookie(secret, created.expire)
        } catch (error) {
            return { ok: false, ...describeAuthError(error, 'verify') }
        }
        // The cookie we just set is not in this request's cookies yet, so use the secret directly.
        const viewer = await session.loadViewer(secret)
        if (!viewer) {
            return { ok: false, code: 'unexpected', message: 'We could not sign you in. Please try again.' }
        }
        return { ok: true, data: viewer }
    })

/** Invalidates the Appwrite session, then always clears the cookie. */
export const logoutFn = createServerFn({ method: 'POST' }).handler(async () => {
    const session = await import('#/server/session.server')
    const secret = session.readSessionSecret()
    try {
        if (secret) {
            const { deleteCurrentSession } = await import('#/server/appwrite.server')
            await deleteCurrentSession(secret)
        }
    } catch (error) {
        // Session may already be dead; the cookie must go regardless.
        console.error('[auth] deleting session failed', error)
    } finally {
        session.clearSessionCookie()
    }
    return { ok: true as const }
})