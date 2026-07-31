import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminPanel, type AdminScene } from '@/components/admin/admin-panel'
import { listUsers, ownerEmails, requireAdmin } from '@/lib/auth/admin'
import { listMcpGrants } from '@/lib/mcp/tokens'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  // Admin-only. Non-admins (and signed-out visitors) get a 404 so the page's
  // existence isn't advertised.
  const admin = await requireAdmin()
  if (!admin) notFound()

  const [users, operations, grants] = await Promise.all([
    listUsers(),
    getSceneOperations(),
    listMcpGrants(),
  ])
  const withMcp = new Set(grants.map((g) => g.userId))
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
            <Link className="text-muted-foreground hover:text-foreground" href="/">
              Home
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">Admin</span>
          </nav>
          <span className="text-muted-foreground text-sm">{admin.email}</span>
        </div>
      </header>
      <main className="container mx-auto max-w-5xl px-6 py-10">
        <AdminPanel
          currentAdminId={admin.id}
          scenes={adminScenes}
          users={users.map((u) => ({ ...u, mcpEnabled: withMcp.has(u.id) }))}
        />
      </main>
    </div>
  )
}
