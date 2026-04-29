'use client'

import { useState, Suspense, lazy } from 'react'
import Link from 'next/link'

const ProjectPreviewCanvas = lazy(() => import('./ProjectPreviewCanvas'))

type Member = { user: { id: string; name: string | null; image: string | null } }

type Project = {
  id: string
  name: string
  description: string | null
  thumbnailUrl: string | null
  updatedAt: Date | string
  lastOpenedAt?: Date | string | null
  teamName: string
  members?: Member[]
}

function timeAgo(date: Date | string): string {
  const diff = (Date.now() - new Date(date).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function getStatus(updatedAt: Date | string): 'live' | 'review' | 'draft' {
  const diff = (Date.now() - new Date(updatedAt).getTime()) / 1000
  if (diff < 3600) return 'live'
  if (diff < 86400 * 3) return 'review'
  return 'draft'
}

const STATUS_STYLES = {
  live: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  review: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  draft: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/15',
}

export function ProjectCard({
  project,
  starred,
}: {
  project: Project
  starred?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const status = getStatus(project.updatedAt)
  const members = project.members?.slice(0, 3) ?? []

  return (
    <Link href={`/editor/${project.id}`} className="block group">
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.04]"
      >
        {/* Thumbnail */}
        <div className="relative w-full aspect-[4/3] bg-[#111] overflow-hidden">
          {hovered ? (
            <Suspense fallback={<ThumbnailFallback thumbnailUrl={project.thumbnailUrl} />}>
              <ProjectPreviewCanvas />
            </Suspense>
          ) : (
            <ThumbnailFallback thumbnailUrl={project.thumbnailUrl} />
          )}

          {/* Status badge */}
          <div className={`absolute top-3 left-3 z-20 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${STATUS_STYLES[status]}`}>
            {status}
          </div>

          {/* Avatar stack */}
          {members.length > 0 && (
            <div className="absolute top-3 right-3 z-20 flex -space-x-1.5">
              {members.map((m) => (
                <div
                  key={m.user.id}
                  className="w-6 h-6 rounded-full border border-black bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[9px] font-bold text-white overflow-hidden"
                  title={m.user.name ?? ''}
                >
                  {m.user.image
                    ? <img src={m.user.image} alt="" className="w-full h-full object-cover" />
                    : (m.user.name?.split(' ').map((n) => n[0]).join('').slice(0, 2) ?? '?').toUpperCase()
                  }
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Card body */}
        <div className="px-4 py-3">
          <h3 className="text-[13px] font-semibold text-white group-hover:text-indigo-300 transition-colors line-clamp-1 mb-0.5">
            {project.name}
          </h3>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-600 truncate">{project.teamName}</span>
            <span className="text-[11px] text-zinc-700">{timeAgo(project.updatedAt)}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function ThumbnailFallback({ thumbnailUrl }: { thumbnailUrl: string | null }) {
  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt="" className="w-full h-full object-cover opacity-70" />
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-[#0d0d0d]"
      style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)', backgroundSize: '32px 32px' }}
    >
      {/* Simple architectural wireframe SVG */}
      <svg width="80" height="60" viewBox="0 0 80 60" fill="none" xmlns="http://www.w3.org/2000/svg" opacity="0.35">
        <rect x="10" y="20" width="40" height="30" stroke="white" strokeWidth="1"/>
        <polygon points="10,20 30,8 70,8 50,20" stroke="white" strokeWidth="1" fill="none"/>
        <line x1="50" y1="20" x2="50" y2="50" stroke="white" strokeWidth="1"/>
        <line x1="70" y1="8" x2="70" y2="38" stroke="white" strokeWidth="1"/>
        <line x1="50" y1="50" x2="70" y2="38" stroke="white" strokeWidth="1"/>
        <rect x="22" y="32" width="12" height="18" stroke="white" strokeWidth="0.75"/>
      </svg>
    </div>
  )
}
