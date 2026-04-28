import { getDashboardData } from './actions'
import { ProjectCard } from './_components/ProjectCard'
import { Plus, FolderKanban, Users, Building2 } from 'lucide-react'
import Link from 'next/link'

export default async function DashboardOverview() {
  const data = await getDashboardData()

  if (!data || data.organizations.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-zinc-600" />
          </div>
          <p className="text-zinc-400 text-sm">No organization found.</p>
        </div>
      </div>
    )
  }

  const org = data.organizations[0]!.organization
  const totalTeams = org.teams.length
  const totalProjects = org.teams.reduce((acc, t) => acc + t.projects.length, 0)
  const totalMembers = org.members.length

  const allProjects = org.teams.flatMap((team) =>
    team.projects.map((proj) => ({ ...proj, teamName: team.name }))
  )

  const recentProjects = [...allProjects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 9)

  return (
    <div className="p-8 max-w-[1400px]">
      {/* Header */}
      <header className="mb-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
            <p className="text-zinc-500 text-sm mt-0.5">Your workspace overview</p>
          </div>
          <Link
            href="/dashboard/projects"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 text-sm font-semibold rounded-xl hover:bg-indigo-500/20 transition-all"
          >
            <Plus className="w-4 h-4" /> New Project
          </Link>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        <StatCard label="Teams" value={totalTeams} icon={<Building2 className="w-4 h-4 text-indigo-400" />} />
        <StatCard label="Projects" value={totalProjects} icon={<FolderKanban className="w-4 h-4 text-violet-400" />} />
        <StatCard label="Members" value={totalMembers} icon={<Users className="w-4 h-4 text-emerald-400" />} />
      </div>

      {/* Recent projects masonry grid */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Recent Projects</h2>
          <Link href="/dashboard/projects" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium">
            View all →
          </Link>
        </div>

        {recentProjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] py-20 flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
              <FolderKanban className="w-6 h-6 text-zinc-600" />
            </div>
            <div className="text-center">
              <p className="text-zinc-400 font-medium text-sm">No projects yet</p>
              <p className="text-zinc-600 text-xs mt-1">Create your first project to get started</p>
            </div>
            <Link href="/dashboard/projects" className="px-4 py-2 bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 text-sm font-semibold rounded-xl hover:bg-indigo-500/20 transition-all">
              Create Project
            </Link>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
            {recentProjects.map((project) => (
              <div key={project.id} className="break-inside-avoid">
                <ProjectCard project={project} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 hover:border-white/[0.10] transition-all">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 bg-white/[0.05] rounded-lg">{icon}</div>
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-3xl font-bold">{value}</span>
    </div>
  )
}
