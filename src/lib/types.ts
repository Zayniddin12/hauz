export type Role = 'property_owner' | 'realtor'

export interface PersonalAccount {
  personalAccountId: string
  firstName: string
  lastName: string
  role: Role
  contactEmail: string | null
  bio: string | null
  updatedAt: string
}

/** What the rest of the app knows about the signed-in person. */
export interface Viewer {
  id: string
  email: string
  /** null = signed in but has not onboarded (or the lookup failed). */
  account: PersonalAccount | null
}

/** Server functions return these instead of throwing, so no raw error text reaches the browser. */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> }
