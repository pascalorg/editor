import { getSession } from '@panel/lib/auth/session'
import { redirect } from 'next/navigation'
import { EditorApp } from '@/components/editor-app'
import { canEdit, getSessionUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/**
 * The front door. A visitor who has not finished signing in is sent to the
 * console screen that matches their state; a signed-in one gets the editor
 * rendered right here — no redirect, so the address bar stays on the bare
 * domain, which is how the operator wants the editor addressed.
 */
export default async function Root() {
  const session = await getSession({ touch: false })

  if (!session) redirect('/signin')
  if (session.mfaPending) redirect('/mfa')
  if (session.user.mustChangePassword) redirect('/welcome')

  // View-only accounts have no business in the editing surface: they land on
  // their scene list and open scenes in preview.
  const user = await getSessionUser()
  if (user && !canEdit(user)) redirect('/scenes')

  return <EditorApp />
}
