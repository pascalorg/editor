import {
  clearSceneHistory,
  type DrawingSheetNode,
  DrawingSheetNode as DrawingSheetNodeSchema,
  emitter,
  useScene,
  validateBuildJson,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { TreeView, VisualJson } from '@visual-json/react'
import { AlertTriangle, Camera, Download, Map as MapIcon, Save, Trash2, Upload } from 'lucide-react'
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { exportFloorplanPdf } from '../../../../../lib/floorplan/floorplan-export'
import useDrawingView, {
  DRAWING_SCALE_OPTIONS,
  DRAWING_TYPE_OPTIONS,
  normalizeDrawingScale,
} from '../../../../../store/use-drawing-view'
import useFloorplanPreflight from '../../../../../store/use-floorplan-preflight'
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
  const installedPlugins = useScene((state) => state.installedPlugins)
  const setScene = useScene((state) => state.setScene)
  const clearScene = useScene((state) => state.clearScene)
  const resetSelection = useViewer((state) => state.resetSelection)
  const exportScene = useViewer((state) => state.exportScene)
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const shadows = useViewer((state) => state.shadows)
  const setPhase = useEditor((state) => state.setPhase)
  const drawingScale = useDrawingView((state) => state.drawingScale)
  const setDrawingScale = useDrawingView((state) => state.setDrawingScale)
  const drawingType = useDrawingView((state) => state.drawingType)
  const floorplanPreflightIssues = useFloorplanPreflight((state) => state.issues)
  const clearanceChecksEnabled = useFloorplanPreflight(
    (state) => state.clearanceChecksEnabled,
  )
  const moduleChecksEnabled = useFloorplanPreflight((state) => state.moduleChecksEnabled)
  const setClearanceChecksEnabled = useFloorplanPreflight(
    (state) => state.setClearanceChecksEnabled,
  )
  const setModuleChecksEnabled = useFloorplanPreflight(
    (state) => state.setModuleChecksEnabled,
  )
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const sceneGraphValue = useMemo(
    () => buildSceneGraphValue(nodes as Record<string, SceneNode>, rootNodeIds),
    [nodes, rootNodeIds],
  )
  const drawingSheet = useMemo(() => {
    if (!activeLevelId) return null
    return (
      Object.values(nodes).find(
        (node): node is DrawingSheetNode =>
          node.type === 'drawing-sheet' &&
          node.placedViews.some(
            (view) =>
              (view.levelId === null || view.levelId === activeLevelId) &&
              view.drawingType === drawingType,
          ),
      ) ?? null
    )
  }, [activeLevelId, drawingType, nodes])
  const activePlacedView = drawingSheet?.placedViews.find(
    (view) =>
      (view.levelId === null || view.levelId === activeLevelId) &&
      view.drawingType === drawingType,
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

  const handleSaveBuild = () => {
    const sceneData = { nodes, rootNodeIds, installedPlugins }
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

  const handleConfirmImport = (parsed: {
    nodes: Record<string, unknown>
    rootNodeIds: string[]
    installedPlugins?: string[]
  }) => {
    const currentScene = useScene.getState()
    setScene(
      parsed.nodes as Parameters<typeof setScene>[0],
      parsed.rootNodeIds as Parameters<typeof setScene>[1],
      {
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

  const createDrawingSheet = () => {
    if (!activeLevelId) return
    const drawingLabel =
      DRAWING_TYPE_OPTIONS.find((option) => option.id === drawingType)?.label ?? 'Floor plan'
    const sheet = DrawingSheetNodeSchema.parse({
      id: `drawing-sheet_${crypto.randomUUID()}`,
      sheetTitle: drawingLabel,
      placedViews: [
        {
          id: `drawing-view_${crypto.randomUUID()}`,
          drawingType,
          title: drawingLabel,
          levelId: activeLevelId,
          scale: drawingScale,
        },
      ],
    })
    useScene.getState().createNode(sheet)
  }

  const updateDrawingSheet = (patch: Partial<DrawingSheetNode>) => {
    if (!drawingSheet) return
    useScene.getState().updateNode(drawingSheet.id, patch)
  }

  const updateTitleBlockField = (
    field: keyof DrawingSheetNode['titleBlock'],
    value: string,
  ) => {
    if (!drawingSheet) return
    updateDrawingSheet({
      titleBlock: { ...drawingSheet.titleBlock, [field]: value.trim() },
    })
  }

  const updatePlacedViewScale = (scale: DrawingSheetNode['placedViews'][number]['scale']) => {
    setDrawingScale(scale)
    if (!(drawingSheet && activePlacedView)) return
    updateDrawingSheet({
      placedViews: drawingSheet.placedViews.map((view) =>
        view.id === activePlacedView.id ? { ...view, scale } : view,
      ),
    })
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
        </div>

        <div className="space-y-2">
          <div className="font-medium text-muted-foreground text-xs">Floorplan</div>
          <label className="block space-y-1">
            <span className="font-medium text-muted-foreground text-[11px] uppercase">
              Drawing scale
            </span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              onChange={(event) => updatePlacedViewScale(normalizeDrawingScale(event.target.value))}
              value={activePlacedView?.scale ?? drawingScale}
            >
              {DRAWING_SCALE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="font-medium text-xs">Drawing sheet</div>
            {drawingSheet ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-[11px] text-muted-foreground">
                    Sheet number
                    <input
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-foreground text-xs"
                      defaultValue={drawingSheet.sheetNumber}
                      key={`sheet-number:${drawingSheet.sheetNumber}`}
                      onBlur={(event) => {
                        const sheetNumber = event.currentTarget.value.trim()
                        if (sheetNumber && sheetNumber !== drawingSheet.sheetNumber) {
                          updateDrawingSheet({ sheetNumber })
                        }
                      }}
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-muted-foreground">
                    Paper
                    <select
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-foreground text-xs"
                      onChange={(event) =>
                        updateDrawingSheet({
                          paperSize: event.currentTarget.value as DrawingSheetNode['paperSize'],
                        })
                      }
                      value={drawingSheet.paperSize}
                    >
                      <option value="letter">Letter</option>
                      <option value="tabloid">Tabloid</option>
                      <option value="arch-a">ARCH A</option>
                      <option value="arch-b">ARCH B</option>
                      <option value="arch-c">ARCH C</option>
                      <option value="a4">A4</option>
                      <option value="a3">A3</option>
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-[11px] text-muted-foreground">
                  Sheet title
                  <input
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-foreground text-xs"
                    defaultValue={drawingSheet.sheetTitle}
                    key={`sheet-title:${drawingSheet.sheetTitle}`}
                    onBlur={(event) => {
                      const sheetTitle = event.currentTarget.value.trim()
                      if (sheetTitle && sheetTitle !== drawingSheet.sheetTitle) {
                        updateDrawingSheet({ sheetTitle })
                      }
                    }}
                  />
                </label>
                <label className="block space-y-1 text-[11px] text-muted-foreground">
                  Orientation
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-foreground text-xs"
                    onChange={(event) =>
                      updateDrawingSheet({
                        orientation: event.currentTarget
                          .value as DrawingSheetNode['orientation'],
                      })
                    }
                    value={drawingSheet.orientation}
                  >
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                  </select>
                </label>
                <label className="block space-y-1 text-[11px] text-muted-foreground">
                  General notes (one per line)
                  <textarea
                    className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-foreground text-xs"
                    defaultValue={drawingSheet.generalNotes.map((note) => note.text).join('\n')}
                    key={`sheet-notes:${drawingSheet.generalNotes.map((note) => note.id).join(':')}`}
                    onBlur={(event) => {
                      const generalNotes = event.currentTarget.value
                        .split(/\r?\n/)
                        .map((text) => text.trim())
                        .filter(Boolean)
                        .map((text, index) => ({
                          id: `sheet-note_${crypto.randomUUID()}` as `sheet-note_${string}`,
                          number: index + 1,
                          text,
                        }))
                      updateDrawingSheet({ generalNotes })
                    }}
                  />
                </label>
                <label className="block space-y-1 text-[11px] text-muted-foreground">
                  Keyed-note legend (KEY | note)
                  <textarea
                    className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-foreground text-xs"
                    defaultValue={drawingSheet.keyedNoteDefinitions
                      .map((note) => `${note.key} | ${note.text}`)
                      .join('\n')}
                    key={`sheet-keyed-notes:${drawingSheet.keyedNoteDefinitions
                      .map((note) => `${note.id}:${note.key}:${note.text}`)
                      .join('|')}`}
                    onBlur={(event) => {
                      const existingByKey = new Map(
                        drawingSheet.keyedNoteDefinitions.map((note) => [note.key, note]),
                      )
                      const keyedNoteDefinitions = event.currentTarget.value
                        .split(/\r?\n/)
                        .map((line) => {
                          const separator = line.indexOf('|')
                          if (separator < 0) return null
                          const key = line.slice(0, separator).trim()
                          const text = line.slice(separator + 1).trim()
                          if (!(key && text)) return null
                          return {
                            id:
                              existingByKey.get(key)?.id ??
                              (`keyed-note_${crypto.randomUUID()}` as `keyed-note_${string}`),
                            key,
                            text,
                          }
                        })
                        .filter(
                          (note): note is NonNullable<typeof note> => note !== null,
                        )
                      updateDrawingSheet({
                        keyedNoteDefinitions,
                        keyedNoteLegend: keyedNoteDefinitions.map(({ key, text }) => ({
                          key,
                          text,
                        })),
                      })
                    }}
                  />
                </label>
                <div className="space-y-2 border-border border-t pt-2">
                  <div className="font-medium text-[11px] text-muted-foreground uppercase">
                    Title block
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['projectName', 'Project name'],
                        ['projectNumber', 'Project number'],
                        ['clientName', 'Client'],
                        ['drawnBy', 'Drawn by'],
                        ['checkedBy', 'Checked by'],
                        ['issueDate', 'Issue date'],
                        ['revision', 'Revision'],
                      ] as const
                    ).map(([field, label]) => (
                      <label
                        className="space-y-1 text-[11px] text-muted-foreground"
                        key={field}
                      >
                        {label}
                        <input
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-foreground text-xs"
                          defaultValue={drawingSheet.titleBlock[field]}
                          key={`${field}:${drawingSheet.titleBlock[field]}`}
                          onBlur={(event) =>
                            updateTitleBlockField(field, event.currentTarget.value)
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <Button
                className="w-full"
                disabled={!activeLevelId}
                onClick={createDrawingSheet}
                variant="outline"
              >
                Create sheet for active level
              </Button>
            )}
          </div>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportFloorplanPdf('full')}
            variant="outline"
          >
            <MapIcon className="size-4" />
            Full floorplan
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportFloorplanPdf('structure')}
            variant="outline"
          >
            <MapIcon className="size-4" />
            Structure only
          </Button>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium text-sm">
                <AlertTriangle
                  className={`size-4 ${
                    floorplanPreflightIssues.length > 0
                      ? 'text-amber-600'
                      : 'text-muted-foreground'
                  }`}
                />
                Drawing preflight
              </div>
              <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground text-xs">
                {floorplanPreflightIssues.length}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              Annotation diagnostics are shown here only; they are not painted on the plan or added
              to PDF output.
            </p>
            <div className="mt-3 space-y-2 border-border border-t pt-2">
              <label className="flex items-center justify-between gap-3 text-xs">
                <span>Clearance advisories</span>
                <Switch
                  checked={clearanceChecksEnabled}
                  onCheckedChange={setClearanceChecksEnabled}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-xs">
                <span>Modular coordination advisories</span>
                <Switch
                  checked={moduleChecksEnabled}
                  onCheckedChange={setModuleChecksEnabled}
                />
              </label>
            </div>
            {floorplanPreflightIssues.length > 0 ? (
              <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-muted-foreground text-xs">
                {floorplanPreflightIssues.slice(0, 6).map((issue) => (
                  <li key={`${issue.kind}:${issue.id}`}>• {issue.message}</li>
                ))}
                {floorplanPreflightIssues.length > 6 ? (
                  <li>• {floorplanPreflightIssues.length - 6} more issue(s)</li>
                ) : null}
              </ul>
            ) : null}
          </div>
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
