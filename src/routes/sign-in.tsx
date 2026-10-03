import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { sendCodeFn, verifyCodeFn } from '#/lib/auth.functions'
import { safeRedirect } from '#/lib/redirect'

export const Route = createFileRoute('/sign-in')({
  // Sanitised once here: everything downstream only ever sees a safe internal path.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = safeRedirect(search.redirect, '')
    return target ? { redirect: target } : {}
  },
  beforeLoad: ({ context, search }) => {
    const destination = search.redirect ?? '/'
    if (context.viewer) {
      throw redirect({
        href: context.viewer.account
          ? destination
          : `/onboarding?redirect=${encodeURIComponent(destination)}`,
      })
    }
  },
  component: SignIn,
})

function SignIn() {
  const { redirect: target } = Route.useSearch()
  const destination = target ?? '/'
  const router = useRouter()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sendCode = useMutation({
    mutationFn: (value: string) => sendCodeFn({ data: { email: value } }),
    onSuccess: (result) => {
      if (result.ok) {
        setUserId(result.data.userId)
        setCode('')
        setError(null)
      } else {
        setError(result.message)
      }
    },
    onError: () => setError('Network problem. Check your connection and try again.'),
  })

  const verify = useMutation({
    mutationFn: (value: { userId: string; code: string }) => verifyCodeFn({ data: value }),
    onSuccess: (result) => {
      if (!result.ok) {
        setError(result.message)
        return
      }
      queryClient.clear()
      // Navigating re-runs the root beforeLoad, which picks up the new cookie.
      router.history.push(
        result.data.account
          ? destination
          : `/onboarding?redirect=${encodeURIComponent(destination)}`,
      )
    },
    onError: () => setError('Network problem. Check your connection and try again.'),
  })

  if (!userId) {
    return (
      <main>
        <h1>Sign in</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!sendCode.isPending) sendCode.mutate(email)
          }}
        >
          <label>
            Email <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" disabled={sendCode.isPending}>
            {sendCode.isPending ? 'Sending…' : 'Send code'}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      </main>
    )
  }

  return (
    <main>
      <h1>Enter your code</h1>
      <p>We sent a code to {email}.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!verify.isPending) verify.mutate({ userId, code })
        }}
      >
        <label>
          Code <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <button type="submit" disabled={verify.isPending}>
          {verify.isPending ? 'Checking…' : 'Sign in'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      <button
        type="button"
        disabled={sendCode.isPending}
        onClick={() => sendCode.mutate(email)}
      >
        Resend code
      </button>{' '}
      <button type="button" onClick={() => { setUserId(null); setError(null) }}>
        Use a different email
      </button>
    </main>
  )
}
