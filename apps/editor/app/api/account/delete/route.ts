import { getAuth } from '@/lib/auth'
import { getDatabase } from '@pascal-app/db'
import { users, scenes, sessions } from '@pascal-app/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const auth = getAuth()
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDatabase()
  const userId = session.user.id

  const now = new Date()

  try {
    await db.transaction(async (tx) => {
      // 1. Soft-delete the user
      await tx.update(users).set({ deletedAt: now }).where(eq(users.id, userId))

      // 2. Soft-delete the scenes
      await tx.update(scenes).set({ deletedAt: now }).where(eq(scenes.ownerId, userId))

      // 3. Delete all sessions for the user to force them out immediately
      await tx.delete(sessions).where(eq(sessions.userId, userId))
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Failed to delete account:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
