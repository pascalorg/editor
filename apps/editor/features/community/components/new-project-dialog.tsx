'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Switch } from '@/components/ui/primitives/switch'
import { createProject } from '../lib/projects/actions'

interface NewProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (projectId: string) => void
}

/**
 * NewProjectDialog - Dialog for creating a new project
 */
export function NewProjectDialog({ open, onOpenChange, onSuccess }: NewProjectDialogProps) {
  const [projectName, setProjectName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const name = projectName.trim() || 'Untitled Project'

    setIsCreating(true)

    try {
      const result = await createProject({ name, isPrivate })

      if (result.success && result.data) {
        onOpenChange(false)
        setProjectName('')
        setIsPrivate(false)
        onSuccess?.(result.data.id)
      } else {
        setError(result.error || 'Failed to create project')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsCreating(false)
    }
  }

  const handleClose = () => {
    if (!isCreating) {
      onOpenChange(false)
      setProjectName('')
      setIsPrivate(false)
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose} modal={false}>
      <DialogContent
        className="sm:max-w-125"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <button
            className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none"
            disabled={isCreating}
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {/* Project Name */}
          <div>
            <label htmlFor="project-name" className="text-sm font-medium">
              Project Name
            </label>
            <input
              id="project-name"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="My Project"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isCreating}
              autoFocus
            />
          </div>

          {/* Privacy Toggle */}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <div className="font-medium text-sm">Privacy</div>
              <div className="text-xs text-muted-foreground">
                {isPrivate ? 'Only you can view this project' : 'Anyone can view this project'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Public</span>
              <Switch checked={!isPrivate} onCheckedChange={(checked) => setIsPrivate(!checked)} />
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              className="rounded-md border border-input px-4 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              disabled={isCreating}
              type="button"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
              disabled={isCreating}
              type="submit"
            >
              {isCreating ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
