import { headers as nextHeaders } from 'next/headers'
import { BASE_URL } from '@/lib/utils'

/**
 * Get the current session from Better Auth backend (server-side)
 */
export async function getSession() {
  try {
    const headersList = await nextHeaders()

    // Make authenticated request to the auth backend to get session
    const response = await fetch(`${BASE_URL}/api/auth/get-session`, {
      headers: {
        cookie: headersList.get('cookie') || '',
      },
      credentials: 'include',
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()

    // Better Auth returns the session data directly
    if (data?.user && data?.session) {
      return {
        user: data.user,
        session: data.session,
      }
    }

    return null
  } catch (error) {
    console.error('Failed to get session:', error)
    return null
  }
}

/**
 * Get the current user from the session
 */
export async function getUser() {
  const session = await getSession()
  return session?.user ?? null
}
