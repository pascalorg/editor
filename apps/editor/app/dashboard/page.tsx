import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getDashboardData } from './actions'
import { ProjectCard } from './_components/ProjectCard'
import { CreateWorkspacePrompt } from './_components/CreateWorkspacePrompt'
import { NewProjectCard } from './_components/NewProjectCard'
import { Plus, Search } from 'lucide-react'
import Link from 'next/link'

function getGreeting(name: string | null | undefined) {
  const h = new Date().getHours()
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  return `Good ${time}, ${name?.split(' ')[0] ?? 'there'}.`
}

export default async function DashboardOverview() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const data = await getDashboardData()
  if (!data || data.organizations.length === 0) return <CreateWorkspacePrompt />

  const org = data.organizations[0]!.organization
  const allProjects = org.teams.flatMap((team) =>
    team.projects.map((proj) => ({
      ...proj,
      teamName: team.name,
      members: team.members,
    }))
  )

  const starredIds = new Set(data.starredProjectIds ?? [])

  const recentProjects = [...allProjects]
    .sort((a, b) => {
      const aTime = ((a as { lastOpenedAt?: Date | null }).lastOpenedAt ?? a.updatedAt).getTime()
      const bTime = ((b as { lastOpenedAt?: Date | null }).lastOpenedAt ?? b.updatedAt).getTime()
      return bTime - aTime
    })
    .slice(0, 6)

  const greeting = getGreeting(session.user.name)

  // Recent activity (last 3 modified projects as "live now" events)
  const liveActivity = [...allProjects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 3)

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-8 py-4 border-b border-white/[0.05] bg-[#0A0A0A]/80 backdrop-blur-xl">
        <div className="text-[11px] text-zinc-600 uppercase tracking-widest font-medium">
          {org.name} / <span className="text-zinc-500">Workspace</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/projects"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-white hover:border-white/[0.14] transition-all text-[13px]"
          >
            <Search className="w-3.5 h-3.5" />
            Search
          </Link>
          <Link
            href="/dashboard/projects"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-[13px] font-semibold rounded-lg transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            New project
          </Link>
        </div>
      </header>

      <div className="px-8 pt-10 pb-16 max-w-[1400px]">
        {/* Greeting */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-white mb-1">
            {greeting.replace('.', '')}<span className="text-indigo-400">.</span>
          </h1>
          <p className="text-zinc-500 text-sm">
            {allProjects.length} project{allProjects.length !== 1 ? 's' : ''}
            {liveActivity.length > 0 && ` · ${liveActivity.length} with activity today`}
          </p>
        </div>

        {/* Live Now banner */}
        {liveActivity.length > 0 && (
          <div className="mb-8 rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.05]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-zinc-500 uppercase tracking-widest font-semibold">Live now</span>
              <span className="ml-auto text-[11px] text-zinc-600">
                Updated {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="flex divide-x divide-white/[0.05]">
              {liveActivity.map((p) => {
                const memberUser = org.members[0]?.user
                const initials = memberUser?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'AN'
                return (
                  <Link key={p.id} href={`/editor/${p.id}`} className="flex-1 flex items-start gap-3 px-5 py-4 hover:bg-white/[0.02] transition-colors min-w-0">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] text-zinc-400 truncate">
                        <span className="text-white font-medium">{memberUser?.name ?? session.user?.name ?? 'You'}</span>
                        {' '}edited{' '}
                        <span className="text-white font-medium">{p.name}</span>
                      </p>
                      <p className="text-[11px] text-zinc-600 mt-0.5">
                        {timeAgo(p.updatedAt)}
                      </p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Filter tabs + view toggle */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            {['All', 'Recent', 'Starred'].map((tab) => (
              <Link
                key={tab}
                href={tab === 'All' ? '/dashboard' : `/dashboard/projects?filter=${tab.toLowerCase()}`}
                className="px-3 py-1 rounded-lg text-[13px] font-medium transition-all text-zinc-500 hover:text-white first:bg-white/[0.07] first:text-white"
              >
                {tab}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded-lg bg-white/[0.07] text-white">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.8"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.8"/><rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.8"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.8"/></svg>
            </button>
            <button className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04] transition-all">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="2" rx="1" fill="currentColor"/><rect x="1" y="7" width="14" height="2" rx="1" fill="currentColor"/><rect x="1" y="12" width="14" height="2" rx="1" fill="currentColor"/></svg>
            </button>
          </div>
        </div>

        {/* Project grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <NewProjectCard />
          {recentProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              starred={starredIds.has(project.id)}
            />
          ))}
        </div>

        {allProjects.length > 6 && (
          <div className="mt-6 text-center">
            <Link
              href="/dashboard/projects"
              className="text-[13px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              View all {allProjects.length} projects →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

function timeAgo(date: Date | string): string {
  const diff = (Date.now() - new Date(date).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
