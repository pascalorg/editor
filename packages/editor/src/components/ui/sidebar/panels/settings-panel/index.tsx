import {
  clearSceneHistory,
  emitter,
  isNodeKindEnabled,
  nodeRegistry,
  type ParsedBuildJson,
  useRegistryVersion,
  useScene,
  validateBuildJson,
} from '@pascal-app/core'
import { useViewer, viewerPresentationRegistry } from '@pascal-app/viewer'
import { TreeView, VisualJson } from '@visual-json/react'
import {
  Camera,
  Check,
  ChevronDown,
  Copy,
  Download,
  ListTree,
  Map as MapIcon,
  Save,
  Send,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import { Input } from './../../../../../components/ui/primitives/input'
import { Switch } from './../../../../../components/ui/primitives/switch'
import {
  exportFloorplanPdf,
  type FloorplanExportScope,
} from '../../../../../lib/floorplan/floorplan-export'
import {
  LocalAppError,
  probeLocalApp,
  sendGlbToLocalApp,
  waitForLocalImport,
} from '../../../../../lib/send-to-app'
import { cn } from './../../../../../lib/utils'
import useEditor, { selectDefaultBuildingAndLevel } from './../../../../../store/use-editor'
import useFloorplanMode from './../../../../../store/use-floorplan-mode'
import { type SendToAppStep, useSendToApp } from './../../../../../store/use-send-to-app'
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

const MODEL_EXPORT_FORMATS = [
  { format: 'glb', label: 'GLB' },
  { format: 'usdz', label: 'USDZ' },
  { format: 'stl', label: 'STL' },
  { format: 'obj', label: 'OBJ' },
] as const

type ModelExportFormat = (typeof MODEL_EXPORT_FORMATS)[number]['format']

const SEND_TO_BLENDER_STEP_LABEL: Record<SendToAppStep, string> = {
  probing: 'Looking for Blender…',
  exporting: 'Preparing the scene…',
  sending: 'Sending to Blender…',
  importing: 'Blender is importing…',
}

const BLENDER_ADDON_URL = 'https://github.com/pascalorg/blender-addon#install'

type ExportableNodeType = {
  type: string
  label: string
  supportsGeometryOnly: boolean
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

function SettingsSection({
  children,
  description,
  title,
  tone = 'default',
}: {
  children: ReactNode
  description?: string
  title: string
  tone?: 'default' | 'destructive'
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-3 py-5 first:pt-0 last:pb-0">
      <div className="space-y-0.5">
        <h3
          className={cn(
            'font-semibold text-sm',
            tone === 'destructive' ? 'text-destructive' : 'text-foreground',
          )}
          id={headingId}
        >
          {title}
        </h3>
        {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function SettingsSubheading({ children }: { children: ReactNode }) {
  return <h4 className="font-medium text-muted-foreground text-xs">{children}</h4>
}

function SettingsSwitchRow({
  checked,
  description,
  label,
  onCheckedChange,
}: {
  checked: boolean
  description: string
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0 space-y-0.5">
        <label className="block font-medium text-sm" htmlFor={id}>
          {label}
        </label>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch checked={checked} id={id} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export interface SettingsPanelProps {
  /** Merged onto the scrolling root so hosts can restyle padding (e.g. inside a dialog). */
  className?: string
  projectId?: string
  /** Shown as the scene name in apps the scene is sent to (Blender collection name). */
  projectName?: string
  projectVisibility?: ProjectVisibility
  onVisibilityChange?: (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => Promise<void>
}

export function SettingsPanel({
  className,
  projectId,
  projectName,
  projectVisibility,
  onVisibilityChange,
}: SettingsPanelProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const copyResetTimeoutRef = useRef<number | null>(null)
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const installedPlugins = useScene((state) => state.installedPlugins)
  const materials = useScene((state) => state.materials)
  const collections = useScene((state) => state.collections)
  const setScene = useScene((state) => state.setScene)
  const clearScene = useScene((state) => state.clearScene)
  const resetSelection = useViewer((state) => state.resetSelection)
  const modelExport = useEditor((state) => state.modelExport)
  const shadows = useViewer((state) => state.shadows)
  const setPhase = useEditor((state) => state.setPhase)
  const floorplanMode = useFloorplanMode((state) => state.mode)
  const registryVersion = useRegistryVersion()
  const visibleOnlySwitchId = useId()
  const includeNodeTypeIdPrefix = useId()
  const includePresentationIdPrefix = useId()
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false)
  const [exportOnlyVisible, setExportOnlyVisible] = useState(true)
  const [excludedNodeTypes, setExcludedNodeTypes] = useState<string[]>([])
  const [includedPresentationIds, setIncludedPresentationIds] = useState<string[]>([])
  const [activeModelExport, setActiveModelExport] = useState<ModelExportFormat | null>(null)
  const [modelExportError, setModelExportError] = useState<string | null>(null)
  const [modelExportWarning, setModelExportWarning] = useState<string | null>(null)
  const sendToBlenderStep = useSendToApp((state) => state.step)
  const sendToBlenderMessage = useSendToApp((state) => state.message)
  const setSendToBlenderStep = useSendToApp((state) => state.setStep)
  const setSendToBlenderMessage = useSendToApp((state) => state.setMessage)
  const [activeFloorplanExport, setActiveFloorplanExport] = useState<FloorplanExportScope | null>(
    null,
  )
  const [floorplanExportError, setFloorplanExportError] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [projectIdCopyState, setProjectIdCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const exportableNodeTypes = useMemo(() => {
    void registryVersion
    const uniqueTypes = new Set(Object.values(nodes).map((node) => node.type))
    const options: ExportableNodeType[] = []

    for (const type of uniqueTypes) {
      const definition = nodeRegistry.get(type)
      if (
        !(
          definition?.bakeGeometry ||
          definition?.bakeGeometryAsync ||
          definition?.bake === 'replace'
        ) ||
        !isNodeKindEnabled(type, installedPlugins)
      ) {
        continue
      }
      options.push({
        type,
        label: definition.presentation?.label ?? type,
        supportsGeometryOnly: !definition.bakeGeometryAsync || Boolean(definition.bakeGeometry),
      })
    }

    return options.sort((a, b) => {
      const labelOrder = a.label.localeCompare(b.label)
      return labelOrder === 0 ? a.type.localeCompare(b.type) : labelOrder
    })
  }, [installedPlugins, nodes, registryVersion])
  const registeredPresentations = useSyncExternalStore(
    viewerPresentationRegistry.subscribe,
    viewerPresentationRegistry.getSnapshot,
    viewerPresentationRegistry.getSnapshot,
  )
  const exportablePresentations = useMemo(
    () =>
      registeredPresentations.filter(
        (contribution) =>
          contribution.staticExport &&
          (!contribution.pluginId || installedPlugins.includes(contribution.pluginId)),
      ),
    [installedPlugins, registeredPresentations],
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
    const sceneData = { nodes, rootNodeIds, installedPlugins, materials, collections }
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
        collections: parsed.collections,
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

  const handleNodeTypeInclusion = useCallback((type: string, included: boolean) => {
    setExcludedNodeTypes((current) => {
      const isExcluded = current.includes(type)
      if (included) {
        return isExcluded ? current.filter((excludedType) => excludedType !== type) : current
      }
      return isExcluded ? current : [...current, type]
    })
  }, [])
  const handlePresentationInclusion = useCallback((id: string, included: boolean) => {
    setIncludedPresentationIds((current) => {
      const isIncluded = current.includes(id)
      if (included) return isIncluded ? current : [...current, id]
      return isIncluded ? current.filter((includedId) => includedId !== id) : current
    })
  }, [])

  const handleModelExport = async (format: ModelExportFormat, label: string) => {
    if (!modelExport || activeModelExport || useSendToApp.getState().step) return

    setActiveModelExport(format)
    setModelExportError(null)
    setModelExportWarning(null)
    try {
      const artifact = await modelExport(format, {
        onlyVisible: exportOnlyVisible,
        excludedNodeTypes,
        includedPresentationIds:
          format === 'glb' || format === 'usdz'
            ? includedPresentationIds.filter((id) =>
                exportablePresentations.some((contribution) => contribution.id === id),
              )
            : [],
      })
      if (!artifact) {
        throw new Error('Model export did not produce a file')
      }
      if (artifact.warnings?.length) setModelExportWarning(artifact.warnings.join(' '))
    } catch (error) {
      setModelExportError(
        error instanceof Error ? error.message : `Couldn’t export ${label}. Try again.`,
      )
    } finally {
      setActiveModelExport(null)
    }
  }

  const handleSendToBlender = async () => {
    if (!modelExport || activeModelExport || useSendToApp.getState().step) return

    setSendToBlenderMessage(null)
    setSendToBlenderStep('probing')
    try {
      const probe = await probeLocalApp()
      if (probe.status === 'unreachable') {
        setSendToBlenderMessage({
          tone: 'error',
          text: 'Blender isn’t listening. Open Blender with the Pascal add-on installed and enabled, then try again.',
        })
        return
      }
      if (probe.status === 'refused') {
        setSendToBlenderMessage({
          tone: 'error',
          text: `Blender is open but hasn’t allowed ${window.location.origin} yet. In Blender, open the Pascal tab in the 3D viewport sidebar (N) and click Allow.`,
        })
        return
      }

      setSendToBlenderStep('exporting')
      const artifact = await modelExport('glb', {
        onlyVisible: exportOnlyVisible,
        excludedNodeTypes,
        includedPresentationIds: includedPresentationIds.filter((id) =>
          exportablePresentations.some((contribution) => contribution.id === id),
        ),
        download: false,
      })
      if (!artifact) throw new Error('Model export did not produce a file')

      setSendToBlenderStep('sending')
      const queued = await sendGlbToLocalApp(probe.base, artifact.blob, {
        name: projectName,
        projectId,
      })

      setSendToBlenderStep('importing')
      const done = await waitForLocalImport(probe.base, queued.id)
      setSendToBlenderMessage({
        tone: 'info',
        text: done.summary ? `Sent to Blender. ${done.summary}.` : 'Sent to Blender.',
      })
    } catch (error) {
      const text =
        error instanceof LocalAppError || error instanceof Error
          ? error.message
          : 'Couldn’t send the scene to Blender. Try again.'
      setSendToBlenderMessage({ tone: 'error', text })
    } finally {
      setSendToBlenderStep(null)
    }
  }

  const handleFloorplanExport = async (scope: FloorplanExportScope) => {
    if (activeFloorplanExport) return

    setActiveFloorplanExport(scope)
    setFloorplanExportError(null)
    try {
      await exportFloorplanPdf(scope)
    } catch (error) {
      setFloorplanExportError(
        `Couldn’t export the floor plan. ${error instanceof Error ? error.message : 'Try again.'}`,
      )
    } finally {
      setActiveFloorplanExport(null)
    }
  }

  return (
    <div
      className={cn(
        'subtle-scrollbar @container min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3',
        className,
      )}
    >
      <div className="divide-y divide-border/60">
        {projectId && (
          <SettingsSection
            description="Reference this project from the API, MCP tools, or support."
            title="Project"
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label="Project ID"
                className="font-mono text-xs"
                readOnly
                value={projectId}
              />
              <Button
                aria-label={
                  projectIdCopyState === 'copied' ? 'Project ID copied' : 'Copy project ID'
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
                  ? 'Copied'
                  : projectIdCopyState === 'error'
                    ? 'Try again'
                    : 'Copy'}
              </Button>
            </div>
          </SettingsSection>
        )}

        {/* Sharing (only for cloud projects) */}
        {projectId && !isLocalProject && (
          <SettingsSection description="Control who can open this project." title="Sharing">
            <SettingsSwitchRow
              checked={!(projectVisibility?.isPrivate ?? false)}
              description={
                projectVisibility?.isPrivate
                  ? 'Only you can view it.'
                  : 'Anyone with the link can view it.'
              }
              label="Public project"
              onCheckedChange={(checked) => handleVisibilityChange('isPrivate', !checked)}
            />
            <SettingsSwitchRow
              checked={projectVisibility?.showScansPublic ?? true}
              description="Visible in the public viewer."
              label="Show 3D scans"
              onCheckedChange={(checked) => handleVisibilityChange('showScansPublic', checked)}
            />
            <SettingsSwitchRow
              checked={projectVisibility?.showGuidesPublic ?? true}
              description="Visible in the public viewer."
              label="Show floor plans"
              onCheckedChange={(checked) => handleVisibilityChange('showGuidesPublic', checked)}
            />
          </SettingsSection>
        )}

        <SettingsSection description="Rendering options for this editor session." title="Viewer">
          <SettingsSwitchRow
            checked={shadows}
            description="Cast shadows from lights."
            label="Shadows"
            onCheckedChange={(checked) => useViewer.getState().setShadows(checked)}
          />
        </SettingsSection>

        <SettingsSection description="Download the scene or hand it to another app." title="Export">
          <div className="space-y-3">
            <SettingsSubheading>3D model</SettingsSubheading>
            <details
              className="group"
              onKeyDownCapture={(event) => {
                // Keep Space available to the disclosure and switches, not canvas panning.
                if (event.code === 'Space') event.stopPropagation()
              }}
            >
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-md border px-3 font-medium text-sm focus-visible:outline-2 focus-visible:outline-ring">
                Export options
                <ChevronDown aria-hidden="true" className="size-4 group-open:rotate-180" />
              </summary>
              <div className="space-y-3 pt-3">
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div className="min-w-0">
                    <label className="font-medium text-sm" htmlFor={visibleOnlySwitchId}>
                      Visible nodes only
                    </label>
                    <div className="text-muted-foreground text-xs">
                      Exclude hidden furniture and other hidden scene nodes
                    </div>
                  </div>
                  <Switch
                    aria-label="Export visible nodes only"
                    checked={exportOnlyVisible}
                    id={visibleOnlySwitchId}
                    onCheckedChange={setExportOnlyVisible}
                  />
                </div>

                <fieldset className="space-y-2 rounded-md border p-3">
                  <legend className="px-1 font-medium text-sm">Include in file</legend>
                  <p className="text-muted-foreground text-xs">
                    Choose which procedural content is baked into model files. GLB and USDZ use the
                    textured portable path; STL and OBJ remain geometry-only.
                  </p>
                  {exportableNodeTypes.length > 0 ? (
                    <div className="space-y-2 pt-1">
                      {exportableNodeTypes.map(({ type, label, supportsGeometryOnly }, index) => {
                        const switchId = `${includeNodeTypeIdPrefix}-${index}`
                        return (
                          <div className="flex items-center justify-between gap-4" key={type}>
                            <label className="min-w-0 font-medium text-sm" htmlFor={switchId}>
                              {label}
                              {!supportsGeometryOnly && (
                                <span className="text-muted-foreground text-xs">
                                  {' '}
                                  (GLB/USDZ only)
                                </span>
                              )}
                            </label>
                            <Switch
                              aria-label={`Include ${label} in model files`}
                              checked={!excludedNodeTypes.includes(type)}
                              id={switchId}
                              onCheckedChange={(included) =>
                                handleNodeTypeInclusion(type, included)
                              }
                            />
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      No optional procedural content is present.
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Viewer surroundings are excluded unless selected separately below.
                  </p>
                </fieldset>
                {exportablePresentations.length > 0 ? (
                  <fieldset className="space-y-2 rounded-md border p-3">
                    <legend className="px-1 font-medium text-sm">Viewer surroundings</legend>
                    <p className="text-muted-foreground text-xs">
                      Optional static surroundings are included only in GLB and USDZ.
                    </p>
                    <div className="space-y-2 pt-1">
                      {exportablePresentations.map((contribution, index) => {
                        const switchId = `${includePresentationIdPrefix}-${index}`
                        const label = contribution.staticExport!.label
                        return (
                          <div
                            className="flex items-center justify-between gap-4"
                            key={contribution.id}
                          >
                            <label className="min-w-0 font-medium text-sm" htmlFor={switchId}>
                              {label}
                            </label>
                            <Switch
                              aria-label={`Include ${label} in GLB and USDZ`}
                              checked={includedPresentationIds.includes(contribution.id)}
                              id={switchId}
                              onCheckedChange={(included) =>
                                handlePresentationInclusion(contribution.id, included)
                              }
                            />
                          </div>
                        )
                      })}
                    </div>
                  </fieldset>
                ) : null}
              </div>
            </details>

            <div className="grid gap-2 @sm:grid-cols-2">
              {MODEL_EXPORT_FORMATS.map(({ format, label }) => {
                const isActive = activeModelExport === format
                return (
                  <Button
                    aria-busy={isActive}
                    className="w-full justify-start gap-2"
                    disabled={
                      activeModelExport !== null || sendToBlenderStep !== null || !modelExport
                    }
                    key={format}
                    onClick={() => void handleModelExport(format, label)}
                    variant="outline"
                  >
                    <Download aria-hidden="true" className="size-4" />
                    {isActive ? `Exporting ${label}…` : `Export ${label}`}
                  </Button>
                )
              })}
            </div>

            <div className="space-y-2">
              <Button
                aria-busy={sendToBlenderStep !== null}
                className="w-full justify-start gap-2"
                disabled={activeModelExport !== null || sendToBlenderStep !== null || !modelExport}
                onClick={() => void handleSendToBlender()}
                variant="outline"
              >
                <Send aria-hidden="true" className="size-4" />
                {sendToBlenderStep
                  ? SEND_TO_BLENDER_STEP_LABEL[sendToBlenderStep]
                  : 'Send to Blender'}
              </Button>
              <p className="text-muted-foreground text-xs">
                Needs the{' '}
                <a
                  className="underline underline-offset-2"
                  href={BLENDER_ADDON_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  Pascal add-on for Blender
                </a>{' '}
                running in an open Blender.
              </p>
            </div>
            {sendToBlenderMessage ? (
              <p
                className={
                  sendToBlenderMessage.tone === 'error'
                    ? 'text-destructive text-xs'
                    : 'text-foreground text-xs'
                }
                role={sendToBlenderMessage.tone === 'error' ? 'alert' : 'status'}
              >
                {sendToBlenderMessage.text}
              </p>
            ) : null}

            {activeModelExport ? (
              <p className="text-muted-foreground text-xs" role="status">
                Preparing {activeModelExport.toUpperCase()} file…
              </p>
            ) : null}
            {modelExportError ? (
              <p className="text-destructive text-xs" role="alert">
                {modelExportError}
              </p>
            ) : null}
            {modelExportWarning ? (
              <p className="text-foreground text-xs" role="status">
                Warning: {modelExportWarning}
              </p>
            ) : null}

            <div className="grid gap-2 @sm:grid-cols-2">
              <PrintExportButton onlyVisible={exportOnlyVisible} />
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <SettingsSubheading>Floor plan</SettingsSubheading>
              <span className="text-muted-foreground text-xs">
                {floorplanMode === 'default' ? 'Default mode' : 'Expert mode'}
              </span>
            </div>
            <div className="grid gap-2 @sm:grid-cols-2">
              <Button
                aria-busy={activeFloorplanExport === 'full'}
                className="w-full justify-start gap-2"
                disabled={activeFloorplanExport !== null}
                onClick={() => void handleFloorplanExport('full')}
                variant="outline"
              >
                <MapIcon className="size-4" />
                Full floor plan
              </Button>
              <Button
                aria-busy={activeFloorplanExport === 'structure'}
                className="w-full justify-start gap-2"
                disabled={activeFloorplanExport !== null}
                onClick={() => void handleFloorplanExport('structure')}
                variant="outline"
              >
                <MapIcon className="size-4" />
                Structure only
              </Button>
            </div>
            {activeFloorplanExport ? (
              <p className="text-muted-foreground text-xs" role="status">
                Preparing floor-plan PDF…
              </p>
            ) : null}
            {floorplanExportError ? (
              <p className="break-words text-destructive text-xs" role="alert">
                {floorplanExportError}
              </p>
            ) : null}
          </div>
        </SettingsSection>

        {/* Thumbnail (only for cloud projects) */}
        {projectId && !isLocalProject && (
          <SettingsSection
            description="Refresh the preview shown in your project list."
            title="Thumbnail"
          >
            <div className="grid gap-2 @sm:grid-cols-2">
              <Button
                className="w-full justify-start gap-2"
                disabled={isGeneratingThumbnail}
                onClick={handleGenerateThumbnail}
                variant="outline"
              >
                <Camera className="size-4" />
                {isGeneratingThumbnail ? 'Generating…' : 'Generate thumbnail'}
              </Button>
            </div>
          </SettingsSection>
        )}

        <SettingsSection
          description="Keep a JSON copy of the scene, or restore one."
          title="Save and load"
        >
          <div className="grid gap-2 @sm:grid-cols-2">
            <Button
              className="w-full justify-start gap-2"
              onClick={handleSaveBuild}
              variant="outline"
            >
              <Save className="size-4" />
              Save build
            </Button>
            <Button
              className="w-full justify-start gap-2"
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
            >
              <Upload className="size-4" />
              Load build
            </Button>
          </div>

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
        </SettingsSection>

        <SettingsSection description="Sound levels and keyboard shortcuts." title="Preferences">
          <div className="grid gap-2 @sm:grid-cols-2">
            <AudioSettingsDialog />
            <KeyboardShortcutsDialog />
          </div>
        </SettingsSection>

        <SettingsSection
          description="Inspect how nodes are nested in this scene."
          title="Scene graph"
        >
          <Dialog>
            <DialogTrigger asChild>
              <div className="grid gap-2 @sm:grid-cols-2">
                <Button className="w-full justify-start gap-2" variant="outline">
                  <ListTree className="size-4" />
                  Explore scene graph
                </Button>
              </div>
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
        </SettingsSection>

        <SettingsSection
          description="Removes every node from this scene. This cannot be undone."
          title="Danger zone"
          tone="destructive"
        >
          <div className="grid gap-2 @sm:grid-cols-2">
            <Button
              className="w-full justify-start gap-2"
              onClick={handleResetToDefault}
              variant="destructive"
            >
              <Trash2 className="size-4" />
              Clear and start new
            </Button>
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}
