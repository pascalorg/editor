import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminPanel, type AdminScene } from '@/components/admin/admin-panel'
import { listUsers, ownerEmails, requireAdmin } from '@/lib/auth/admin'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  // Admin-only. Non-admins (and signed-out visitors) get a 404 so the page's
  // existence isn't advertised.
  const admin = await requireAdmin()
  if (!admin) notFound()

  const [users, operations] = await Promise.all([listUsers(), getSceneOperations()])
  const scenes = await operations.listScenes({ limit: 500 })
  const emails = await ownerEmails(scenes.map((s) => s.ownerId).filter((x): x is string => !!x))

  const adminScenes: AdminScene[] = scenes.map((s) => ({
    id: s.id,
    name: s.name,
    ownerId: s.ownerId,
    ownerEmail: s.ownerId ? (emails.get(s.ownerId) ?? null) : null,
    updatedAt: s.updatedAt,
    nodeCount: s.nodeCount,
  }))

  return (
    <div className="min-h-screen bg-background text-foreground">
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
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/scenes"
            >
              Scenes
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">Admin</span>
          </nav>
          <span className="text-muted-foreground text-sm">{admin.email}</span>
        </div>
      </header>
      <main className="container mx-auto max-w-5xl px-6 py-12">
        <h1 className="mb-2 font-bold text-3xl">Administration</h1>
        <p className="mb-8 text-muted-foreground text-sm">
          {users.length} user{users.length === 1 ? '' : 's'}, {adminScenes.length} scene
          {adminScenes.length === 1 ? '' : 's'}.
        </p>
        <AdminPanel users={users} scenes={adminScenes} currentAdminId={admin.id} />
      </main>
    </div>
  )
}
