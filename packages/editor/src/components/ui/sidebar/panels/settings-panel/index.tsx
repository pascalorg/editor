import {
  clearSceneHistory,
  emitter,
  useScene,
  type ParsedBuildJson,
  validateBuildJson,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { TreeView, VisualJson } from '@visual-json/react'
import { Camera, Check, Copy, Download, Map as MapIcon, Save, Trash2, Upload } from 'lucide-react'
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { exportFloorplanPdf } from '../../../../../lib/floorplan/floorplan-export'
import { useTranslations } from '../../../../../lib/i18n'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import { Input } from './../../../../../components/ui/primitives/input'
import { Switch } from './../../../../../components/ui/primitives/switch'
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

export function SettingsPanel({
  projectId,
  projectVisibility,
  onVisibilityChange,
}: SettingsPanelProps = {}) {
  const t = useTranslations()
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
      {projectId && (
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">{t('settings.project')}</label>
          <div className="font-medium text-sm">{t('settings.projectId')}</div>
          <div className="flex items-center gap-2">
            <Input
              aria-label={t('settings.projectId')}
              className="font-mono text-xs"
              readOnly
              value={projectId}
            />
            <Button
              aria-label={
                projectIdCopyState === 'copied'
                  ? t('settings.projectIdCopied')
                  : t('settings.copyProjectId')
              }
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
                ? t('settings.copied')
                : projectIdCopyState === 'error'
                  ? t('settings.tryAgain')
                  : t('common.copy')}
            </Button>
          </div>
        </div>
      )}

      {/* Visibility Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-3">
          <label className="font-medium text-muted-foreground text-xs uppercase">{t('settings.visibility')}</label>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{t('settings.visibilityPublic')}</div>
              <div className="text-muted-foreground text-xs">
                {projectVisibility?.isPrivate
                  ? t('settings.visibilityOnlyYou')
                  : t('settings.visibilityAnyone')}{' '}
                {t('settings.visibilityCanView')}
              </div>
            </div>
            <Switch
              checked={!(projectVisibility?.isPrivate ?? false)}
              onCheckedChange={(checked) => handleVisibilityChange('isPrivate', !checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{t('settings.visibilityShow3DScans')}</div>
              <div className="text-muted-foreground text-xs">{t('settings.visibilityVisiblePublic')}</div>
            </div>
            <Switch
              checked={projectVisibility?.showScansPublic ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showScansPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{t('settings.visibilityShowFloorplans')}</div>
              <div className="text-muted-foreground text-xs">{t('settings.visibilityVisiblePublic')}</div>
            </div>
            <Switch
              checked={projectVisibility?.showGuidesPublic ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showGuidesPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{t('settings.shadows')}</div>
              <div className="text-muted-foreground text-xs">{t('settings.visibilityCastShadows')}</div>
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
        <label className="font-medium text-muted-foreground text-xs uppercase">{t('settings.export')}</label>

        <div className="space-y-2">
          <div className="font-medium text-muted-foreground text-xs">{t('settings.export3DModel')}</div>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <div className="font-medium text-sm">{t('settings.visibleNodesOnly')}</div>
              <div className="text-muted-foreground text-xs">
                {t('settings.visibleNodesOnlyDesc')}
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
            {t('settings.exportedGLB')}
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => modelExport?.('stl', { onlyVisible: exportOnlyVisible })}
            variant="outline"
          >
            <Download className="size-4" />
            {t('settings.exportedSTL')}
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => modelExport?.('obj', { onlyVisible: exportOnlyVisible })}
            variant="outline"
          >
            <Download className="size-4" />
            {t('settings.exportedOBJ')}
          </Button>

          <PrintExportButton onlyVisible={exportOnlyVisible} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between font-medium text-muted-foreground text-xs">
            <span>{t('settings.floorPlan')}</span>
            <span>{floorplanMode === 'default' ? t('settings.floorplanDefault') : t('settings.floorplanExpert')}</span>
          </div>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportFloorplanPdf('full')}
            variant="outline"
          >
            <MapIcon className="size-4" />
            {t('settings.floorplanFull')}
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportFloorplanPdf('structure')}
            variant="outline"
          >
            <MapIcon className="size-4" />
            {t('settings.floorplanStructure')}
          </Button>
        </div>
      </div>

      {/* Thumbnail Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">{t('settings.thumbnail')}</label>
          <Button
            className="w-full justify-start gap-2"
            disabled={isGeneratingThumbnail}
            onClick={handleGenerateThumbnail}
            variant="outline"
          >
            <Camera className="size-4" />
            {isGeneratingThumbnail ? t('settings.exporting') : t('settings.generateThumbnail')}
          </Button>
        </div>
      )}

      {/* Save/Load Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">{t('settings.saveAndLoad')}</label>

        <Button className="w-full justify-start gap-2" onClick={handleSaveBuild} variant="outline">
          <Save className="size-4" />
          {t('settings.saveBuild')}
        </Button>

        <Button
          className="w-full justify-start gap-2"
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
        >
          <Upload className="size-4" />
          {t('settings.loadBuild')}
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
        <label className="font-medium text-muted-foreground text-xs uppercase">{t('settings.audio')}</label>
        <AudioSettingsDialog />
      </div>

      {/* Keyboard Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">{t('settings.keyboard')}</label>
        <KeyboardShortcutsDialog />
      </div>

      {/* Scene Graph */}
      <div className="space-y-1">
        <label className="font-medium text-muted-foreground text-xs uppercase">{t('settings.sceneGraph')}</label>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="h-auto justify-start p-0 text-sm" variant="link">
              {t('settings.exploreSceneGraph')}
            </Button>
          </DialogTrigger>
          <DialogContent className="h-[80vh] max-w-[95vw] gap-0 overflow-hidden border-0 bg-[#1e1e1e] p-0 shadow-none sm:max-w-5xl">
            <DialogTitle className="sr-only">{t('settings.sceneGraph')}</DialogTitle>
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
        <label className="font-medium text-destructive text-xs uppercase">{t('settings.dangerZone')}</label>

        <Button
          className="w-full justify-start gap-2"
          onClick={handleResetToDefault}
          variant="destructive"
        >
          <Trash2 className="size-4" />
          {t('settings.clearAndStartNew')}
        </Button>
      </div>
    </div>
  )
}
