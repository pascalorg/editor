'use client'

import { useState, Suspense, lazy } from 'react'
import Link from 'next/link'
import { Clock, ArrowRight } from 'lucide-react'
import { ROLE_COLORS, ROLE_LABELS } from '@/lib/rbac'
import type { ProjectRole } from '@/lib/rbac'

const ProjectPreviewCanvas = lazy(() => import('./ProjectPreviewCanvas'))

type Project = {
  id: string
  name: string
  description: string | null
  thumbnailUrl: string | null
  updatedAt: Date | string
  teamName: string
  role?: ProjectRole
}

function timeAgo(date: Date | string): string {
  const d = new Date(date)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function ProjectCard({ project }: { project: Project }) {
  const [hovered, setHovered] = useState(false)

  return (
    <Link href={`/editor/${project.id}`} className="block group">
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-sm overflow-hidden transition-all duration-300 hover:border-indigo-500/25 hover:bg-white/[0.05] hover:shadow-2xl hover:shadow-indigo-500/5"
      >
        {/* Thumbnail / 3D preview area */}
        <div className="relative w-full aspect-[16/10] bg-zinc-950 overflow-hidden">
          {/* Gradient overlay always present */}
          <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/5 via-transparent to-violet-500/5 pointer-events-none z-10" />

          {hovered ? (
            <Suspense fallback={<ThumbnailFallback thumbnailUrl={project.thumbnailUrl} />}>
              <ProjectPreviewCanvas />
            </Suspense>
          ) : (
            <ThumbnailFallback thumbnailUrl={project.thumbnailUrl} />
          )}

          {/* Role badge */}
          {project.role && (
            <div className={`absolute top-3 right-3 z-20 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${ROLE_COLORS[project.role]}`}>
              {ROLE_LABELS[project.role]}
            </div>
          )}
        </div>

        {/* Card body */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm text-white group-hover:text-indigo-300 transition-colors line-clamp-1">
              {project.name}
            </h3>
            <ArrowRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-0.5" />
          </div>
          {project.description && (
            <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{project.description}</p>
          )}
          <div className="flex items-center gap-3 mt-3 text-[11px] text-zinc-600">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(project.updatedAt)}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="truncate">{project.teamName}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function ThumbnailFallback({ thumbnailUrl }: { thumbnailUrl: string | null }) {
  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt="" className="w-full h-full object-cover opacity-60" />
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px]">
      <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500/40 rounded-sm" />
      </div>
    </div>
  )
}
