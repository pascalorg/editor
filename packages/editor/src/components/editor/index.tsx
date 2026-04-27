'use client'

import { Icon } from '@iconify/react'
import {
  type AnyNode,
  type AnyNodeId,
  type ItemNode,
  initSpaceDetectionSync,
  initSpatialGridSync,
  spatialGridManager,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  type HoverStyles,
  InteractiveSystem,
  useViewer,
  Viewer,
  ViewerRuntimeStateProvider,
} from '@pascal-app/viewer'
import {
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { ViewerOverlay } from '../../components/viewer-overlay'
import { ViewerZoneSystem } from '../../components/viewer-zone-system'
import { type PresetsAdapter, PresetsProvider } from '../../contexts/presets-context'
import { type SaveStatus, useAutoSave } from '../../hooks/use-auto-save'
import { useKeyboard } from '../../hooks/use-keyboard'
import {
  buildPascalTruckNodeForScene,
  isPascalTruckNode,
  PASCAL_TRUCK_ITEM_NODE_ID,
  stripPascalTruckFromSceneGraph,
} from '../../lib/pascal-truck'
import {
  applySceneGraphToEditor,
  loadSceneFromLocalStorage,
  type SceneGraph,
  writePersistedSelection,
} from '../../lib/scene'
import { initSFXBus } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import useNavigation from '../../store/use-navigation'
import navigationVisualsStore from '../../store/use-navigation-visuals'
import { CeilingSelectionAffordanceSystem } from '../systems/ceiling/ceiling-selection-affordance-system'
import { CeilingSystem } from '../systems/ceiling/ceiling-system'
import { RoofEditSystem } from '../systems/roof/roof-edit-system'
import { StairEditSystem } from '../systems/stair/stair-edit-system'
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
import { FloatingBuildingActionMenu } from './floating-building-action-menu'
import { FloorplanPanel } from './floorplan-panel'
import { Grid } from './grid'
import { PresetThumbnailGenerator } from './preset-thumbnail-generator'
import { SelectionManager } from './selection-manager'
import { SiteEdgeLabels } from './site-edge-labels'
import { ThumbnailGenerator } from './thumbnail-generator'
import { ToolConeOverlayViewer } from './tool-cone-overlay-viewer'
import { WallMeasurementLabel } from './wall-measurement-label'

const CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY = 'editor-camera-controls-hint-dismissed:v1'
const DELETE_CURSOR_BADGE_COLOR = '#ef4444'
const DELETE_CURSOR_BADGE_OFFSET_X = 14
const DELETE_CURSOR_BADGE_OFFSET_Y = 14
const PAINT_CURSOR_BADGE_COLOR = '#f59e0b'
const PAINT_CURSOR_BADGE_DISABLED_COLOR = '#94a3b8'
const PAINT_CURSOR_BADGE_OFFSET_X = 14
const PAINT_CURSOR_BADGE_OFFSET_Y = 14
const EDITOR_HOVER_STYLES: HoverStyles = {
  default: { visibleColor: 0x00_aaff, hiddenColor: 0xf3_ff47, strength: 5, pulse: true },
  delete: { visibleColor: 0xef_4444, hiddenColor: 0x99_1b1b, strength: 6, pulse: false },
  'paint-ready': { visibleColor: 0xf5_9e0b, hiddenColor: 0xfd_e068, strength: 5, pulse: true },
  'paint-disabled': {
    visibleColor: 0x94_a3b8,
    hiddenColor: 0x47_5569,
    strength: 4,
    pulse: false,
  },
}

const NavigationPanel = lazy(async () => {
  const module = await import('../ui/panels/navigation-panel')
  return { default: module.NavigationPanel }
})

const NavigationRuntime = lazy(async () => {
  const module = await import('./navigation-system')
  return { default: module.NavigationSystem }
})

/**
 * Wire up module-level singletons (spatial grid, space detection, SFX) for
 * an Editor mount. Returns a teardown function that detaches the scene-store
 * subscriptions and resets the shared singletons so a subsequent remount —
 * including hot navigation back to the editor in the same tab — starts from
 * a clean slate.
 */
function initializeEditorRuntime(): () => void {
  const unsubscribeSpatialGrid = initSpatialGridSync()
  const unsubscribeSpaceDetection = initSpaceDetectionSync(useScene, useEditor)
  initSFXBus()

  return () => {
    unsubscribeSpatialGrid()
    unsubscribeSpaceDetection?.()

    spatialGridManager.clear()

    const outliner = useViewer.getState().outliner
    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0
  }
}

function cloneSceneGraph(sceneGraph: SceneGraph): SceneGraph {
  if (typeof structuredClone === 'function') {
    return structuredClone(sceneGraph)
  }

  return JSON.parse(JSON.stringify(sceneGraph)) as SceneGraph
}

function hasTaskModeSceneContent(
  sceneGraph: SceneGraph | null | undefined,
): sceneGraph is SceneGraph {
  if (
    !sceneGraph ||
    !Array.isArray(sceneGraph.rootNodeIds) ||
    sceneGraph.rootNodeIds.length === 0
  ) {
    return false
  }

  return Object.values(sceneGraph.nodes ?? {}).some((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return false
    }

    const type = (node as { type?: unknown }).type
    return typeof type === 'string' && type !== 'site' && type !== 'building' && type !== 'level'
  })
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

  // Version preview overlays (rendered by host app)
  sidebarOverlay?: ReactNode
  viewerBanner?: ReactNode

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

const SIMPLE_ROBOT_CAMERA_CONTROL_HINTS: CameraControlHint[] = [
  {
    action: 'Pan',
    keys: [{ value: 'Space' }, { value: 'Left click' }],
  },
  { action: 'Rotate/Move Robot', keys: [{ value: 'Right click' }] },
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
  isSimpleRobotMode,
  isPreviewMode,
  onDismiss,
}: {
  isSimpleRobotMode: boolean
  isPreviewMode: boolean
  onDismiss: () => void
}) {
  const hints = isPreviewMode
    ? PREVIEW_CAMERA_CONTROL_HINTS
    : isSimpleRobotMode
      ? SIMPLE_ROBOT_CAMERA_CONTROL_HINTS
      : EDITOR_CAMERA_CONTROL_HINTS

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

function DeleteCursorBadge({ position }: { position: { x: number; y: number } }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-40"
      style={{
        left: position.x + DELETE_CURSOR_BADGE_OFFSET_X,
        top: position.y + DELETE_CURSOR_BADGE_OFFSET_Y,
      }}
    >
      <div
        className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/95 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
        style={{
          boxShadow: `0 8px 16px -4px rgba(0,0,0,0.3), 0 4px 8px -4px rgba(0,0,0,0.2), 0 0 18px ${DELETE_CURSOR_BADGE_COLOR}22`,
        }}
      >
        <Icon
          aria-hidden="true"
          className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
          color={DELETE_CURSOR_BADGE_COLOR}
          height={18}
          icon="mdi:trash-can-outline"
          width={18}
        />
      </div>
    </div>
  )
}

function PaintCursorBadge({
  position,
  label,
  disabled,
  icon,
}: {
  position: { x: number; y: number }
  label: string
  disabled: boolean
  icon: string
}) {
  const accentColor = disabled ? PAINT_CURSOR_BADGE_DISABLED_COLOR : PAINT_CURSOR_BADGE_COLOR

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-40"
      style={{
        left: position.x + PAINT_CURSOR_BADGE_OFFSET_X,
        top: position.y + PAINT_CURSOR_BADGE_OFFSET_Y,
      }}
    >
      <div
        className="flex items-center gap-2 rounded-xl border border-white/5 bg-zinc-900/95 px-3 py-2 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
        style={{
          boxShadow: `0 8px 16px -4px rgba(0,0,0,0.3), 0 4px 8px -4px rgba(0,0,0,0.2), 0 0 18px ${accentColor}22`,
        }}
      >
        <Icon
          aria-hidden="true"
          className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
          color={accentColor}
          height={16}
          icon={icon}
          width={16}
        />
        <span className="font-medium text-[11px]" style={{ color: accentColor }}>
          {label}
        </span>
      </div>
    </div>
  )
}

// ── Viewer scene content: memoized so <Viewer> doesn't re-render on mode/viewMode changes ──

const ViewerSceneContent = memo(function ViewerSceneContent({
  isVersionPreviewMode,
  isLoading,
  isFirstPersonMode,
  onThumbnailCapture,
  robotModeActive,
}: {
  isVersionPreviewMode: boolean
  isLoading: boolean
  isFirstPersonMode: boolean
  onThumbnailCapture?: (blob: Blob) => void
  robotModeActive: boolean
}) {
  return (
    <>
      {!isFirstPersonMode && <SelectionManager />}
      {!isVersionPreviewMode && !isFirstPersonMode && <BoxSelectTool />}
      {!isVersionPreviewMode && !isFirstPersonMode && <FloatingActionMenu />}
      {!isVersionPreviewMode && !isFirstPersonMode && <FloatingBuildingActionMenu />}
      {!isFirstPersonMode && <WallMeasurementLabel />}
      <ExportManager />
      {isFirstPersonMode ? <ViewerZoneSystem /> : <ZoneSystem />}
      <CeilingSystem />
      <CeilingSelectionAffordanceSystem />
      <RoofEditSystem />
      <StairEditSystem />
      {!isLoading && !isFirstPersonMode && (
        <Grid cellColor="#aaa" fadeDistance={500} sectionColor="#ccc" />
      )}
      {!isLoading && !isFirstPersonMode && robotModeActive && (
        <Suspense fallback={null}>
          <NavigationRuntime />
        </Suspense>
      )}
      {!(isLoading || isVersionPreviewMode) && !isFirstPersonMode && <ToolManager />}
      {isFirstPersonMode && <FirstPersonControls />}
      <CustomCameraControls />
      <ThumbnailGenerator onThumbnailCapture={onThumbnailCapture} />
      <PresetThumbnailGenerator />
      {!isFirstPersonMode && <SiteEdgeLabels />}
      {isFirstPersonMode && <InteractiveSystem />}
    </>
  )
})

// ── Delete cursor badge: isolated component so cursor moves don't re-render ViewerCanvas ──
// Subscribes to mode itself and manages cursor position state independently.

function DeleteCursorLayer({
  containerRef,
  isVersionPreviewMode,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  isVersionPreviewMode: boolean
}) {
  const mode = useEditor((s) => s.mode)
  const badgeRef = useRef<HTMLDivElement>(null)
  const active = mode === 'delete' && !isVersionPreviewMode

  useEffect(() => {
    if (!active) {
      if (badgeRef.current) {
        badgeRef.current.style.display = 'none'
      }
      return
    }
    const el = containerRef.current
    if (!el) return
    let frame = 0
    let nextX = 0
    let nextY = 0
    const badge = badgeRef.current

    const flushPosition = () => {
      frame = 0
      if (!badge) return
      badge.style.display = 'block'
      badge.style.transform = `translate(${nextX + DELETE_CURSOR_BADGE_OFFSET_X}px, ${nextY + DELETE_CURSOR_BADGE_OFFSET_Y}px)`
    }

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      nextX = e.clientX - rect.left
      nextY = e.clientY - rect.top

      if (frame === 0) {
        frame = window.requestAnimationFrame(flushPosition)
      }
    }
    const onLeave = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      if (badge) {
        badge.style.display = 'none'
      }
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
      }
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [active, containerRef])

  if (!active) return null

  return (
    <div
      className="pointer-events-none"
      ref={badgeRef}
      style={{ display: 'none', position: 'absolute', left: 0, top: 0 }}
    >
      <DeleteCursorBadge position={{ x: 0, y: 0 }} />
    </div>
  )
}

function PaintCursorLayer({
  containerRef,
  isVersionPreviewMode,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  isVersionPreviewMode: boolean
}) {
  const mode = useEditor((s) => s.mode)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  const activePaintTarget = useEditor((s) => s.activePaintTarget)
  const badgeRef = useRef<HTMLDivElement>(null)
  const active = mode === 'material-paint' && !isVersionPreviewMode

  useEffect(() => {
    if (!active) {
      if (badgeRef.current) {
        badgeRef.current.style.display = 'none'
      }
      return
    }
    const el = containerRef.current
    if (!el) return
    let frame = 0
    let nextX = 0
    let nextY = 0
    const badge = badgeRef.current

    const flushPosition = () => {
      frame = 0
      if (!badge) return
      badge.style.display = 'block'
      badge.style.transform = `translate(${nextX + PAINT_CURSOR_BADGE_OFFSET_X}px, ${nextY + PAINT_CURSOR_BADGE_OFFSET_Y}px)`
    }

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      nextX = e.clientX - rect.left
      nextY = e.clientY - rect.top

      if (frame === 0) {
        frame = window.requestAnimationFrame(flushPosition)
      }
    }
    const onLeave = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      if (badge) {
        badge.style.display = 'none'
      }
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
      }
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [active, containerRef])

  const hasMaterial = Boolean(
    activePaintMaterial &&
      (activePaintMaterial.material !== undefined ||
        activePaintMaterial.materialPreset !== undefined),
  )
  const label = !hasMaterial ? 'Choose material' : `Paint ${activePaintTarget}`
  const icon = 'mdi:format-color-fill'

  useLayoutEffect(() => {
    if (!active && badgeRef.current) {
      badgeRef.current.style.display = 'none'
    }
  }, [active])

  if (!active) return null

  return (
    <div
      className="pointer-events-none"
      ref={badgeRef}
      style={{ display: 'none', position: 'absolute', left: 0, top: 0 }}
    >
      <PaintCursorBadge
        disabled={!hasMaterial}
        icon={icon}
        label={label}
        position={{ x: 0, y: 0 }}
      />
    </div>
  )
}

// ── Viewer canvas: memoized, subscribes to viewMode/floorplanPaneRatio internally ──
// This prevents Editor from re-rendering when those values change.

const ViewerCanvas = memo(function ViewerCanvas({
  isVersionPreviewMode,
  isLoading,
  hasLoadedInitialScene,
  showLoader,
  isFirstPersonMode,
  onThumbnailCapture,
}: {
  isVersionPreviewMode: boolean
  isLoading: boolean
  hasLoadedInitialScene: boolean
  showLoader: boolean
  isFirstPersonMode: boolean
  onThumbnailCapture?: (blob: Blob) => void
}) {
  const viewMode = useEditor((s) => s.viewMode)
  const floorplanPaneRatio = useEditor((s) => s.floorplanPaneRatio)
  const setFloorplanPaneRatio = useEditor((s) => s.setFloorplanPaneRatio)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const robotMode = useNavigation((state) => state.robotMode)
  const robotModeActive = robotMode !== null

  const [isCameraControlsHintVisible, setIsCameraControlsHintVisible] = useState<boolean | null>(
    null,
  )

  const viewerAreaRef = useRef<HTMLDivElement>(null)
  const viewer3dRef = useRef<HTMLDivElement>(null)
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
  }, [setFloorplanPaneRatio])

  useEffect(() => {
    setIsCameraControlsHintVisible(!readCameraControlsHintDismissed())
  }, [])

  const dismissCameraControlsHint = useCallback(() => {
    setIsCameraControlsHintVisible(false)
    writeCameraControlsHintDismissed(true)
  }, [])

  const show2d = viewMode === '2d' || viewMode === 'split'
  const show3d = viewMode === '3d' || viewMode === 'split'

  return (
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
          ref={viewer3dRef}
          style={{ display: show3d ? undefined : 'none' }}
        >
          <DeleteCursorLayer
            containerRef={viewer3dRef}
            isVersionPreviewMode={isVersionPreviewMode}
          />
          <PaintCursorLayer
            containerRef={viewer3dRef}
            isVersionPreviewMode={isVersionPreviewMode}
          />
          {!showLoader && isCameraControlsHintVisible && !isFirstPersonMode ? (
            <ViewerCanvasControlsHint
              isSimpleRobotMode={robotMode === 'normal'}
              isPreviewMode={isPreviewMode}
              onDismiss={dismissCameraControlsHint}
            />
          ) : null}
          <SelectionPersistenceManager enabled={hasLoadedInitialScene && !showLoader} />
          <ViewerRuntimeStateProvider store={navigationVisualsStore}>
            <ToolConeOverlayViewer
              enabled={robotModeActive}
              hoverStyles={EDITOR_HOVER_STYLES}
              selectionManager={isFirstPersonMode ? 'default' : 'custom'}
            >
              <ViewerSceneContent
                isFirstPersonMode={isFirstPersonMode}
                isLoading={isLoading}
                isVersionPreviewMode={isVersionPreviewMode}
                onThumbnailCapture={onThumbnailCapture}
                robotModeActive={robotModeActive}
              />
            </ToolConeOverlayViewer>
          </ViewerRuntimeStateProvider>
        </div>
      </div>
      {!(isLoading || isVersionPreviewMode) && <ZoneLabelEditorSystem />}
    </ErrorBoundary>
  )
})

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
  sidebarOverlay,
  viewerBanner,
  settingsPanelProps,
  sitePanelProps,
  extraSidebarPanels,
  presetsAdapter,
  commandPaletteEmptyAction,
}: EditorProps) {
  useKeyboard({ isVersionPreviewMode })

  const robotMode = useNavigation((state) => state.robotMode)
  const taskLoopToken = useNavigation((state) => state.taskLoopToken)
  const [taskModeSceneRestorePending, setTaskModeSceneRestorePending] = useState(false)

  const { isLoadingSceneRef } = useAutoSave({
    onSave,
    onDirty,
    onSaveStatusChange,
    isVersionPreviewMode,
    suppressSave: robotMode === 'task' || taskModeSceneRestorePending,
  })

  const [isSceneLoading, setIsSceneLoading] = useState(false)
  const [hasLoadedInitialScene, setHasLoadedInitialScene] = useState(false)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const isFirstPersonMode = useEditor((s) => s.isFirstPersonMode)
  const previousRobotModeRef = useRef<typeof robotMode>(robotMode)
  const previousTaskLoopTokenRef = useRef(taskLoopToken)
  const pascalTruckNodeRef = useRef<ItemNode | null>(null)
  const taskModeSceneSnapshotRef = useRef<SceneGraph | null>(null)

  const sidebarWidth = useSidebarStore((s) => s.width)
  const isSidebarCollapsed = useSidebarStore((s) => s.isCollapsed)

  const stripPascalTruckFromScene = useCallback(
    (sceneGraph?: SceneGraph | null): SceneGraph | null => {
      const { sceneGraph: sanitizedSceneGraph, truckNode } =
        stripPascalTruckFromSceneGraph(sceneGraph)
      if (truckNode) {
        pascalTruckNodeRef.current = truckNode
      }

      return (sanitizedSceneGraph as SceneGraph | null | undefined) ?? null
    },
    [],
  )

  const captureCurrentSceneGraph = useCallback((): SceneGraph => {
    const sceneState = useScene.getState()
    const sceneGraph = cloneSceneGraph({
      nodes: sceneState.nodes as SceneGraph['nodes'],
      rootNodeIds: [...sceneState.rootNodeIds] as SceneGraph['rootNodeIds'],
    })
    return stripPascalTruckFromScene(sceneGraph) ?? sceneGraph
  }, [stripPascalTruckFromScene])

  const restoreTaskModeSceneSnapshot = useCallback(
    (options?: { clearSnapshot?: boolean; settledToken?: number }) => {
      const finalizeRestore = () => {
        if (options?.clearSnapshot) {
          taskModeSceneSnapshotRef.current = null
        }
        if (typeof options?.settledToken === 'number') {
          useNavigation.getState().setTaskLoopSettledToken(options.settledToken)
        }
      }

      const snapshot = taskModeSceneSnapshotRef.current
      if (!hasTaskModeSceneContent(snapshot)) {
        const currentScene = captureCurrentSceneGraph()
        taskModeSceneSnapshotRef.current = hasTaskModeSceneContent(currentScene)
          ? currentScene
          : null
        finalizeRestore()
        return false
      }

      isLoadingSceneRef.current = true
      setTaskModeSceneRestorePending(true)
      useLiveTransforms.getState().clearAll()
      const nextSceneGraph = cloneSceneGraph(snapshot)
      if (useNavigation.getState().robotMode === 'task') {
        const hasTruckNode = Object.values(nextSceneGraph.nodes).some((node) =>
          isPascalTruckNode(node),
        )
        if (!hasTruckNode) {
          const { node, parentId } = buildPascalTruckNodeForScene(
            nextSceneGraph,
            pascalTruckNodeRef.current,
          )
          if (parentId) {
            nextSceneGraph.nodes[node.id] = node
            const parentNode = nextSceneGraph.nodes[parentId]
            if (parentNode && typeof parentNode === 'object' && parentNode !== null) {
              const parentRecord = parentNode as { children?: unknown }
              const nextChildren = Array.isArray(parentRecord.children)
                ? [...parentRecord.children]
                : []
              if (!nextChildren.includes(node.id)) {
                nextChildren.push(node.id)
              }
              nextSceneGraph.nodes[parentId] = {
                ...parentNode,
                children: nextChildren,
              }
            }
          }
        }
      }
      applySceneGraphToEditor(nextSceneGraph, {
        mode: useNavigation.getState().robotMode === 'task' ? 'task-loop' : 'full',
      })
      requestAnimationFrame(() => {
        isLoadingSceneRef.current = false
        setTaskModeSceneRestorePending(false)
        finalizeRestore()
      })
      return true
    },
    [captureCurrentSceneGraph, isLoadingSceneRef],
  )

  useEffect(() => {
    const teardown = initializeEditorRuntime()
    return teardown
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
        const loadedSceneGraph = onLoad ? await onLoad() : loadSceneFromLocalStorage()
        const sceneGraph = stripPascalTruckFromScene(loadedSceneGraph)
        if (!cancelled) {
          applySceneGraphToEditor(sceneGraph)
          if (useNavigation.getState().robotMode === 'task') {
            taskModeSceneSnapshotRef.current = hasTaskModeSceneContent(sceneGraph)
              ? cloneSceneGraph(sceneGraph)
              : null
          }
        }
      } catch {
        if (!cancelled) {
          applySceneGraphToEditor(null)
          if (useNavigation.getState().robotMode === 'task') {
            taskModeSceneSnapshotRef.current = null
          }
        }
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
  }, [isLoadingSceneRef, onLoad, stripPascalTruckFromScene])

  // Apply preview scene when version preview mode changes
  useEffect(() => {
    if (isVersionPreviewMode && previewScene) {
      applySceneGraphToEditor(stripPascalTruckFromScene(previewScene))
    }
  }, [isVersionPreviewMode, previewScene, stripPascalTruckFromScene])

  // Lock scene graph and reset to select mode when entering version preview
  useEffect(() => {
    useScene.getState().setReadOnly(isVersionPreviewMode)
    if (isVersionPreviewMode) {
      useEditor.getState().setMode('select')
    }
    return () => {
      useScene.getState().setReadOnly(false)
    }
  }, [isVersionPreviewMode])

  useEffect(() => {
    if (!hasLoadedInitialScene || isVersionPreviewMode || taskModeSceneRestorePending) {
      return
    }

    const sceneState = useScene.getState()
    const currentSceneGraph = cloneSceneGraph({
      nodes: sceneState.nodes as SceneGraph['nodes'],
      rootNodeIds: [...sceneState.rootNodeIds] as SceneGraph['rootNodeIds'],
    })
    const existingTruckNode =
      (Object.values(currentSceneGraph.nodes).find((node) =>
        isPascalTruckNode(node),
      ) as ItemNode | null) ?? null

    if (existingTruckNode) {
      pascalTruckNodeRef.current = cloneSceneGraph({
        nodes: { [existingTruckNode.id]: existingTruckNode },
        rootNodeIds: [],
      }).nodes[existingTruckNode.id] as ItemNode
    }

    if (robotMode === null) {
      if (existingTruckNode) {
        sceneState.deleteNode(existingTruckNode.id as AnyNodeId)
      }
      return
    }

    if (existingTruckNode?.id === PASCAL_TRUCK_ITEM_NODE_ID) {
      return
    }

    const { node, parentId } = buildPascalTruckNodeForScene(
      currentSceneGraph,
      pascalTruckNodeRef.current,
    )
    if (!parentId) {
      return
    }

    if (existingTruckNode) {
      sceneState.deleteNode(existingTruckNode.id as AnyNodeId)
    }

    sceneState.createNode(node as AnyNode, parentId as AnyNodeId)
  }, [
    hasLoadedInitialScene,
    isVersionPreviewMode,
    robotMode,
    taskLoopToken,
    taskModeSceneRestorePending,
  ])

  useEffect(() => {
    document.body.classList.add('dark')
    return () => {
      document.body.classList.remove('dark')
    }
  }, [])

  useEffect(() => {
    const previousRobotMode = previousRobotModeRef.current
    if (previousRobotMode !== 'task' && robotMode === 'task') {
      const currentScene = captureCurrentSceneGraph()
      taskModeSceneSnapshotRef.current = hasTaskModeSceneContent(currentScene) ? currentScene : null
      useNavigation.getState().setTaskLoopSettledToken(useNavigation.getState().taskLoopToken)
    } else if (previousRobotMode === 'task' && robotMode !== 'task') {
      restoreTaskModeSceneSnapshot({ clearSnapshot: true })
    }

    previousRobotModeRef.current = robotMode
  }, [captureCurrentSceneGraph, restoreTaskModeSceneSnapshot, robotMode])

  useEffect(() => {
    const previousTaskLoopToken = previousTaskLoopTokenRef.current
    if (previousTaskLoopToken === taskLoopToken) {
      return
    }

    previousTaskLoopTokenRef.current = taskLoopToken
    if (robotMode !== 'task') {
      return
    }

    restoreTaskModeSceneSnapshot({ settledToken: taskLoopToken })
  }, [restoreTaskModeSceneSnapshot, robotMode, taskLoopToken])

  const showLoader = isLoading || isSceneLoading

  const previewViewerContent = (
    <Viewer hoverStyles={EDITOR_HOVER_STYLES} selectionManager="default">
      <ExportManager />
      <ViewerZoneSystem />
      <CeilingSystem />
      <RoofEditSystem />
      <StairEditSystem />
      <CustomCameraControls />
      <ThumbnailGenerator onThumbnailCapture={onThumbnailCapture} />
      <PresetThumbnailGenerator />
      <InteractiveSystem />
    </Viewer>
  )

  const viewerCanvas = (
    <ViewerCanvas
      hasLoadedInitialScene={hasLoadedInitialScene}
      isFirstPersonMode={isFirstPersonMode}
      isLoading={isLoading}
      isVersionPreviewMode={isVersionPreviewMode}
      onThumbnailCapture={onThumbnailCapture}
      showLoader={showLoader}
    />
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
            <EditorLayoutV2
              navbarSlot={navbarSlot}
              overlays={
                <>
                  <FloatingLevelSelector />
                  {!isVersionPreviewMode && (
                    <div className="pointer-events-auto">
                      <ActionMenu />
                    </div>
                  )}
                  {!isVersionPreviewMode && (
                    <div className="pointer-events-auto">
                      <PanelManager />
                    </div>
                  )}
                  {!isVersionPreviewMode && !isFirstPersonMode && robotMode && (
                    <div className="pointer-events-auto">
                      <Suspense fallback={null}>
                        <NavigationPanel />
                      </Suspense>
                    </div>
                  )}
                  <div className="pointer-events-auto">
                    <HelperManager />
                  </div>
                  {viewerBanner}
                </>
              }
              renderTabContent={renderTabContent}
              sidebarOverlay={sidebarOverlay}
              sidebarTabs={tabBarTabs}
              viewerContent={viewerCanvas}
              viewerToolbarLeft={viewerToolbarLeft}
              viewerToolbarRight={viewerToolbarRight}
            />
            {/* First-person overlay — rendered on top of normal layout */}
            {isFirstPersonMode && (
              <div className="fixed inset-0 z-50 pointer-events-none">
                <FirstPersonOverlay onExit={() => useEditor.getState().setFirstPersonMode(false)} />
              </div>
            )}
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
            <div className="relative flex-1 overflow-hidden rounded-xl">{viewerCanvas}</div>

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
