'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth/hooks'
import type { LocalProject } from '../lib/local-storage/project-store'
import { createLocalProject, getLocalProjects } from '../lib/local-storage/project-store'
import { getPublicProjects, getUserProjects } from '../lib/projects/actions'
import type { Project } from '../lib/projects/types'
import { CreateProjectButton } from './create-project-button'
import { NewProjectDialog } from './new-project-dialog'
import { ProfileDropdown } from './profile-dropdown'
import { ProjectGrid } from './project-grid'
import { SignInDialog } from './sign-in-dialog'

export default function CommunityHub() {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth()
  const router = useRouter()
  const [isSignInDialogOpen, setIsSignInDialogOpen] = useState(false)
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [localProjectToSave, setLocalProjectToSave] = useState<LocalProject | null>(null)
  const [publicProjects, setPublicProjects] = useState<Project[]>([])
  const [userProjects, setUserProjects] = useState<Project[]>([])
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadProjects() {
      setLoading(true)

      // Load public projects (always)
      const publicResult = await getPublicProjects()
      if (publicResult.success) {
        setPublicProjects(publicResult.data || [])
      }

      // Load user projects if authenticated
      if (isAuthenticated) {
        const userResult = await getUserProjects()
        if (userResult.success) {
          setUserProjects(userResult.data || [])
        }
      }

      // Always load local projects
      setLocalProjects(getLocalProjects())

      setLoading(false)
    }

    if (!authLoading) {
      loadProjects()
    }
  }, [isAuthenticated, authLoading])

  const handleCreateProject = async () => {
    if (!isAuthenticated) {
      // Create local project for guest
      const project = createLocalProject('Untitled Project')
      router.push(`/editor/${project.id}`)
    } else {
      // Open project creation dialog for authenticated users
      setIsNewProjectDialogOpen(true)
    }
  }

  const handleProjectCreated = async (projectId: string) => {
    // If this was a local project being saved, delete it from localStorage
    if (localProjectToSave) {
      const { deleteLocalProject } = await import('../lib/local-storage/project-store')
      deleteLocalProject(localProjectToSave.id)
      setLocalProjects(getLocalProjects())
      setLocalProjectToSave(null)
    }

    // Reload projects and navigate to the new project
    const result = await getUserProjects()
    if (result.success) {
      setUserProjects(result.data || [])
    }
    router.push(`/editor/${projectId}`)
  }

  const handleSaveLocalToCloud = (localProject: LocalProject) => {
    setLocalProjectToSave(localProject)
    setIsNewProjectDialogOpen(true)
  }

  const handleProjectClick = (projectId: string) => {
    router.push(`/editor/${projectId}`)
  }

  const handleViewProject = (projectId: string) => {
    router.push(`/viewer/${projectId}`)
  }

  if (authLoading || loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image
                src="/pascal-logo-shape.svg"
                alt="Pascal"
                width={64}
                height={64}
                className="h-5 w-5"
              />
              <h1 className="text-2xl font-bold">Hub</h1>
            </div>
            {!isAuthenticated ? (
              <button
                onClick={() => setIsSignInDialogOpen(true)}
                className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
              >
                Sign In
              </button>
            ) : (
              <ProfileDropdown />
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-12">
        {/* User's Projects Section */}
        {isAuthenticated && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">My Projects</h2>
              <CreateProjectButton onCreateProject={handleCreateProject} />
            </div>
            {userProjects.length === 0 && localProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
                <p className="text-muted-foreground">You don&apos;t have any projects yet.</p>
              </div>
            ) : (
              <ProjectGrid
                projects={[...userProjects, ...localProjects]}
                onProjectClick={handleProjectClick}
                onViewClick={handleViewProject}
                onSaveToCloud={handleSaveLocalToCloud}
                showOwner={false}
                canEdit
                onUpdate={() => {
                  if (!authLoading) {
                    getUserProjects().then((result) => {
                      if (result.success) {
                        setUserProjects(result.data || [])
                      }
                    })
                  }
                }}
              />
            )}
          </section>
        )}

        {/* Local Projects Section (Guest Users) */}
        {!isAuthenticated && localProjects.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">My Local Projects</h2>
              <CreateProjectButton onCreateProject={handleCreateProject} />
            </div>
            <ProjectGrid
              projects={localProjects}
              onProjectClick={handleProjectClick}
              showOwner={false}
              isLocal
            />
          </section>
        )}

        {/* Create First Project CTA */}
        {!isAuthenticated && localProjects.length === 0 && (
          <section className="text-center py-12">
            <h2 className="text-2xl font-semibold mb-4">Get Started</h2>
            <p className="text-muted-foreground mb-6">
              Create your first project to start designing
            </p>
            <CreateProjectButton onCreateProject={handleCreateProject} />
          </section>
        )}

        {/* Public Projects Section */}
        <section>
          <h2 className="text-xl font-semibold mb-6">Community Projects</h2>
          {publicProjects.length > 0 ? (
            <ProjectGrid
              projects={publicProjects}
              onProjectClick={handleViewProject}
              showOwner
            />
          ) : (
            <div className="text-center py-12 text-muted-foreground">No public projects yet</div>
          )}
        </section>
      </main>

      <SignInDialog open={isSignInDialogOpen} onOpenChange={setIsSignInDialogOpen} />
      <NewProjectDialog
        open={isNewProjectDialogOpen}
        onOpenChange={setIsNewProjectDialogOpen}
        onSuccess={handleProjectCreated}
        localProjectData={
          localProjectToSave
            ? {
                id: localProjectToSave.id,
                name: localProjectToSave.name,
                sceneGraph: localProjectToSave.scene_graph,
              }
            : undefined
        }
      />
    </div>
  )
}
