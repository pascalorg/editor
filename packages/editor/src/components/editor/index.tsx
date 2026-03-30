'use client'

import { Icon } from '@iconify/react'
import { initSpaceDetectionSync, initSpatialGridSync, useScene } from '@pascal-app/core'
import { InteractiveSystem, useViewer, Viewer } from '@pascal-app/viewer'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { ViewerOverlay } from '../../components/viewer-overlay'
import { ViewerZoneSystem } from '../../components/viewer-zone-system'
import { type PresetsAdapter, PresetsProvider } from '../../contexts/presets-context'
import { type SaveStatus, useAutoSave } from '../../hooks/use-auto-save'
import { useKeyboard } from '../../hooks/use-keyboard'
import {
  applySceneGraphToEditor,
  loadSceneFromLocalStorage,
  type SceneGraph,
  writePersistedSelection,
} from '../../lib/scene'
import { initSFXBus } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { CeilingSystem } from '../systems/ceiling/ceiling-system'
import { RoofEditSystem } from '../systems/roof/roof-edit-system'
import { ZoneLabelEditorSystem } from '../systems/zone/zone-label-editor-system'
import { ZoneSystem } from '../systems/zone/zone-system'
import { ToolManager } from '../tools/tool-manager'
import { ActionMenu } from '../ui/action-menu'
import { HelperManager } from '../ui/helpers/helper-manager'
import { PanelManager } from '../ui/panels/panel-manager'
import { ErrorBoundary } from '../ui/primitives/error-boundary'
import { SidebarProvider } from '../ui/primitives/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/primitives/tooltip'
import { SceneLoader } from '../ui/scene-loader'
import { AppSidebar } from '../ui/sidebar/app-sidebar'
import type { SettingsPanelProps } from '../ui/sidebar/panels/settings-panel'
import type { SitePanelProps } from '../ui/sidebar/panels/site-panel'
import { CustomCameraControls } from './custom-camera-controls'
import { ExportManager } from './export-manager'
import { FirstPersonControls, FirstPersonOverlay } from './first-person-controls'
import { FloatingActionMenu } from './floating-action-menu'
import { FloorplanPanel } from './floorplan-panel'
import { Grid } from './grid'
import { PresetThumbnailGenerator } from './preset-thumbnail-generator'
import { SelectionManager } from './selection-manager'
import { SiteEdgeLabels } from './site-edge-labels'
import { ThumbnailGenerator } from './thumbnail-generator'
import { WallMeasurementLabel } from './wall-measurement-label'

let hasInitializedEditorRuntime = false
const CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY = 'editor-camera-controls-hint-dismissed:v1'

function initializeEditorRuntime() {
  if (hasInitializedEditorRuntime) return
  initSpatialGridSync()
  initSpaceDetectionSync(useScene, useEditor)
  initSFXBus()

  hasInitializedEditorRuntime = true
}
export interface EditorProps {
  // UI slots
  appMenuButton?: ReactNode
  sidebarTop?: ReactNode
  projectId?: string | null

  // Persistence — defaults to localStorage when omitted
  onLoad?: () => Promise<SceneGraph | null>
  onSave?: (scene: SceneGraph) => Promise<void>
  onDirty?: () => void
  onSaveStatusChange?: (status: SaveStatus) => void

  // Version preview
  previewScene?: SceneGraph
  isVersionPreviewMode?: boolean

  // Loading indicator (e.g. project fetching in community mode)
  isLoading?: boolean

  // Thumbnail
  onThumbnailCapture?: (blob: Blob) => void

  // Panel config (passed through to sidebar panels)
  settingsPanelProps?: SettingsPanelProps
  sitePanelProps?: SitePanelProps

  // Presets storage backend (defaults to localStorage)
  presetsAdapter?: PresetsAdapter
}

function EditorSceneCrashFallback() {
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-background/95 p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
        <h2 className="font-semibold text-lg">The editor scene failed to render</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          You can retry the scene or return home without reloading the whole app shell.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            className="rounded-md border border-border bg-accent px-3 py-2 font-medium text-sm hover:bg-accent/80"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload editor
          </button>
          <a
            className="rounded-md border border-border bg-background px-3 py-2 font-medium text-sm hover:bg-accent/40"
            href="/"
          >
            Back to home
          </a>
        </div>
      </div>
    </div>
  )
}

function SelectionPersistenceManager({ enabled }: { enabled: boolean }) {
  const selection = useViewer((state) => state.selection)

  useEffect(() => {
    if (!enabled) {
      return
    }

    writePersistedSelection(selection)
  }, [enabled, selection])

  return null
}

type ShortcutKey = {
  value: string
}

type CameraControlHint = {
  action: string
  keys: ShortcutKey[]
  alternativeKeys?: ShortcutKey[]
}

const EDITOR_CAMERA_CONTROL_HINTS: CameraControlHint[] = [
  {
    action: 'Pan',
    keys: [{ value: 'Space' }, { value: 'Left click' }],
  },
  { action: 'Rotate', keys: [{ value: 'Right click' }] },
  { action: 'Zoom', keys: [{ value: 'Scroll' }] },
]

const PREVIEW_CAMERA_CONTROL_HINTS: CameraControlHint[] = [
  { action: 'Pan', keys: [{ value: 'Left click' }] },
  { action: 'Rotate', keys: [{ value: 'Right click' }] },
  { action: 'Zoom', keys: [{ value: 'Scroll' }] },
]

const CAMERA_SHORTCUT_KEY_META: Record<string, { icon?: string; label: string; text?: string }> = {
  'Left click': {
    icon: 'ph:mouse-left-click-fill',
    label: 'Left click',
  },
  'Middle click': {
    icon: 'qlementine-icons:mouse-middle-button-16',
    label: 'Middle click',
  },
  'Right click': {
    icon: 'ph:mouse-right-click-fill',
    label: 'Right click',
  },
  Scroll: {
    icon: 'qlementine-icons:mouse-middle-button-16',
    label: 'Scroll wheel',
  },
  Space: {
    icon: 'lucide:space',
    label: 'Space',
  },
}

function readCameraControlsHintDismissed(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCameraControlsHintDismissed(dismissed: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (dismissed) {
      window.localStorage.setItem(CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY, '1')
      return
    }

    window.localStorage.removeItem(CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY)
  } catch {}
}

function InlineShortcutKey({ shortcutKey }: { shortcutKey: ShortcutKey }) {
  const meta = CAMERA_SHORTCUT_KEY_META[shortcutKey.value]

  if (meta?.icon) {
    return (
      <span
        aria-label={meta.label}
        className="inline-flex items-center text-foreground/90"
        role="img"
        title={meta.label}
      >
        <Icon aria-hidden="true" color="currentColor" height={16} icon={meta.icon} width={16} />
        <span className="sr-only">{meta.label}</span>
      </span>
    )
  }

  return (
    <span className="font-medium text-[11px] text-foreground/90">
      {meta?.text ?? shortcutKey.value}
    </span>
  )
}

function ShortcutSequence({ keys }: { keys: ShortcutKey[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <div className="flex items-center gap-1" key={`${key.value}-${index}`}>
          {index > 0 ? <span className="text-[10px] text-muted-foreground/70">+</span> : null}
          <InlineShortcutKey shortcutKey={key} />
        </div>
      ))}
    </div>
  )
}

function CameraControlHintItem({ hint }: { hint: CameraControlHint }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 px-4 text-center first:pl-0 last:pr-0">
      <span className="font-medium text-[10px] text-muted-foreground/60 tracking-[0.03em]">
        {hint.action}
      </span>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <ShortcutSequence keys={hint.keys} />
        {hint.alternativeKeys ? (
          <>
            <span className="text-[10px] text-muted-foreground/40">/</span>
            <ShortcutSequence keys={hint.alternativeKeys} />
          </>
        ) : null}
      </div>
    </div>
  )
}

function ViewerCanvasControlsHint({
  isPreviewMode,
  onDismiss,
}: {
  isPreviewMode: boolean
  onDismiss: () => void
}) {
  const hints = isPreviewMode ? PREVIEW_CAMERA_CONTROL_HINTS : EDITOR_CAMERA_CONTROL_HINTS

  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-40 max-w-[calc(100vw-2rem)] -translate-x-1/2">
      <section
        aria-label="Camera controls hint"
        className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-border/35 bg-background/90 px-3.5 py-2.5 shadow-[0_22px_40px_-28px_rgba(15,23,42,0.65),0_10px_24px_-20px_rgba(15,23,42,0.55)] backdrop-blur-xl"
      >
        <div className="grid min-w-0 flex-1 grid-cols-3 items-start divide-x divide-border/18">
          {hints.map((hint) => (
            <CameraControlHintItem hint={hint} key={hint.action} />
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Dismiss camera controls hint"
              className="flex h-5 shrink-0 items-center justify-center self-center border-border/18 border-l pl-3 text-muted-foreground/70 transition-colors hover:text-foreground"
              onClick={onDismiss}
              type="button"
            >
              <Icon
                aria-hidden="true"
                color="currentColor"
                height={14}
                icon="lucide:x"
                width={14}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Dismiss
          </TooltipContent>
        </Tooltip>
      </section>
    </div>
  )
}

export default function Editor({
  appMenuButton,
  sidebarTop,
  projectId,
  onLoad,
  onSave,
  onDirty,
  onSaveStatusChange,
  previewScene,
  isVersionPreviewMode = false,
  isLoading = false,
  onThumbnailCapture,
  settingsPanelProps,
  sitePanelProps,
  presetsAdapter,
}: EditorProps) {
  useKeyboard()

  const { isLoadingSceneRef } = useAutoSave({
    onSave,
    onDirty,
    onSaveStatusChange,
    isVersionPreviewMode,
  })

  const [isSceneLoading, setIsSceneLoading] = useState(false)
  const [hasLoadedInitialScene, setHasLoadedInitialScene] = useState(false)
  const [isCameraControlsHintVisible, setIsCameraControlsHintVisible] = useState<boolean | null>(
    null,
  )
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const isFirstPersonMode = useEditor((s) => s.isFirstPersonMode)
  const isFloorplanOpen = useEditor((s) => s.isFloorplanOpen)

  useEffect(() => {
    initializeEditorRuntime()
  }, [])

  useEffect(() => {
    useViewer.getState().setProjectId(projectId ?? null)

    return () => {
      useViewer.getState().setProjectId(null)
    }
  }, [projectId])

  // Load scene on mount (or when onLoad identity changes, e.g. project switch)
  useEffect(() => {
    let cancelled = false

    async function load() {
      isLoadingSceneRef.current = true
      setHasLoadedInitialScene(false)
      setIsSceneLoading(true)

      try {
        const sceneGraph = onLoad ? await onLoad() : loadSceneFromLocalStorage()
        if (!cancelled) {
          applySceneGraphToEditor(sceneGraph)
        }
      } catch {
        if (!cancelled) applySceneGraphToEditor(null)
      } finally {
        if (!cancelled) {
          setIsSceneLoading(false)
          setHasLoadedInitialScene(true)
          requestAnimationFrame(() => {
            isLoadingSceneRef.current = false
          })
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [onLoad, isLoadingSceneRef])

  // Apply preview scene when version preview mode changes
  useEffect(() => {
    if (isVersionPreviewMode && previewScene) {
      applySceneGraphToEditor(previewScene)
    }
  }, [isVersionPreviewMode, previewScene])

  useEffect(() => {
    document.body.classList.add('dark')
    return () => {
      document.body.classList.remove('dark')
    }
  }, [])

  useEffect(() => {
    setIsCameraControlsHintVisible(!readCameraControlsHintDismissed())
  }, [])

  const showLoader = isLoading || isSceneLoading
  const dismissCameraControlsHint = useCallback(() => {
    setIsCameraControlsHintVisible(false)
    writeCameraControlsHintDismissed(true)
  }, [])

  return (
    <PresetsProvider adapter={presetsAdapter}>
      <div className="dark h-full w-full text-foreground">
        {showLoader && (
          <div className="fixed inset-0 z-60">
            <SceneLoader />
          </div>
        )}

        {!showLoader && isCameraControlsHintVisible && !isFirstPersonMode ? (
          <ViewerCanvasControlsHint
            isPreviewMode={isPreviewMode}
            onDismiss={dismissCameraControlsHint}
          />
        ) : null}

        {isFirstPersonMode ? (
          <FirstPersonOverlay
            onExit={() => useEditor.getState().setFirstPersonMode(false)}
          />
        ) : !isLoading && isPreviewMode ? (
          <ViewerOverlay onBack={() => useEditor.getState().setPreviewMode(false)} />
        ) : (
          <>
            <ActionMenu />
            <PanelManager />
            {isFloorplanOpen && <FloorplanPanel />}
            <HelperManager />

            <SidebarProvider className="fixed z-20">
              <AppSidebar
                appMenuButton={appMenuButton}
                settingsPanelProps={settingsPanelProps}
                sidebarTop={sidebarTop}
                sitePanelProps={sitePanelProps}
              />
            </SidebarProvider>
          </>
        )}

        <ErrorBoundary fallback={<EditorSceneCrashFallback />}>
          <div className="h-full w-full">
            <SelectionPersistenceManager enabled={hasLoadedInitialScene && !showLoader} />
            <Viewer selectionManager={isPreviewMode || isFirstPersonMode ? 'default' : 'custom'}>
              {!isPreviewMode && !isFirstPersonMode && <SelectionManager />}
              {!isPreviewMode && !isFirstPersonMode && <FloatingActionMenu />}
              {!isPreviewMode && !isFirstPersonMode && <WallMeasurementLabel />}
              <ExportManager />
              {isPreviewMode || isFirstPersonMode ? <ViewerZoneSystem /> : <ZoneSystem />}
              <CeilingSystem />
              <RoofEditSystem />
              {!isPreviewMode && !isFirstPersonMode && (
                <Grid cellColor="#aaa" fadeDistance={500} sectionColor="#ccc" />
              )}
              {!(isPreviewMode || isFirstPersonMode || isLoading) && <ToolManager />}
              <CustomCameraControls />
              {isFirstPersonMode && <FirstPersonControls />}
              <ThumbnailGenerator onThumbnailCapture={onThumbnailCapture} />
              <PresetThumbnailGenerator />
              {!isPreviewMode && !isFirstPersonMode && <SiteEdgeLabels />}
              {(isPreviewMode || isFirstPersonMode) && <InteractiveSystem />}
            </Viewer>
          </div>
          {!(isPreviewMode || isFirstPersonMode || isLoading) && <ZoneLabelEditorSystem />}
        </ErrorBoundary>
      </div>
    </PresetsProvider>
  )
}
