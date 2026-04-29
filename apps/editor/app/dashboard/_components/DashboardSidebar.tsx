'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  LayoutDashboard, FolderKanban, Users2, Users, Settings,
  LogOut, ChevronDown, Check, Box, Globe, ShoppingBag,
} from 'lucide-react'

type Org = { id: string; name: string; slug: string; logoUrl: string | null; role: string }
type User = { name: string | null; email: string | null; image: string | null }

const NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Overview', exact: true },
  { href: '/dashboard/projects', icon: FolderKanban, label: 'Projects', exact: false },
  { href: '/dashboard/teams', icon: Users2, label: 'Teams', exact: false },
  { href: '/dashboard/members', icon: Users, label: 'Members', exact: false },
  { href: '/marketplace', icon: ShoppingBag, label: 'Marketplace', exact: false },
]

export function DashboardSidebar({ orgs, user }: { orgs: Org[]; user: User }) {
  const pathname = usePathname()
  const [activeOrg, setActiveOrg] = useState<Org | null>(orgs[0] ?? null)
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)

  const initial = (activeOrg?.name[0] ?? user.name?.[0] ?? 'U').toUpperCase()

  return (
    <aside className="fixed left-0 top-0 h-full w-64 z-40 flex flex-col border-r border-white/[0.06] bg-white/[0.03] backdrop-blur-2xl">
      {/* Specular top highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Org Switcher */}
      <div className="p-4 border-b border-white/[0.06]">
        {activeOrg ? (
        <button
          onClick={() => setOrgMenuOpen((o) => !o)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] transition-all group"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-lg shadow-indigo-500/20">
            {activeOrg.logoUrl ? (
              <img src={activeOrg.logoUrl} alt="" className="w-full h-full rounded-lg object-cover" />
            ) : (
              initial
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-semibold truncate">{activeOrg.name}</div>
            <div className="text-[11px] text-zinc-500 capitalize">{activeOrg.role.toLowerCase()}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${orgMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        ) : (
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-xs font-bold text-zinc-400 flex-shrink-0">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-zinc-300">Personal</div>
            <div className="text-[11px] text-zinc-600">No team yet</div>
          </div>
        </div>
        )}

        {orgMenuOpen && orgs.length > 1 && (
          <div className="mt-1 rounded-xl border border-white/[0.08] bg-[#111]/90 backdrop-blur-xl overflow-hidden shadow-2xl">
            {orgs.map((org) => (
              <button
                key={org.id}
                onClick={() => { setActiveOrg(org); setOrgMenuOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.05] transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                  {(org.name[0] ?? 'A').toUpperCase()}
                </div>
                <span className="text-sm font-medium truncate flex-1 text-left">{org.name}</span>
                {org.id === activeOrg?.id && <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, icon: Icon, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link key={href} href={href}>
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-medium ${
                active
                  ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-zinc-400 hover:bg-white/[0.05] hover:text-white'
              }`}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </div>
            </Link>
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="p-4 border-t border-white/[0.06] space-y-0.5">
        <Link href="/dashboard/settings">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-zinc-400 hover:bg-white/[0.05] hover:text-white transition-all text-sm font-medium">
            <Settings className="w-4 h-4 flex-shrink-0" />
            Settings
          </div>
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-all text-sm font-medium"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          Sign Out
        </button>

        {/* User profile */}
        <div className="mt-2 pt-3 border-t border-white/[0.06] flex items-center gap-3 px-1">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {user.image ? (
              <img src={user.image} alt="" className="w-full h-full rounded-full object-cover" />
            ) : (
              (user.name?.[0] ?? user.email?.[0] ?? 'U').toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">{user.name ?? 'User'}</div>
            <div className="text-[11px] text-zinc-600 truncate">{user.email}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
