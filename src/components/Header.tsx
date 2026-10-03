import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'

import { logoutFn } from '#/lib/auth.functions'
import type { Viewer } from '#/lib/types'

/** Pure render of the viewer resolved on the server, so the first paint is correct. */
export function Header({ viewer }: { viewer: Viewer | null }) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const logout = useMutation({
    mutationFn: () => logoutFn(),
    onSettled: async () => {
      queryClient.clear() // never keep one person's data around for the next sign-in
      // Leave the page first (it may be protected), re-resolving the viewer on the way.
      await router.navigate({ to: '/' })
      await router.invalidate()
    },
  })

  return (
    <header>
      <Link to="/">HAUZ</Link>{' '}
      {viewer ? (
        <>
          <Link to="/profile">{viewer.account?.firstName ?? viewer.email}</Link>{' '}
          <button type="button" disabled={logout.isPending} onClick={() => logout.mutate()}>
            Log out
          </button>
        </>
      ) : (
        <Link to="/sign-in">Sign in</Link>
      )}
    </header>
  )
}
