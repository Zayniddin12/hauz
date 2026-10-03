import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { createAccountFn } from '#/lib/account.functions'
import { safeRedirect } from '#/lib/redirect'
import type { Role } from '#/lib/types'

export const Route = createFileRoute('/onboarding')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = safeRedirect(search.redirect, '')
    return target ? { redirect: target } : {}
  },
  beforeLoad: ({ context, search }) => {
    const destination = search.redirect ?? '/'
    if (!context.viewer) {
      throw redirect({ to: '/sign-in', search: search.redirect ? { redirect: search.redirect } : {} })
    }
    if (context.viewer.account) {
      throw redirect({ href: destination })
    }
  },
  component: Onboarding,
})

function Onboarding() {
  const { redirect: target } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const submitting = useRef(false) // synchronous guard: state updates are too late for a fast double click
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const create = useMutation({
    mutationFn: (data: { firstName: string; lastName: string; role: Role }) =>
      createAccountFn({ data }),
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.clear()
        router.history.push(target ?? '/') // root beforeLoad re-reads the viewer
        return
      }
      setError(result.message)
      setFieldErrors(result.fieldErrors ?? {})
      if (result.code === 'unauthorized') router.history.push('/sign-in')
    },
    onError: () => setError('Network problem. Check your connection and try again.'),
    onSettled: () => {
      submitting.current = false
    },
  })

  return (
    <main>
      <h1>Set up your account</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (submitting.current) return
          submitting.current = true
          const form = new FormData(e.currentTarget)
          setError(null)
          setFieldErrors({})
          create.mutate({
            firstName: String(form.get('firstName') ?? ''),
            lastName: String(form.get('lastName') ?? ''),
            role: form.get('role') as Role,
          })
        }}
      >
        <label>
          First name <input name="firstName" required maxLength={100} autoComplete="given-name" />
        </label>
        {fieldErrors.firstName && <p role="alert">{fieldErrors.firstName}</p>}
        <label>
          Last name <input name="lastName" required maxLength={100} autoComplete="family-name" />
        </label>
        {fieldErrors.lastName && <p role="alert">{fieldErrors.lastName}</p>}
        <fieldset>
          <legend>I am a</legend>
          <label>
            <input type="radio" name="role" value="property_owner" required /> Property Owner
          </label>
          <label>
            <input type="radio" name="role" value="realtor" /> Realtor
          </label>
        </fieldset>
        <p>You cannot change this later.</p>
        <button type="submit" disabled={create.isPending || create.isSuccess}>
          {create.isPending ? 'Saving…' : 'Continue'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  )
}
