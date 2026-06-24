'use client'

import { Icon } from '@iconify/react'
import {
  type AnyNodeId,
  emitter,
  initSpaceDetectionSync,
  initSpatialGridSync,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import {
  clearViewerMaterialCaches,
  type HoverStyles,
  InteractiveSystem,
  useViewer,
  Viewer,
} from '@pascal-app/viewer'
import {
  memo,
  type ReactNode,
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
import { deleteSelectedNodeIds, useKeyboard } from '../../hooks/use-keyboard'
import {
  applySceneGraphToEditor,
  loadSceneFromLocalStorage,
  type SceneGraph,
  writePersistedSelection,
} from '../../lib/scene'
import { computeSceneBoundsXZ, pickSceneCameraFocusBounds } from '../../lib/scene-bounds'
import { initSFXBus } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { CeilingSelectionAffordanceSystem } from '../systems/ceiling/ceiling-selection-affordance-system'
import { CeilingSystem } from '../systems/ceiling/ceiling-system'
import { LiveDataBindingRuntime } from '../systems/live-data/live-data-binding-runtime'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/primitives/dialog'
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
import { NodeArrowHandles } from './node-arrow-handles'
import { PresetThumbnailGenerator } from './preset-thumbnail-generator'
import { SelectionManager } from './selection-manager'
import { SiteEdgeLabels } from './site-edge-labels'
import { SnapshotCaptureOverlay } from './snapshot-capture-overlay'
import { type SnapshotCameraData, ThumbnailGenerator } from './thumbnail-generator'
import { WallMoveSideHandles } from './wall-move-side-handles'

const CAMERA_CONTROLS_HINT_DISMISSED_STORAGE_KEY = 'editor-camera-controls-hint-dismissed:v1'
const CAMERA_CONTROLS_HINT_ICON_COLOR = '#bfbfbf'
const DELETE_CURSOR_BADGE_COLOR = '#ef4444'
const DELETE_CURSOR_BADGE_OFFSET_X = 14
const DELETE_CURSOR_BADGE_OFFSET_Y = 14
const PAINT_CURSOR_BADGE_COLOR = '#f59e0b'
const PAINT_CURSOR_BADGE_DISABLED_COLOR = '#94a3b8'
const PAINT_CURSOR_BADGE_OFFSET_X = 14
const PAINT_CURSOR_BADGE_OFFSET_Y = 14
const EDITOR_HOVER_STYLES: HoverStyles = {
  default: { visibleColor: 0x00_aa_ff, hiddenColor: 0xf3_ff_47, strength: 5, pulse: true },
  delete: { visibleColor: 0xef_44_44, hiddenColor: 0x99_1b_1b, strength: 6, pulse: false },
  'paint-ready': { visibleColor: 0xf5_9e_0b, hiddenColor: 0xfd_e0_68, strength: 5, pulse: true },
  'paint-disabled': {
    visibleColor: 0x94_a3_b8,
    hiddenColor: 0x47_55_69,
    strength: 4,
    pulse: false,
  },
}

function SnapAwareGrid() {
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  return <Grid cellColor="#aaa" cellSize={gridSnapStep} fadeDistance={500} sectionColor="#ccc" />
}

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
    clearViewerMaterialCaches()

    const outliner = useViewer.getState().outliner
    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0
  }
}

function DeleteSelectionConfirmDialog({
  selectedIds,
  onCancel,
  onConfirm,
}: {
  selectedIds: readonly AnyNodeId[]
  onCancel: () => void
  onConfirm: () => void
}) {
  const count = selectedIds.length
  return (
    <Dialog open={count > 1} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="w-[360px] gap-3 border-white/10 bg-[#202124] p-4 text-white shadow-2xl sm:max-w-[360px]">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-base">删除选中的物品？</DialogTitle>
          <DialogDescription className="text-neutral-300 text-sm">
            已选中 {count} 个物品，删除后可通过撤销恢复。确定要删除吗？
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-1 flex-row justify-end gap-2">
          <button
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-neutral-100 text-sm transition hover:bg-white/10"
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="rounded-md bg-red-500 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-red-400"
            onClick={onConfirm}
            type="button"
          >
            删除
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function emitFitSceneForGraph(sceneGraph: SceneGraph | null | undefined) {
  if (!sceneGraph) {
    emitter.emit('camera-controls:fit-scene', {})
    return
  }
  const nodes = sceneGraph.nodes as Parameters<typeof pickSceneCameraFocusBounds>[0]
  const focus = pickSceneCameraFocusBounds(nodes)
  const bounds = focus?.bounds ?? computeSceneBoundsXZ(nodes)
  emitter.emit(
    'camera-controls:fit-scene',
    bounds ? { bounds, reason: focus?.reason ?? 'scene-bounds' } : {},
  )
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
  onThumbnailCapture?: (blob: Blob, cameraData: SnapshotCameraData) => void

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
    action: '平移',
    keys: [{ value: 'Space' }, { value: 'Left click' }],
  },
  { action: '旋转', keys: [{ value: 'Right click' }] },
  { action: '缩放', keys: [{ value: 'Scroll' }] },
]

const PREVIEW_CAMERA_CONTROL_HINTS: CameraControlHint[] = [
  { action: '平移', keys: [{ value: 'Left click' }] },
  { action: '旋转', keys: [{ value: 'Right click' }] },
  { action: '缩放', keys: [{ value: 'Scroll' }] },
]

const CAMERA_SHORTCUT_KEY_META: Record<string, { icon?: string; label: string; text?: string }> = {
  'Left click': {
    icon: 'ph:mouse-left-click-fill',
    label: '鼠标左键',
  },
  'Middle click': {
    icon: 'qlementine-icons:mouse-middle-button-16',
    label: '鼠标中键',
  },
  'Right click': {
    icon: 'ph:mouse-right-click-fill',
    label: '鼠标右键',
  },
  Scroll: {
    icon: 'qlementine-icons:mouse-middle-button-16',
    label: '鼠标滚轮',
  },
  Space: {
    icon: 'lucide:space',
    label: '空格键',
    text: '空格',
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
        <Icon
          aria-hidden="true"
          color={CAMERA_CONTROLS_HINT_ICON_COLOR}
          height={16}
          icon={meta.icon}
          width={16}
        />
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
        className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-border/35 bg-background/90 px-3.5 py-2.5 shadow-elevation-4 backdrop-blur-xl"
      >
        <div
          className={`grid min-w-0 flex-1 items-start divide-x divide-border/18 ${
            hints.length > 3 ? 'grid-cols-4' : 'grid-cols-3'
          }`}
        >
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
                color={CAMERA_CONTROLS_HINT_ICON_COLOR}
                height={14}
                icon="lucide:x"
                width={14}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            关闭提示
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
  isPreviewMode,
  onThumbnailCapture,
}: {
  isVersionPreviewMode: boolean
  isLoading: boolean
  isFirstPersonMode: boolean
  isPreviewMode: boolean
  onThumbnailCapture?: (blob: Blob, cameraData: SnapshotCameraData) => void
}) {
  const isCaptureMode = useEditor((s) => s.isCaptureMode)
  const noEditing = isVersionPreviewMode || isFirstPersonMode || isCaptureMode || isPreviewMode

  return (
    <>
      {isPreviewMode ? null : !(isFirstPersonMode || isCaptureMode) && <SelectionManager />}
      {!noEditing && <BoxSelectTool />}
      {!noEditing && <NodeArrowHandles />}
      {!noEditing && <WallMoveSideHandles />}
      {!noEditing && <FloatingActionMenu />}
      {!noEditing && <FloatingBuildingActionMenu />}
      <ExportManager />
      {isPreviewMode || isFirstPersonMode ? <ViewerZoneSystem /> : <ZoneSystem />}
      <CeilingSystem />
      {!isPreviewMode && <CeilingSelectionAffordanceSystem />}
      <RoofEditSystem />
      <StairEditSystem />
      <LiveDataBindingRuntime />
      {!(isPreviewMode || isFirstPersonMode) && <SiteEdgeLabels />}
      {!(isLoading || isFirstPersonMode || isPreviewMode) && <SnapAwareGrid />}
      {!(isLoading || noEditing) && <ToolManager />}
      {isFirstPersonMode && <FirstPersonControls />}
      <CustomCameraControls />
      <ThumbnailGenerator onThumbnailCapture={onThumbnailCapture} />
      <PresetThumbnailGenerator />
      <InteractiveSystem />
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
  const label = hasMaterial ? `Paint ${activePaintTarget}` : 'Choose material'
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
  isFirstPersonMode,
  hasLoadedInitialScene,
  showLoader,
  onThumbnailCapture,
}: {
  isVersionPreviewMode: boolean
  isLoading: boolean
  isFirstPersonMode: boolean
  hasLoadedInitialScene: boolean
  showLoader: boolean
  onThumbnailCapture?: (blob: Blob, cameraData: SnapshotCameraData) => void
}) {
  const viewMode = useEditor((s) => s.viewMode)
  const floorplanPaneRatio = useEditor((s) => s.floorplanPaneRatio)
  const setFloorplanPaneRatio = useEditor((s) => s.setFloorplanPaneRatio)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)

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
              isPreviewMode={isPreviewMode}
              onDismiss={dismissCameraControlsHint}
            />
          ) : null}
          <SelectionPersistenceManager enabled={hasLoadedInitialScene && !showLoader} />
          <Viewer
            hoverStyles={EDITOR_HOVER_STYLES}
            selectionManager={isFirstPersonMode || isPreviewMode ? 'default' : 'custom'}
          >
            <ViewerSceneContent
              isFirstPersonMode={isFirstPersonMode}
              isLoading={isLoading}
              isPreviewMode={isPreviewMode}
              isVersionPreviewMode={isVersionPreviewMode}
              onThumbnailCapture={onThumbnailCapture}
            />
          </Viewer>
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
  const isFirstPersonMode = useEditor((s) => s.isFirstPersonMode)
  const [deleteConfirmationIds, setDeleteConfirmationIds] = useState<AnyNodeId[]>([])

  const handleRequestDeleteSelectedNodes = useCallback((selectedNodeIds: AnyNodeId[]) => {
    setDeleteConfirmationIds(selectedNodeIds)
  }, [])

  const handleCancelDeleteSelection = useCallback(() => {
    setDeleteConfirmationIds([])
  }, [])

  const handleConfirmDeleteSelection = useCallback(() => {
    const existingIds = deleteConfirmationIds.filter((id) => Boolean(useScene.getState().nodes[id]))
    deleteSelectedNodeIds(existingIds)
    setDeleteConfirmationIds([])
  }, [deleteConfirmationIds])

  useKeyboard({
    isVersionPreviewMode,
    disabled: isFirstPersonMode,
    onRequestDeleteSelectedNodes: handleRequestDeleteSelectedNodes,
  })

  const { isLoadingSceneRef } = useAutoSave({
    onSave,
    onDirty,
    onSaveStatusChange,
    isVersionPreviewMode,
  })

  const [isSceneLoading, setIsSceneLoading] = useState(false)
  const [hasLoadedInitialScene, setHasLoadedInitialScene] = useState(false)
  const isPreviewMode = useEditor((s) => s.isPreviewMode)
  const isCaptureMode = useEditor((s) => s.isCaptureMode)

  const sidebarWidth = useSidebarStore((s) => s.width)
  const isSidebarCollapsed = useSidebarStore((s) => s.isCollapsed)

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
        const sceneGraph = onLoad ? await onLoad() : loadSceneFromLocalStorage()
        if (!cancelled) {
          applySceneGraphToEditor(sceneGraph)
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!cancelled) emitFitSceneForGraph(sceneGraph)
            })
          })
        }
      } catch {
        if (!cancelled) {
          applySceneGraphToEditor(null)
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!cancelled) emitFitSceneForGraph(null)
            })
          })
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
  }, [onLoad, isLoadingSceneRef])

  // Apply preview scene when version preview mode changes
  useEffect(() => {
    if (isVersionPreviewMode && previewScene) {
      applySceneGraphToEditor(previewScene)
    }
  }, [isVersionPreviewMode, previewScene])

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
    document.body.classList.add('dark')
    return () => {
      document.body.classList.remove('dark')
    }
  }, [])

  const showLoader = isLoading || isSceneLoading

  const firstPersonPreviousLevelRef = useRef(useViewer.getState().selection.levelId)
  const wasFirstPersonModeRef = useRef(isFirstPersonMode)

  useEffect(() => {
    const wasFirstPersonMode = wasFirstPersonModeRef.current
    wasFirstPersonModeRef.current = isFirstPersonMode

    if (isFirstPersonMode && !wasFirstPersonMode) {
      const viewer = useViewer.getState()
      firstPersonPreviousLevelRef.current = viewer.selection.levelId
      viewer.setCameraMode('perspective')
      viewer.setWallMode('up')
      viewer.setWalkthroughMode(true)
      viewer.setSelection({ selectedIds: [], zoneId: null })
      return
    }

    if (!(wasFirstPersonMode && !isFirstPersonMode)) return

    const viewer = useViewer.getState()
    const previousLevelId = firstPersonPreviousLevelRef.current
    firstPersonPreviousLevelRef.current = null
    viewer.setWalkthroughMode(false)

    if (!previousLevelId) return

    const previousLevelNode = useScene.getState().nodes[previousLevelId]
    if (previousLevelNode?.type === 'level') {
      viewer.setSelection({
        levelId: previousLevelId,
        zoneId: null,
        selectedIds: [],
      })
    }
  }, [isFirstPersonMode])

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

    const tabBarTabs =
      sidebarTabs?.map(({ id, label, mobileDefaultSnap, mobileIcon }) => ({
        id,
        label,
        mobileDefaultSnap,
        mobileIcon,
      })) ?? []

    return (
      <PresetsProvider adapter={presetsAdapter}>
        <DeleteSelectionConfirmDialog
          onCancel={handleCancelDeleteSelection}
          onConfirm={handleConfirmDeleteSelection}
          selectedIds={deleteConfirmationIds}
        />
        {showLoader && (
          <div className="fixed inset-0 z-60">
            <SceneLoader />
          </div>
        )}

        <EditorLayoutV2
          navbarSlot={isPreviewMode ? null : navbarSlot}
          overlays={
            <>
              {!isLoading && isPreviewMode ? (
                <ViewerOverlay onBack={() => useEditor.getState().setPreviewMode(false)} />
              ) : null}
              {!(isPreviewMode || isCaptureMode) && <FloatingLevelSelector />}
              {!(isPreviewMode || isVersionPreviewMode || isCaptureMode) && (
                <div className="pointer-events-auto">
                  <ActionMenu />
                </div>
              )}
              {!(isPreviewMode || isVersionPreviewMode || isCaptureMode) && (
                <div className="pointer-events-auto">
                  <PanelManager />
                </div>
              )}
              {!(isPreviewMode || isCaptureMode) && (
                <div className="pointer-events-auto">
                  <HelperManager />
                </div>
              )}
              {isFirstPersonMode && !isPreviewMode && (
                <FirstPersonOverlay onExit={() => useEditor.getState().setFirstPersonMode(false)} />
              )}
              {!isPreviewMode && viewerBanner}
              {!isPreviewMode && projectId ? (
                <SnapshotCaptureOverlay projectId={projectId} />
              ) : null}
            </>
          }
          renderTabContent={renderTabContent}
          sidebarOverlay={isPreviewMode ? null : sidebarOverlay}
          sidebarTabs={isPreviewMode ? [] : tabBarTabs}
          viewerContent={viewerCanvas}
          viewerToolbarLeft={isPreviewMode ? null : viewerToolbarLeft}
          viewerToolbarRight={isPreviewMode ? null : viewerToolbarRight}
        />
        {!isPreviewMode && <EditorCommands />}
        {!isPreviewMode && <CommandPalette emptyAction={commandPaletteEmptyAction} />}
      </PresetsProvider>
    )
  }

  // ── V1 layout (existing) ──
  // p-3 (12px) padding on root + gap-3 (12px) between sidebar and viewer + sidebar width
  const LAYOUT_PADDING = 12
  const LAYOUT_GAP = 12
  const overlayLeft = LAYOUT_PADDING + (isSidebarCollapsed ? 8 : sidebarWidth) + LAYOUT_GAP

  const isActivePreviewMode = !isLoading && isPreviewMode

  return (
    <PresetsProvider adapter={presetsAdapter}>
      <div
        className={`dark flex h-full w-full bg-neutral-100 text-foreground ${
          isActivePreviewMode ? '' : 'gap-3 p-3'
        }`}
      >
        <DeleteSelectionConfirmDialog
          onCancel={handleCancelDeleteSelection}
          onConfirm={handleConfirmDeleteSelection}
          selectedIds={deleteConfirmationIds}
        />
        {showLoader && (
          <div className="fixed inset-0 z-60">
            <SceneLoader />
          </div>
        )}

        <div className={isActivePreviewMode ? 'hidden' : 'contents'}>
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
        </div>

        <div
          className={`relative flex-1 overflow-hidden ${isActivePreviewMode ? '' : 'rounded-xl'}`}
        >
          {isActivePreviewMode && (
            <ViewerOverlay onBack={() => useEditor.getState().setPreviewMode(false)} />
          )}
          {viewerCanvas}
        </div>

        {!isActivePreviewMode && (
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
            {isFirstPersonMode && (
              <FirstPersonOverlay onExit={() => useEditor.getState().setFirstPersonMode(false)} />
            )}
          </ViewerOverlays>
        )}
      </div>
    </PresetsProvider>
  )
}
