'use client'

import {
  type AnyNodeId,
  type CollectionId,
  type ControlValue,
  type ItemNode,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { type Object3D, Vector3 } from 'three'
import {
  applyNumericGroupDelta,
  canMergeControlGroups,
  canMergeControlMemberIntoGroup,
  getAccentRgb,
  getControlLabel,
  getGroupAccessibleLabel,
  getGroupDisplayKinds,
  getGroupIntensitySegments,
  getGroupIntensityTiles,
  getGroupItemKind,
  getGroupNumericDisplayValue,
  getGroupTooltip,
  getGroupVisualSegments,
  getItemBadgeText,
  getMajorityItemKind,
  getResolvedControlValue,
  getSliderValueAtRatio,
  type GroupIntensitySegment,
  type RoomControlGroup,
  type RoomControlLookupEntry,
  type RoomControlOverlayProps,
  type RoomControlTile,
  type RoomOverlayNode,
  scaleRgb,
} from './room-control-model'

export {
  buildRoomControlGroups,
  normalizeRoomControlGroupList,
  selectRoomControlGroupSource,
} from './room-control-model'
export type {
  RoomControlChange,
  RoomControlChangeSource,
  RoomControlGroup,
  RoomControlGroupKind,
  RoomControlIntensityTile,
  RoomControlOverlayProps,
  RoomControlTile,
  RoomOverlayNode,
} from './room-control-model'

const PANEL_CLOSED_MIN_WIDTH = 56
const PANEL_CLOSED_MAX_WIDTH = 240
const PANEL_CLOSED_CHAR_WIDTH = 7.2
const PANEL_CLOSED_HEIGHT = 32
const DEVICE_ICON_PILL_WIDTH = 44
const PANEL_OPEN_MIN_WIDTH = 120
const PANEL_HEADER_HEIGHT = 38
const PANEL_HORIZONTAL_PADDING = 12
const PANEL_GAP = 16
const PANEL_BOTTOM_MARGIN = 12
const PANEL_BODY_PADDING = 8
const PANEL_GRID_GAP = 6
const CONTROL_ICON_BUTTON_SIZE = 44
const CONTROL_ICON_SIZE = 20
const MIXED_GROUP_ICON_GAP = 4
const MIN_MIXED_GROUP_ICON_SIZE = 18
const PANEL_MAX_COLUMNS = 8
const PANEL_PREFERRED_MAX_ROWS = 3
const LINE_GAP = 4
const LINE_END_MARGIN = 12
const ROOM_CONTROL_PILL_WORLD_HEIGHT = 3.5
const OFFSCREEN_MARGIN = 64
const POSITIONED_SCREEN_STICK_HEIGHT = 72
const WORLD_POSITIONED_LINE_VISIBLE_RATIO = 0.5
const POSITION_EPSILON = 0.5
const MERGE_HOTSPOT_INSET_RATIO = 0.08
const GROUP_EXPAND_HOLD_MS = 750
const GROUP_EXPAND_DRAG_THRESHOLD_PX = 18
const EDIT_EXIT_ACTION_SUPPRESS_MS = 260
const LONG_PRESS_CLICK_SUPPRESS_MS = 900
const ROOM_PANEL_NODE_EVENT_SUPPRESS_MS = 260
const ROOM_PANEL_LONG_PRESS_NODE_EVENT_SUPPRESS_MS =
  GROUP_EXPAND_HOLD_MS + ROOM_PANEL_NODE_EVENT_SUPPRESS_MS
const DEVICE_ICON_DRAG_THRESHOLD_PX = 8
const COLLAPSED_PILL_SINGLE_CLICK_DELAY_MS = 220
const ROOM_PANEL_CENTER_DISTANCE_LIMIT = 0.88
const ROOM_PANEL_OPEN_CENTER_DISTANCE_LIMIT = 1.02
const EXPANDED_GROUP_PADDING = 6
const EXPANDED_GROUP_GAP = 4
const MIN_EXPANDED_GROUP_MEMBER_BUTTON_SIZE = 28
const INTENSITY_STRIP_INSET = 4
const INTENSITY_STRIP_HEIGHT = 8
const INTENSITY_STRIP_GAP = 4
const INTENSITY_SEGMENT_BOUNDARY_INSET = 2
const INTENSITY_CONTENT_BOTTOM_OFFSET = INTENSITY_STRIP_INSET + INTENSITY_STRIP_HEIGHT + 2
const _anchor = new Vector3()
const _groundProjected = new Vector3()
const _projected = new Vector3()
const _scratchVector = new Vector3()

const overlayRootStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
}

const overlayItemStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  pointerEvents: 'none',
}

const panelBaseStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  transform: 'translateX(-50%)',
  borderRadius: 18,
  border: '1px solid rgba(92,98,108,1)',
  background: 'linear-gradient(180deg, rgba(237,239,243,1) 0%, rgba(216,220,226,1) 100%)',
  boxShadow: 'inset -4px 0 0 rgba(92,98,108,1), 0 12px 24px rgba(0,0,0,0.24)',
  overflow: 'hidden',
  userSelect: 'none',
  opacity: 0,
  transformOrigin: 'top center',
  transition:
    'width 180ms cubic-bezier(0.22, 1, 0.36, 1), height 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms linear',
  visibility: 'hidden',
}

const lineStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 2,
  marginLeft: -1,
  borderRadius: 999,
  background: 'rgba(70,74,82,0.92)',
  boxShadow: 'none',
  opacity: 0,
  transformOrigin: 'top center',
  visibility: 'hidden',
}

const nightLineStyle: CSSProperties = {
  ...lineStyle,
  background: 'rgba(232,235,240,0.86)',
  boxShadow: '0 0 8px rgba(232,235,240,0.32)',
}

const endpointStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 6,
  height: 6,
  marginLeft: -3,
  marginTop: -3,
  borderRadius: '50%',
  border: '1px solid rgba(70,74,82,0.92)',
  background: 'rgba(70,74,82,0.92)',
  boxShadow: 'none',
  opacity: 0,
  visibility: 'hidden',
}

const nightEndpointStyle: CSSProperties = {
  ...endpointStyle,
  border: '1px solid rgba(232,235,240,0.86)',
  background: 'rgba(232,235,240,0.86)',
  boxShadow: '0 0 8px rgba(232,235,240,0.32)',
}

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: PANEL_HEADER_HEIGHT,
  padding: `0 ${PANEL_HORIZONTAL_PADDING}px`,
  borderBottom: '1px solid rgba(255,255,255,0.16)',
}

const headerMainButtonStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: 'rgba(18,20,24,0.96)',
  cursor: 'pointer',
  padding: 0,
  textAlign: 'center',
}

const collapsedHeaderButtonStyle: CSSProperties = {
  ...headerMainButtonStyle,
  width: '100%',
  minHeight: PANEL_CLOSED_HEIGHT,
  padding: `0 ${PANEL_HORIZONTAL_PADDING}px`,
}

const iconOnlyPillButtonStyle: CSSProperties = {
  ...headerMainButtonStyle,
  width: '100%',
  height: PANEL_CLOSED_HEIGHT,
  minHeight: PANEL_CLOSED_HEIGHT,
  padding: 0,
}

const iconOnlyPillGlyphStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
}

const headerNameStyle: CSSProperties = {
  width: '100%',
  overflow: 'hidden',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.02em',
  lineHeight: 1,
  textAlign: 'center',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const panelBodyStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: PANEL_GRID_GAP,
  gridAutoFlow: 'row dense',
  gridAutoRows: CONTROL_ICON_BUTTON_SIZE,
  justifyContent: 'start',
  padding: PANEL_BODY_PADDING,
}

const emptyStateStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: CONTROL_ICON_BUTTON_SIZE,
  borderRadius: 10,
  border: '1px dashed rgba(92,98,108,0.45)',
  background: 'rgba(255,255,255,0.32)',
  color: 'rgba(55,65,81,0.78)',
  fontSize: 10,
  fontWeight: 600,
  textAlign: 'center',
  padding: 8,
}

const compactControlButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: CONTROL_ICON_BUTTON_SIZE,
  height: CONTROL_ICON_BUTTON_SIZE,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  position: 'relative',
  padding: 0,
}

const iconGlyphWrapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: CONTROL_ICON_SIZE,
  height: CONTROL_ICON_SIZE,
}

const groupedIconGlyphRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'auto',
  height: CONTROL_ICON_SIZE,
  padding: 0,
  gap: MIXED_GROUP_ICON_GAP,
}

const getSharedIconGlyphWrapStyle = (kindCount: number): CSSProperties =>
  kindCount <= 2
    ? iconGlyphWrapStyle
    : {
        ...iconGlyphWrapStyle,
        transform: `scale(${Math.max(MIN_MIXED_GROUP_ICON_SIZE / CONTROL_ICON_SIZE, 1 - (kindCount - 2) * 0.08)})`,
        transformOrigin: 'center',
        width: Math.max(MIN_MIXED_GROUP_ICON_SIZE, CONTROL_ICON_SIZE),
      }

const glyphContentRowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'auto',
  maxWidth: '100%',
  gap: 2,
}

const segmentedGlyphContentStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'stretch',
  width: '100%',
  height: '100%',
  gap: 0,
}

const segmentedGlyphLaneStyle: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const intensityStripStyle: CSSProperties = {
  position: 'absolute',
  left: INTENSITY_STRIP_INSET,
  right: INTENSITY_STRIP_INSET,
  bottom: INTENSITY_STRIP_INSET,
  height: INTENSITY_STRIP_HEIGHT,
  display: 'flex',
  alignItems: 'stretch',
  gap: 0,
  pointerEvents: 'auto',
}

const intensitySegmentLaneStyle: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'stretch',
}

const intensitySegmentTrackStyle: CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  borderRadius: 999,
  boxSizing: 'border-box',
  cursor: 'ew-resize',
  touchAction: 'none',
}

const intensitySegmentFillStyle: CSSProperties = {
  position: 'absolute',
  top: 1,
  right: 1,
  bottom: 1,
  left: 1,
  borderRadius: 999,
  transformOrigin: 'left center',
}

const intensitySegmentThumbStyle: CSSProperties = {
  position: 'absolute',
  top: 1,
  bottom: 1,
  width: 4,
  marginLeft: -2,
  borderRadius: 999,
  background: 'rgba(255,255,255,0.92)',
  boxShadow: '0 0 0 1px rgba(15,23,42,0.18), 0 1px 4px rgba(15,23,42,0.18)',
}

const iconCountBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: CONTROL_ICON_SIZE + 4,
  height: CONTROL_ICON_SIZE + 4,
  padding: '0 3px',
  marginLeft: -1,
  borderRadius: 999,
  border: '1px solid rgba(92,98,108,0.22)',
  fontSize: CONTROL_ICON_SIZE - 2,
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: '-0.03em',
  fontVariantNumeric: 'tabular-nums',
  boxShadow: '0 1px 3px rgba(15,23,42,0.12)',
}

const editTileStyle: CSSProperties = {
  ...compactControlButtonStyle,
  border: '1px solid rgba(92,98,108,0.55)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(230,233,239,0.96) 100%)',
  boxShadow: 'inset -3px 0 0 rgba(92,98,108,0.75), 0 8px 18px rgba(0,0,0,0.1)',
  color: 'rgba(31,41,55,0.92)',
  cursor: 'grab',
}

const dragGhostStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: CONTROL_ICON_BUTTON_SIZE,
  height: CONTROL_ICON_BUTTON_SIZE,
  transform: 'translate(-50%, -50%) rotate(-3deg)',
  pointerEvents: 'none',
  zIndex: 400,
  opacity: 0.94,
}

const editModeAnimationCss = `
@keyframes room-panel-edit-wobble {
  0% { transform: translate3d(0, 0, 0) rotate(-1.4deg); }
  100% { transform: translate3d(0, -1px, 0) rotate(1.4deg); }
}
`

type PanelBodyMetrics = {
  bodyHeight: number
  bodyWidth: number
  columns: number
  rows: number
}

type OverlayLayout = {
  endpointX?: number
  endpointY?: number
  lineEndMargin?: number
  lineLengthRatio?: number
  opacity: number
  panelHeight: number
  panelTop: number
  panelWidth: number
  visible: boolean
  x: number
  y: number
}

type OverlayDomRefs = {
  endpoint: HTMLDivElement | null
  line: HTMLDivElement | null
  panel: HTMLDivElement | null
}

type DragState = {
  startedAt: number
  startX: number
  startY: number
  pointerX: number
  pointerY: number
  dropTargetGroupId: string | null
  placeAfterTarget: boolean
  sourceGroupId: string
  sourceMemberId: string | null
  targetGroupId: string | null
}

type DeviceIconDragState = {
  dragging: boolean
  member: RoomControlTile
  pointerId: number
  pointerX: number
  pointerY: number
  sourceCollectionId: CollectionId
  startX: number
  startY: number
  targetCollectionId: CollectionId | null
}

type LongPressAction = 'edit' | 'open-edit'

type PendingExpandState = {
  groupId: string
  pointerId: number
  startEventTime: number
  startedAt: number
  startX: number
  startY: number
}

type PendingLongPressState = {
  action: LongPressAction
  dragGroupId: string | null
  key: string
  pointerId: number
  pointerX: number
  pointerY: number
  startEventTime: number
  startedAt: number
  startX: number
  startY: number
}

type ExpandedGroupMemberLayout = {
  buttonSize: number
  columns: number
}

const projectToViewportOrigin = () => [0, 0] as [number, number]

const suppressRoomPanelNodeEvents = (durationMs = ROOM_PANEL_NODE_EVENT_SUPPRESS_MS) => {
  useViewer.getState().suppressNodeEvents(durationMs)
}

const isQuickEditTap = (
  startedAt: number,
  startX: number,
  startY: number,
  pointerX: number,
  pointerY: number,
) =>
  Date.now() - startedAt < GROUP_EXPAND_HOLD_MS &&
  Math.hypot(pointerX - startX, pointerY - startY) < GROUP_EXPAND_DRAG_THRESHOLD_PX

const isPointInsideElement = (clientX: number, clientY: number, element: Element | null) => {
  if (!(element instanceof HTMLElement)) {
    return false
  }

  const rect = element.getBoundingClientRect()
  return (
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  )
}

const findRoomControlGroupElement = (groupId: string) => {
  if (typeof document === 'undefined') {
    return null
  }

  for (const element of document.querySelectorAll<HTMLElement>('[data-room-control-group-id]')) {
    if (element.dataset.roomControlGroupId === groupId) {
      return element
    }
  }

  return null
}

const getReorderPlacement = (
  pointerX: number,
  pointerY: number,
  sourceElement: HTMLElement,
  targetElement: HTMLElement,
) => {
  const sourceRect = sourceElement.getBoundingClientRect()
  const targetRect = targetElement.getBoundingClientRect()
  const sourceCenterX = sourceRect.left + sourceRect.width / 2
  const sourceCenterY = sourceRect.top + sourceRect.height / 2
  const targetCenterX = targetRect.left + targetRect.width / 2
  const targetCenterY = targetRect.top + targetRect.height / 2
  const deltaX = targetCenterX - sourceCenterX
  const deltaY = targetCenterY - sourceCenterY

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const placeAfter = deltaX >= 0
    const ready = placeAfter ? pointerX > targetCenterX : pointerX < targetCenterX
    return { placeAfter, ready }
  }

  const placeAfter = deltaY >= 0
  const ready = placeAfter ? pointerY > targetCenterY : pointerY < targetCenterY
  return { placeAfter, ready }
}

export const RoomControlOverlay = ({
  onApplyRoomGrouping,
  onCopyRoomControlToRoom,
  onRemoveRoomControlFromRoom,
  onRoomControlChange,
  roomOverlayNodes = [],
}: RoomControlOverlayProps = {}) => {
  const theme = useViewer((state) => state.theme)
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setHoveredId = useViewer((state) => state.setHoveredId)
  const setHoveredIds = useViewer((state) => state.setHoveredIds)
  const sceneNodes = useScene((state) => state.nodes)
  const interactiveState = useInteractive((state) => state.items)
  const initItem = useInteractive((state) => state.initItem)
  const setControlValue = useInteractive((state) => state.setControlValue)
  const [openRoomId, setOpenRoomId] = useState<string | null>(null)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)

  const domRefsRef = useRef<Record<string, OverlayDomRefs>>({})
  const layoutRef = useRef<Record<string, OverlayLayout>>({})

  useEffect(() => {
    for (const roomOverlayNode of roomOverlayNodes) {
      for (const group of roomOverlayNode.controlGroups) {
        for (const member of group.members) {
          const interactive = {
            controls: [
              member.control,
              ...(member.intensityControl ? [member.intensityControl] : []),
            ],
            effects: [],
          }

          if (!sceneNodes[member.itemId]) {
            initItem(member.itemId, interactive)
          } else if (
            sceneNodes[member.itemId]?.type === 'item' &&
            ((sceneNodes[member.itemId] as ItemNode).asset.interactive?.controls.length ?? 0) === 0
          ) {
            initItem(member.itemId, interactive)
          }

          if (
            member.linkedItemId &&
            member.linkedItemId !== member.itemId &&
            sceneNodes[member.linkedItemId]?.type === 'item' &&
            ((sceneNodes[member.linkedItemId] as ItemNode).asset.interactive?.controls.length ??
              0) === 0
          ) {
            initItem(member.linkedItemId, interactive)
          }
        }
      }
    }
  }, [initItem, roomOverlayNodes, sceneNodes])

  useEffect(() => {
    const activeIds = new Set(roomOverlayNodes.map((node) => node.id))

    for (const id of Object.keys(domRefsRef.current)) {
      if (!activeIds.has(id as AnyNodeId)) {
        delete domRefsRef.current[id]
      }
    }

    for (const id of Object.keys(layoutRef.current)) {
      if (!activeIds.has(id as AnyNodeId)) {
        delete layoutRef.current[id]
      }
    }
  }, [roomOverlayNodes])

  useEffect(() => {
    if (openRoomId && !roomOverlayNodes.some((room) => room.id === openRoomId)) {
      setOpenRoomId(null)
    }
  }, [openRoomId, roomOverlayNodes])

  useEffect(() => {
    if (!editingRoomId) {
      return
    }
    if (editingRoomId !== openRoomId) {
      setEditingRoomId(null)
    }
  }, [editingRoomId, openRoomId])

  useEffect(
    () => () => {
      setHoveredId(null)
      setHoveredIds([])
    },
    [setHoveredId, setHoveredIds],
  )

  useEffect(() => {
    useViewer.getState().setInteractiveOverlayActive(openRoomId !== null)
  }, [openRoomId])

  useEffect(() => {
    if (openRoomId && selectedIds.length > 0) {
      useViewer.getState().setSelection({ selectedIds: [] })
    }
  }, [openRoomId, selectedIds])

  useEffect(
    () => () => {
      useViewer.getState().setInteractiveOverlayActive(false)
    },
    [],
  )

  useEffect(() => {
    if (!openRoomId) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const panel = domRefsRef.current[openRoomId]?.panel
      if (panel && event.target instanceof Node && panel.contains(event.target)) {
        return
      }
      setOpenRoomId(null)
      setEditingRoomId(null)
      setHoveredId(null)
      setHoveredIds([])
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [openRoomId, setHoveredId, setHoveredIds])

  const roomControlMemberLookup = useMemo(() => {
    const lookup = new Map<string, RoomControlLookupEntry>()
    for (const roomOverlayNode of roomOverlayNodes) {
      for (const group of roomOverlayNode.controlGroups) {
        for (const member of group.members) {
          const primaryKey = `${member.itemId}:${member.controlIndex}`
          if (!lookup.has(primaryKey)) {
            lookup.set(primaryKey, { member, source: 'primary' })
          }
          if (member.intensityControl && member.intensityControlIndex !== null) {
            const intensityKey = `${member.itemId}:${member.intensityControlIndex}`
            if (!lookup.has(intensityKey)) {
              lookup.set(intensityKey, { member, source: 'intensity' })
            }
          }
        }
      }
    }
    return lookup
  }, [roomOverlayNodes])

  const handleCollectionControlChange = (
    itemId: AnyNodeId,
    controlIndex: number,
    nextValue: ControlValue,
  ) => {
    const lookupEntry = roomControlMemberLookup.get(`${itemId}:${controlIndex}`)
    if (!lookupEntry || lookupEntry.member.disabled) {
      return
    }

    setControlValue(itemId, controlIndex, nextValue)
    if (lookupEntry.member.linkedItemId && lookupEntry.member.linkedItemId !== itemId) {
      setControlValue(lookupEntry.member.linkedItemId, controlIndex, nextValue)
    }
    onRoomControlChange?.({
      member: lookupEntry.member,
      nextValue,
      source: lookupEntry.source,
    })
  }

  useFrame(({ camera, size }) => {
    if (roomOverlayNodes.length === 0) {
      for (const refs of Object.values(domRefsRef.current)) {
        applyOverlayLayout(refs, {
          opacity: 0,
          panelHeight: PANEL_CLOSED_HEIGHT,
          panelTop: 0,
          panelWidth: PANEL_CLOSED_MIN_WIDTH,
          visible: false,
          x: 0,
          y: 0,
        })
      }
      layoutRef.current = {}
      return
    }

    for (const roomOverlayNode of roomOverlayNodes) {
      const refs = domRefsRef.current[roomOverlayNode.id]
      const open = openRoomId === roomOverlayNode.id
      const metrics = getRoomPanelMetrics(
        open,
        roomOverlayNode.controlGroups,
        roomOverlayNode.totalSlotCount,
        roomOverlayNode.roomName,
        roomOverlayNode.iconOnly,
      )

      const anchorObjects = roomOverlayNode.anchorNodeIds
        .map((nodeId) => sceneRegistry.nodes.get(nodeId))
        .filter((node): node is Object3D => Boolean(node))

      if (roomOverlayNode.screenPosition && !roomOverlayNode.worldPosition) {
        const x = roomOverlayNode.screenPosition.x * size.width
        const y = roomOverlayNode.screenPosition.y * size.height
        const collapsedPanelTop = y - PANEL_CLOSED_HEIGHT - POSITIONED_SCREEN_STICK_HEIGHT
        const panelTop = Math.min(
          Math.max(collapsedPanelTop, 14),
          Math.max(14, size.height - metrics.height - PANEL_BOTTOM_MARGIN),
        )
        const layout: OverlayLayout = {
          opacity: 1,
          panelHeight: metrics.height,
          panelTop,
          panelWidth: metrics.width,
          visible: true,
          x,
          y,
        }

        if (!areLayoutsClose(layoutRef.current[roomOverlayNode.id], layout) || refs?.panel) {
          applyOverlayLayout(refs, layout)
          layoutRef.current[roomOverlayNode.id] = layout
        }
        continue
      }

      if (!(roomOverlayNode.worldPosition || anchorObjects.length > 0)) {
        const hiddenLayout = {
          opacity: 0,
          panelHeight: metrics.height,
          panelTop: 0,
          panelWidth: metrics.width,
          visible: false,
          x: 0,
          y: 0,
        }
        applyOverlayLayout(refs, hiddenLayout)
        layoutRef.current[roomOverlayNode.id] = hiddenLayout
        continue
      }

      if (roomOverlayNode.worldPosition) {
        _anchor.set(
          roomOverlayNode.worldPosition.x,
          roomOverlayNode.worldPosition.y + ROOM_CONTROL_PILL_WORLD_HEIGHT,
          roomOverlayNode.worldPosition.z,
        )
        _groundProjected
          .set(
            roomOverlayNode.worldPosition.x,
            roomOverlayNode.worldPosition.y,
            roomOverlayNode.worldPosition.z,
          )
          .project(camera)
      } else {
        _anchor.set(0, 0, 0)
        for (const anchorObject of anchorObjects) {
          anchorObject.updateWorldMatrix(true, false)
          anchorObject.getWorldPosition(_scratchVector)
          _anchor.add(_scratchVector)
        }
        _anchor.multiplyScalar(1 / anchorObjects.length)
      }
      _projected.copy(_anchor).project(camera)

      const projectedX = (_projected.x * 0.5 + 0.5) * size.width
      const y = (-_projected.y * 0.5 + 0.5) * size.height
      const endpointX = roomOverlayNode.worldPosition
        ? (_groundProjected.x * 0.5 + 0.5) * size.width
        : undefined
      const endpointY = roomOverlayNode.worldPosition
        ? (-_groundProjected.y * 0.5 + 0.5) * size.height
        : undefined
      const x = endpointX ?? projectedX
      const collapsedPanelTop = y - PANEL_CLOSED_HEIGHT - PANEL_GAP
      const panelTop = Math.min(
        Math.max(collapsedPanelTop, 14),
        Math.max(14, size.height - metrics.height - PANEL_BOTTOM_MARGIN),
      )
      const centerDistanceRatio = getRoomPanelCenterDistanceRatio(x, panelTop, metrics.height, size)
      const centerDistanceLimit = open
        ? ROOM_PANEL_OPEN_CENTER_DISTANCE_LIMIT
        : ROOM_PANEL_CENTER_DISTANCE_LIMIT

      const visible =
        centerDistanceRatio <= centerDistanceLimit &&
        _projected.z >= -1 &&
        _projected.z <= 1 &&
        (!roomOverlayNode.worldPosition || (_groundProjected.z >= -1 && _groundProjected.z <= 1)) &&
        isRoomPanelInsideViewportMargin(x, panelTop, metrics.width, metrics.height, size)

      const layout: OverlayLayout = {
        opacity: 1,
        panelHeight: metrics.height,
        panelTop,
        panelWidth: metrics.width,
        visible,
        endpointX,
        endpointY,
        lineEndMargin: roomOverlayNode.worldPosition ? 0 : undefined,
        lineLengthRatio: roomOverlayNode.worldPosition
          ? WORLD_POSITIONED_LINE_VISIBLE_RATIO
          : undefined,
        x,
        y,
      }

      if (!areLayoutsClose(layoutRef.current[roomOverlayNode.id], layout) || refs?.panel) {
        applyOverlayLayout(refs, layout)
        layoutRef.current[roomOverlayNode.id] = layout
      }
    }
  })

  if (roomOverlayNodes.length === 0) {
    return null
  }

  const setHoveredItemTargets = (itemIds: AnyNodeId[]) => {
    const uniqueIds = Array.from(new Set(itemIds)).filter((itemId) => Boolean(sceneNodes[itemId]))
    setHoveredId(uniqueIds[0] ?? null)
    setHoveredIds(uniqueIds)
  }

  const clearHoveredItemTargets = () => {
    setHoveredId(null)
    setHoveredIds([])
  }

  return (
    <Html
      calculatePosition={projectToViewportOrigin}
      fullscreen
      style={overlayRootStyle}
      zIndexRange={[240, 0]}
    >
      <div style={overlayRootStyle}>
        <style>{editModeAnimationCss}</style>
        {roomOverlayNodes.map((roomOverlayNode) => (
          <div
            key={roomOverlayNode.id}
            style={getOverlayItemStyle(
              openRoomId === roomOverlayNode.id,
              editingRoomId === roomOverlayNode.id,
            )}
          >
            <div
              ref={(node) => setOverlayDomRef(domRefsRef.current, roomOverlayNode.id, 'line', node)}
              style={theme === 'dark' ? nightLineStyle : lineStyle}
            />
            <div
              ref={(node) =>
                setOverlayDomRef(domRefsRef.current, roomOverlayNode.id, 'endpoint', node)
              }
              style={theme === 'dark' ? nightEndpointStyle : endpointStyle}
            />
            <RoomPanel
              clearHoveredItemTargets={clearHoveredItemTargets}
              controlGroups={roomOverlayNode.controlGroups}
              controlValues={interactiveState}
              editing={editingRoomId === roomOverlayNode.id}
              isOpen={openRoomId === roomOverlayNode.id}
              onApplyGrouping={(nextGroups) =>
                onApplyRoomGrouping?.(roomOverlayNode.id, nextGroups)
              }
              onChange={handleCollectionControlChange}
              onCopyDeviceToGroup={(sourceCollectionId, targetCollectionId) =>
                onCopyRoomControlToRoom?.(sourceCollectionId, targetCollectionId)
              }
              onOpenIntoEdit={() => {
                setOpenRoomId(roomOverlayNode.id)
                setEditingRoomId(roomOverlayNode.id)
              }}
              onSetEditing={(editing) => setEditingRoomId(editing ? roomOverlayNode.id : null)}
              onSetOpen={(open) => {
                setOpenRoomId(open ? roomOverlayNode.id : null)
                if (!open) {
                  setEditingRoomId(null)
                  clearHoveredItemTargets()
                }
              }}
              onRemoveDeviceFromGroup={(member) => onRemoveRoomControlFromRoom?.(member)}
              refsStore={domRefsRef.current}
              roomId={roomOverlayNode.id}
              roomName={roomOverlayNode.roomName}
              totalSlotCount={roomOverlayNode.totalSlotCount}
              iconOnly={roomOverlayNode.iconOnly}
              setHoveredItemTargets={setHoveredItemTargets}
            />
          </div>
        ))}
      </div>
    </Html>
  )
}

const RoomPanel = ({
  clearHoveredItemTargets,
  controlGroups,
  controlValues,
  editing,
  iconOnly,
  isOpen,
  onApplyGrouping,
  onChange,
  onCopyDeviceToGroup,
  onOpenIntoEdit,
  onRemoveDeviceFromGroup,
  onSetEditing,
  onSetOpen,
  refsStore,
  roomId,
  roomName,
  totalSlotCount,
  setHoveredItemTargets,
}: {
  clearHoveredItemTargets: () => void
  controlGroups: RoomControlGroup[]
  controlValues: Record<AnyNodeId, { controlValues: ControlValue[] }>
  editing: boolean
  iconOnly?: boolean
  isOpen: boolean
  onApplyGrouping: (nextGroups: string[][]) => void
  onChange: (itemId: AnyNodeId, controlIndex: number, nextValue: ControlValue) => void
  onCopyDeviceToGroup: (sourceCollectionId: CollectionId, targetCollectionId: CollectionId) => void
  onOpenIntoEdit: () => void
  onRemoveDeviceFromGroup: (member: RoomControlTile) => void
  onSetEditing: (editing: boolean) => void
  onSetOpen: (open: boolean) => void
  refsStore: Record<string, OverlayDomRefs>
  roomId: string
  roomName: string
  totalSlotCount: number
  setHoveredItemTargets: (itemIds: AnyNodeId[]) => void
}) => {
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [deviceIconDragState, setDeviceIconDragState] = useState<DeviceIconDragState | null>(null)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const [orderedGroupIds, setOrderedGroupIds] = useState<string[]>(() =>
    controlGroups.map((group) => group.id),
  )
  const [pendingExpand, setPendingExpand] = useState<PendingExpandState | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const collapsedClickTimeoutRef = useRef<number | null>(null)
  const deviceIconDragStateRef = useRef<DeviceIconDragState | null>(null)
  const iconOnlyClickSuppressedUntilRef = useRef(0)
  const longPressRef = useRef<PendingLongPressState | null>(null)
  const longPressTimeoutRef = useRef<number | null>(null)
  const suppressedClickRef = useRef<string | null>(null)
  const suppressedClickTimeoutRef = useRef<number | null>(null)
  const editExitActionSuppressedUntilRef = useRef(0)
  const lastAppliedGroupingRef = useRef<string[][] | null>(null)
  const pendingExpandRef = useRef<PendingExpandState | null>(null)
  const expandTimeoutRef = useRef<number | null>(null)
  const groupById = useMemo(
    () => new Map(controlGroups.map((group) => [group.id, group])),
    [controlGroups],
  )
  const orderedGroups = useMemo(
    () =>
      reconcileGroupOrder(
        orderedGroupIds,
        controlGroups.map((group) => group.id),
      )
        .map((groupId) => groupById.get(groupId))
        .filter((group): group is RoomControlGroup => Boolean(group)),
    [controlGroups, groupById, orderedGroupIds],
  )
  const displayedGroups = orderedGroups
  const panelMetrics = useMemo(
    () => getPanelBodyMetrics(totalSlotCount, displayedGroups),
    [displayedGroups, totalSlotCount],
  )
  const panelColumns = panelMetrics.columns
  const currentOrderIds = useMemo(() => orderedGroups.map((group) => group.id), [orderedGroups])
  const collapsedDirectControlGroup =
    displayedGroups.length === 1 && displayedGroups[0]?.members.length === 1
      ? displayedGroups[0]
      : null
  const collapsedDirectControlMember = collapsedDirectControlGroup?.members[0] ?? null
  const collapsedDirectControlDisabled = Boolean(collapsedDirectControlMember?.disabled)
  const collapsedDirectControlValue = collapsedDirectControlMember
    ? controlValues[collapsedDirectControlMember.itemId]?.controlValues[
        collapsedDirectControlMember.controlIndex
      ]
    : undefined
  const collapsedDirectCanTrigger = collapsedDirectControlMember?.directActionMode === 'trigger'
  const collapsedDirectCanToggle =
    collapsedDirectControlMember?.directActionMode === 'toggle' ||
    (collapsedDirectControlMember?.control.kind === 'toggle' &&
      iconOnly &&
      collapsedDirectControlMember.directActionMode !== 'trigger')
  const collapsedDirectActionMode = collapsedDirectControlDisabled
    ? null
    : collapsedDirectCanTrigger
      ? 'trigger'
      : collapsedDirectCanToggle
        ? 'toggle'
        : null
  const collapsedToggleMembers = displayedGroups.flatMap((group) =>
    group.members.filter((member) => member.control.kind === 'toggle' && !member.disabled),
  )
  const collapsedToggleValues = collapsedToggleMembers.map((member) =>
    Boolean(
      getResolvedControlValue(
        member.control,
        controlValues[member.itemId]?.controlValues?.[member.controlIndex],
      ),
    ),
  )
  const collapsedAllToggleMembersOn =
    collapsedToggleValues.length > 0 && collapsedToggleValues.every(Boolean)
  const collapsedAnyToggleMemberOn = collapsedToggleValues.some(Boolean)
  const collapsedMajorityItemKind = getMajorityItemKind(collapsedToggleMembers)
  const collapsedVisualActive = iconOnly
    ? Boolean(collapsedDirectControlValue)
    : collapsedAnyToggleMemberOn
  const collapsedHasToggleAction = collapsedToggleMembers.length > 0
  const collapsedGroupDisabled =
    !iconOnly &&
    displayedGroups.length > 0 &&
    displayedGroups.every((group) => group.members.every((member) => member.disabled))
  const collapsedDirectButtonDisabled = iconOnly
    ? collapsedDirectControlDisabled || !collapsedDirectActionMode
    : collapsedGroupDisabled

  const clearLongPress = useCallback(() => {
    if (typeof window !== 'undefined' && longPressTimeoutRef.current !== null) {
      window.clearTimeout(longPressTimeoutRef.current)
    }
    longPressTimeoutRef.current = null
    longPressRef.current = null
  }, [])

  const clearCollapsedClickTimeout = useCallback(() => {
    if (typeof window !== 'undefined' && collapsedClickTimeoutRef.current !== null) {
      window.clearTimeout(collapsedClickTimeoutRef.current)
    }
    collapsedClickTimeoutRef.current = null
  }, [])

  const clearSuppressedClick = useCallback(() => {
    if (typeof window !== 'undefined' && suppressedClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressedClickTimeoutRef.current)
    }
    suppressedClickTimeoutRef.current = null
    suppressedClickRef.current = null
  }, [])

  const applyRoomGrouping = useCallback(
    (nextGroups: string[][]) => {
      const normalizedGroups = nextGroups.filter((group) => group.length > 0)
      lastAppliedGroupingRef.current = normalizedGroups
      onApplyGrouping(normalizedGroups)
    },
    [onApplyGrouping],
  )

  const scheduleSuppressedClickReset = useCallback((key: string) => {
    if (typeof window === 'undefined') {
      return
    }
    if (suppressedClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressedClickTimeoutRef.current)
    }
    suppressedClickTimeoutRef.current = window.setTimeout(() => {
      if (suppressedClickRef.current === key) {
        suppressedClickRef.current = null
      }
      suppressedClickTimeoutRef.current = null
    }, LONG_PRESS_CLICK_SUPPRESS_MS)
  }, [])

  const consumeSuppressedClick = useCallback(
    (key: string) => {
      if (suppressedClickRef.current !== key) {
        return false
      }
      clearSuppressedClick()
      return true
    },
    [clearSuppressedClick],
  )

  const suppressEditExitActions = useCallback(() => {
    editExitActionSuppressedUntilRef.current = Date.now() + EDIT_EXIT_ACTION_SUPPRESS_MS
  }, [])

  const shouldSuppressEditExitAction = () => editExitActionSuppressedUntilRef.current > Date.now()

  const commitLongPress = (activeLongPress: PendingLongPressState) => {
    suppressedClickRef.current = activeLongPress.key
    scheduleSuppressedClickReset(activeLongPress.key)
    clearLongPress()
    if (activeLongPress.action === 'open-edit') {
      onOpenIntoEdit()
      return
    }
    if (activeLongPress.dragGroupId) {
      const sourceGroup = groupById.get(activeLongPress.dragGroupId)
      if (sourceGroup && sourceGroup.members.length === 1) {
        setHoveredItemTargets(sourceGroup.itemIds)
        startGroupDrag(
          activeLongPress.dragGroupId,
          activeLongPress.pointerX,
          activeLongPress.pointerY,
        )
      }
    }
    onSetEditing(true)
  }

  const startLongPress = (
    event: ReactPointerEvent<HTMLButtonElement>,
    key: string,
    action: LongPressAction,
    dragGroupId: string | null = null,
  ) => {
    if (action === 'edit' && editing) {
      return
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    clearLongPress()
    clearSuppressedClick()
    const pointerId = event.pointerId
    event.currentTarget.setPointerCapture?.(pointerId)
    const nextPendingLongPress = {
      action,
      dragGroupId,
      key,
      pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startEventTime: event.timeStamp,
      startedAt: Date.now(),
      startX: event.clientX,
      startY: event.clientY,
    }
    longPressRef.current = nextPendingLongPress
    if (typeof window !== 'undefined') {
      longPressTimeoutRef.current = window.setTimeout(() => {
        const activeLongPress = longPressRef.current
        if (
          !activeLongPress ||
          activeLongPress.pointerId !== pointerId ||
          activeLongPress.key !== key
        ) {
          return
        }
        commitLongPress(activeLongPress)
      }, GROUP_EXPAND_HOLD_MS)
    }
  }

  const continueLongPress = (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    const activeLongPress = longPressRef.current
    if (
      !activeLongPress ||
      activeLongPress.key !== key ||
      activeLongPress.pointerId !== event.pointerId
    ) {
      return
    }

    activeLongPress.pointerX = event.clientX
    activeLongPress.pointerY = event.clientY

    const distance = Math.hypot(
      event.clientX - activeLongPress.startX,
      event.clientY - activeLongPress.startY,
    )
    if (distance >= GROUP_EXPAND_DRAG_THRESHOLD_PX) {
      clearLongPress()
    }
  }

  const endLongPress = (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const activeLongPress = longPressRef.current
    if (
      !activeLongPress ||
      activeLongPress.key !== key ||
      activeLongPress.pointerId !== event.pointerId
    ) {
      return
    }
    if (
      event.timeStamp - activeLongPress.startEventTime >= GROUP_EXPAND_HOLD_MS &&
      Math.hypot(event.clientX - activeLongPress.startX, event.clientY - activeLongPress.startY) <
        GROUP_EXPAND_DRAG_THRESHOLD_PX
    ) {
      commitLongPress(activeLongPress)
      return
    }
    clearLongPress()
  }

  const clearPendingExpand = useCallback(() => {
    if (typeof window !== 'undefined' && expandTimeoutRef.current !== null) {
      window.clearTimeout(expandTimeoutRef.current)
    }
    expandTimeoutRef.current = null
    pendingExpandRef.current = null
    setPendingExpand(null)
  }, [])

  const startGroupDrag = useCallback(
    (groupId: string, clientX: number, clientY: number) => {
      clearPendingExpand()
      const nextDragState = {
        startedAt: Date.now(),
        startX: clientX,
        startY: clientY,
        pointerX: clientX,
        pointerY: clientY,
        dropTargetGroupId: null,
        placeAfterTarget: false,
        sourceGroupId: groupId,
        sourceMemberId: null,
        targetGroupId: null,
      }
      dragStateRef.current = nextDragState
      setDragState(nextDragState)
    },
    [clearPendingExpand],
  )

  const startMemberDrag = useCallback(
    (groupId: string, memberId: string, clientX: number, clientY: number) => {
      clearPendingExpand()
      const nextDragState = {
        startedAt: Date.now(),
        startX: clientX,
        startY: clientY,
        pointerX: clientX,
        pointerY: clientY,
        dropTargetGroupId: null,
        placeAfterTarget: false,
        sourceGroupId: groupId,
        sourceMemberId: memberId,
        targetGroupId: null,
      }
      dragStateRef.current = nextDragState
      setDragState(nextDragState)
    },
    [clearPendingExpand],
  )

  const startDeviceIconDrag = (
    member: RoomControlTile,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const nextState = {
      dragging: false,
      member,
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      sourceCollectionId: member.collectionId,
      startX: event.clientX,
      startY: event.clientY,
      targetCollectionId: null,
    }
    deviceIconDragStateRef.current = nextState
    setDeviceIconDragState(nextState)
  }

  const exitEditMode = useCallback(() => {
    onApplyGrouping(
      lastAppliedGroupingRef.current ??
        orderedGroups
          .map((group) => group.members.map((member) => member.id))
          .filter((group) => group.length > 0),
    )
    clearPendingExpand()
    setExpandedGroupId(null)
    clearHoveredItemTargets()
    onSetEditing(false)
  }, [clearHoveredItemTargets, clearPendingExpand, onApplyGrouping, onSetEditing, orderedGroups])

  useEffect(() => {
    setOrderedGroupIds((current) =>
      reconcileGroupOrder(
        current,
        controlGroups.map((group) => group.id),
      ),
    )
    lastAppliedGroupingRef.current = null
  }, [controlGroups])

  useEffect(() => {
    dragStateRef.current = dragState
  }, [dragState])

  useEffect(() => {
    deviceIconDragStateRef.current = deviceIconDragState
  }, [deviceIconDragState])

  useEffect(
    () => () => {
      clearCollapsedClickTimeout()
    },
    [clearCollapsedClickTimeout],
  )

  useEffect(() => {
    pendingExpandRef.current = pendingExpand
  }, [pendingExpand])

  useEffect(() => {
    const pointerId = deviceIconDragState?.pointerId
    if (pointerId === undefined) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const current = deviceIconDragStateRef.current
      if (!current || event.pointerId !== current.pointerId) {
        return
      }

      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
      const dragging = current.dragging || distance >= DEVICE_ICON_DRAG_THRESHOLD_PX
      const targetCollectionId = dragging
        ? getDeviceDropTargetCollectionId(event.clientX, event.clientY, current.sourceCollectionId)
        : null
      const nextState = {
        ...current,
        dragging,
        pointerX: event.clientX,
        pointerY: event.clientY,
        targetCollectionId,
      }

      deviceIconDragStateRef.current = nextState
      setDeviceIconDragState(nextState)
      if (dragging) {
        event.preventDefault()
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const current = deviceIconDragStateRef.current
      if (!current || event.pointerId !== current.pointerId) {
        return
      }

      if (current.dragging) {
        event.preventDefault()
        suppressRoomPanelNodeEvents()
        iconOnlyClickSuppressedUntilRef.current = Date.now() + EDIT_EXIT_ACTION_SUPPRESS_MS
        const targetCollectionId =
          current.targetCollectionId ??
          getDeviceDropTargetCollectionId(event.clientX, event.clientY, current.sourceCollectionId)
        if (targetCollectionId) {
          onCopyDeviceToGroup(current.sourceCollectionId, targetCollectionId)
        }
      }

      deviceIconDragStateRef.current = null
      setDeviceIconDragState(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [deviceIconDragState?.pointerId, onCopyDeviceToGroup])

  useEffect(() => {
    if (!(editing && pendingExpand)) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const activePendingExpand = pendingExpandRef.current
      if (!activePendingExpand || event.pointerId !== activePendingExpand.pointerId) {
        return
      }

      const distance = Math.hypot(
        event.clientX - activePendingExpand.startX,
        event.clientY - activePendingExpand.startY,
      )
      if (distance < GROUP_EXPAND_DRAG_THRESHOLD_PX) {
        return
      }

      const groupId = activePendingExpand.groupId
      clearPendingExpand()
      startGroupDrag(groupId, event.clientX, event.clientY)
    }

    const handlePointerFinish = (event: PointerEvent) => {
      const activePendingExpand = pendingExpandRef.current
      if (!activePendingExpand || event.pointerId !== activePendingExpand.pointerId) {
        return
      }
      const quickTap = isQuickEditTap(
        activePendingExpand.startedAt,
        activePendingExpand.startX,
        activePendingExpand.startY,
        event.clientX,
        event.clientY,
      )
      const heldLongEnough =
        event.timeStamp - activePendingExpand.startEventTime >= GROUP_EXPAND_HOLD_MS
      const movedDistance = Math.hypot(
        event.clientX - activePendingExpand.startX,
        event.clientY - activePendingExpand.startY,
      )
      if (heldLongEnough && movedDistance < GROUP_EXPAND_DRAG_THRESHOLD_PX) {
        const groupId = activePendingExpand.groupId
        clearPendingExpand()
        setExpandedGroupId(groupId)
        return
      }
      clearPendingExpand()
      if (quickTap) {
        suppressEditExitActions()
        exitEditMode()
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerFinish)
    window.addEventListener('pointercancel', handlePointerFinish)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerFinish)
      window.removeEventListener('pointercancel', handlePointerFinish)
    }
  }, [
    clearPendingExpand,
    editing,
    exitEditMode,
    pendingExpand,
    startGroupDrag,
    suppressEditExitActions,
  ])

  useEffect(() => {
    if (!expandedGroupId) {
      return
    }

    const expandedGroup = groupById.get(expandedGroupId)
    if (!expandedGroup || expandedGroup.members.length < 2) {
      setExpandedGroupId(null)
    }
  }, [expandedGroupId, groupById])

  useEffect(() => {
    if (!(editing && expandedGroupId) || dragState) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest(`[data-expanded-room-control-root="${expandedGroupId}"]`)
      ) {
        return
      }
      setExpandedGroupId(null)
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [dragState, editing, expandedGroupId])

  useEffect(() => {
    if (!(editing && dragState)) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const activeDragState = dragStateRef.current
      if (!activeDragState) {
        return
      }

      const hoveredElement = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-room-control-group-id]') as HTMLElement | null
      const targetGroupId = hoveredElement?.dataset.roomControlGroupId ?? null
      const sourceGroup = groupById.get(activeDragState.sourceGroupId)
      const sourceMember = activeDragState.sourceMemberId
        ? (sourceGroup?.members.find((member) => member.id === activeDragState.sourceMemberId) ??
          null)
        : null
      const targetGroup = targetGroupId ? groupById.get(targetGroupId) : null
      const compatibleTargetId =
        hoveredElement &&
        targetGroup &&
        ((sourceMember &&
          targetGroup.id !== activeDragState.sourceGroupId &&
          canMergeControlMemberIntoGroup(sourceMember, targetGroup)) ||
          (sourceGroup && canMergeControlGroups(sourceGroup, targetGroup)))
          ? targetGroupId
          : null
      const mergeTargetId =
        compatibleTargetId &&
        hoveredElement &&
        isPointerInMergeHotspot(event.clientX, event.clientY, hoveredElement)
          ? compatibleTargetId
          : null
      const reorderTargetGroupId =
        targetGroupId && targetGroupId !== activeDragState.sourceGroupId ? targetGroupId : null
      const sourceElement =
        activeDragState.sourceMemberId == null
          ? findRoomControlGroupElement(activeDragState.sourceGroupId)
          : null
      const reorderPlacement =
        mergeTargetId == null && reorderTargetGroupId && hoveredElement && sourceElement
          ? getReorderPlacement(event.clientX, event.clientY, sourceElement, hoveredElement)
          : null
      const placeAfterTarget = reorderPlacement?.placeAfter ?? false

      if (
        activeDragState.sourceMemberId == null &&
        mergeTargetId == null &&
        reorderTargetGroupId &&
        reorderPlacement?.ready
      ) {
        setOrderedGroupIds((current) =>
          moveGroupIdRelative(
            current,
            activeDragState.sourceGroupId,
            reorderTargetGroupId,
            placeAfterTarget,
          ),
        )
      }

      setDragState((current) =>
        current
          ? (() => {
              const nextDragState = {
                ...current,
                pointerX: event.clientX,
                pointerY: event.clientY,
                dropTargetGroupId: reorderPlacement?.ready ? reorderTargetGroupId : null,
                placeAfterTarget,
                targetGroupId: mergeTargetId,
              }
              dragStateRef.current = nextDragState
              return nextDragState
            })()
          : current,
      )
    }

    const handlePointerUp = (event: PointerEvent) => {
      const activeDragState = dragStateRef.current
      if (!activeDragState) {
        return
      }

      if (
        isQuickEditTap(
          activeDragState.startedAt,
          activeDragState.startX,
          activeDragState.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        dragStateRef.current = null
        setDragState(null)
        if (!activeDragState.sourceMemberId) {
          suppressEditExitActions()
          exitEditMode()
        }
        return
      }

      const sourceGroup = groupById.get(activeDragState.sourceGroupId)
      const targetGroup = activeDragState.targetGroupId
        ? groupById.get(activeDragState.targetGroupId)
        : null
      const panelElement = refsStore[roomId]?.panel
      const releasedOutsidePanel = !isPointInsideElement(
        event.clientX,
        event.clientY,
        panelElement ?? null,
      )
      const hoveredGroupElement = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-room-control-group-id]') as HTMLElement | null

      if (sourceGroup && activeDragState.sourceMemberId) {
        const sourceMember = sourceGroup.members.find(
          (member) => member.id === activeDragState.sourceMemberId,
        )
        const sourceRemainingIds = sourceGroup.members
          .filter((member) => member.id !== activeDragState.sourceMemberId)
          .map((member) => member.id)

        const droppedSingleMemberGroupIntoBlankPanel =
          sourceMember &&
          !targetGroup &&
          sourceGroup.members.length === 1 &&
          sourceMember.canDetachFromRoom

        if (sourceMember && (releasedOutsidePanel || droppedSingleMemberGroupIntoBlankPanel)) {
          const nextGroups = controlGroups.flatMap((group) => {
            if (group.id === sourceGroup.id) {
              return sourceRemainingIds.length > 0 ? [sourceRemainingIds] : []
            }
            return [group.members.map((member) => member.id)]
          })
          const nextOrderIds = nextGroups.map((group) => group.join('|'))

          setOrderedGroupIds(nextOrderIds)
          applyRoomGrouping(nextGroups)
          onRemoveDeviceFromGroup(sourceMember)
        } else if (
          sourceMember &&
          targetGroup &&
          canMergeControlMemberIntoGroup(sourceMember, targetGroup)
        ) {
          const nextSourceGroupId = sourceRemainingIds.join('|')
          const mergedMemberIds = [
            ...targetGroup.members.map((member) => member.id),
            sourceMember.id,
          ]
          const nextTargetGroupId = mergedMemberIds.join('|')

          setOrderedGroupIds(
            currentOrderIds.flatMap((groupId) => {
              if (groupId === sourceGroup.id) {
                return sourceRemainingIds.length > 0 ? [nextSourceGroupId] : []
              }
              if (groupId === targetGroup.id) {
                return [nextTargetGroupId]
              }
              return [groupId]
            }),
          )

          applyRoomGrouping(
            controlGroups.flatMap((group) => {
              if (group.id === sourceGroup.id) {
                return sourceRemainingIds.length > 0 ? [sourceRemainingIds] : []
              }
              if (group.id === targetGroup.id) {
                return [mergedMemberIds]
              }
              return [group.members.map((member) => member.id)]
            }),
          )
        } else if (sourceMember && sourceRemainingIds.length > 0) {
          const nextSourceGroupId = sourceRemainingIds.join('|')
          const memberGroupId = sourceMember.id
          const reorderAnchorId =
            activeDragState.dropTargetGroupId &&
            activeDragState.dropTargetGroupId !== sourceGroup.id
              ? activeDragState.dropTargetGroupId
              : nextSourceGroupId
          const nextOrderIds = moveGroupIdRelative(
            [
              ...currentOrderIds.flatMap((groupId) =>
                groupId === sourceGroup.id ? [nextSourceGroupId] : [groupId],
              ),
              memberGroupId,
            ],
            memberGroupId,
            reorderAnchorId,
            reorderAnchorId === nextSourceGroupId ? true : activeDragState.placeAfterTarget,
          )

          setOrderedGroupIds(nextOrderIds)
          applyRoomGrouping(
            controlGroups.flatMap((group) => {
              if (group.id === sourceGroup.id) {
                return [sourceRemainingIds, [sourceMember.id]]
              }
              return [group.members.map((member) => member.id)]
            }),
          )
        }

        setExpandedGroupId(null)
      } else if (
        sourceGroup &&
        sourceGroup.members.length === 1 &&
        sourceGroup.members[0]?.canDetachFromRoom &&
        (releasedOutsidePanel || !hoveredGroupElement)
      ) {
        const sourceMember = sourceGroup.members[0]
        const nextGroups = controlGroups.flatMap((group) =>
          group.id === sourceGroup.id ? [] : [group.members.map((member) => member.id)],
        )
        const nextOrderIds = nextGroups.map((group) => group.join('|'))

        setOrderedGroupIds(nextOrderIds)
        applyRoomGrouping(nextGroups)
        if (sourceMember) {
          onRemoveDeviceFromGroup(sourceMember)
        }
      } else if (sourceGroup && sourceGroup.members.length > 1 && releasedOutsidePanel) {
        const splitMemberIds = sourceGroup.members.map((member) => member.id)

        setOrderedGroupIds((current) =>
          current.flatMap((groupId) => (groupId === sourceGroup.id ? splitMemberIds : [groupId])),
        )

        applyRoomGrouping(
          controlGroups.flatMap((group) =>
            group.id === sourceGroup.id
              ? splitMemberIds.map((memberId) => [memberId])
              : [group.members.map((member) => member.id)],
          ),
        )
      } else if (sourceGroup && targetGroup && canMergeControlGroups(sourceGroup, targetGroup)) {
        const mergedMemberIds = [
          ...targetGroup.members.map((member) => member.id),
          ...sourceGroup.members.map((member) => member.id),
        ]
        const mergedGroupId = mergedMemberIds.join('|')

        setOrderedGroupIds((current) =>
          current.flatMap((groupId) => {
            if (groupId === sourceGroup.id) {
              return []
            }
            if (groupId === targetGroup.id) {
              return [mergedGroupId]
            }
            return [groupId]
          }),
        )

        applyRoomGrouping(
          controlGroups
            .filter((group) => group.id !== sourceGroup.id)
            .map((group) =>
              group.id === targetGroup.id
                ? mergedMemberIds
                : group.members.map((member) => member.id),
            ),
        )
      }

      dragStateRef.current = null
      setDragState(null)
      clearHoveredItemTargets()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [
    clearHoveredItemTargets,
    applyRoomGrouping,
    controlGroups,
    currentOrderIds,
    dragState,
    editing,
    exitEditMode,
    groupById,
    onRemoveDeviceFromGroup,
    refsStore,
    roomId,
    suppressEditExitActions,
  ])

  useEffect(() => {
    if (!editing) {
      setDragState(null)
      setExpandedGroupId(null)
      clearPendingExpand()
    }
  }, [clearPendingExpand, editing])

  useEffect(
    () => () => {
      clearLongPress()
      clearSuppressedClick()
    },
    [clearLongPress, clearSuppressedClick],
  )

  useEffect(() => {
    if (!dragState) {
      return
    }

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [dragState])

  const currentDragGroup = dragState ? (groupById.get(dragState.sourceGroupId) ?? null) : null
  const currentDragMember =
    dragState?.sourceMemberId && currentDragGroup
      ? (currentDragGroup.members.find((member) => member.id === dragState.sourceMemberId) ?? null)
      : null
  const openHeaderKey = `${roomId}:header-open`
  const closeHeaderKey = `${roomId}:header-close`
  const getGroupLongPressKey = (groupId: string) => `${roomId}:group:${groupId}`

  const handleHeaderPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    action: LongPressAction,
    key: string,
  ) => {
    event.stopPropagation()
    suppressRoomPanelNodeEvents(ROOM_PANEL_LONG_PRESS_NODE_EVENT_SUPPRESS_MS)
    startLongPress(event, key, action)
  }

  const handleHeaderPointerMove = (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    continueLongPress(event, key)
  }

  const handleHeaderPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    suppressRoomPanelNodeEvents()
    endLongPress(event, key)
  }

  const handleControlPointerDown = (
    groupId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation()
    suppressRoomPanelNodeEvents(ROOM_PANEL_LONG_PRESS_NODE_EVENT_SUPPRESS_MS)
    startLongPress(event, getGroupLongPressKey(groupId), 'edit', groupId)
  }

  const handleControlPointerMove = (
    groupId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    continueLongPress(event, getGroupLongPressKey(groupId))
  }

  const handleControlPointerEnd = (
    groupId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    suppressRoomPanelNodeEvents()
    endLongPress(event, getGroupLongPressKey(groupId))
  }

  const consumeControlSuppressedClick = (groupId: string) =>
    consumeSuppressedClick(getGroupLongPressKey(groupId))

  const handlePanelBodyPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editing || dragState || event.target !== event.currentTarget) {
      return
    }
    event.stopPropagation()
    suppressRoomPanelNodeEvents()
    exitEditMode()
  }

  const runCollapsedPillPrimaryAction = () => {
    if (collapsedDirectButtonDisabled) {
      return
    }

    if (iconOnly) {
      if (collapsedDirectActionMode && collapsedDirectControlMember) {
        onChange(
          collapsedDirectControlMember.itemId,
          collapsedDirectControlMember.controlIndex,
          !collapsedDirectControlValue,
        )
      }
      return
    }

    if (collapsedHasToggleAction) {
      const nextValue = !collapsedAllToggleMembersOn
      for (const member of collapsedToggleMembers) {
        onChange(member.itemId, member.controlIndex, nextValue)
      }
    }
  }

  const scheduleCollapsedPillPrimaryAction = () => {
    clearCollapsedClickTimeout()

    if (typeof window === 'undefined') {
      runCollapsedPillPrimaryAction()
      return
    }

    collapsedClickTimeoutRef.current = window.setTimeout(() => {
      collapsedClickTimeoutRef.current = null
      runCollapsedPillPrimaryAction()
    }, COLLAPSED_PILL_SINGLE_CLICK_DELAY_MS)
  }

  const collapsedDirectAriaLabel = collapsedDirectControlDisabled
    ? `${roomName} is not linked to a controllable device`
    : iconOnly && !collapsedDirectActionMode
      ? `${roomName} has no direct action`
      : iconOnly
        ? collapsedDirectActionMode === 'trigger'
          ? `Run ${roomName}`
          : `Toggle ${roomName}`
        : collapsedHasToggleAction
          ? `Toggle ${roomName}`
          : collapsedDirectActionMode === 'trigger'
            ? `Run ${roomName}`
            : `Open ${roomName} controls`

  return (
    <div
      data-room-control-collection-id={roomId}
      ref={(node) => setOverlayDomRef(refsStore, roomId, 'panel', node)}
      style={panelBaseStyle}
    >
      {isOpen ? (
        <div style={headerRowStyle}>
          <button
            aria-label={`Close ${roomName} controls`}
            aria-expanded
            onClick={(event) => {
              event.stopPropagation()
              suppressRoomPanelNodeEvents()
              if (consumeSuppressedClick(closeHeaderKey)) {
                return
              }
              if (editing) {
                suppressEditExitActions()
                exitEditMode()
                return
              }
              onSetOpen(false)
            }}
            onPointerCancel={(event) => handleHeaderPointerEnd(event, closeHeaderKey)}
            onPointerDown={(event) => handleHeaderPointerDown(event, 'edit', closeHeaderKey)}
            onPointerMove={(event) => handleHeaderPointerMove(event, closeHeaderKey)}
            onPointerUp={(event) => handleHeaderPointerEnd(event, closeHeaderKey)}
            style={headerMainButtonStyle}
            type="button"
          >
            <span style={headerNameStyle}>{roomName}</span>
          </button>
        </div>
      ) : (
        <button
          aria-label={collapsedDirectAriaLabel}
          aria-expanded={false}
          disabled={collapsedDirectButtonDisabled}
          onClick={(event) => {
            event.stopPropagation()
            suppressRoomPanelNodeEvents()
            if (Date.now() < iconOnlyClickSuppressedUntilRef.current) {
              return
            }
            if (consumeSuppressedClick(openHeaderKey)) {
              return
            }
            if (collapsedDirectButtonDisabled) {
              return
            }
            scheduleCollapsedPillPrimaryAction()
          }}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            suppressRoomPanelNodeEvents()
            clearCollapsedClickTimeout()
            if (iconOnly || collapsedDirectButtonDisabled) {
              return
            }
            onSetOpen(true)
          }}
          onPointerCancel={(event) => handleHeaderPointerEnd(event, openHeaderKey)}
          onPointerDown={(event) => {
            if (iconOnly) {
              event.stopPropagation()
              suppressRoomPanelNodeEvents()
              if (collapsedDirectControlMember && !collapsedDirectButtonDisabled) {
                startDeviceIconDrag(collapsedDirectControlMember, event)
              }
              return
            }
            if (collapsedDirectControlMember && !collapsedDirectButtonDisabled) {
              startDeviceIconDrag(collapsedDirectControlMember, event)
            }
            handleHeaderPointerDown(event, 'open-edit', openHeaderKey)
          }}
          onPointerMove={(event) => handleHeaderPointerMove(event, openHeaderKey)}
          onPointerUp={(event) => handleHeaderPointerEnd(event, openHeaderKey)}
          style={getCollapsedDirectToggleButtonStyle(
            collapsedDirectControlMember,
            collapsedVisualActive,
            collapsedDirectButtonDisabled,
            iconOnly,
            collapsedMajorityItemKind,
          )}
          type="button"
        >
          {iconOnly && collapsedDirectControlMember ? (
            <span style={iconOnlyPillGlyphStyle}>
              <ControlGlyph itemKind={collapsedDirectControlMember.itemKind} />
            </span>
          ) : (
            <span style={headerNameStyle}>{roomName}</span>
          )}
        </button>
      )}
      {isOpen ? (
        <div
          onPointerDown={handlePanelBodyPointerDown}
          style={getPanelBodyGridStyle(totalSlotCount, displayedGroups)}
        >
          {controlGroups.length > 0 ? (
            displayedGroups.map((group) =>
              editing ? (
                expandedGroupId === group.id && group.members.length > 1 ? (
                  <GroupExpandedEditTile
                    clearHoveredItemTargets={clearHoveredItemTargets}
                    draggingMemberId={
                      dragState?.sourceGroupId === group.id ? dragState.sourceMemberId : null
                    }
                    group={group}
                    key={group.id}
                    mergeTarget={dragState?.targetGroupId === group.id}
                    onGroupHover={() => setHoveredItemTargets(group.itemIds)}
                    onMemberHover={(member) => setHoveredItemTargets([member.itemId])}
                    onStartMemberDrag={(member, event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      suppressRoomPanelNodeEvents(ROOM_PANEL_LONG_PRESS_NODE_EVENT_SUPPRESS_MS)
                      setHoveredItemTargets([member.itemId])
                      startMemberDrag(group.id, member.id, event.clientX, event.clientY)
                    }}
                    panelColumns={panelColumns}
                  />
                ) : (
                  <GroupEditTile
                    animated={Boolean(dragState)}
                    clearHoveredItemTargets={clearHoveredItemTargets}
                    dragging={
                      dragState?.sourceGroupId === group.id && dragState.sourceMemberId == null
                    }
                    group={group}
                    key={group.id}
                    mergeTarget={dragState?.targetGroupId === group.id}
                    onHover={() => setHoveredItemTargets(group.itemIds)}
                    onStartDrag={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      suppressRoomPanelNodeEvents(ROOM_PANEL_LONG_PRESS_NODE_EVENT_SUPPRESS_MS)
                      setHoveredItemTargets(group.itemIds)

                      if (group.members.length > 1) {
                        clearPendingExpand()
                        const nextPendingExpand = {
                          groupId: group.id,
                          pointerId: event.pointerId,
                          startEventTime: event.timeStamp,
                          startedAt: Date.now(),
                          startX: event.clientX,
                          startY: event.clientY,
                        }
                        pendingExpandRef.current = nextPendingExpand
                        setPendingExpand(nextPendingExpand)
                        if (typeof window !== 'undefined') {
                          expandTimeoutRef.current = window.setTimeout(() => {
                            const activePendingExpand = pendingExpandRef.current
                            if (!activePendingExpand || activePendingExpand.groupId !== group.id) {
                              return
                            }
                            clearPendingExpand()
                            setExpandedGroupId(group.id)
                          }, GROUP_EXPAND_HOLD_MS)
                        }
                        return
                      }

                      startGroupDrag(group.id, event.clientX, event.clientY)
                    }}
                    panelColumns={panelColumns}
                  />
                )
              ) : group.controlKind === 'numeric' ? (
                <AdjustableGroupTile
                  clearHoveredItemTargets={clearHoveredItemTargets}
                  consumeSuppressedClick={consumeControlSuppressedClick}
                  controlValues={controlValues}
                  group={group}
                  key={group.id}
                  onChange={onChange}
                  onHover={() => setHoveredItemTargets(group.itemIds)}
                  onPointerDown={handleControlPointerDown}
                  onPointerEnd={handleControlPointerEnd}
                  onPointerMove={handleControlPointerMove}
                  shouldSuppressEditExitAction={shouldSuppressEditExitAction}
                  panelColumns={panelColumns}
                />
              ) : (
                <ToggleGroupTile
                  clearHoveredItemTargets={clearHoveredItemTargets}
                  consumeSuppressedClick={consumeControlSuppressedClick}
                  controlValues={controlValues}
                  group={group}
                  key={group.id}
                  onChange={onChange}
                  onHover={() => setHoveredItemTargets(group.itemIds)}
                  onPointerDown={handleControlPointerDown}
                  onPointerEnd={handleControlPointerEnd}
                  onPointerMove={handleControlPointerMove}
                  shouldSuppressEditExitAction={shouldSuppressEditExitAction}
                  panelColumns={panelColumns}
                />
              ),
            )
          ) : (
            <div style={emptyStateStyle}>No controls</div>
          )}
        </div>
      ) : null}
      {editing && dragState && currentDragGroup && typeof document !== 'undefined'
        ? createPortal(
            <div
              style={{
                ...dragGhostStyle,
                left: dragState.pointerX,
                top: dragState.pointerY,
              }}
            >
              <GroupEditGhost
                group={currentDragGroup}
                member={currentDragMember}
                mergeReady={dragState.targetGroupId !== null}
                panelColumns={panelColumns}
              />
            </div>,
            document.body,
          )
        : null}
      {deviceIconDragState?.dragging && typeof document !== 'undefined'
        ? createPortal(
            <div
              style={{
                ...dragGhostStyle,
                left: deviceIconDragState.pointerX,
                top: deviceIconDragState.pointerY,
                width: DEVICE_ICON_PILL_WIDTH,
              }}
            >
              <button
                aria-hidden="true"
                style={{
                  ...getIconOnlyDevicePillButtonStyle(deviceIconDragState.member, true, false),
                  outline: deviceIconDragState.targetCollectionId
                    ? '2px solid rgba(34,197,94,0.92)'
                    : 'none',
                  outlineOffset: 2,
                }}
                tabIndex={-1}
                type="button"
              >
                <span style={iconOnlyPillGlyphStyle}>
                  <ControlGlyph itemKind={deviceIconDragState.member.itemKind} />
                </span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

const GroupIntensityStrip = ({
  controlValues,
  group,
  onChange,
}: {
  controlValues: Record<AnyNodeId, { controlValues: ControlValue[] }>
  group: RoomControlGroup
  onChange: (itemId: AnyNodeId, controlIndex: number, nextValue: ControlValue) => void
}) => {
  const segments = useMemo(
    () => getGroupIntensitySegments(group, controlValues),
    [controlValues, group],
  )
  const visualSegments = useMemo(() => getGroupVisualSegments(group), [group])

  if (segments.length === 0) {
    return null
  }

  const segmentByKind = new Map(segments.map((segment) => [segment.itemKind, segment] as const))

  const applySegmentRatio = (
    segment: GroupIntensitySegment,
    element: HTMLSpanElement,
    clientX: number,
  ) => {
    const nextRatio = getSliderPointerRatio(clientX, element)
    for (const member of segment.members) {
      onChange(
        member.itemId,
        member.intensityControlIndex,
        getSliderValueAtRatio(member.intensityControl, nextRatio),
      )
    }
  }

  const stopSegmentEvent = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault()
    event.stopPropagation()
    suppressRoomPanelNodeEvents()
  }

  return (
    <span
      aria-hidden="true"
      data-room-control-intensity-strip={group.id}
      onClick={stopSegmentEvent}
      style={intensityStripStyle}
    >
      {visualSegments.map((visualSegment, index) => {
        const segment = segmentByKind.get(visualSegment.itemKind)
        if (!segment) {
          return <span key={`empty-${visualSegment.itemKind}`} style={intensitySegmentLaneStyle} />
        }

        const accentRgb = getAccentRgb(segment.itemKind)
        const trackBackgroundRgb = scaleRgb(accentRgb, 0.38)
        const fillRgb = scaleRgb(accentRgb, 1.04)
        const thumbLeft = `${Math.max(0, Math.min(100, segment.ratio * 100))}%`
        const segmentTitle =
          segment.members.length === 1
            ? `Set ${segment.members[0]!.itemName} intensity`
            : `Set grouped ${segment.itemKind} intensity`

        return (
          <span key={segment.key} style={intensitySegmentLaneStyle}>
            <span
              onClick={stopSegmentEvent}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onPointerCancel={(event) => {
                stopSegmentEvent(event)
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
              }}
              onPointerDown={(event) => {
                stopSegmentEvent(event)
                event.currentTarget.setPointerCapture?.(event.pointerId)
                applySegmentRatio(segment, event.currentTarget, event.clientX)
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                  return
                }
                stopSegmentEvent(event)
                applySegmentRatio(segment, event.currentTarget, event.clientX)
              }}
              onPointerUp={(event) => {
                stopSegmentEvent(event)
                applySegmentRatio(segment, event.currentTarget, event.clientX)
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
              }}
              style={{
                ...intensitySegmentTrackStyle,
                background: `rgba(${trackBackgroundRgb},0.22)`,
                border: '1px solid rgba(0,0,0,0.82)',
                marginLeft: index > 0 ? INTENSITY_SEGMENT_BOUNDARY_INSET : 0,
                marginRight:
                  index < visualSegments.length - 1 ? INTENSITY_SEGMENT_BOUNDARY_INSET : 0,
              }}
              title={segmentTitle}
            >
              <span
                style={{
                  ...intensitySegmentFillStyle,
                  background: `linear-gradient(90deg, rgba(${fillRgb},0.88) 0%, rgba(${accentRgb},0.96) 100%)`,
                  transform: `scaleX(${segment.ratio})`,
                }}
              />
              <span style={{ ...intensitySegmentThumbStyle, left: thumbLeft }} />
            </span>
          </span>
        )
      })}
    </span>
  )
}

const ToggleGroupTile = ({
  clearHoveredItemTargets,
  consumeSuppressedClick,
  controlValues,
  group,
  onChange,
  onHover,
  onPointerDown,
  onPointerEnd,
  onPointerMove,
  shouldSuppressEditExitAction,
  panelColumns,
}: {
  clearHoveredItemTargets: () => void
  consumeSuppressedClick: (groupId: string) => boolean
  controlValues: Record<AnyNodeId, { controlValues: ControlValue[] }>
  group: RoomControlGroup
  onChange: (itemId: AnyNodeId, controlIndex: number, nextValue: ControlValue) => void
  onHover: () => void
  onPointerDown: (groupId: string, event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerEnd: (groupId: string, event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerMove: (groupId: string, event: ReactPointerEvent<HTMLButtonElement>) => void
  shouldSuppressEditExitAction: () => boolean
  panelColumns: number
}) => {
  const toggleMembers = group.members.filter((member) => member.control.kind === 'toggle')
  const hasIntensity = getGroupIntensityTiles(group).length > 0
  const disabled = toggleMembers.length === 0 || toggleMembers.every((member) => member.disabled)
  const toggleValues = toggleMembers.map((member) =>
    Boolean(
      getResolvedControlValue(
        member.control,
        controlValues[member.itemId]?.controlValues?.[member.controlIndex],
      ),
    ),
  )
  const allOn = !disabled && toggleValues.every(Boolean)
  const anyOn = !disabled && toggleValues.some(Boolean)
  const nextValue = !allOn

  return (
    <button
      aria-label={`${nextValue ? 'Turn on' : 'Turn off'} ${getGroupAccessibleLabel(group)}`}
      data-room-control-group-id={group.id}
      disabled={disabled}
      title={getGroupTooltip(group)}
      onClick={(event) => {
        event.stopPropagation()
        suppressRoomPanelNodeEvents()
        if (disabled || shouldSuppressEditExitAction()) {
          return
        }
        if (consumeSuppressedClick(group.id)) {
          return
        }
        for (const member of toggleMembers.filter((entry) => !entry.disabled)) {
          onChange(member.itemId, member.controlIndex, nextValue)
        }
      }}
      onPointerCancel={(event) => onPointerEnd(group.id, event)}
      onPointerDown={(event) => onPointerDown(group.id, event)}
      onPointerEnter={onHover}
      onPointerLeave={clearHoveredItemTargets}
      onPointerMove={(event) => onPointerMove(group.id, event)}
      onPointerUp={(event) => onPointerEnd(group.id, event)}
      style={getToggleTileStyle(group, panelColumns, allOn, anyOn, hasIntensity, disabled)}
      type="button"
    >
      <span style={getControlGlyphContainerStyle(hasIntensity)}>
        <GroupGlyphContent active={!disabled && (allOn || anyOn)} group={group} />
      </span>
      <GroupIntensityStrip controlValues={controlValues} group={group} onChange={onChange} />
    </button>
  )
}

const AdjustableGroupTile = ({
  clearHoveredItemTargets,
  consumeSuppressedClick,
  controlValues,
  group,
  onChange,
  onHover,
  onPointerDown,
  onPointerEnd,
  onPointerMove,
  shouldSuppressEditExitAction,
  panelColumns,
}: {
  clearHoveredItemTargets: () => void
  consumeSuppressedClick: (groupId: string) => boolean
  controlValues: Record<AnyNodeId, { controlValues: ControlValue[] }>
  group: RoomControlGroup
  onChange: (itemId: AnyNodeId, controlIndex: number, nextValue: ControlValue) => void
  onHover: () => void
  onPointerDown: (groupId: string, event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerEnd: (groupId: string, event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerMove: (groupId: string, event: ReactPointerEvent<HTMLButtonElement>) => void
  shouldSuppressEditExitAction: () => boolean
  panelColumns: number
}) => {
  const hasIntensity = getGroupIntensityTiles(group).length > 0
  const disabled = group.members.length === 0 || group.members.every((member) => member.disabled)
  const representativeControl = group.members[0]?.control
  const displayValue = representativeControl
    ? getGroupNumericDisplayValue(group, controlValues)
    : ''

  return (
    <button
      aria-label={`Adjust ${getGroupAccessibleLabel(group)}`}
      data-room-control-group-id={group.id}
      disabled={disabled}
      title={`${getGroupTooltip(group)}${displayValue ? ` (${displayValue})` : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        suppressRoomPanelNodeEvents()
        if (disabled || shouldSuppressEditExitAction()) {
          return
        }
        if (consumeSuppressedClick(group.id)) {
          return
        }
        applyNumericGroupDelta(group, controlValues, onChange, 1)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        suppressRoomPanelNodeEvents()
        if (disabled) {
          return
        }
        applyNumericGroupDelta(group, controlValues, onChange, -1)
      }}
      onPointerEnter={onHover}
      onPointerLeave={clearHoveredItemTargets}
      onPointerCancel={(event) => onPointerEnd(group.id, event)}
      onPointerDown={(event) => onPointerDown(group.id, event)}
      onPointerMove={(event) => onPointerMove(group.id, event)}
      onPointerUp={(event) => onPointerEnd(group.id, event)}
      onWheel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        suppressRoomPanelNodeEvents()
        if (disabled) {
          return
        }
        applyNumericGroupDelta(group, controlValues, onChange, event.deltaY > 0 ? -1 : 1)
      }}
      style={getAdjustableTileStyle(group, panelColumns, hasIntensity, disabled)}
      type="button"
    >
      <span style={getControlGlyphContainerStyle(hasIntensity)}>
        <GroupGlyphContent active={false} group={group} />
      </span>
      <GroupIntensityStrip controlValues={controlValues} group={group} onChange={onChange} />
    </button>
  )
}

const GroupEditTile = ({
  animated,
  clearHoveredItemTargets,
  dragging,
  group,
  mergeTarget,
  onHover,
  onStartDrag,
  panelColumns,
}: {
  animated: boolean
  clearHoveredItemTargets: () => void
  dragging: boolean
  group: RoomControlGroup
  mergeTarget: boolean
  onHover: () => void
  onStartDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
  panelColumns: number
}) => (
  <div
    aria-grabbed={dragging}
    data-room-control-group-id={group.id}
    onPointerDown={onStartDrag}
    onPointerEnter={onHover}
    onPointerLeave={clearHoveredItemTargets}
    title={getGroupTooltip(group)}
    style={getEditTileStyle(group, panelColumns, dragging, mergeTarget, animated)}
  >
    <GroupGlyphContent active={false} group={group} />
  </div>
)

const GroupExpandedEditTile = ({
  clearHoveredItemTargets,
  draggingMemberId,
  group,
  mergeTarget,
  onGroupHover,
  onMemberHover,
  onStartMemberDrag,
  panelColumns,
}: {
  clearHoveredItemTargets: () => void
  draggingMemberId: string | null
  group: RoomControlGroup
  mergeTarget: boolean
  onGroupHover: () => void
  onMemberHover: (member: RoomControlTile) => void
  onStartMemberDrag: (member: RoomControlTile, event: ReactPointerEvent<HTMLButtonElement>) => void
  panelColumns: number
}) => {
  const memberLayout = getExpandedGroupMemberLayout(group, panelColumns)

  return (
    <div
      data-expanded-room-control-root={group.id}
      data-room-control-group-id={group.id}
      onPointerEnter={onGroupHover}
      onPointerLeave={clearHoveredItemTargets}
      title={getGroupTooltip(group)}
      style={getExpandedGroupEditTileStyle(group, panelColumns, mergeTarget)}
    >
      <div style={getExpandedGroupMemberGridStyle(memberLayout)}>
        {group.members.map((member) => (
          <button
            aria-label={`Move ${member.itemName}`}
            data-room-control-group-member-id={member.id}
            key={member.id}
            onPointerDown={(event) => onStartMemberDrag(member, event)}
            onPointerEnter={() => onMemberHover(member)}
            onPointerLeave={clearHoveredItemTargets}
            style={getExpandedGroupMemberButtonStyle(
              memberLayout.buttonSize,
              draggingMemberId === member.id,
            )}
            title={`${member.itemName}: ${getControlLabel(member.control)}`}
            type="button"
          >
            <span style={getExpandedGroupMemberGlyphStyle(memberLayout.buttonSize)}>
              <ControlGlyph itemKind={member.itemKind} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

const GroupEditGhost = ({
  group,
  member,
  mergeReady,
  panelColumns,
}: {
  group: RoomControlGroup
  member: RoomControlTile | null
  mergeReady: boolean
  panelColumns: number
}) => (
  <div style={getEditGhostStyle(group, member, panelColumns, mergeReady)}>
    {member ? (
      <span style={iconGlyphWrapStyle}>
        <ControlGlyph itemKind={member.itemKind} />
      </span>
    ) : (
      <GroupGlyphContent active={false} group={group} />
    )}
  </div>
)

const GroupGlyph = ({ group }: { group: RoomControlGroup }) => {
  const displayKinds = getGroupDisplayKinds(group)
  const iconWrapStyle = getSharedIconGlyphWrapStyle(displayKinds.length)

  if (displayKinds.length <= 1) {
    return (
      <span style={iconWrapStyle}>
        <ControlGlyph itemKind={displayKinds[0] ?? 'item'} />
      </span>
    )
  }

  return (
    <span style={groupedIconGlyphRowStyle}>
      {displayKinds.map((itemKind) => (
        <span key={itemKind} style={iconWrapStyle}>
          <ControlGlyph itemKind={itemKind} />
        </span>
      ))}
    </span>
  )
}

const GroupGlyphContent = ({ active, group }: { active: boolean; group: RoomControlGroup }) => {
  const segments = getGroupVisualSegments(group)
  const iconWrapStyle = getSharedIconGlyphWrapStyle(segments.length)

  if (segments.length <= 1) {
    const segment = segments[0]
    return (
      <span style={glyphContentRowStyle}>
        <GroupGlyph group={group} />
        {group.members.length > 1 ? (
          <span style={getCountBadgeStyle(segment?.itemKind ?? getGroupItemKind(group), active)}>
            {group.members.length}
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <span style={segmentedGlyphContentStyle}>
      {segments.map((segment) => (
        <span key={segment.itemKind} style={segmentedGlyphLaneStyle}>
          <span style={glyphContentRowStyle}>
            <span style={iconWrapStyle}>
              <ControlGlyph itemKind={segment.itemKind} />
            </span>
            {segment.count > 1 ? (
              <span style={getCountBadgeStyle(segment.itemKind, active)}>{segment.count}</span>
            ) : null}
          </span>
        </span>
      ))}
    </span>
  )
}

const ControlGlyph = ({ itemKind }: { itemKind: string }) => {
  switch (itemKind) {
    case 'light':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <path
            d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.7 10.7c.7.5 1.3 1.3 1.5 2.3h4.4c.2-1 .8-1.8 1.5-2.3A6 6 0 0 0 12 3Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      )
    case 'fan':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          style={{ transform: 'scale(1.18)', transformOrigin: 'center' }}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <circle cx="12" cy="12" fill="currentColor" r="1.5" />
          <path
            d="M12 10.5c0-2.8 1.5-5 3.3-5 1.4 0 2.2 1.2 2.2 2.5 0 2-2.1 3.1-4.4 4.5ZM10.5 12c-2.8 0-5-1.5-5-3.3 0-1.4 1.2-2.2 2.5-2.2 2 0 3.1 2.1 4.5 4.4ZM12 13.5c0 2.8-1.5 5-3.3 5-1.4 0-2.2-1.2-2.2-2.5 0-2 2.1-3.1 4.4-4.5ZM13.5 12c2.8 0 5 1.5 5 3.3 0 1.4-1.2 2.2-2.5 2.2-2 0-3.1-2.1-4.5-4.4Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      )
    case 'switch':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <rect height="14" rx="3" stroke="currentColor" strokeWidth="1.8" width="10" x="7" y="5" />
          <circle cx="12" cy="12" fill="currentColor" r="1.4" />
        </svg>
      )
    case 'outlet':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <rect height="14" rx="3" stroke="currentColor" strokeWidth="1.8" width="12" x="6" y="5" />
          <path
            d="M10 10v3M14 10v3M12 13v2"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      )
    case 'shade':
    case 'blind':
    case 'curtain':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <path
            d="M5 6h14M6 8v10M10 8v10M14 8v10M18 8v10M5 18h14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      )
    case 'door':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <path
            d="M7 20V5.5A1.5 1.5 0 0 1 8.5 4H17v16H7ZM11 12.5h.01"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      )
    case 'window':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <rect height="14" rx="2" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="5" />
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      )
    case 'fireplace':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <path
            d="M12 4c1.8 2 3 3.8 3 5.8a3.2 3.2 0 0 1-6.4 0c0-1.3.5-2.4 1.4-3.6.1 1.5.7 2.5 2 3.4C12.4 7.6 12.4 6 12 4Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="M8.5 15a3.5 3.5 0 0 0 7 0c0-1.3-.8-2.3-1.9-3 .1 1.2-.5 2-1.6 2.6-.4-.8-.5-1.7-.3-2.6-1.5 1-3.2 1.8-3.2 3Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'speaker':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <path
            d="M6 10h4l5-4v12l-5-4H6zM18 10a3 3 0 0 1 0 4M19.8 8a6 6 0 0 1 0 8"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      )
    case 'tv':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <rect height="10" rx="2" stroke="currentColor" strokeWidth="1.8" width="16" x="4" y="6" />
          <path
            d="M10 19h4M9 4l3 3 3-3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      )
    case 'group':
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.8" width="5" x="4" y="4" />
          <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.8" width="5" x="15" y="4" />
          <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.8" width="5" x="4" y="15" />
          <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.8" width="5" x="15" y="15" />
        </svg>
      )
    default:
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height={CONTROL_ICON_SIZE}
          viewBox="0 0 24 24"
          width={CONTROL_ICON_SIZE}
        >
          <path
            d="M12 4v6M8 6.5a7 7 0 1 0 8 0"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      )
  }
}

const getCanonicalPanelGridMetrics = (slotCount: number) => {
  if (slotCount <= 0) {
    return { columns: 1, rows: 1 }
  }

  const preferredColumns = Math.max(
    Math.ceil(slotCount / PANEL_PREFERRED_MAX_ROWS),
    Math.ceil(Math.sqrt(slotCount)),
  )
  const columns = Math.min(PANEL_MAX_COLUMNS, Math.max(1, Math.min(slotCount, preferredColumns)))
  const rows = Math.max(1, Math.ceil(slotCount / columns))
  return { columns, rows }
}

const getGroupPanelSpan = (group: RoomControlGroup, panelColumns: number) => {
  const requestedSlots = getMinimumGroupPanelSlots(group)

  if (requestedSlots <= panelColumns) {
    return { columnSpan: requestedSlots, rowSpan: 1 }
  }

  const preferredColumns = Math.min(panelColumns, Math.max(2, Math.ceil(Math.sqrt(requestedSlots))))
  return {
    columnSpan: preferredColumns,
    rowSpan: Math.ceil(requestedSlots / preferredColumns),
  }
}

const getMinimumGroupPanelSlots = (group: RoomControlGroup) => {
  const memberSlots = Math.max(1, group.members.length)
  const mixedKindSlots = getGroupDisplayKinds(group).length

  return Math.max(memberSlots, mixedKindSlots)
}

const getPackedPanelRowCount = (groups: RoomControlGroup[], panelColumns: number) => {
  const occupied: boolean[][] = []
  let maxRows = 1

  const ensureRows = (count: number) => {
    while (occupied.length < count) {
      occupied.push(Array.from({ length: panelColumns }, () => false))
    }
  }

  const canPlace = (row: number, column: number, columnSpan: number, rowSpan: number) => {
    if (column + columnSpan > panelColumns) {
      return false
    }

    ensureRows(row + rowSpan)
    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
        if (occupied[row + rowOffset]?.[column + columnOffset]) {
          return false
        }
      }
    }

    return true
  }

  const markPlaced = (row: number, column: number, columnSpan: number, rowSpan: number) => {
    ensureRows(row + rowSpan)
    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
        occupied[row + rowOffset]![column + columnOffset] = true
      }
    }
    maxRows = Math.max(maxRows, row + rowSpan)
  }

  for (const group of groups) {
    const { columnSpan, rowSpan } = getGroupPanelSpan(group, panelColumns)
    let placed = false
    let row = 0

    while (!placed) {
      ensureRows(row + rowSpan)
      for (let column = 0; column <= panelColumns - columnSpan; column += 1) {
        if (!canPlace(row, column, columnSpan, rowSpan)) {
          continue
        }
        markPlaced(row, column, columnSpan, rowSpan)
        placed = true
        break
      }
      row += 1
    }
  }

  return maxRows
}

const getPanelBodyMetrics = (
  totalSlotCount: number,
  groups: RoomControlGroup[] = [],
): PanelBodyMetrics => {
  const baseMetrics = getCanonicalPanelGridMetrics(totalSlotCount)
  const minimumGroupColumns =
    groups.length > 0
      ? Math.min(
          PANEL_MAX_COLUMNS,
          Math.max(
            ...groups.map((group) => Math.min(PANEL_MAX_COLUMNS, getMinimumGroupPanelSlots(group))),
          ),
        )
      : 1
  let columns = Math.max(baseMetrics.columns, minimumGroupColumns)
  let rows = groups.length > 0 ? getPackedPanelRowCount(groups, columns) : baseMetrics.rows

  if (groups.length > 0 && rows > baseMetrics.rows) {
    let bestColumns = columns
    let bestRows = rows

    for (
      let candidateColumns = columns + 1;
      candidateColumns <= PANEL_MAX_COLUMNS;
      candidateColumns += 1
    ) {
      const candidateRows = getPackedPanelRowCount(groups, candidateColumns)
      if (candidateRows < bestRows) {
        bestColumns = candidateColumns
        bestRows = candidateRows
      }
      if (candidateRows <= baseMetrics.rows) {
        bestColumns = candidateColumns
        bestRows = candidateRows
        break
      }
    }

    columns = bestColumns
    rows = bestRows
  }

  const bodyWidth = columns * CONTROL_ICON_BUTTON_SIZE + Math.max(columns - 1, 0) * PANEL_GRID_GAP
  const bodyHeight = rows * CONTROL_ICON_BUTTON_SIZE + Math.max(rows - 1, 0) * PANEL_GRID_GAP
  return { bodyHeight, bodyWidth, columns, rows }
}

const getPanelBodyGridStyle = (
  totalSlotCount: number,
  groups: RoomControlGroup[],
): CSSProperties => {
  const { columns } = getPanelBodyMetrics(totalSlotCount, groups)
  return {
    ...panelBodyStyle,
    gridTemplateColumns: `repeat(${columns}, ${CONTROL_ICON_BUTTON_SIZE}px)`,
  }
}

const getClosedPanelWidth = (roomName: string) => {
  const normalizedName = roomName.trim() || 'Room'
  const estimatedWidth =
    PANEL_HORIZONTAL_PADDING * 2 + normalizedName.length * PANEL_CLOSED_CHAR_WIDTH
  return Math.max(PANEL_CLOSED_MIN_WIDTH, Math.min(PANEL_CLOSED_MAX_WIDTH, estimatedWidth))
}

const getOverlayItemStyle = (isOpen: boolean, isEditing: boolean): CSSProperties => ({
  ...overlayItemStyle,
  zIndex: isEditing ? 40 : isOpen ? 30 : 10,
})

const getRoomPanelCenterDistanceRatio = (
  x: number,
  panelTop: number,
  panelHeight: number,
  size: { height: number; width: number },
) => {
  const halfWidth = Math.max(1, size.width / 2)
  const halfHeight = Math.max(1, size.height / 2)
  const panelCenterX = x
  const panelCenterY = panelTop + panelHeight / 2
  const normalizedX = (panelCenterX - halfWidth) / halfWidth
  const normalizedY = (panelCenterY - halfHeight) / halfHeight

  return Math.hypot(normalizedX, normalizedY)
}

const isRoomPanelInsideViewportMargin = (
  x: number,
  panelTop: number,
  panelWidth: number,
  panelHeight: number,
  size: { height: number; width: number },
) => {
  const panelLeft = x - panelWidth / 2
  const panelRight = x + panelWidth / 2
  const panelBottom = panelTop + panelHeight

  return (
    panelRight >= -OFFSCREEN_MARGIN &&
    panelLeft <= size.width + OFFSCREEN_MARGIN &&
    panelBottom >= -OFFSCREEN_MARGIN &&
    panelTop <= size.height + OFFSCREEN_MARGIN
  )
}

const getRoomPanelMetrics = (
  open: boolean,
  groups: RoomControlGroup[],
  totalSlotCount: number,
  roomName: string,
  iconOnly = false,
) => {
  if (!open) {
    return {
      height: PANEL_CLOSED_HEIGHT,
      width: iconOnly ? DEVICE_ICON_PILL_WIDTH : getClosedPanelWidth(roomName),
    }
  }

  if (totalSlotCount <= 0) {
    return {
      height: PANEL_HEADER_HEIGHT + PANEL_BODY_PADDING * 2 + CONTROL_ICON_BUTTON_SIZE,
      width: PANEL_OPEN_MIN_WIDTH,
    }
  }

  const { bodyHeight, bodyWidth } = getPanelBodyMetrics(totalSlotCount, groups)

  return {
    height: PANEL_HEADER_HEIGHT + PANEL_BODY_PADDING * 2 + bodyHeight,
    width: Math.max(PANEL_OPEN_MIN_WIDTH, PANEL_BODY_PADDING * 2 + bodyWidth),
  }
}

const reconcileGroupOrder = (previous: string[], next: string[]) => {
  const nextSet = new Set(next)
  const ordered = previous.filter((groupId) => nextSet.has(groupId))
  for (const groupId of next) {
    if (!ordered.includes(groupId)) {
      ordered.push(groupId)
    }
  }
  return ordered
}

const moveGroupIdRelative = (
  groupIds: string[],
  sourceGroupId: string,
  targetGroupId: string,
  placeAfter: boolean,
) => {
  const sourceIndex = groupIds.indexOf(sourceGroupId)
  const targetIndex = groupIds.indexOf(targetGroupId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return groupIds
  }

  const next = [...groupIds]
  next.splice(sourceIndex, 1)
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  next.splice(adjustedTargetIndex + (placeAfter ? 1 : 0), 0, sourceGroupId)
  return next
}

const isPointerInMergeHotspot = (pointerX: number, pointerY: number, element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  const insetX = rect.width * MERGE_HOTSPOT_INSET_RATIO
  const insetY = rect.height * MERGE_HOTSPOT_INSET_RATIO
  return (
    pointerX >= rect.left + insetX &&
    pointerX <= rect.right - insetX &&
    pointerY >= rect.top + insetY &&
    pointerY <= rect.bottom - insetY
  )
}

const getDeviceDropTargetCollectionId = (
  pointerX: number,
  pointerY: number,
  sourceCollectionId: CollectionId,
) => {
  if (typeof document === 'undefined') {
    return null
  }

  const targetElement = document
    .elementFromPoint(pointerX, pointerY)
    ?.closest('[data-room-control-collection-id]') as HTMLElement | null
  const targetCollectionId = targetElement?.dataset.roomControlCollectionId as
    | CollectionId
    | undefined

  return targetCollectionId && targetCollectionId !== sourceCollectionId ? targetCollectionId : null
}

const getSliderPointerRatio = (clientX: number, element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0) {
    return 0
  }
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}

const getGroupPanelFootprintSize = (group: RoomControlGroup, panelColumns: number) => {
  const { columnSpan, rowSpan } = getGroupPanelSpan(group, panelColumns)
  return {
    height: rowSpan * CONTROL_ICON_BUTTON_SIZE + Math.max(rowSpan - 1, 0) * PANEL_GRID_GAP,
    width: columnSpan * CONTROL_ICON_BUTTON_SIZE + Math.max(columnSpan - 1, 0) * PANEL_GRID_GAP,
  }
}

const getGroupPanelFootprintStyle = (
  group: RoomControlGroup,
  panelColumns: number,
): CSSProperties => {
  const { columnSpan, rowSpan } = getGroupPanelSpan(group, panelColumns)
  return {
    alignSelf: 'stretch',
    gridColumn: `span ${columnSpan}`,
    gridRow: `span ${rowSpan}`,
    height: '100%',
    justifySelf: 'stretch',
    minHeight: CONTROL_ICON_BUTTON_SIZE,
    minWidth: CONTROL_ICON_BUTTON_SIZE,
    width: '100%',
  }
}

const getExpandedGroupMemberLayout = (
  group: RoomControlGroup,
  panelColumns: number,
): ExpandedGroupMemberLayout => {
  const footprint = getGroupPanelFootprintSize(group, panelColumns)
  const { columnSpan, rowSpan } = getGroupPanelSpan(group, panelColumns)
  const usableWidth = Math.max(
    footprint.width - EXPANDED_GROUP_PADDING * 2,
    CONTROL_ICON_BUTTON_SIZE,
  )
  const usableHeight = Math.max(
    footprint.height - EXPANDED_GROUP_PADDING * 2,
    CONTROL_ICON_BUTTON_SIZE,
  )
  const maxColumns = Math.max(1, Math.min(group.members.length, columnSpan))
  let bestColumns = maxColumns
  let bestButtonSize = 0

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = Math.ceil(group.members.length / columns)
    if (rows > rowSpan) {
      continue
    }
    const buttonWidth = (usableWidth - Math.max(columns - 1, 0) * EXPANDED_GROUP_GAP) / columns
    const buttonHeight = (usableHeight - Math.max(rows - 1, 0) * EXPANDED_GROUP_GAP) / rows
    const buttonSize = Math.min(buttonWidth, buttonHeight)
    if (buttonSize >= bestButtonSize) {
      bestButtonSize = buttonSize
      bestColumns = columns
    }
  }

  return {
    buttonSize: Math.max(MIN_EXPANDED_GROUP_MEMBER_BUTTON_SIZE, Math.floor(bestButtonSize)),
    columns: bestColumns,
  }
}

const getExpandedGroupMemberGlyphStyle = (buttonSize: number): CSSProperties => ({
  ...iconGlyphWrapStyle,
  transform:
    buttonSize < CONTROL_ICON_BUTTON_SIZE
      ? `scale(${Math.max(0.9, buttonSize / CONTROL_ICON_BUTTON_SIZE)})`
      : undefined,
})

const getExpandedGroupEditTileStyle = (
  group: RoomControlGroup,
  panelColumns: number,
  mergeTarget: boolean,
): CSSProperties => ({
  ...getEditTileStyle(group, panelColumns, false, mergeTarget, false),
  cursor: 'default',
  padding: EXPANDED_GROUP_PADDING,
})

const getExpandedGroupMemberGridStyle = (
  memberLayout: ExpandedGroupMemberLayout,
): CSSProperties => ({
  display: 'grid',
  gap: EXPANDED_GROUP_GAP,
  gridTemplateColumns: `repeat(${memberLayout.columns}, ${memberLayout.buttonSize}px)`,
  justifyContent: 'center',
  alignContent: 'center',
  width: '100%',
  height: '100%',
})

const getExpandedGroupMemberButtonStyle = (
  buttonSize: number,
  dragging: boolean,
): CSSProperties => ({
  boxSizing: 'border-box',
  width: buttonSize,
  height: buttonSize,
  borderRadius: 8,
  border: '1px solid rgba(92,98,108,0.48)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(232,236,242,0.98) 100%)',
  boxShadow: 'inset -2px 0 0 rgba(92,98,108,0.62), 0 4px 12px rgba(0,0,0,0.08)',
  color: 'rgba(31,41,55,0.92)',
  cursor: dragging ? 'grabbing' : 'grab',
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  opacity: dragging ? 0.12 : 1,
})

const getControlGlyphContainerStyle = (hasIntensity: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  transform: hasIntensity ? 'translateY(2px)' : undefined,
})

const getCountBadgeStyle = (itemKind: string, active: boolean): CSSProperties => {
  const accentRgb = getAccentRgb(itemKind)
  return {
    ...iconCountBadgeStyle,
    background: active ? 'rgba(255,255,255,0.72)' : `rgba(${accentRgb},0.18)`,
    color: active ? 'rgba(18,20,24,0.84)' : `rgba(${scaleRgb(accentRgb, 0.62)},1)`,
  }
}

const getMixedGroupBackground = (group: RoomControlGroup, strong: boolean) => {
  const segments = getGroupVisualSegments(group)
  if (segments.length <= 1) {
    return null
  }

  const alpha = strong ? 0.94 : 0.2
  const stops = segments
    .map((segment, index) => {
      const start = (index / segments.length) * 100
      const end = ((index + 1) / segments.length) * 100
      const rgb = strong
        ? scaleRgb(getAccentRgb(segment.itemKind), 1.02)
        : getAccentRgb(segment.itemKind)
      return `rgba(${rgb},${alpha}) ${start}%, rgba(${rgb},${alpha}) ${end}%`
    })
    .join(', ')

  const sheen = strong
    ? 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%)'
    : 'linear-gradient(180deg, rgba(255,255,255,0.74) 0%, rgba(255,255,255,0.18) 100%)'

  return `${sheen}, linear-gradient(90deg, ${stops})`
}

const getToggleTileStyle = (
  group: RoomControlGroup,
  panelColumns: number,
  allOn: boolean,
  anyOn: boolean,
  hasIntensity: boolean,
  disabled = false,
): CSSProperties => {
  const accentRgb = getAccentRgb(getGroupItemKind(group))
  const accentFillRgb = scaleRgb(accentRgb, 1.1)
  const accentEdgeRgb = scaleRgb(accentRgb, 1.32)
  const mutedAccentRgb = scaleRgb(accentRgb, 0.56)
  const mixedBackground = getMixedGroupBackground(group, allOn || anyOn)
  const isMixed = Boolean(mixedBackground)

  if (disabled) {
    return {
      ...compactControlButtonStyle,
      ...getGroupPanelFootprintStyle(group, panelColumns),
      border: '1px solid rgba(148,163,184,0.22)',
      background: 'linear-gradient(180deg, rgba(226,229,234,0.66) 0%, rgba(206,211,219,0.68) 100%)',
      boxShadow: 'none',
      color: 'rgba(92,98,108,0.58)',
      cursor: 'not-allowed',
      opacity: 0.68,
      paddingBottom: hasIntensity ? INTENSITY_CONTENT_BOTTOM_OFFSET : 0,
    }
  }

  return {
    ...compactControlButtonStyle,
    ...getGroupPanelFootprintStyle(group, panelColumns),
    border: isMixed
      ? '1px solid rgba(92,98,108,0.7)'
      : `1px solid rgba(${allOn || anyOn ? accentEdgeRgb : mutedAccentRgb},1)`,
    background:
      mixedBackground ??
      (allOn || anyOn
        ? `linear-gradient(180deg, rgba(${accentFillRgb},1) 0%, rgba(${accentRgb},1) 100%)`
        : 'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(230,233,239,0.92) 100%)'),
    boxShadow: isMixed
      ? 'inset -3px 0 0 rgba(92,98,108,0.78), 0 8px 18px rgba(0,0,0,0.14)'
      : allOn || anyOn
        ? `inset 4px 0 0 rgba(${accentEdgeRgb},1), 0 8px 18px rgba(0,0,0,0.18)`
        : 'inset -3px 0 0 rgba(92,98,108,0.85), 0 8px 18px rgba(0,0,0,0.1)',
    color: allOn || anyOn ? 'rgba(18,20,24,0.96)' : 'rgba(31,41,55,0.92)',
    cursor: 'pointer',
    paddingBottom: hasIntensity ? INTENSITY_CONTENT_BOTTOM_OFFSET : 0,
  }
}

const getAdjustableTileStyle = (
  group: RoomControlGroup,
  panelColumns: number,
  hasIntensity: boolean,
  disabled = false,
): CSSProperties => {
  const accentRgb = getAccentRgb(getGroupItemKind(group))
  const mutedAccentRgb = scaleRgb(accentRgb, 0.52)
  const mixedBackground = getMixedGroupBackground(group, false)
  const isMixed = Boolean(mixedBackground)

  if (disabled) {
    return {
      ...compactControlButtonStyle,
      ...getGroupPanelFootprintStyle(group, panelColumns),
      border: '1px solid rgba(148,163,184,0.22)',
      background: 'linear-gradient(180deg, rgba(226,229,234,0.66) 0%, rgba(206,211,219,0.68) 100%)',
      boxShadow: 'none',
      color: 'rgba(92,98,108,0.58)',
      cursor: 'not-allowed',
      opacity: 0.68,
      paddingBottom: hasIntensity ? INTENSITY_CONTENT_BOTTOM_OFFSET : 0,
    }
  }

  return {
    ...compactControlButtonStyle,
    ...getGroupPanelFootprintStyle(group, panelColumns),
    border: isMixed ? '1px solid rgba(92,98,108,0.62)' : `1px solid rgba(${mutedAccentRgb},0.78)`,
    background:
      mixedBackground ??
      'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(230,233,239,0.96) 100%)',
    boxShadow: isMixed
      ? 'inset -3px 0 0 rgba(92,98,108,0.72), 0 8px 18px rgba(0,0,0,0.1)'
      : 'inset -3px 0 0 rgba(92,98,108,0.75), 0 8px 18px rgba(0,0,0,0.1)',
    color: 'rgba(31,41,55,0.92)',
    cursor: 'pointer',
    paddingBottom: hasIntensity ? INTENSITY_CONTENT_BOTTOM_OFFSET : 0,
  }
}

const getEditWobbleDelayMs = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 211
  }
  return -(hash % 180)
}

const getEditTileStyle = (
  group: RoomControlGroup,
  panelColumns: number,
  dragging: boolean,
  mergeTarget: boolean,
  animated: boolean,
): CSSProperties => ({
  ...editTileStyle,
  ...getGroupPanelFootprintStyle(group, panelColumns),
  animation:
    !dragging && !mergeTarget
      ? 'room-panel-edit-wobble 172ms ease-in-out infinite alternate'
      : 'none',
  animationDelay: !dragging && !mergeTarget ? `${getEditWobbleDelayMs(group.id)}ms` : undefined,
  border: mergeTarget ? '1px solid rgba(59,130,246,1)' : '1px solid rgba(92,98,108,0.55)',
  boxShadow: mergeTarget
    ? 'inset -3px 0 0 rgba(92,98,108,0.75), 0 0 0 1px rgba(59,130,246,0.82), 0 0 0 3px rgba(59,130,246,0.14), 0 10px 22px rgba(37,99,235,0.18)'
    : 'inset -3px 0 0 rgba(92,98,108,0.75), 0 8px 18px rgba(0,0,0,0.1)',
  cursor: dragging ? 'grabbing' : 'grab',
  opacity: dragging ? 0.08 : 1,
  outline: mergeTarget ? '1px solid rgba(59,130,246,0.72)' : 'none',
  outlineOffset: mergeTarget ? 1 : 0,
  pointerEvents: dragging ? 'none' : 'auto',
  touchAction: 'none',
  transform: mergeTarget ? 'scale(1.08)' : undefined,
  transition:
    dragging || !animated
      ? 'none'
      : 'transform 160ms ease, opacity 120ms linear, box-shadow 160ms ease',
  zIndex: mergeTarget ? 2 : 1,
})

const getEditGhostStyle = (
  group: RoomControlGroup,
  member: RoomControlTile | null,
  panelColumns: number,
  mergeReady: boolean,
): CSSProperties => ({
  ...editTileStyle,
  ...(member
    ? {
        width: Math.max(26, CONTROL_ICON_BUTTON_SIZE - 8),
        height: Math.max(26, CONTROL_ICON_BUTTON_SIZE - 8),
      }
    : getGroupPanelFootprintSize(group, panelColumns)),
  border: mergeReady ? '1px solid rgba(59,130,246,1)' : editTileStyle.border,
  boxShadow: mergeReady
    ? 'inset -3px 0 0 rgba(92,98,108,0.75), 0 0 0 1px rgba(59,130,246,0.82), 0 0 0 3px rgba(59,130,246,0.14), 0 14px 28px rgba(37,99,235,0.18)'
    : 'inset -3px 0 0 rgba(92,98,108,0.75), 0 12px 24px rgba(0,0,0,0.16)',
  cursor: 'grabbing',
  outline: mergeReady ? '1px solid rgba(59,130,246,0.72)' : 'none',
  outlineOffset: mergeReady ? 1 : 0,
})

const getCollapsedDirectToggleButtonStyle = (
  member: RoomControlTile | null,
  active: boolean,
  disabled = false,
  iconOnly = false,
  fallbackItemKind = 'item',
): CSSProperties => {
  if (iconOnly) {
    return getIconOnlyDevicePillButtonStyle(member, active, disabled)
  }

  if (disabled) {
    return {
      ...collapsedHeaderButtonStyle,
      borderRadius: 16,
      background: 'rgba(148,163,184,0.18)',
      boxShadow: 'none',
      color: 'rgba(92,98,108,0.58)',
      cursor: 'not-allowed',
    }
  }

  const itemKind = member && member.control.kind === 'toggle' ? member.itemKind : fallbackItemKind

  if (!active && !(member && member.control.kind === 'toggle')) {
    return collapsedHeaderButtonStyle
  }

  const accentRgb = getAccentRgb(itemKind)
  const accentFillRgb = scaleRgb(accentRgb, 1.08)
  const accentEdgeRgb = scaleRgb(accentRgb, 1.26)

  return {
    ...collapsedHeaderButtonStyle,
    borderRadius: 16,
    background: active
      ? `linear-gradient(180deg, rgba(${accentFillRgb},1) 0%, rgba(${accentRgb},1) 100%)`
      : 'transparent',
    boxShadow: active ? `inset 4px 0 0 rgba(${accentEdgeRgb},1)` : 'none',
    color: active ? 'rgba(18,20,24,0.96)' : 'rgba(31,41,55,0.92)',
  }
}

const getIconOnlyDevicePillButtonStyle = (
  member: RoomControlTile | null,
  active: boolean,
  disabled: boolean,
): CSSProperties => {
  if (disabled || !member) {
    return {
      ...iconOnlyPillButtonStyle,
      borderRadius: 16,
      background: 'rgba(148,163,184,0.18)',
      boxShadow: 'none',
      color: 'rgba(92,98,108,0.58)',
      cursor: 'not-allowed',
    }
  }

  const accentRgb = getAccentRgb(member.itemKind)
  const accentFillRgb = scaleRgb(accentRgb, 1.08)
  const accentEdgeRgb = scaleRgb(accentRgb, 1.26)

  return {
    ...iconOnlyPillButtonStyle,
    borderRadius: 16,
    background: active
      ? `linear-gradient(180deg, rgba(${accentFillRgb},1) 0%, rgba(${accentRgb},1) 100%)`
      : `linear-gradient(180deg, rgba(${accentRgb},0.22) 0%, rgba(${accentRgb},0.14) 100%)`,
    boxShadow: active ? `inset 4px 0 0 rgba(${accentEdgeRgb},1)` : 'none',
    color: active ? 'rgba(18,20,24,0.96)' : `rgba(${scaleRgb(accentRgb, 0.58)},1)`,
  }
}

const setOverlayDomRef = <
  T extends keyof OverlayDomRefs,
  E extends Exclude<OverlayDomRefs[T], null>,
>(
  refs: Record<string, OverlayDomRefs>,
  id: string,
  key: T,
  element: E | null,
) => {
  if (!refs[id]) {
    refs[id] = { endpoint: null, line: null, panel: null }
  }
  refs[id][key] = element
}

const applyOverlayLayout = (refs: OverlayDomRefs | undefined, layout: OverlayLayout) => {
  if (!refs) {
    return
  }

  const lineStartX = layout.x
  const lineTop = layout.panelTop + layout.panelHeight + LINE_GAP
  const lineEndMargin = layout.lineEndMargin ?? LINE_END_MARGIN
  const rawEndpointY =
    layout.endpointY === undefined
      ? Math.max(lineTop, layout.y - lineEndMargin)
      : layout.endpointY - lineEndMargin
  const lineLengthRatio = Math.max(0, Math.min(1, layout.lineLengthRatio ?? 1))
  const endpointX = lineStartX
  const endpointY = lineTop + (rawEndpointY - lineTop) * lineLengthRatio
  const lineHeight = Math.max(endpointY - lineTop, 0)
  const lineVisible = layout.visible && lineHeight > 0

  if (refs.panel) {
    refs.panel.style.left = `${layout.x}px`
    refs.panel.style.top = `${layout.panelTop}px`
    refs.panel.style.width = `${layout.panelWidth}px`
    refs.panel.style.height = `${layout.panelHeight}px`
    refs.panel.style.opacity = `${layout.opacity}`
    refs.panel.style.visibility = layout.visible ? 'visible' : 'hidden'
    refs.panel.style.pointerEvents = layout.visible ? 'auto' : 'none'
    refs.panel.style.transform = 'translateX(-50%)'
  }

  if (refs.line) {
    refs.line.style.left = `${Math.round(lineStartX)}px`
    refs.line.style.top = `${lineTop}px`
    refs.line.style.height = `${lineHeight}px`
    refs.line.style.opacity = lineVisible ? `${layout.opacity}` : '0'
    refs.line.style.transform = 'none'
    refs.line.style.visibility = lineVisible ? 'visible' : 'hidden'
  }

  if (refs.endpoint) {
    refs.endpoint.style.left = `${Math.round(endpointX)}px`
    refs.endpoint.style.top = `${endpointY}px`
    refs.endpoint.style.opacity = lineVisible ? `${layout.opacity}` : '0'
    refs.endpoint.style.visibility = lineVisible ? 'visible' : 'hidden'
  }
}

const areLayoutsClose = (previous: OverlayLayout | undefined, next: OverlayLayout) => {
  if (!previous) {
    return false
  }
  if (previous.visible !== next.visible) {
    return false
  }
  if (Math.abs(previous.x - next.x) > POSITION_EPSILON) {
    return false
  }
  if (Math.abs(previous.y - next.y) > POSITION_EPSILON) {
    return false
  }
  if (Math.abs(previous.panelTop - next.panelTop) > POSITION_EPSILON) {
    return false
  }
  if (Math.abs(previous.panelWidth - next.panelWidth) > POSITION_EPSILON) {
    return false
  }
  if (Math.abs(previous.panelHeight - next.panelHeight) > POSITION_EPSILON) {
    return false
  }
  if (Math.abs(previous.opacity - next.opacity) > 0.01) {
    return false
  }
  if (
    Math.abs((previous.endpointX ?? previous.x) - (next.endpointX ?? next.x)) > POSITION_EPSILON
  ) {
    return false
  }
  if (
    Math.abs((previous.endpointY ?? previous.y) - (next.endpointY ?? next.y)) > POSITION_EPSILON
  ) {
    return false
  }
  return true
}
