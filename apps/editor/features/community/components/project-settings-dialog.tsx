'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { Switch } from '@/components/ui/primitives/switch'
import { updateProjectName, updateProjectPrivacy, deleteProject } from '../lib/projects/actions'
import type { Project } from '../lib/projects/types'

interface ProjectSettingsDialogProps {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: () => void
  onDelete?: () => void
}

export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange,
  onUpdate,
  onDelete,
}: ProjectSettingsDialogProps) {
  const [loading, setLoading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [name, setName] = useState(project.name || '')
  const [isPrivate, setIsPrivate] = useState(project.is_private)

  const handleSave = async () => {
    setLoading(true)
    try {
      // Update name if changed
      const trimmedName = name.trim()
      if (trimmedName && trimmedName !== (project.name || '')) {
        const nameResult = await updateProjectName(project.id, trimmedName)
        if (!nameResult.success) {
          alert(`Failed to update name: ${nameResult.error}`)
          setLoading(false)
          return
        }
      }

      // Update privacy if changed
      if (isPrivate !== project.is_private) {
        const privacyResult = await updateProjectPrivacy(project.id, isPrivate)
        if (!privacyResult.success) {
          alert(`Failed to update privacy: ${privacyResult.error}`)
          setLoading(false)
          return
        }
      }

      onUpdate?.()
      onOpenChange(false)
    } catch (error) {
      alert('Failed to save settings')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      return
    }

    setIsDeleting(true)
    try {
      const result = await deleteProject(project.id)
      if (result.success) {
        onDelete?.()
        onOpenChange(false)
      } else {
        alert(`Failed to delete project: ${result.error}`)
      }
    } catch (error) {
      alert('Failed to delete project')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>Update project name and privacy settings</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Project Name */}
          <div>
            <label htmlFor="project-name" className="font-medium text-sm">
              Project Name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={loading}
            />
          </div>

          {/* Privacy Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Privacy</div>
              <div className="text-sm text-muted-foreground">
                {isPrivate ? 'Only you can view this project' : 'Anyone can view this project'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Public</span>
              <Switch checked={!isPrivate} onCheckedChange={(checked) => setIsPrivate(!checked)} />
            </div>
          </div>

          {/* Danger Zone */}
          <div className="border-t border-border pt-6">
            <h3 className="font-medium text-destructive mb-2">Danger Zone</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Once you delete a project, there is no going back. Please be certain.
            </p>
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive hover:bg-destructive/20"
              disabled={isDeleting || loading}
            >
              {isDeleting ? 'Deleting...' : 'Delete Project'}
            </button>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
            disabled={loading || isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            disabled={loading || isDeleting}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
