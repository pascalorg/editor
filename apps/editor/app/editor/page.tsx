import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** The editor moved to the root URL; this survives for old links and habit. */
export default function EditorRedirect() {
  redirect('/')
}
