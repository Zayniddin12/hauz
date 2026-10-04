import { getRequestHeader } from '@tanstack/react-start/server'

export function getClientIp(): string {
    // Faqat ishonchli proxy (Nginx, Cloudflare, Vercel) ortida bo'lsangiz x-forwarded-for ishonchli
    const forwarded = getRequestHeader('x-forwarded-for')
    if (forwarded) return forwarded.split(',')[0].trim()
    return getRequestHeader('x-real-ip') ?? 'unknown'
}