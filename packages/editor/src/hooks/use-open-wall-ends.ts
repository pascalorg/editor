'use client'

import { type AnyNode, findOpenWallEnds, type OpenWallEnd, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  collapseMutualOpenWallEnds,
  joinOpenWallEnd,
  openWallEndKey,
  visibleOpenWallEnds,
} from '../lib/floorplan/open-wall-ends'
import { sfxEmitter } from '../lib/sfx-bus'
import useEditor from '../store/use-editor'
import { useFloorplanDraftPreview } from '../store/use-floorplan-draft-preview'
import useInteractionScope from '../store/use-interaction-scope'

type Boundary = Extract<AnyNode, { type: 'wall' | 'separator' }>

const NO_ENDS: OpenWallEnd[] = []

let lastAnalysis: {
  levelId: string
  boundaries: readonly Boundary[]
  ends: OpenWallEnd[]
} | null = null

/**
 * The room-graph pass behind the open-end markers, shared by the floor plan
 * and the 3D view: split view mounts both, and they must not pay for it twice.
 * Recomputed only when the level's walls or separators change (compared by
 * node reference), never per frame.
 */
export function analyseOpenWallEnds(
  levelId: string,
  boundaries: readonly Boundary[],
): OpenWallEnd[] {
  const last = lastAnalysis
  if (
    last &&
    last.levelId === levelId &&
    last.boundaries.length === boundaries.length &&
    last.boundaries.every((node, index) => node === boundaries[index])
  ) {
    return last.ends
  }
  const ends = findOpenWallEnds(
    Object.fromEntries(boundaries.map((node) => [node.id, node])),
    levelId,
  )
  lastAnalysis = { levelId, boundaries, ends }
  return ends
}

/** Moving, placing, reshaping or dragging a handle: the markers step aside. */
export function useOpenWallEndsSuppressed(): boolean {
  return useInteractionScope(
    (state) =>
      state.scope.kind === 'moving' ||
      state.scope.kind === 'placing' ||
      state.scope.kind === 'reshaping' ||
      state.scope.kind === 'handle-drag',
  )
}

export type OpenWallEndsState = {
  /** The wall tool (any variant) or Divide is active. */
  drawing: boolean
  /** A wall or divide segment is mid-draft: markers stay visible but out of the way. */
  drafting: boolean
  /** Ends to mark, mutual pairs collapsed to the end that slides straight. */
  ends: OpenWallEnd[]
  /** Walls on the active level that bound no room. */
  roomlessWallIds: string[]
  /** Whether the overlay is up at all (drawing, or a near miss to show). */
  shown: boolean
}

/**
 * Open wall ends on the active level and when to show them. On while walls or
 * rooms are being drawn; otherwise only when a wall that bounds no room has a
 * near miss.
 */
export function useOpenWallEnds(): OpenWallEndsState {
  const levelId = useViewer((state) => state.selection.levelId)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const spaces = useEditor(
    useShallow((state) => Object.values(state.spaces).filter((space) => space.levelId === levelId)),
  )
  const isDividing = useInteractionScope((state) => state.scope.kind === 'room-divide')
  const dividingDraft = useInteractionScope(
    (state) => state.scope.kind === 'room-divide' && state.scope.points.length > 0,
  )
  const wallDrafting = useFloorplanDraftPreview(
    (state) =>
      state.wallDraftStart !== null ||
      state.wallRectangleDraftStart !== null ||
      state.wallPolygonDraftPoints.length > 0,
  )
  const boundaries = useScene(
    useShallow((state) => {
      const level = levelId ? state.nodes[levelId as AnyNode['id']] : undefined
      if (level?.type !== 'level') return [] as Boundary[]
      return level.children
        .map((id) => state.nodes[id])
        .filter((node): node is Boundary => node?.type === 'wall' || node?.type === 'separator')
    }),
  )

  const drawing = (mode === 'build' && tool === 'wall') || isDividing
  const roomWallIds = useMemo(() => {
    const ids = new Set<string>()
    for (const space of spaces) for (const wallId of space.wallIds) ids.add(wallId)
    return ids
  }, [spaces])
  const roomlessWallIds = useMemo(
    () =>
      boundaries
        .filter((node) => node.type === 'wall' && !roomWallIds.has(node.id))
        .map((node) => node.id as string),
    [boundaries, roomWallIds],
  )
  const hasWalls = boundaries.some((node) => node.type === 'wall')
  const shouldAnalyse = !!levelId && hasWalls && (drawing || roomlessWallIds.length > 0)
  const openEnds = useMemo(
    () => (shouldAnalyse && levelId ? analyseOpenWallEnds(levelId, boundaries) : NO_ENDS),
    [shouldAnalyse, levelId, boundaries],
  )
  const ends = useMemo(() => {
    const walls = new Map(boundaries.map((node) => [node.id as string, node]))
    return collapseMutualOpenWallEnds(
      visibleOpenWallEnds(openEnds, roomWallIds, drawing),
      (wallId) => {
        const wall = walls.get(wallId)
        return wall?.type === 'wall'
          ? [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
          : null
      },
    )
  }, [openEnds, roomWallIds, drawing, boundaries])

  return {
    drawing,
    drafting: wallDrafting || dividingDraft,
    ends,
    roomlessWallIds,
    shown: drawing || ends.length > 0,
  }
}

const HOVER_RELEASE_MS = 250

function clearReleaseTimer(timer: { current: ReturnType<typeof setTimeout> | null }) {
  if (timer.current) clearTimeout(timer.current)
  timer.current = null
}

/**
 * Hover / pin / join for one view's markers — the floor plan and the 3D view
 * each keep their own, so hovering a dot in one does not pop a pill in the
 * other. A pinned pill closes on Escape or a press outside any
 * `[data-open-wall-end]` element.
 */
export function useOpenWallEndFocus(ends: readonly OpenWallEnd[], drafting: boolean) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<{ key: string; message: string } | null>(null)
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => clearReleaseTimer(releaseTimer)
  useEffect(() => () => clearReleaseTimer(releaseTimer), [])

  const activeKey = pinnedKey ?? hoveredKey
  const activeEnd = drafting
    ? null
    : (ends.find((end) => end.candidate && openWallEndKey(end) === activeKey) ?? null)

  useEffect(() => {
    if (!pinnedKey) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-open-wall-end]')) return
      setPinnedKey(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [pinnedKey])

  useEffect(() => {
    if (!activeEnd) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      clearReleaseTimer(releaseTimer)
      setPinnedKey(null)
      setHoveredKey(null)
      setRefusal(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeEnd])

  return {
    activeKey,
    activeEnd,
    refusal: activeEnd && refusal?.key === openWallEndKey(activeEnd) ? refusal.message : null,
    keepHover: (key: string) => {
      clearTimer()
      setHoveredKey(key)
    },
    releaseHover: () => {
      clearTimer()
      releaseTimer.current = setTimeout(() => setHoveredKey(null), HOVER_RELEASE_MS)
    },
    togglePin: (key: string) => setPinnedKey((current) => (current === key ? null : key)),
    pin: (key: string) => setPinnedKey(key),
    join: (end: OpenWallEnd) => {
      const key = openWallEndKey(end)
      const message = joinOpenWallEnd(end)
      setRefusal(message ? { key, message } : null)
      if (message) return
      sfxEmitter.emit('sfx:structure-build')
      setPinnedKey(null)
      setHoveredKey(null)
    },
  }
}
