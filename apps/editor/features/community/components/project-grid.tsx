'use client'

import { Eye, Heart, Settings } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { Project } from '../lib/projects/types'
import type { LocalProject } from '../lib/local-storage/project-store'
import { ProjectSettingsDialog } from './project-settings-dialog'
import { getUserProjectLikes, toggleProjectLike } from '../lib/projects/actions'
import { useAuth } from '../lib/auth/hooks'

interface ProjectGridProps {
  projects: (Project | LocalProject)[]
  onProjectClick: (id: string) => void
  onViewClick?: (id: string) => void
  onSaveToCloud?: (project: LocalProject) => void
  showOwner: boolean
  isLocal?: boolean
  canEdit?: boolean
  onUpdate?: () => void
}

function isLocalProject(prop: Project | LocalProject): prop is LocalProject {
  return 'is_local' in prop && prop.is_local === true
}

export function ProjectGrid({
  projects,
  onProjectClick,
  onViewClick,
  onSaveToCloud,
  showOwner,
  isLocal = false,
  canEdit = false,
  onUpdate,
}: ProjectGridProps) {
  const { isAuthenticated } = useAuth()
  const [settingsProject, setSettingsProject] = useState<Project | null>(null)
  const [userLikes, setUserLikes] = useState<Record<string, boolean>>({})
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({})

  // Initialize like counts from projects
  useEffect(() => {
    const counts: Record<string, number> = {}
    projects.forEach((proj) => {
      if (!isLocalProject(proj)) {
        counts[proj.id] = proj.likes
      }
    })
    setLikeCounts(counts)
  }, [projects])

  // Fetch which projects the user has liked
  useEffect(() => {
    if (!isAuthenticated) {
      setUserLikes({})
      return
    }

    const projectIds = projects
      .filter((p) => !isLocalProject(p))
      .map((p) => p.id)

    if (projectIds.length === 0) return

    getUserProjectLikes(projectIds).then((result) => {
      if (result.success && result.data) {
        setUserLikes(result.data)
      }
    })
  }, [projects, isAuthenticated])

  const handleSettingsClick = (e: React.MouseEvent, project: Project | LocalProject) => {
    e.stopPropagation()
    if (!isLocalProject(project)) {
      setSettingsProject(project)
    }
  }

  const handleViewClick = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    onViewClick?.(projectId)
  }

  const handleLikeClick = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()

    if (!isAuthenticated) {
      // Could show a sign-in prompt here
      return
    }

    // Optimistic update
    const wasLiked = userLikes[projectId] || false
    const currentCount = likeCounts[projectId] || 0

    setUserLikes((prev) => ({ ...prev, [projectId]: !wasLiked }))
    setLikeCounts((prev) => ({
      ...prev,
      [projectId]: wasLiked ? currentCount - 1 : currentCount + 1
    }))

    // Call server action
    const result = await toggleProjectLike(projectId)

    if (result.success && result.data) {
      // Update with actual values from server
      const data = result.data
      setUserLikes((prev) => ({ ...prev, [projectId]: data.liked }))
      setLikeCounts((prev) => ({ ...prev, [projectId]: data.likes }))
    } else {
      // Revert on error
      setUserLikes((prev) => ({ ...prev, [projectId]: wasLiked }))
      setLikeCounts((prev) => ({ ...prev, [projectId]: currentCount }))
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {projects.map((project) => {
          const owner = !isLocalProject(project) ? project.owner : null

          return (
            <div
              key={project.id}
              onClick={() => onProjectClick(project.id)}
              className="group text-left cursor-pointer"
            >
              {/* Thumbnail card */}
              <div className="relative aspect-[4/3] rounded-xl rounded-smooth-xl bg-neutral-50 overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)] transition-shadow group-hover:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)]">
                {!isLocalProject(project) && project.thumbnail_url ? (
                  <img
                    src={project.thumbnail_url}
                    alt={project.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    No preview
                  </div>
                )}
                {isLocalProject(project) && (
                  <div className="absolute top-3 right-3">
                    {isAuthenticated && onSaveToCloud ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSaveToCloud(project)
                        }}
                        className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2.5 py-1 rounded-md transition-colors"
                        title="Save to cloud"
                      >
                        Save to cloud
                      </button>
                    ) : (
                      <div className="bg-blue-500 text-white text-xs px-2.5 py-1 rounded-md">
                        Local
                      </div>
                    )}
                  </div>
                )}
                {canEdit && !isLocalProject(project) && (
                  <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onViewClick && (
                      <button
                        onClick={(e) => handleViewClick(e, project.id)}
                        className="bg-background/80 hover:bg-background rounded-md p-1.5"
                        aria-label="View"
                        title="View in viewer mode"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={(e) => handleSettingsClick(e, project)}
                      className="bg-background/80 hover:bg-background rounded-md p-1.5"
                      aria-label="Settings"
                      title="Project settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Info row below the card */}
              <div className="flex items-center gap-3 mt-3">
                {/* Avatar */}
                {showOwner && owner ? (
                  <Link
                    href={owner.username ? `/u/${owner.username}` : '#'}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                  >
                    {owner.image ? (
                      <img
                        src={owner.image}
                        alt={owner.name}
                        className="w-9 h-9 rounded-full object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.1)]"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center text-sm font-medium shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
                        {owner.name?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                  </Link>
                ) : null}

                {/* Name + stats */}
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-sm truncate">{project.name}</h3>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    {showOwner && owner && (
                      <>
                        <Link
                          href={owner.username ? `/u/${owner.username}` : '#'}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-foreground transition-colors truncate"
                        >
                          {owner.username || owner.name}
                        </Link>
                        {!isLocalProject(project) && <span className="shrink-0">·</span>}
                      </>
                    )}
                    {!isLocalProject(project) && (
                      <>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Eye className="w-3.5 h-3.5" />
                          <span>{project.views}</span>
                        </div>
                        <span className="shrink-0">·</span>
                        <button
                          onClick={(e) => handleLikeClick(e, project.id)}
                          className="flex items-center gap-0.5 shrink-0 hover:text-red-500 transition-colors"
                          disabled={!isAuthenticated}
                        >
                          <Heart
                            className={`w-3.5 h-3.5 ${
                              userLikes[project.id]
                                ? 'fill-red-500 text-red-500'
                                : ''
                            }`}
                          />
                          <span>{likeCounts[project.id] ?? project.likes}</span>
                        </button>
                      </>
                    )}
                    {isLocalProject(project) && (
                      <span>{new Date(project.updated_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Settings Dialog */}
      {settingsProject && (
        <ProjectSettingsDialog
          project={settingsProject}
          open={!!settingsProject}
          onOpenChange={(open) => !open && setSettingsProject(null)}
          onUpdate={onUpdate}
          onDelete={() => {
            setSettingsProject(null)
            onUpdate?.()
          }}
        />
      )}
    </>
  )
}
