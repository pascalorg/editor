'use client'

import { Icon } from '@iconify/react'
import { initSpaceDetectionSync, initSpatialGridSync, useScene } from '@pascal-app/core'
import { InteractiveSystem, useViewer, Viewer } from '@pascal-app/viewer'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
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
import { BoxSelectTool } from '../tools/select/box-select-tool'
import { ToolManager } from '../tools/tool-manager'
import { ActionMenu } from '../ui/action-menu'
import { CommandPalette, type CommandPaletteEmptyAction } from '../ui/command-palette'
import { EditorCommands } from '../ui/command-palette/editor-commands'
import { FloatingLevelSelector } from '../ui/floating-level-selector'
import { HelperManager } from '../ui/helpers/helper-manager'
import { PanelManager } from '../ui/panels/panel-manager'
import { ErrorBoundary } from '../ui/primitives/error-boundary'
import { useSidebarStore } from '../ui/primitives/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/primitives/tooltip'
import { SceneLoader } from '../ui/scene-loader'
import { AppSidebar } from '../ui/sidebar/app-sidebar'
import type { ExtraPanel } from '../ui/sidebar/icon-rail'
import { SettingsPanel, type SettingsPanelProps } from '../ui/sidebar/panels/settings-panel'
import { SitePanel, type SitePanelProps } from '../ui/sidebar/panels/site-panel'
import type { SidebarTab } from '../ui/sidebar/tab-bar'
import { CustomCameraControls } from './custom-camera-controls'
import { EditorLayoutV2 } from './editor-layout-v2'
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
  // Layout version — 'v1' (default) or 'v2' (navbar + two-column)
  layoutVersion?: 'v1' | 'v2'

  // UI slots (v1)
  appMenuButton?: ReactNode
  sidebarTop?: ReactNode

  // UI slots (v2)
  navbarSlot?: ReactNode
  sidebarTabs?: (SidebarTab & { component: React.ComponentType })[]
  viewerToolbarLeft?: ReactNode
  viewerToolbarRight?: ReactNode

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

  // Panel config (passed through to sidebar panels — v1 only)
  settingsPanelProps?: SettingsPanelProps
  sitePanelProps?: SitePanelProps
  extraSidebarPanels?: ExtraPanel[]

  // Presets storage backend (defaults to localStorage)
  presetsAdapter?: PresetsAdapter

  // Command palette fallback when no commands match
  commandPaletteEmptyAction?: CommandPaletteEmptyAction
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

// ── Sidebar slot: in-flow, resizable, collapses to a grab strip ──────────────

function SidebarSlot({ children }: { children: ReactNode }) {
  const width = useSidebarStore((s) => s.width)
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setIsCollapsed = useSidebarStore((s) => s.setIsCollapsed)
  const setWidth = useSidebarStore((s) => s.setWidth)
  const isDragging = useSidebarStore((s) => s.isDragging)
  const setIsDragging = useSidebarStore((s) => s.setIsDragging)

  const isResizing = useRef(false)
  const isExpanding = useRef(false)

  const handleResizerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      isResizing.current = true
      setIsDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [setIsDragging],
  )

  const handleGrabDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      isExpanding.current = true
      setIsDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [setIsDragging],
  )

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (isResizing.current) {
        setWidth(e.clientX)
      } else if (isExpanding.current && e.clientX > 60) {
        setIsCollapsed(false)
        setWidth(Math.max(240, e.clientX))
      }
    }
    const handlePointerUp = () => {
      isResizing.current = false
      isExpanding.current = false
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [setWidth, setIsCollapsed, setIsDragging])

  return (
    // Outer: no overflow-hidden so the handle can extend into the gap
    <div
      className="relative h-full flex-shrink-0 rounded-xl"
      style={{
        width: isCollapsed ? 8 : width,
        transition: isDragging ? 'none' : 'width 150ms ease',
      }}
    >
      {/* Inner: overflow-hidden clips content to rounded corners */}
      <div className="h-full w-full overflow-hidden rounded-xl">
        {isCollapsed ? (
          <div
            className="absolute inset-0 z-10 cursor-col-resize transition-colors hover:bg-primary/20"
            onPointerDown={handleGrabDown}
            title="Expand sidebar"
          />
        ) : (
          children
        )}
      </div>

      {/* Handle: extends into the gap, centered on the gap midpoint */}
      {!isCollapsed && (
        <div
          className="group absolute inset-y-0 -right-3.5 z-10 flex w-4 cursor-col-resize items-stretch justify-center py-4"
          onPointerDown={handleResizerDown}
        >
          <div className="w-px self-stretch rounded-full bg-transparent transition-colors group-hover:bg-neutral-300" />
        </div>
      )}
    </div>
  )
}

// ── UI overlays: fixed, scoped to viewer area via transform containing block ──

function ViewerOverlays({ left, children }: { left: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left,
        // Creates a containing block so position:fixed children are scoped here
        transform: 'translateZ(0)',
        zIndex: 30,
      }}
    >
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

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
    <div className="pointer-events-none absolute top-14 left-1/2 z-40 max-w-[calc(100%-2rem)] -translate-x-1/2">
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
  layoutVersion = 'v1',
  appMenuButton,
  sidebarTop,
  navbarSlot,
  sidebarTabs,
  viewerToolbarLeft,
  viewerToolbarRight,
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
  extraSidebarPanels,
  presetsAdapter,
  commandPaletteEmptyAction,
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
  const floorplanPaneRatio = useEditor((s) => s.floorplanPaneRatio)
  const setFloorplanPaneRatio = useEditor((s) => s.setFloorplanPaneRatio)

  const sidebarWidth = useSidebarStore((s) => s.width)
  const isSidebarCollapsed = useSidebarStore((s) => s.isCollapsed)
  const viewerAreaRef = useRef<HTMLDivElement>(null)
  const isResizingFloorplan = useRef(false)

  const handleFloorplanDividerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    isResizingFloorplan.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isResizingFloorplan.current) return
      if (!viewerAreaRef.current) return
      const rect = viewerAreaRef.current.getBoundingClientRect()
      const newRatio = (e.clientX - rect.left) / rect.width
      setFloorplanPaneRatio(Math.max(0.15, Math.min(0.85, newRatio)))
    }
    const handlePointerUp = () => {
      isResizingFloorplan.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

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

  // ── Shared viewer scene content ──
  const viewerSceneContent = (
    <>
      {!isFirstPersonMode && <SelectionManager />}
      {!isFirstPersonMode && <BoxSelectTool />}
      {!isFirstPersonMode && <FloatingActionMenu />}
      {!isFirstPersonMode && <WallMeasurementLabel />}
      <ExportManager />
      {isFirstPersonMode ? <ViewerZoneSystem /> : <ZoneSystem />}
      <CeilingSystem />
      <RoofEditSystem />
      {!isLoading && !isFirstPersonMode && <Grid cellColor="#aaa" fadeDistance={500} sectionColor="#ccc" />}
      {!isLoading && !isFirstPersonMode && <ToolManager />}
      <CustomCameraControls />
      {isFirstPersonMode && <FirstPersonControls />}
      <ThumbnailGenerator onThumbnailCapture={onThumbnailCapture} />
      <PresetThumbnailGenerator />
      {!isFirstPersonMode && <SiteEdgeLabels />}
      {isFirstPersonMode && <InteractiveSystem />}
    </>
  )

  const previewViewerContent = (
    <Viewer selectionManager="default">
      <ExportManager />
      <ViewerZoneSystem />
      <CeilingSystem />
      <RoofEditSystem />
      <CustomCameraControls />
      <ThumbnailGenerator onThumbnailCapture={onThumbnailCapture} />
      <PresetThumbnailGenerator />
      <InteractiveSystem />
    </Viewer>
  )

  // ── Shared viewer canvas (handles split/2d/3d) ──
  const viewMode = useEditor((s) => s.viewMode)

  const show2d = viewMode === '2d' || viewMode === 'split'
  const show3d = viewMode === '3d' || viewMode === 'split'

  const viewerCanvas = (
    <ErrorBoundary fallback={<EditorSceneCrashFallback />}>
      <div className="flex h-full" ref={viewerAreaRef}>
        {/* 2D floorplan — always mounted once shown, hidden via CSS to preserve state */}
        <div
          className="relative h-full flex-shrink-0"
          style={{
            width: viewMode === '2d' ? '100%' : `${floorplanPaneRatio * 100}%`,
            display: show2d ? undefined : 'none',
          }}
        >
          <div className="h-full w-full overflow-hidden">
            <FloorplanPanel />
          </div>
          {viewMode === 'split' && (
            <div
              className="absolute inset-y-0 -right-3 z-10 flex w-6 cursor-col-resize items-center justify-center"
              onPointerDown={handleFloorplanDividerDown}
            >
              <div className="h-8 w-1 rounded-full bg-neutral-400" />
            </div>
          )}
        </div>

        {/* 3D viewer — always mounted, hidden via CSS to avoid destroying the WebGL context */}
        <div
          className="relative min-w-0 flex-1 overflow-hidden"
          style={{ display: show3d ? undefined : 'none' }}
        >
          {!showLoader && isCameraControlsHintVisible && !isFirstPersonMode ? (
            <ViewerCanvasControlsHint
              isPreviewMode={isPreviewMode}
              onDismiss={dismissCameraControlsHint}
            />
          ) : null}
          <SelectionPersistenceManager enabled={hasLoadedInitialScene && !showLoader} />
          <Viewer selectionManager={isFirstPersonMode ? 'default' : 'custom'}>{viewerSceneContent}</Viewer>
        </div>
      </div>
      {!isLoading && <ZoneLabelEditorSystem />}
    </ErrorBoundary>
  )

  // ── V2 layout ──
  if (layoutVersion === 'v2') {
    const tabMap = new Map(sidebarTabs?.map((t) => [t.id, t]) ?? [])

    const renderTabContent = (tabId: string) => {
      // Built-in panels
      if (tabId === 'site') {
        return <SitePanel {...sitePanelProps} />
      }
      if (tabId === 'settings') {
        return <SettingsPanel {...settingsPanelProps} />
      }
      // External tabs (AI chat, catalog, etc.)
      const tab = tabMap.get(tabId)
      if (!tab) return null
      const Component = tab.component
      return <Component />
    }

    const tabBarTabs = sidebarTabs?.map(({ id, label }) => ({ id, label })) ?? []

    return (
      <PresetsProvider adapter={presetsAdapter}>
        {showLoader && (
          <div className="fixed inset-0 z-60">
            <SceneLoader />
          </div>
        )}

        {!isLoading && isPreviewMode ? (
          <div className="dark flex h-full w-full flex-col bg-neutral-100 text-foreground">
            <ViewerOverlay onBack={() => useEditor.getState().setPreviewMode(false)} />
            <div className="h-full w-full">{previewViewerContent}</div>
          </div>
        ) : (
          <>
            {/* First-person overlay — rendered on top of normal layout */}
            {isFirstPersonMode && (
              <div className="fixed inset-0 z-50 pointer-events-none">
                <div className="pointer-events-auto h-full w-full">
                  <FirstPersonOverlay
                    onExit={() => useEditor.getState().setFirstPersonMode(false)}
                  />
                </div>
              </div>
            )}
            <EditorLayoutV2
              navbarSlot={navbarSlot}
              overlays={
                <>
                  <FloatingLevelSelector />
                  <div className="pointer-events-auto">
                    <ActionMenu />
                  </div>
                  <div className="pointer-events-auto">
                    <PanelManager />
                  </div>
                  <div className="pointer-events-auto">
                    <HelperManager />
                  </div>
                </>
              }
              renderTabContent={renderTabContent}
              sidebarTabs={tabBarTabs}
              viewerContent={viewerCanvas}
              viewerToolbarLeft={viewerToolbarLeft}
              viewerToolbarRight={viewerToolbarRight}
            />
            <EditorCommands />
            <CommandPalette emptyAction={commandPaletteEmptyAction} />
          </>
        )}
      </PresetsProvider>
    )
  }

  // ── V1 layout (existing) ──
  // p-3 (12px) padding on root + gap-3 (12px) between sidebar and viewer + sidebar width
  const LAYOUT_PADDING = 12
  const LAYOUT_GAP = 12
  const overlayLeft = LAYOUT_PADDING + (isSidebarCollapsed ? 8 : sidebarWidth) + LAYOUT_GAP

  return (
    <PresetsProvider adapter={presetsAdapter}>
      <div className="dark flex h-full w-full gap-3 bg-neutral-100 p-3 text-foreground">
        {showLoader && (
          <div className="fixed inset-0 z-60">
            <SceneLoader />
          </div>
        )}

        {!isLoading && isPreviewMode ? (
          <>
            <ViewerOverlay onBack={() => useEditor.getState().setPreviewMode(false)} />
            <div className="h-full w-full">{previewViewerContent}</div>
          </>
        ) : (
          <>
            {/* Sidebar */}
            <SidebarSlot>
              <AppSidebar
                appMenuButton={appMenuButton}
                commandPaletteEmptyAction={commandPaletteEmptyAction}
                extraPanels={extraSidebarPanels}
                settingsPanelProps={settingsPanelProps}
                sidebarTop={sidebarTop}
                sitePanelProps={sitePanelProps}
              />
            </SidebarSlot>

            {/* Viewer area */}
            <div className="relative flex-1 overflow-hidden rounded-xl" ref={viewerAreaRef}>
              {viewerCanvas}
            </div>

            {/* Fixed UI overlays scoped to the viewer area */}
            <ViewerOverlays left={overlayLeft}>
              <div className="pointer-events-auto">
                <ActionMenu />
              </div>
              <div className="pointer-events-auto">
                <PanelManager />
              </div>
              <div className="pointer-events-auto">
                <HelperManager />
              </div>
            </ViewerOverlays>
          </>
        )}
      </div>
    </PresetsProvider>
  )
}
