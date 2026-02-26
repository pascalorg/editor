'use client'

import {
  type AnyNodeId,
  type GuideNode,
  GuideNode as GuideNodeSchema,
  type LevelNode,
  type ScanNode,
  ScanNode as ScanNodeSchema,
  useScene,
} from '@pascal-app/core'
import { Box, Image, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import useEditor from '@/store/use-editor'
import { deleteProjectAssetByUrl, uploadProjectAsset } from '@/features/community/lib/assets/actions'
import { useProjectStore } from '@/features/community/lib/projects/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/primitives/popover'

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB — matches server action bodySizeLimit

interface ReferencesDialogProps {
  levelId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReferencesDialog({ levelId, open, onOpenChange }: ReferencesDialogProps) {
  const nodes = useScene((s) => s.nodes)
  const createNode = useScene((s) => s.createNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  const activeProject = useProjectStore((s) => s.activeProject)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const scanInputRef = useRef<HTMLInputElement>(null)
  const guideInputRef = useRef<HTMLInputElement>(null)

  const handleAddScan = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = ''

      const projectId = activeProject?.id
      if (!projectId) {
        setUploadError('No active project. Please open a project first.')
        return
      }

      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`File is too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum size is 100 MB.`)
        return
      }

      setUploadError(null)
      setUploading(true)
      const result = await uploadProjectAsset(projectId, file, 'scan')
      setUploading(false)

      if (!result.success) {
        setUploadError(result.error)
        return
      }

      const node = ScanNodeSchema.parse({
        url: result.url,
        name: file.name,
        parentId: levelId,
      })
      createNode(node, levelId as AnyNodeId)
      // Auto-select and close dialog
      setSelectedReferenceId(node.id)
      onOpenChange(false)
    },
    [levelId, createNode, setSelectedReferenceId, onOpenChange, activeProject],
  )

  const handleAddGuide = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = ''

      const projectId = activeProject?.id
      if (!projectId) {
        setUploadError('No active project. Please open a project first.')
        return
      }

      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`File is too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum size is 100 MB.`)
        return
      }

      setUploadError(null)
      setUploading(true)
      const result = await uploadProjectAsset(projectId, file, 'guide')
      setUploading(false)

      if (!result.success) {
        setUploadError(result.error)
        return
      }

      const node = GuideNodeSchema.parse({
        url: result.url,
        name: file.name,
        parentId: levelId,
      })
      createNode(node, levelId as AnyNodeId)
      // Auto-select and close dialog
      setSelectedReferenceId(node.id)
      onOpenChange(false)
    },
    [levelId, createNode, setSelectedReferenceId, onOpenChange, activeProject],
  )

  const handleEdit = useCallback(
    (nodeId: string) => {
      setSelectedReferenceId(nodeId)
      onOpenChange(false)
    },
    [setSelectedReferenceId, onOpenChange],
  )

  const handleDelete = useCallback(
    async (nodeId: string) => {
      const refNode = nodes[nodeId as AnyNodeId] as ScanNode | GuideNode | undefined
      const projectId = activeProject?.id

      // Delete storage asset first (before removing from scene)
      if (
        projectId &&
        refNode?.url &&
        (refNode.url.startsWith('http://') || refNode.url.startsWith('https://'))
      ) {
        const result = await deleteProjectAssetByUrl(projectId, refNode.url)
        if (!result.success) {
          setUploadError(`Failed to delete asset: ${result.error}`)
          return
        }
      }

      deleteNode(nodeId as AnyNodeId)
    },
    [deleteNode, nodes, activeProject],
  )

  const level = nodes[levelId as AnyNodeId] as LevelNode | undefined
  if (!level) return null

  // Find all scan and guide children of this level
  const references = Object.values(nodes).filter(
    (node): node is ScanNode | GuideNode =>
      (node.type === 'scan' || node.type === 'guide') && node.parentId === levelId,
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>References — {level.name || `Level ${level.level}`}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {references.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No references yet. Add a 3D scan or guide image.
            </p>
          )}

          {references.map((ref) => (
            <div
              key={ref.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent/50 group"
            >
              {ref.type === 'scan' ? (
                <Box className="w-4 h-4 shrink-0 text-muted-foreground" />
              ) : (
                <Image className="w-4 h-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex-1 truncate">
                {ref.name || (ref.type === 'scan' ? '3D Scan' : 'Guide Image')}
              </span>
              <button
                className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded hover:bg-accent cursor-pointer"
                onClick={() => handleEdit(ref.id)}
                title="Edit"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive cursor-pointer"
                onClick={() => handleDelete(ref.id)}
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {uploadError && (
          <p className="text-xs text-destructive px-1 pb-1">{uploadError}</p>
        )}

        <div className="flex justify-end pt-2 border-t border-border/50">
          <input
            ref={scanInputRef}
            type="file"
            accept=".glb,.gltf"
            className="hidden"
            onChange={handleAddScan}
          />
          <input
            ref={guideInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAddGuide}
          />

          <Popover>
            <PopoverTrigger asChild>
              <button
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5" />
                {uploading ? 'Uploading…' : 'Add'}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <button
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm hover:bg-accent cursor-pointer"
                onClick={() => scanInputRef.current?.click()}
              >
                <Box className="w-4 h-4" />
                3D Scan
              </button>
              <button
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm hover:bg-accent cursor-pointer"
                onClick={() => guideInputRef.current?.click()}
              >
                <Image className="w-4 h-4" />
                Guide Image
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </DialogContent>
    </Dialog>
  )
}
