'use client'

import { Check, ChevronDown, Home, Plus } from 'lucide-react'
import { useState } from 'react'
import { useProjectStore } from '../lib/projects/store'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/primitives/dropdown-menu'
import { NewProjectDialog } from './new-project-dialog'
import { useProjectScene } from '../lib/models/hooks'

/**
 * ProjectDropdown - Shows active project and allows switching between projects
 */
export function ProjectDropdown() {
  useProjectScene() // Load and auto-save project scenes

  // Use project store
  const projects = useProjectStore(state => state.projects)
  const activeProject = useProjectStore(state => state.activeProject)
  const isLoading = useProjectStore(state => state.isLoading)
  const setActiveProject = useProjectStore(state => state.setActiveProject)
  const fetchProjects = useProjectStore(state => state.fetchProjects)

  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)

  const handleProjectSelect = async (projectId: string) => {
    await setActiveProject(projectId)
  }

  const handleAddNew = () => {
    setIsNewProjectDialogOpen(true)
  }

  const handleProjectCreated = async (projectId: string) => {
    // Set the newly created project as active (this will also fetch projects)
    await setActiveProject(projectId)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background/95 px-3 text-sm shadow-lg backdrop-blur-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 focus:outline-none"
            disabled={isLoading}
            type="button"
          >
            <Home className="h-4 w-4" />
            <span className="max-w-[150px] truncate">
              {activeProject
                ? activeProject.name
                : projects.length > 0
                  ? 'Select Project'
                  : 'Add Project'}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[280px]">
          {/* Project list */}
          {projects.length > 0 ? (
            <div className="max-h-[300px] overflow-y-auto">
              {projects.map((project) => (
                <DropdownMenuItem
                  className={cn(
                    'cursor-pointer text-sm',
                    activeProject?.id === project.id && 'cursor-default bg-accent',
                  )}
                  key={project.id}
                  onClick={() =>
                    activeProject?.id === project.id ? null : handleProjectSelect(project.id)
                  }
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex-1 truncate font-medium">{project.name}</div>
                    {activeProject?.id === project.id && (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          ) : (
            <div className="px-2 py-3 text-center text-muted-foreground text-sm">
              No projects yet
            </div>
          )}

          {/* Add new project option */}
          <DropdownMenuItem className="cursor-pointer" onClick={handleAddNew}>
            <Plus className="mr-2 h-4 w-4" />
            <span>Add new project</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewProjectDialog
        open={isNewProjectDialogOpen}
        onOpenChange={setIsNewProjectDialogOpen}
        onSuccess={handleProjectCreated}
      />
    </>
  )
}
