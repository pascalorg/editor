import {
  type AnyNodeId,
  type GuideNode,
  GuideNode as GuideNodeSchema,
  type LevelNode,
  type ScanNode,
  ScanNode as ScanNodeSchema,
  saveAsset,
  useScene,
} from '@pascal-app/core'
import { Box, Image, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useRef } from 'react'
import useEditor from '@/store/use-editor'
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

  const scanInputRef = useRef<HTMLInputElement>(null)
  const guideInputRef = useRef<HTMLInputElement>(null)

  const level = nodes[levelId as AnyNodeId] as LevelNode | undefined
  if (!level) return null

  // Find all scan and guide children of this level
  const references = Object.values(nodes).filter(
    (node): node is ScanNode | GuideNode =>
      (node.type === 'scan' || node.type === 'guide') && node.parentId === levelId,
  )

  const handleAddScan = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const url = await saveAsset(file)
      const node = ScanNodeSchema.parse({
        url,
        name: file.name,
        parentId: levelId,
      })
      createNode(node, levelId as AnyNodeId)
      e.target.value = ''
      // Auto-select and close dialog
      setSelectedReferenceId(node.id)
      onOpenChange(false)
    },
    [levelId, createNode, setSelectedReferenceId, onOpenChange],
  )

  const handleAddGuide = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const url = await saveAsset(file)
      const node = GuideNodeSchema.parse({
        url,
        name: file.name,
        parentId: levelId,
      })
      createNode(node, levelId as AnyNodeId)
      e.target.value = ''
      // Auto-select and close dialog
      setSelectedReferenceId(node.id)
      onOpenChange(false)
    },
    [levelId, createNode, setSelectedReferenceId, onOpenChange],
  )

  const handleEdit = useCallback(
    (nodeId: string) => {
      setSelectedReferenceId(nodeId)
      onOpenChange(false)
    },
    [setSelectedReferenceId, onOpenChange],
  )

  const handleDelete = useCallback(
    (nodeId: string) => {
      deleteNode(nodeId as AnyNodeId)
    },
    [deleteNode],
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
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer">
                <Plus className="w-3.5 h-3.5" />
                Add
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
