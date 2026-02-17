'use client'

import { Eye, Heart, Settings } from 'lucide-react'
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {projects.map((project) => (
          <div
            key={project.id}
            onClick={() => onProjectClick(project.id)}
            className="group relative overflow-hidden rounded-lg border border-border bg-card hover:border-primary transition-all text-left cursor-pointer"
          >
            {/* Thumbnail */}
            <div className="aspect-video bg-muted relative">
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
                <div className="absolute top-2 right-2">
                  {isAuthenticated && onSaveToCloud ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSaveToCloud(project)
                      }}
                      className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded transition-colors"
                      title="Save to cloud"
                    >
                      Save to cloud
                    </button>
                  ) : (
                    <div className="bg-blue-500 text-white text-xs px-2 py-1 rounded">
                      Local
                    </div>
                  )}
                </div>
              )}
              {canEdit && !isLocalProject(project) && (
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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

            {/* Info */}
            <div className="p-4">
              <h3 className="font-medium text-left line-clamp-2 mb-2">{project.name}</h3>

              {!isLocalProject(project) && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Eye className="w-4 h-4" />
                    <span>{project.views}</span>
                  </div>
                  <button
                    onClick={(e) => handleLikeClick(e, project.id)}
                    className="flex items-center gap-1 hover:text-red-500 transition-colors"
                    disabled={!isAuthenticated}
                  >
                    <Heart
                      className={`w-4 h-4 ${
                        userLikes[project.id]
                          ? 'fill-red-500 text-red-500'
                          : ''
                      }`}
                    />
                    <span>{likeCounts[project.id] ?? project.likes}</span>
                  </button>
                </div>
              )}

              {isLocalProject(project) && (
                <div className="text-sm text-muted-foreground">
                  {new Date(project.updated_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        ))}
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
