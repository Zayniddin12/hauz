/**
 * Open-redirect protection. Only same-site absolute paths are allowed.
 * Rejects `https://evil.com`, `//evil.com`, `/\evil.com`, `javascript:` and
 * anything containing control characters or backslashes (browsers treat `\` as `/`).
 */
export function safeRedirect(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  if (/[\\\u0000-\u001f]/.test(value)) return fallback
  try {
    // Must still resolve to our own origin when parsed.
    const url = new URL(value, 'http://internal.invalid')
    if (url.origin !== 'http://internal.invalid') return fallback
  } catch {
    return fallback
  }
  return value
}
