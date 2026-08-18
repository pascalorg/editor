import { getAuth } from '@/lib/auth'
import { getDatabase } from '@pascal-app/db'
import { users, scenes, sceneVersions } from '@pascal-app/db/schema'
import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const auth = getAuth()
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDatabase()
  const userId = session.user.id

  try {
    // 1. Get user profile
    const userProfile = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })

    // 2. Get all scenes owned by user
    const userScenes = await db.query.scenes.findMany({
      where: and(eq(scenes.ownerId, userId)),
    })

    // 3. Get the latest graph for each scene
    const exportedScenes = await Promise.all(
      userScenes.map(async (scene) => {
        const headVersion = await db.query.sceneVersions.findFirst({
          where: and(
            eq(sceneVersions.sceneId, scene.id),
            eq(sceneVersions.version, scene.headVersion)
          ),
        })

        return {
          id: scene.id,
          name: scene.name,
          createdAt: scene.createdAt,
          updatedAt: scene.updatedAt,
          graph: headVersion?.graph || null,
        }
      })
    )

    const exportData = {
      profile: userProfile,
      scenes: exportedScenes,
      exportedAt: new Date().toISOString(),
    }

    return new NextResponse(JSON.stringify(exportData), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="menart-3d-export-${userId}.json"`,
      },
    })
  } catch (err) {
    console.error('Failed to export account data:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
