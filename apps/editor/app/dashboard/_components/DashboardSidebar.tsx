'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  FolderKanban, Clock, Star, Users, FileText,
  LogOut, Settings, HardDrive, ChevronRight,
} from 'lucide-react'

type Org = { id: string; name: string; slug: string; logoUrl: string | null; role: string }
type Team = { id: string; name: string; projectCount: number; color: string }
type User = { name: string | null; email: string | null; image: string | null }

const TEAM_COLORS = ['#4F8EF7', '#F97316', '#A855F7', '#10B981', '#F59E0B', '#EF4444']

const LIBRARY_ITEMS = [
  { href: '/dashboard/projects', icon: FolderKanban, label: 'All projects', countKey: 'total' as const },
  { href: '/dashboard/projects?filter=recent', icon: Clock, label: 'Recent', countKey: null },
  { href: '/dashboard/projects?filter=starred', icon: Star, label: 'Starred', countKey: 'starred' as const },
  { href: '/dashboard/projects?filter=shared', icon: Users, label: 'Shared with me', countKey: null },
  { href: '/dashboard/projects?filter=drafts', icon: FileText, label: 'Drafts', countKey: null },
]

export function DashboardSidebar({
  orgs,
  user,
  teams,
  totalProjects,
  starredCount,
  storageUsedGb,
  storageLimitGb,
}: {
  orgs: Org[]
  user: User
  teams: Team[]
  totalProjects: number
  starredCount: number
  storageUsedGb: number
  storageLimitGb: number
}) {
  const pathname = usePathname()
  const activeOrg = orgs[0] ?? null
  const storagePercent = Math.min(100, Math.round((storageUsedGb / storageLimitGb) * 100))

  const counts: Record<'total' | 'starred', number> = { total: totalProjects, starred: starredCount }

  return (
    <aside className="fixed left-0 top-0 h-full w-[220px] z-40 flex flex-col bg-[#0f0f0f] border-r border-white/[0.05]">

      {/* Org header */}
      <div className="px-4 pt-5 pb-4 border-b border-white/[0.05]">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
            {activeOrg?.name[0]?.toUpperCase() ?? user.name?.[0]?.toUpperCase() ?? 'P'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-zinc-500 uppercase tracking-widest font-medium truncate">
              {activeOrg?.name ?? 'Personal'}
            </div>
          </div>
          <ChevronRight className="w-3 h-3 text-zinc-600" />
        </div>
      </div>

      {/* Library */}
      <div className="px-3 pt-4 pb-2">
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold px-2 mb-1.5">Library</p>
        <nav className="space-y-0.5">
          {LIBRARY_ITEMS.map(({ href, icon: Icon, label, countKey }) => {
            const active = pathname === href || (pathname === '/dashboard' && href === '/dashboard/projects')
            const count = countKey ? counts[countKey] : null
            return (
              <Link key={href} href={href}>
                <div className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all text-[13px] ${
                  active
                    ? 'bg-white/[0.07] text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]'
                }`}>
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1 truncate">{label}</span>
                  {count != null && count > 0 && (
                    <span className="text-[11px] text-zinc-600 tabular-nums">{count}</span>
                  )}
                </div>
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Teams */}
      {teams.length > 0 && (
        <div className="px-3 pt-3 pb-2">
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold px-2 mb-1.5">Teams</p>
          <nav className="space-y-0.5">
            {teams.map((team, i) => (
              <Link key={team.id} href={`/dashboard/teams`}>
                <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04] transition-all text-[13px]">
                  <span
                    className="w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: TEAM_COLORS[i % TEAM_COLORS.length] }}
                  />
                  <span className="flex-1 truncate">{team.name}</span>
                  {team.projectCount > 0 && (
                    <span className="text-[11px] text-zinc-600 tabular-nums">{team.projectCount}</span>
                  )}
                </div>
              </Link>
            ))}
          </nav>
        </div>
      )}

      <div className="flex-1" />

      {/* Storage */}
      <div className="px-4 py-3 mx-3 mb-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <HardDrive className="w-3 h-3 text-zinc-500" />
            <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Storage</span>
          </div>
          <span className="text-[11px] text-zinc-600">{storagePercent}%</span>
        </div>
        <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all"
            style={{ width: `${storagePercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-600">{storageUsedGb} of {storageLimitGb} GB</span>
          <button className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors font-medium">Upgrade</button>
        </div>
      </div>

      {/* User profile + actions */}
      <div className="px-3 pb-4 border-t border-white/[0.05] pt-3 space-y-0.5">
        <Link href="/dashboard/settings">
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04] transition-all text-[13px]">
            <Settings className="w-3.5 h-3.5" />
            Settings
          </div>
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/[0.06] transition-all text-[13px]"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
        <div className="flex items-center gap-2.5 px-2 pt-2 mt-1 border-t border-white/[0.05]">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 overflow-hidden">
            {user.image
              ? <img src={user.image} alt="" className="w-full h-full object-cover" />
              : (user.name?.[0] ?? user.email?.[0] ?? 'U').toUpperCase()
            }
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-zinc-300 truncate">{user.name ?? 'User'}</div>
            <div className="text-[10px] text-zinc-600 truncate">{user.email}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
