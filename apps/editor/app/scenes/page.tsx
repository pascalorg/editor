import Link from 'next/link'
import { redirect } from 'next/navigation'
import { IfcImportButton } from '@/components/ifc-import-button'
import { CreateSceneButton } from '@/components/save-button'
import type { SceneMeta } from '@/components/scene-loader'
import { SceneGrid } from '@/components/scenes-grid'
import { authAvailable } from '@/lib/auth/db'
import { getSessionUser, type SessionUser } from '@/lib/auth/session'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

/**
 * Signing in belongs to the console alone, so this page carries no sign-in
 * control: a visitor without a session is sent to /signin. Without auth
 * (SQLite dev) everything is listed and there is nobody to redirect.
 */
async function requireUser(): Promise<SessionUser | null> {
  if (!authAvailable()) return null
  const user = await getSessionUser()
  if (!user) redirect('/signin')
  return user
}

async function fetchScenes(viewerId: string | undefined): Promise<SceneMeta[]> {
  const operations = await getSceneOperations()
  // `viewerId` (owned OR shared with them), not `ownerId`, so scenes shared to
  // this account also appear on their scenes page — matching the editor rail.
  return (await operations.listScenes({ viewerId, limit: 50 })) as SceneMeta[]
}

export default async function ScenesPage() {
  const user = await requireUser()
  const editingAllowed = user?.role !== 'viewer'
  const scenes = await fetchScenes(user?.id)

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-4 px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/"
            >
              Home
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">Projects</span>
          </nav>
          <div className="flex items-center gap-3">
            {user?.role === 'admin' && (
              <a
                className="rounded-md border border-border px-3 py-1.5 font-medium text-sm transition-colors hover:bg-accent/40"
                href="/console/scenes"
              >
                Admin
              </a>
            )}
            {editingAllowed && (
              <>
                <IfcImportButton />
                <CreateSceneButton />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-6 py-12">
        <h1 className="mb-2 font-bold text-3xl">Your projects</h1>
        <p className="mb-8 text-muted-foreground text-sm">
          {scenes.length === 0
            ? editingAllowed
              ? 'No projects yet. Create one to get started.'
              : 'No projects have been shared with you yet.'
            : `${scenes.length} project${scenes.length === 1 ? '' : 's'}.`}
        </p>

        {scenes.length === 0 ? (
          <div className="rounded-xl border border-border/60 border-dashed bg-background p-12 text-center">
            <p className="text-muted-foreground text-sm">
              {editingAllowed
                ? 'You haven’t saved any projects yet. Start from scratch, or import an IFC model exported from Revit, ArchiCAD or similar.'
                : 'Ask an administrator to assign a project to your account.'}
            </p>
            {editingAllowed && (
              <div className="mt-4 flex items-start justify-center gap-3">
                <CreateSceneButton />
                <IfcImportButton />
              </div>
            )}
          </div>
        ) : (
          <SceneGrid
            scenes={scenes}
            currentUserId={user?.id ?? null}
            isAdmin={user?.role === 'admin'}
          />
        )}
      </main>
    </div>
  )
}
