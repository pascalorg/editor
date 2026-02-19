'use client'

import { useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { Switch } from '@/components/ui/primitives/switch'
import { updateProjectName, updateProjectVisibility, deleteProject } from '../lib/projects/actions'
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
  const [isDeleting, setIsDeleting] = useState(false)
  const [name, setName] = useState(project.name || '')
  const [isPrivate, setIsPrivate] = useState(project.is_private)
  const [showScansPublic, setShowScansPublic] = useState(project.show_scans_public ?? true)
  const [showGuidesPublic, setShowGuidesPublic] = useState(project.show_guides_public ?? true)
  const nameTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleNameChange = (value: string) => {
    setName(value)
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    nameTimerRef.current = setTimeout(async () => {
      const trimmed = value.trim()
      if (trimmed && trimmed !== (project.name || '')) {
        await updateProjectName(project.id, trimmed)
        onUpdate?.()
      }
    }, 500)
  }

  const handleVisibilityChange = async (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => {
    if (field === 'isPrivate') setIsPrivate(value)
    if (field === 'showScansPublic') setShowScansPublic(value)
    if (field === 'showGuidesPublic') setShowGuidesPublic(value)

    await updateProjectVisibility(project.id, { [field]: value })
    onUpdate?.()
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
          <DialogDescription>Changes are saved automatically</DialogDescription>
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
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My Project"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
              <Switch checked={!isPrivate} onCheckedChange={(checked) => handleVisibilityChange('isPrivate', !checked)} />
            </div>
          </div>

          {/* Public Visibility Toggles */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Show 3D Scans</div>
              <div className="text-sm text-muted-foreground">
                Visible to public viewers
              </div>
            </div>
            <Switch checked={showScansPublic} onCheckedChange={(checked) => handleVisibilityChange('showScansPublic', checked)} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Show Floorplans</div>
              <div className="text-sm text-muted-foreground">
                Visible to public viewers
              </div>
            </div>
            <Switch checked={showGuidesPublic} onCheckedChange={(checked) => handleVisibilityChange('showGuidesPublic', checked)} />
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
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete Project'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
