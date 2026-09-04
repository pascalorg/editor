import { redirect } from 'next/navigation'

/** /console has no content of its own — Overview is the landing tab. */
export default function ConsoleIndex() {
  redirect('/console/overview')
}
