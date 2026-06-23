import { emitter, type AnyNode, type AnyNodeId, useScene, validateBuildJson } from '@pascal-app/core'
import { exportSceneToDxf } from '@pascal-app/core/exporters/dxf'
import { exportSceneToIfcWithItemMeshes } from './../../../../../lib/export-ifc'
import { useViewer } from '@pascal-app/viewer'
import { TreeView, VisualJson } from '@visual-json/react'
import { Camera, Download, FlipHorizontal2, Move, Save, Trash2, Upload } from 'lucide-react'
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import { Switch } from './../../../../../components/ui/primitives/switch'
import useEditor, { selectDefaultBuildingAndLevel } from './../../../../../store/use-editor'
import { AudioSettingsDialog } from './audio-settings-dialog'
import { KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog'
import { LoadBuildDialog, type PendingImport } from './load-build-dialog'

type SceneNode = Record<string, unknown> & {
  id?: unknown
  type?: unknown
  name?: unknown
  parentId?: unknown
  children?: unknown
}

type CenterBounds = {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  hasPoint: boolean
}

const CENTER_LAYOUT_EPSILON = 0.001

function isPlanPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  )
}

function isVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Number.isFinite(value[2])
  )
}

function extendCenterBounds(bounds: CenterBounds, point: [number, number]) {
  bounds.minX = Math.min(bounds.minX, point[0])
  bounds.minZ = Math.min(bounds.minZ, point[1])
  bounds.maxX = Math.max(bounds.maxX, point[0])
  bounds.maxZ = Math.max(bounds.maxZ, point[1])
  bounds.hasPoint = true
}

function shouldCenterNode(node: AnyNode): boolean {
  return node.type !== 'site' && node.type !== 'building' && node.type !== 'level'
}

function hasPlanPositionInLayoutSpace(node: AnyNode, nodes: Record<string, AnyNode>): boolean {
  if (!node.parentId) return true

  const parent = nodes[node.parentId]
  return parent?.type === 'site' || parent?.type === 'building' || parent?.type === 'level'
}

function computeCenterableBounds(nodes: Record<string, AnyNode>): CenterBounds {
  const bounds: CenterBounds = {
    minX: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    hasPoint: false,
  }

  for (const node of Object.values(nodes)) {
    if (!shouldCenterNode(node)) continue
    const record = node as unknown as Record<string, unknown>

    if (isPlanPoint(record.start)) {
      extendCenterBounds(bounds, record.start)
    }
    if (isPlanPoint(record.end)) {
      extendCenterBounds(bounds, record.end)
    }

    if (Array.isArray(record.polygon)) {
      for (const point of record.polygon) {
        if (isPlanPoint(point)) extendCenterBounds(bounds, point)
      }
    }

    if (isVec3(record.position) && hasPlanPositionInLayoutSpace(node, nodes)) {
      extendCenterBounds(bounds, [record.position[0], record.position[2]])
    }
  }

  return bounds
}

function translatePlanPoint(point: [number, number], dx: number, dz: number): [number, number] {
  return [point[0] + dx, point[1] + dz]
}

function translateVec3(point: [number, number, number], dx: number, dz: number): [number, number, number] {
  return [point[0] + dx, point[1], point[2] + dz]
}

function mirrorPlanPoint(point: [number, number]): [number, number] {
  return [point[0], -point[1]]
}

function mirrorVec3(point: [number, number, number]): [number, number, number] {
  return [point[0], point[1], -point[2]]
}

function mirrorRotationTuple(rotation: [number, number, number]): [number, number, number] {
  return [-rotation[0], -rotation[1], rotation[2]]
}

function flipLeftRight<T extends string>(value: T, left: T, right: T): T {
  if (value === left) return right
  if (value === right) return left
  return value
}

function buildCenterLayoutUpdates(
  nodes: Record<string, AnyNode>,
  dx: number,
  dz: number,
): { id: AnyNodeId; data: Partial<AnyNode> }[] {
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []

  for (const node of Object.values(nodes)) {
    if (!shouldCenterNode(node)) continue
    const record = node as unknown as Record<string, unknown>
    const data: Record<string, unknown> = {}

    if (isPlanPoint(record.start)) {
      data.start = translatePlanPoint(record.start, dx, dz)
    }
    if (isPlanPoint(record.end)) {
      data.end = translatePlanPoint(record.end, dx, dz)
    }
    if (Array.isArray(record.polygon) && record.polygon.every(isPlanPoint)) {
      data.polygon = record.polygon.map((point) => translatePlanPoint(point, dx, dz))
    }
    if (isVec3(record.position) && hasPlanPositionInLayoutSpace(node, nodes)) {
      data.position = translateVec3(record.position, dx, dz)
    }

    if (Object.keys(data).length > 0) {
      updates.push({ id: node.id as AnyNodeId, data: data as Partial<AnyNode> })
    }
  }

  return updates
}

function buildMirrorLayoutUpdates(
  nodes: Record<string, AnyNode>,
): { id: AnyNodeId; data: Partial<AnyNode> }[] {
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []

  for (const node of Object.values(nodes)) {
    if (!shouldCenterNode(node)) continue
    const record = node as unknown as Record<string, unknown>
    const data: Record<string, unknown> = {}

    if (isPlanPoint(record.start)) {
      data.start = mirrorPlanPoint(record.start)
    }
    if (isPlanPoint(record.end)) {
      data.end = mirrorPlanPoint(record.end)
    }
    if (Array.isArray(record.polygon) && record.polygon.every(isPlanPoint)) {
      data.polygon = record.polygon.map((point) => mirrorPlanPoint(point)).reverse()
    }
    if (isVec3(record.position) && hasPlanPositionInLayoutSpace(node, nodes)) {
      data.position = mirrorVec3(record.position)
    }
    if (typeof record.rotation === 'number' && Number.isFinite(record.rotation)) {
      data.rotation = -record.rotation
    } else if (isVec3(record.rotation)) {
      data.rotation = mirrorRotationTuple(record.rotation)
    }
    if (typeof record.curveOffset === 'number' && Number.isFinite(record.curveOffset)) {
      data.curveOffset = -record.curveOffset
    }
    if (typeof record.sweepAngle === 'number' && Number.isFinite(record.sweepAngle)) {
      data.sweepAngle = -record.sweepAngle
    }
    if (record.side === 'front' || record.side === 'back') {
      data.side = record.side === 'front' ? 'back' : 'front'
    }
    if (record.hingesSide === 'left' || record.hingesSide === 'right') {
      data.hingesSide = flipLeftRight(record.hingesSide, 'left', 'right')
    }
    if (record.attachmentSide === 'left' || record.attachmentSide === 'right') {
      data.attachmentSide = flipLeftRight(record.attachmentSide, 'left', 'right')
    }

    if (Object.keys(data).length > 0) {
      updates.push({ id: node.id as AnyNodeId, data: data as Partial<AnyNode> })
    }
  }

  return updates
}

type SceneGraphNode = {
  id: string
  type: string
  name: string | null
  parentId: string | null
  children: SceneGraphNode[]
  missing?: true
  cycle?: true
}

type SceneGraphValue = {
  roots: SceneGraphNode[]
  detachedNodes?: SceneGraphNode[]
}

const isSceneNode = (value: unknown): value is SceneNode => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as { id: unknown }).id === 'string'
  )
}

const getChildIdsFromNode = (node: SceneNode): string[] => {
  if (!Array.isArray(node.children)) {
    return []
  }

  const childIds = new Set<string>()

  for (const child of node.children) {
    if (typeof child === 'string') {
      childIds.add(child)
      continue
    }

    if (isSceneNode(child)) {
      childIds.add(child.id as string)
    }
  }

  return Array.from(childIds)
}

const buildSceneGraphValue = (
  nodes: Record<string, SceneNode>,
  rootNodeIds: string[],
): SceneGraphValue => {
  const childIdsByParent = new Map<string, Set<string>>()

  for (const [id, node] of Object.entries(nodes)) {
    const childIds = getChildIdsFromNode(node)
    if (childIds.length > 0) {
      childIdsByParent.set(id, new Set(childIds))
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (typeof node.parentId !== 'string') {
      continue
    }

    const siblings = childIdsByParent.get(node.parentId) ?? new Set<string>()
    siblings.add(id)
    childIdsByParent.set(node.parentId, siblings)
  }

  const visited = new Set<string>()

  const buildNode = (id: string, path: Set<string>): SceneGraphNode => {
    const node = nodes[id]
    if (!node) {
      return {
        id,
        type: 'missing',
        name: null,
        parentId: null,
        missing: true,
        children: [],
      }
    }

    const nodeType = typeof node.type === 'string' ? node.type : 'unknown'
    const nodeName = typeof node.name === 'string' ? node.name : null
    const parentId = typeof node.parentId === 'string' ? node.parentId : null

    if (path.has(id)) {
      return {
        id,
        type: nodeType,
        name: nodeName,
        parentId,
        cycle: true,
        children: [],
      }
    }

    visited.add(id)
    const nextPath = new Set(path)
    nextPath.add(id)

    const childIds = Array.from(childIdsByParent.get(id) ?? [])
    return {
      id,
      type: nodeType,
      name: nodeName,
      parentId,
      children: childIds.map((childId) => buildNode(childId, nextPath)),
    }
  }

  const roots = rootNodeIds.map((id) => buildNode(id, new Set()))
  const detachedNodeIds = Object.keys(nodes).filter((id) => !visited.has(id))

  if (detachedNodeIds.length === 0) {
    return { roots }
  }

  return {
    roots,
    detachedNodes: detachedNodeIds.map((id) => buildNode(id, new Set())),
  }
}

export interface ProjectVisibility {
  isPrivate: boolean
  showScansPublic: boolean
  showGuidesPublic: boolean
}

export interface SettingsPanelProps {
  projectId?: string
  projectVisibility?: ProjectVisibility
  onVisibilityChange?: (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => Promise<void>
}

export function SettingsPanel({
  projectId,
  projectVisibility,
  onVisibilityChange,
}: SettingsPanelProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const setScene = useScene((state) => state.setScene)
  const clearScene = useScene((state) => state.clearScene)
  const updateNodes = useScene((state) => state.updateNodes)
  const resetSelection = useViewer((state) => state.resetSelection)
  const exportScene = useViewer((state) => state.exportScene)
  const showGrid = useViewer((state) => state.showGrid)
  const shadows = useViewer((state) => state.shadows)
  const preserveItemModelMaterials = useViewer((state) => state.preserveItemModelMaterials)
  const setPreserveItemModelMaterials = useViewer((state) => state.setPreserveItemModelMaterials)
  const setPhase = useEditor((state) => state.setPhase)
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [layoutStatus, setLayoutStatus] = useState<string | null>(null)
  const sceneGraphValue = useMemo(
    () => buildSceneGraphValue(nodes as Record<string, SceneNode>, rootNodeIds),
    [nodes, rootNodeIds],
  )
  const blockSceneGraphMutations = useCallback((event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])
  const blockSceneGraphDeletion = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [])

  const isLocalProject = false // Props-based; only show cloud sections when projectId provided

  const handleExportDxf = () => {
    const dxfContent = exportSceneToDxf(nodes as Parameters<typeof exportSceneToDxf>[0])
    const blob = new Blob([dxfContent], { type: 'application/dxf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const date = new Date().toISOString().split('T')[0]
    link.download = `floorplan_${date}.dxf`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleExportIfc = async () => {
    const ifcContent = await exportSceneToIfcWithItemMeshes(
      nodes as Parameters<typeof exportSceneToIfcWithItemMeshes>[0],
    )
    const blob = new Blob([ifcContent], { type: 'application/x-step' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const date = new Date().toISOString().split('T')[0]
    link.download = `model_${date}.ifc`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveBuild = () => {
    const sceneData = { nodes, rootNodeIds }
    const json = JSON.stringify(sceneData, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const date = new Date().toISOString().split('T')[0]
    link.download = `layout_${date}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        setPendingImport({
          fileName: file.name,
          fileSizeBytes: file.size,
          result: {
            ok: false,
            parsed: null,
            stats: { total: 0, byType: {}, unknownTypes: {}, floorAreaM2: 0 },
            errors: [
              {
                severity: 'error',
                code: 'invalid_json',
                message: 'File could not be parsed as JSON.',
              },
            ],
            warnings: [],
            schemaIssues: [],
            schemaIssueCount: 0,
          },
        })
        return
      }
      setPendingImport({
        fileName: file.name,
        fileSizeBytes: file.size,
        result: validateBuildJson(parsed),
      })
    }
    reader.readAsText(file)

    // Reset input so the same file can be loaded again
    e.target.value = ''
  }

  const handleConfirmImport = (parsed: { nodes: Record<string, unknown>; rootNodeIds: string[] }) => {
    setScene(
      parsed.nodes as Parameters<typeof setScene>[0],
      parsed.rootNodeIds as Parameters<typeof setScene>[1],
    )
    resetSelection()
    setPhase('site')
    setPendingImport(null)
  }

  const handleResetToDefault = () => {
    clearScene()
    resetSelection()
    setPhase('structure')
    selectDefaultBuildingAndLevel()
  }

  const handleGenerateThumbnail = () => {
    if (!projectId) return
    setIsGeneratingThumbnail(true)
    emitter.emit('camera-controls:generate-thumbnail', { projectId })
    setTimeout(() => setIsGeneratingThumbnail(false), 3000)
  }

  const handleCenterLayout = useCallback(() => {
    const bounds = computeCenterableBounds(nodes as Record<string, AnyNode>)
    if (!bounds.hasPoint) {
      setLayoutStatus('No layout geometry found.')
      return
    }

    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerZ = (bounds.minZ + bounds.maxZ) / 2
    const dx = -centerX
    const dz = -centerZ

    if (Math.abs(dx) < CENTER_LAYOUT_EPSILON && Math.abs(dz) < CENTER_LAYOUT_EPSILON) {
      setLayoutStatus('Layout is already centered.')
      return
    }

    const updates = buildCenterLayoutUpdates(nodes as Record<string, AnyNode>, dx, dz)
    if (updates.length === 0) {
      setLayoutStatus('No movable layout nodes found.')
      return
    }

    updateNodes(updates)
    setLayoutStatus(`Centered ${updates.length} nodes by ${dx.toFixed(2)}m, ${dz.toFixed(2)}m.`)
  }, [nodes, updateNodes])

  const handleMirrorLayout = useCallback(() => {
    const updates = buildMirrorLayoutUpdates(nodes as Record<string, AnyNode>)
    if (updates.length === 0) {
      setLayoutStatus('No mirrorable layout nodes found.')
      return
    }

    updateNodes(updates)
    setLayoutStatus(`Mirrored ${updates.length} nodes across Z = 0.`)
  }, [nodes, updateNodes])

  const handleVisibilityChange = async (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => {
    await onVisibilityChange?.(field, value)
  }

  return (
    <div className="flex flex-col gap-6 p-3">
      {/* Visibility Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-3">
          <label className="font-medium text-muted-foreground text-xs uppercase">Visibility</label>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Public</div>
              <div className="text-muted-foreground text-xs">
                {projectVisibility?.isPrivate ? 'Only you' : 'Anyone'} can view
              </div>
            </div>
            <Switch
              checked={!(projectVisibility?.isPrivate ?? false)}
              onCheckedChange={(checked) => handleVisibilityChange('isPrivate', !checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Show 3D Scans</div>
              <div className="text-muted-foreground text-xs">Visible to public viewers</div>
            </div>
            <Switch
              checked={projectVisibility?.showScansPublic ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showScansPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Show Floorplans</div>
              <div className="text-muted-foreground text-xs">Visible to public viewers</div>
            </div>
            <Switch
              checked={projectVisibility?.showGuidesPublic ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showGuidesPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Show Grid</div>
              <div className="text-muted-foreground text-xs">Visible only in the editor</div>
            </div>
            <Switch
              checked={showGrid}
              onCheckedChange={(checked) => useViewer.getState().setShowGrid(checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Shadows</div>
              <div className="text-muted-foreground text-xs">Cast shadows from lights</div>
            </div>
            <Switch
              checked={shadows}
              onCheckedChange={(checked) => useViewer.getState().setShadows(checked)}
            />
          </div>
        </div>
      )}

      {/* Rendering Section */}
      <div className="space-y-3">
        <label className="font-medium text-muted-foreground text-xs uppercase">Rendering</label>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-sm">Preserve 3D model materials</div>
            <div className="text-muted-foreground text-xs">Use original catalog model textures</div>
          </div>
          <Switch
            checked={preserveItemModelMaterials}
            onCheckedChange={setPreserveItemModelMaterials}
          />
        </div>
      </div>

      {/* Export Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">Export</label>
        <Button
          className="w-full justify-start gap-2"
          onClick={() => exportScene?.('glb')}
          variant="outline"
        >
          <Download className="size-4" />
          Export GLB
        </Button>
        <Button
          className="w-full justify-start gap-2"
          onClick={() => exportScene?.('stl')}
          variant="outline"
        >
          <Download className="size-4" />
          Export STL
        </Button>
        <Button
          className="w-full justify-start gap-2"
          onClick={() => exportScene?.('obj')}
          variant="outline"
        >
          <Download className="size-4" />
          Export OBJ
        </Button>
        <Button
          className="w-full justify-start gap-2"
          onClick={handleExportDxf}
          variant="outline"
        >
          <Download className="size-4" />
          Export DXF
        </Button>
        <Button
          className="w-full justify-start gap-2"
          onClick={handleExportIfc}
          variant="outline"
        >
          <Download className="size-4" />
          Export IFC (BIM)
        </Button>
      </div>

      {/* Layout Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">Layout</label>
        <Button className="w-full justify-start gap-2" onClick={handleCenterLayout} variant="outline">
          <Move className="size-4" />
          Center Layout
        </Button>
        <Button className="w-full justify-start gap-2" onClick={handleMirrorLayout} variant="outline">
          <FlipHorizontal2 className="size-4" />
          Mirror Layout
        </Button>
        {layoutStatus ? (
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
            {layoutStatus}
          </div>
        ) : null}
      </div>

      {/* Thumbnail Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">Thumbnail</label>
          <Button
            className="w-full justify-start gap-2"
            disabled={isGeneratingThumbnail}
            onClick={handleGenerateThumbnail}
            variant="outline"
          >
            <Camera className="size-4" />
            {isGeneratingThumbnail ? 'Generating...' : 'Generate Thumbnail'}
          </Button>
        </div>
      )}

      {/* Save/Load Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">Save & Load</label>

        <Button className="w-full justify-start gap-2" onClick={handleSaveBuild} variant="outline">
          <Save className="size-4" />
          Save Build
        </Button>

        <Button
          className="w-full justify-start gap-2"
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
        >
          <Upload className="size-4" />
          Load Build
        </Button>

        <input
          accept="application/json"
          className="hidden"
          onChange={handleFileLoad}
          ref={fileInputRef}
          type="file"
        />

        <LoadBuildDialog
          onCancel={() => setPendingImport(null)}
          onConfirm={handleConfirmImport}
          pending={pendingImport}
        />
      </div>

      {/* Audio Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">Audio</label>
        <AudioSettingsDialog />
      </div>

      {/* Keyboard Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">Keyboard</label>
        <KeyboardShortcutsDialog />
      </div>

      {/* Scene Graph */}
      <div className="space-y-1">
        <label className="font-medium text-muted-foreground text-xs uppercase">Scene Graph</label>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="h-auto justify-start p-0 text-sm" variant="link">
              Explore scene graph
            </Button>
          </DialogTrigger>
          <DialogContent className="h-[80vh] max-w-[95vw] gap-0 overflow-hidden border-0 bg-[#1e1e1e] p-0 shadow-none sm:max-w-5xl">
            <DialogTitle className="sr-only">Scene Graph</DialogTitle>
            <div
              className="flex h-full min-h-0 w-full min-w-0 *:h-full *:w-full *:overflow-y-auto"
              onContextMenuCapture={blockSceneGraphMutations}
              onDragStartCapture={blockSceneGraphMutations}
              onDropCapture={blockSceneGraphMutations}
              onKeyDownCapture={blockSceneGraphDeletion}
            >
              <VisualJson value={sceneGraphValue}>
                <TreeView showCounts />
              </VisualJson>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Danger Zone */}
      <div className="space-y-2">
        <label className="font-medium text-destructive text-xs uppercase">Danger Zone</label>

        <Button
          className="w-full justify-start gap-2"
          onClick={handleResetToDefault}
          variant="destructive"
        >
          <Trash2 className="size-4" />
          Clear & Start New
        </Button>
      </div>
    </div>
  )
}
