import {
  clearSceneHistory,
  DEFAULT_LEVEL_HEIGHT,
  emitter,
  getLevelDisplayName,
  LevelNode,
  type AnyNodeId,
  type BuildingNode,
  useScene,
  type ParsedBuildJson,
  validateBuildJson,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { TreeView, VisualJson } from '@visual-json/react'
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  Copy,
  Download,
  Layers,
  Map as MapIcon,
  Save,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { exportFloorplanPdf } from '../../../../../lib/floorplan/floorplan-export'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import { Input } from './../../../../../components/ui/primitives/input'
import { Switch } from './../../../../../components/ui/primitives/switch'
import { cn } from './../../../../../lib/utils'
import { deleteLevelWithFallbackSelection } from './../../../../../lib/level-selection'
import useEditor, { selectDefaultBuildingAndLevel } from './../../../../../store/use-editor'
import useFloorplanMode from './../../../../../store/use-floorplan-mode'
import { AudioSettingsDialog } from './audio-settings-dialog'
import { KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog'
import { LoadBuildDialog, type PendingImport } from './load-build-dialog'
import { PrintExportButton } from './print-export-button'

type SceneNode = Record<string, unknown> & {
  id?: unknown
  type?: unknown
  name?: unknown
  parentId?: unknown
  children?: unknown
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

function FloorSettingsSection() {
  const selectedBuildingId = useViewer((state) => state.selection.buildingId)
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)
  const createNode = useScene((state) => state.createNode)
  const building = useScene((state) => {
    const selected = selectedBuildingId ? state.nodes[selectedBuildingId] : undefined
    if (selected?.type === 'building') return selected as BuildingNode

    const site = state.rootNodeIds
      .map((nodeId) => state.nodes[nodeId])
      .find((node) => node?.type === 'site')
    if (site?.type !== 'site') return null

    return (
      site.children
        .map((childId) => state.nodes[childId as AnyNodeId])
        .find((node): node is BuildingNode => node?.type === 'building') ?? null
    )
  })
  const levels = useScene(
    useShallow((state) => {
      if (!building) return []

      return building.children
        .map((childId) => state.nodes[childId as AnyNodeId])
        .filter((node): node is LevelNode => node?.type === 'level')
        .sort((a, b) => b.level - a.level)
    }),
  )

  if (!building) return null

  const addLevel = (level: number) => {
    const newLevel = LevelNode.parse({
      level,
      height: DEFAULT_LEVEL_HEIGHT,
      children: [],
      parentId: building.id,
    })
    createNode(newLevel, building.id)
    setSelection({ buildingId: building.id, levelId: newLevel.id })
  }

  const addFloor = () =>
    addLevel(levels.length === 0 ? 0 : Math.max(0, ...levels.map((level) => level.level)) + 1)
  const addBasement = () => addLevel(Math.min(0, ...levels.map((level) => level.level)) - 1)

  return (
    <div className="space-y-3">
      <label className="font-medium text-muted-foreground text-xs uppercase">Floors</label>
      <div className="grid grid-cols-2 gap-2">
        <Button className="justify-start" onClick={addFloor} size="sm" type="button" variant="outline">
          <ArrowUp className="size-3.5" />
          Add floor
        </Button>
        <Button
          className="justify-start"
          onClick={addBasement}
          size="sm"
          type="button"
          variant="outline"
        >
          <ArrowDown className="size-3.5" />
          Add basement
        </Button>
      </div>

      <div className="space-y-1 rounded-md border p-1">
        {levels.length === 0 ? (
          <div className="px-2 py-2 text-muted-foreground text-xs">No floors yet</div>
        ) : (
          levels.map((level) => {
            const isSelected = level.id === selectedLevelId
            const canDelete = level.level !== 0

            return (
              <div className="flex items-center gap-1" key={level.id}>
                <button
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
                    isSelected
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                  onClick={() => setSelection({ buildingId: building.id, levelId: level.id })}
                  type="button"
                >
                  <Layers className="size-3.5 shrink-0" />
                  <span className="truncate">{getLevelDisplayName(level)}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                    {level.level === 0 ? '0' : level.level > 0 ? `+${level.level}` : level.level}
                  </span>
                </button>
                <button
                  aria-label={`Remove ${getLevelDisplayName(level)}`}
                  className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                  disabled={!canDelete}
                  onClick={() => deleteLevelWithFallbackSelection(level.id)}
                  title={canDelete ? 'Remove floor' : 'The ground floor cannot be removed'}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Select a floor to make it active. The ground floor is always kept as the building datum.
      </p>
    </div>
  )
}

export function SettingsPanel({
  projectId,
  projectVisibility,
  onVisibilityChange,
}: SettingsPanelProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const copyResetTimeoutRef = useRef<number | null>(null)
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const installedPlugins = useScene((state) => state.installedPlugins)
  const materials = useScene((state) => state.materials)
  const setScene = useScene((state) => state.setScene)
  const clearScene = useScene((state) => state.clearScene)
  const resetSelection = useViewer((state) => state.resetSelection)
  const modelExport = useEditor((state) => state.modelExport)
  const shadows = useViewer((state) => state.shadows)
  const setPhase = useEditor((state) => state.setPhase)
  const floorplanMode = useFloorplanMode((state) => state.mode)
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false)
  const [exportOnlyVisible, setExportOnlyVisible] = useState(true)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [projectIdCopyState, setProjectIdCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  )
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

  useEffect(
    () => () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current)
      }
    },
    [],
  )

  const isLocalProject = false // Props-based; only show cloud sections when projectId provided

  const handleSaveBuild = () => {
    // Materials ride along: nodes reference them by `scene:<id>` slot
    // refs, so a save without the table produces a file whose custom
    // finishes revert to defaults on the very Load Build path below.
    const sceneData = { nodes, rootNodeIds, installedPlugins, materials }
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
            stats: { total: 0, byType: {}, pluginTypes: {}, unknownTypes: {}, floorAreaM2: 0 },
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

  const handleConfirmImport = (parsed: ParsedBuildJson) => {
    const currentScene = useScene.getState()
    setScene(
      parsed.nodes as Parameters<typeof setScene>[0],
      parsed.rootNodeIds as Parameters<typeof setScene>[1],
      {
        // Without this, every `scene:<id>` slot ref in the imported file
        // pointed at a material that no longer existed — custom finishes
        // silently reverted to defaults on import.
        materials: parsed.materials,
        installedPlugins: parsed.installedPlugins ?? currentScene.installedPlugins,
        hasExplicitPluginInstallState:
          parsed.installedPlugins !== undefined || currentScene.hasExplicitPluginInstallState,
      },
    )
    // An import is a scene load: it becomes the undo floor. Without this,
    // undo could step back into the pre-import scene state.
    clearSceneHistory()
    resetSelection()
    setPhase('site')
    setPendingImport(null)
  }

  const handleResetToDefault = () => {
    clearScene()
    // Same floor rule as import — undo after a reset must not resurrect the
    // old scene (or land on the empty intermediate `unloadScene` state).
    clearSceneHistory()
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

  const handleCopyProjectId = async () => {
    if (!projectId) return
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current)
    }

    try {
      await navigator.clipboard.writeText(projectId)
      setProjectIdCopyState('copied')
    } catch {
      setProjectIdCopyState('error')
    }

    copyResetTimeoutRef.current = window.setTimeout(() => {
      setProjectIdCopyState('idle')
      copyResetTimeoutRef.current = null
    }, 2000)
  }

  const handleVisibilityChange = async (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => {
    await onVisibilityChange?.(field, value)
  }

  return (
    <div className="flex flex-col gap-6 p-3">
      <FloorSettingsSection />
      {projectId && (
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">Project</label>
          <div className="font-medium text-sm">Project ID</div>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Project ID"
              className="font-mono text-xs"
              readOnly
              value={projectId}
            />
            <Button
              aria-label={projectIdCopyState === 'copied' ? 'Project ID copied' : 'Copy project ID'}
              className="rounded-full"
              onClick={() => void handleCopyProjectId()}
              size="sm"
              type="button"
              variant="outline"
            >
              {projectIdCopyState === 'copied' ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {projectIdCopyState === 'copied'
                ? 'Copied'
                : projectIdCopyState === 'error'
                  ? 'Try again'
                  : 'Copy'}
            </Button>
          </div>
        </div>
      )}

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
      <div className="space-y-4">
        <label className="font-medium text-muted-foreground text-xs uppercase">Export</label>

        <div className="space-y-2">
          <div className="font-medium text-muted-foreground text-xs">3D model</div>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <div className="font-medium text-sm">Visible nodes only</div>
              <div className="text-muted-foreground text-xs">
                Exclude hidden furniture and other hidden scene nodes
              </div>
            </div>
            <Switch checked={exportOnlyVisible} onCheckedChange={setExportOnlyVisible} />
          </div>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => modelExport?.('glb', { onlyVisible: exportOnlyVisible })}
            variant="outline"
          >
            <Download className="size-4" />
            Export GLB
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => modelExport?.('stl', { onlyVisible: exportOnlyVisible })}
            variant="outline"
          >
            <Download className="size-4" />
            Export STL
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => modelExport?.('obj', { onlyVisible: exportOnlyVisible })}
            variant="outline"
          >
            <Download className="size-4" />
            Export OBJ
          </Button>

          <PrintExportButton onlyVisible={exportOnlyVisible} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between font-medium text-muted-foreground text-xs">
            <span>Floor plan</span>
            <span>{floorplanMode === 'default' ? 'Default mode' : 'Expert mode'}</span>
          </div>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportFloorplanPdf('full')}
            variant="outline"
          >
            <MapIcon className="size-4" />
            Full floor plan
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportFloorplanPdf('structure')}
            variant="outline"
          >
            <MapIcon className="size-4" />
            Structure only
          </Button>
        </div>
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
