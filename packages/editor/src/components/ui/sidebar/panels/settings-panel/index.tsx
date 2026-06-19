import { emitter, useScene, validateBuildJson } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { TreeView, VisualJson } from '@visual-json/react'
import { Camera, Download, Save, Trash2, Upload } from 'lucide-react'
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

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

type SceneGraphNode = {
  id: string
  type: string
  name: string | null
  parentId: string | null
  data?: JsonObject
  children: SceneGraphNode[]
  missing?: true
  cycle?: true
}

type SceneGraphValue = {
  captures?: JsonObject[]
  collections?: JsonObject
  roots: SceneGraphNode[]
  detachedNodes?: SceneGraphNode[]
}

const isJsonObject = (value: unknown): value is JsonObject => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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

const toJsonValue = (value: unknown): JsonValue | undefined => {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry)).filter((entry) => entry !== undefined)
  }
  if (typeof value === 'object') {
    const object: JsonObject = {}
    for (const [key, entry] of Object.entries(value)) {
      const json = toJsonValue(entry)
      if (json !== undefined) object[key] = json
    }
    return object
  }
  return undefined
}

const getNodeData = (node: SceneNode): JsonObject | undefined => {
  const data: JsonObject = {}
  for (const [key, value] of Object.entries(node)) {
    if (
      key === 'children' ||
      key === 'id' ||
      key === 'name' ||
      key === 'object' ||
      key === 'parentId' ||
      key === 'type'
    ) {
      continue
    }
    const json = toJsonValue(value)
    if (json !== undefined) data[key] = json
  }

  return Object.keys(data).length > 0 ? data : undefined
}

const getPascalCaptureMetadataValue = (
  node: SceneNode,
  key: 'pascalCapture' | 'pascalCaptureRef',
): JsonValue | null => {
  const metadata = node.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  const pascalCapture = (metadata as Record<string, unknown>)[key]
  const json = toJsonValue(pascalCapture)
  return json === undefined ? null : json
}

const getCaptureString = (capture: JsonObject | null, key: string): string | null => {
  const value = capture?.[key]
  return typeof value === 'string' ? value : null
}

const getCaptureNumber = (capture: JsonObject | null, key: string): number | null => {
  const value = capture?.[key]
  return typeof value === 'number' ? value : null
}

const buildCaptureReferences = (nodes: Record<string, SceneNode>): JsonObject[] => {
  const capturesByKey = new Map<string, JsonObject & { nodes: JsonObject[] }>()

  for (const [id, node] of Object.entries(nodes)) {
    const pascalCapture = getPascalCaptureMetadataValue(node, 'pascalCapture')
    const pascalCaptureRef = getPascalCaptureMetadataValue(node, 'pascalCaptureRef')
    if (!(pascalCapture || pascalCaptureRef)) continue

    const pascalCaptureObject = isJsonObject(pascalCapture) ? pascalCapture : null
    const pascalCaptureRefObject = isJsonObject(pascalCaptureRef) ? pascalCaptureRef : null
    const source = pascalCaptureObject ?? pascalCaptureRefObject
    const captureId = getCaptureString(source, 'captureId')
    const captureKey = captureId ?? id
    const bundle = pascalCaptureObject && isJsonObject(pascalCaptureObject.bundle)
      ? pascalCaptureObject.bundle
      : null
    const artifacts = bundle && isJsonObject(bundle.artifacts) ? bundle.artifacts : null

    const existing = capturesByKey.get(captureKey) ?? {
      captureId,
      projectId: getCaptureString(source, 'projectId'),
      levelId: getCaptureString(source, 'levelId'),
      sessionId: getCaptureString(source, 'sessionId'),
      storagePrefix: getCaptureString(source, 'storagePrefix'),
      artifactCounts: isJsonObject(source?.artifactCounts) ? source.artifactCounts : null,
      artifactTotalFiles: getCaptureNumber(source, 'artifactTotalFiles'),
      artifactTotalBytes: getCaptureNumber(source, 'artifactTotalBytes'),
      artifacts: artifacts ?? null,
      pascalCapture: pascalCapture ?? null,
      nodes: [],
    }

    if (!existing.pascalCapture && pascalCapture) {
      existing.pascalCapture = pascalCapture
    }
    if (!existing.artifacts && artifacts) {
      existing.artifacts = artifacts
    }
    existing.nodes.push({
      nodeId: id,
      nodeType: typeof node.type === 'string' ? node.type : 'unknown',
      nodeName: typeof node.name === 'string' ? node.name : null,
      hasFullCaptureMetadata: Boolean(pascalCapture),
    })
    capturesByKey.set(captureKey, existing)
  }

  return Array.from(capturesByKey.values()).map((capture) => ({
    ...capture,
    nodes: capture.nodes.sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId))),
  }))
}

const buildSceneGraphValue = (
  nodes: Record<string, SceneNode>,
  rootNodeIds: string[],
  collections?: unknown,
): SceneGraphValue => {
  const childIdsByParent = new Map<string, Set<string>>()
  const captures = buildCaptureReferences(nodes)
  const collectionsJson = toJsonValue(collections)

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
    const data = getNodeData(node)

    if (path.has(id)) {
      return {
        id,
        type: nodeType,
        name: nodeName,
        parentId,
        ...(data ? { data } : {}),
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
      ...(data ? { data } : {}),
      children: childIds.map((childId) => buildNode(childId, nextPath)),
    }
  }

  const roots = rootNodeIds.map((id) => buildNode(id, new Set()))
  const detachedNodeIds = Object.keys(nodes).filter((id) => !visited.has(id))

  const value: SceneGraphValue = {
    ...(captures.length > 0 ? { captures } : {}),
    ...(collectionsJson && isJsonObject(collectionsJson) && Object.keys(collectionsJson).length > 0
      ? { collections: collectionsJson }
      : {}),
    roots,
  }

  if (detachedNodeIds.length === 0) {
    return value
  }

  return {
    ...value,
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
  captureDataDownloadHref?: string | null
  onVisibilityChange?: (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => Promise<void>
}

export function SettingsPanel({
  projectId,
  projectVisibility,
  captureDataDownloadHref,
  onVisibilityChange,
}: SettingsPanelProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const collections = useScene((state) => state.collections)
  const setScene = useScene((state) => state.setScene)
  const clearScene = useScene((state) => state.clearScene)
  const resetSelection = useViewer((state) => state.resetSelection)
  const exportScene = useViewer((state) => state.exportScene)
  const showGrid = useViewer((state) => state.showGrid)
  const shadows = useViewer((state) => state.shadows)
  const setPhase = useEditor((state) => state.setPhase)
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const sceneGraphValue = useMemo(
    () => buildSceneGraphValue(nodes as Record<string, SceneNode>, rootNodeIds, collections),
    [collections, nodes, rootNodeIds],
  )
  const captureCount = sceneGraphValue.captures?.length ?? 0
  const captureNodeReferenceCount =
    sceneGraphValue.captures?.reduce((total, capture) => {
      const captureNodes = capture.nodes
      return total + (Array.isArray(captureNodes) ? captureNodes.length : 0)
    }, 0) ?? 0
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

  const handleSaveBuild = () => {
    const captures = buildCaptureReferences(nodes as Record<string, SceneNode>)
    const sceneData = {
      nodes,
      rootNodeIds,
      collections,
      ...(captures.length > 0 ? { captures } : {}),
    }
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
        {captureDataDownloadHref ? (
          <Button asChild className="w-full justify-start gap-2" variant="outline">
            <a href={captureDataDownloadHref}>
              <Download className="size-4" />
              Download capture data
            </a>
          </Button>
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
        {captureCount > 0 ? (
          <div className="text-muted-foreground text-xs">
            Exports {captureCount} capture{captureCount === 1 ? '' : 's'} across{' '}
            {captureNodeReferenceCount} node{captureNodeReferenceCount === 1 ? '' : 's'} under
            `captures`.
          </div>
        ) : null}
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
