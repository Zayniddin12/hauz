type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

// Xotira to'lib ketmasligi uchun eskirgan yozuvlarni vaqti-vaqti bilan tozalaymiz
const sweeper = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key)
    }
}, 60_000)
sweeper.unref?.()

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number }

/** Fixed-window limiter: `windowMs` ichida `limit` tadan ortiq urinishga ruxsat bermaydi. */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs })
        return { ok: true }
    }
    if (bucket.count >= limit) {
        return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
    }
    bucket.count += 1
    return { ok: true }
}

/** Bir nechta limitni birdan tekshiradi; birinchi buzilgani qaytadi. */
export function checkLimits(
    rules: Array<{ key: string; limit: number; windowMs: number }>,
): RateLimitResult {
    for (const rule of rules) {
        const result = rateLimit(rule.key, rule.limit, rule.windowMs)
        if (!result.ok) return result
    }
    return { ok: true }
}