import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { updateAccountFn } from '#/lib/account.functions'
import { accountQuery } from '#/lib/account.queries'
import type { PersonalAccount } from '#/lib/types'

type ProfileInput = Pick<PersonalAccount, 'firstName' | 'lastName' | 'contactEmail' | 'bio'>

export const Route = createFileRoute('/profile')({
  beforeLoad: ({ context, location }) => {
    if (!context.viewer) {
      // location.href is an internal path + search + hash, never an absolute URL.
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
  },
  loader: async ({ context }) => {
    const result = await context.queryClient.ensureQueryData(accountQuery)
    if (result.ok) return result.data
    if (result.code === 'unauthorized') {
      throw redirect({ to: '/sign-in', search: { redirect: '/profile' } })
    }
    if (result.code === 'not_found') {
      throw redirect({ to: '/onboarding', search: { redirect: '/profile' } })
    }
    throw new Error(result.message)
  },
  errorComponent: ({ error }) => (
    <main>
      <h1>Profile</h1>
      <p role="alert">{import.meta.env.DEV ? (error as Error).message : 'We could not load your profile. Please try again.'}</p>
    </main>
  ),
  component: Profile,
})

function Profile() {
  const loaded = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [account, setAccount] = useState<PersonalAccount>(loaded)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const update = useMutation({
    mutationFn: (data: ProfileInput) => updateAccountFn({ data }),
    onSuccess: async (result) => {
      if (result.ok) {
        setAccount(result.data)
        setSaved(true)
        queryClient.setQueryData(accountQuery.queryKey, result)
        await router.invalidate() // refresh the header's first name
        return
      }
      setError(result.message)
      setFieldErrors(result.fieldErrors ?? {})
      if (result.code === 'unauthorized') await router.invalidate()
    },
    onError: () => setError('Network problem. Check your connection and try again.'),
  })

  return (
    <main>
      <h1>Profile</h1>
      <form
        key={account.updatedAt}
        onSubmit={(e) => {
          e.preventDefault()
          if (update.isPending) return
          const form = new FormData(e.currentTarget)
          const optional = (name: string) => String(form.get(name) ?? '').trim() || null
          setError(null)
          setFieldErrors({})
          setSaved(false)
          update.mutate({
            firstName: String(form.get('firstName') ?? ''),
            lastName: String(form.get('lastName') ?? ''),
            contactEmail: optional('contactEmail'), // empty -> null -> cleared in the backend
            bio: optional('bio'),
          })
        }}
      >
        <label>
          First name <input name="firstName" required maxLength={100} defaultValue={account.firstName} />
        </label>
        {fieldErrors.firstName && <p role="alert">{fieldErrors.firstName}</p>}
        <label>
          Last name <input name="lastName" required maxLength={100} defaultValue={account.lastName} />
        </label>
        {fieldErrors.lastName && <p role="alert">{fieldErrors.lastName}</p>}
        <label>
          Contact email <input name="contactEmail" type="email" defaultValue={account.contactEmail ?? ''} />
        </label>
        {fieldErrors.contactEmail && <p role="alert">{fieldErrors.contactEmail}</p>}
        <label>
          Bio <textarea name="bio" maxLength={2000} defaultValue={account.bio ?? ''} />
        </label>
        {fieldErrors.bio && <p role="alert">{fieldErrors.bio}</p>}
        <p>Role: {account.role === 'realtor' ? 'Realtor' : 'Property Owner'} (cannot be changed)</p>
        <button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
        {saved && <p role="status">Saved.</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  )
}
