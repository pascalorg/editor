import {
  type AnyNode,
  type AnyNodeId,
  type WallNode,
  ZoneNode,
  type ZoneNode as ZoneNodeType,
} from '../schema'
import { generateId } from '../schema/base'
import { findLevelAboveId, getLevelBelow, getLevelElevations } from '../services/storey'
import {
  activeSceneCommitNodeIds,
  getSceneHistoryPauseDepth,
  isRestoringSceneHistory,
  notifySceneCommit,
  pauseSceneHistory,
  resumeSceneHistory,
  subscribeSceneCommits,
} from '../store/history-control'
import { getClampedWallCurveOffset } from '../systems/wall/wall-curve'
import { changedLevelConstructionDisplacements } from './floor-foundation-stack'
import { createFloorOpeningIndex, floorOpeningTargets } from './floor-opening-intent'
import {
  type ExtractedRoom,
  extractRooms,
  pointToTuple,
  polygonSignature,
  type SpaceBoundaryFace,
  sampleWallPointsForRoomDetection,
  WALL_JUNCTION_TOLERANCE,
} from './room-graph'
import { type BoundaryNode, distanceToSegment, RoomTopologyIndex } from './room-topology-index'
import { applyStructureReconciliation } from './structure-commit'
import { classifyWallSides } from './structure-kernel'
import type { StructureIdFactory } from './structure-reconcile'
import { levelBaseElevationAt } from './terrain-support-query'

export function wallClosesRoom(walls: WallNode[], wall: WallNode): boolean {
  return extractRooms(walls).some((room) => room.spans.some((span) => span.boundaryId === wall.id))
}

const DEFAULT_AUTO_SLAB_ELEVATION = 0.05

export { type ExtractedRoom, extractRooms, type SpaceBoundaryFace } from './room-graph'

export type Space = {
  id: string
  levelId: string
  polygon: Array<[number, number]>
  holes?: Array<Array<[number, number]>>
  wallIds: Array<WallNode['id']>
  boundaryFaces: SpaceBoundaryFace[]
  isExterior: boolean
}

export type SpaceTopologyReconcileEvent = {
  levelId: string
  strategy: 'indexed' | 'fallback'
  examinedWallIds: string[]
  affectedBeforeRoomCount: number
  affectedCurrentRoomCount: number
}

export type SpaceDetectionSyncOptions = {
  mintId?: StructureIdFactory
  onTopologyReconcile?: (event: SpaceTopologyReconcileEvent) => void
}

type WallSideUpdate = {
  wallId: string
  frontSide: 'interior' | 'exterior' | 'unknown'
  backSide: 'interior' | 'exterior' | 'unknown'
}

function wallGeometrySignature(wall: WallNode, nodes: Record<string, any>, levelId: string) {
  return [
    wall.id,
    wall.start[0].toFixed(4),
    wall.start[1].toFixed(4),
    wall.end[0].toFixed(4),
    wall.end[1].toFixed(4),
    (wall.thickness ?? 0.2).toFixed(4),
    wall.justification,
    JSON.stringify(
      (wall.children ?? [])
        .map((id) => nodes[id])
        .filter((node) => node?.type === 'door' || node?.type === 'window')
        .map((node) => [node.id, node.position, node.width, node.height, node.verticalAnchor]),
    ),
    // Plane-bound (no stored height) is a distinct state, not a default
    // value: it resolves to the storey plane, so it must not alias an
    // explicit height of the same magnitude in the trigger signature.
    wall.height == null ? 'plane' : wall.height.toFixed(4),
    wall.supportSlabId ?? 'elected',
    (wall.supportOffset ?? 0).toFixed(4),
    getClampedWallCurveOffset(wall).toFixed(4),
    // The ground under this wall, sampled at the SAME point
    // `boundaryWallBase` samples it. Sculpting changes only `site.terrain`,
    // so without a terrain term here every signature stays byte-identical
    // and the sync early-exits — a room's floor and ceiling could never
    // follow ground that moved beneath its walls.
    //
    // The sample, not the field, and not the resolved base: hashing the
    // heightfield would re-trigger every level for a stroke on the far side
    // of the lot, and resolving the full slab election would fold slab
    // POLYGONS into the signature, which is exactly the delete/recreate
    // feedback the comment below is about. Sampling where the placement
    // samples means the two cannot disagree in either direction — no missed
    // re-run, no spurious one.
    //
    // Granularity is per stroke, not per dab: live dabs publish to
    // `useLiveTerrain` and never touch the scene store, so this runs once on
    // release — inside the stroke's own `runAsSingleSceneHistoryStep`, which
    // is what puts the moved floor and the terrain that moved it in the same
    // undo step. Mid-drag the ground-hosted walls follow the brush while the
    // floor waits for release; re-deriving per dab would mean a scene write
    // per dab and a floor that jitters under the cursor.
    levelBaseElevationAt(nodes, levelId, wall.start[0], wall.start[1]).toFixed(4),
  ].join('|')
}

function levelWallSnapshot(walls: WallNode[], nodes: Record<string, any>, levelId: string) {
  return walls
    .map((wall) => wallGeometrySignature(wall, nodes, levelId))
    .sort()
    .join('||')
}

function zoneGeometrySignature(zone: ZoneNodeType) {
  return JSON.stringify([
    zone.id,
    zone.hasCeiling,
    zone.hasFloor,
    zone.floor,
    zone.wallMaterial,
    zone.wallOverrides,
    zone.seed,
    // A drawn zone's outline is intent (it may be adopted); a room's outline is
    // derived, and an edit to it must be re-derived here as the hosted path does.
    // The kernel's own write is not a change: the baseline is taken after it.
    [zone.polygon, zone.holes],
  ])
}

// Derived slab and ceiling footprints and boundary ids stay out of the trigger
// signature: hashing generated footprints caused delete/recreate feedback. Zone
// intent and outlines, separators, wall geometry and slab construction invalidate
// the kernel.
function levelStructureSnapshots(nodes: Record<string, any>) {
  const arrivalsByLevel = new Map<string, string[]>()
  const ceilingIdsByLevel = new Map<string, string[]>()
  const separatorsByLevel = new Map<string, string[]>()
  const wallsByLevel = new Map<string, WallNode[]>()
  const zonesByLevel = new Map<string, ZoneNodeType[]>()
  const slabElevationsByLevel = new Map<string, string[]>()
  const coveringUndersidesByLevel = new Map<string, string[]>()
  const floorOpenings: Extract<AnyNode, { type: 'floor-opening' }>[] = []

  for (const node of Object.values(nodes)) {
    if (!(node && typeof node === 'object' && 'parentId' in node && node.parentId)) continue
    const levelId = (node as any).parentId as string
    if (node.type === 'stair' && nodes[node.deckSlabId]?.support === 'open') {
      const target = nodes[node.deckSlabId].parentId
      const arrivals = arrivalsByLevel.get(target) ?? []
      arrivals.push(
        JSON.stringify([
          node.id,
          node.position,
          node.rotation,
          node.visible,
          node.stairType,
          node.width,
          node.innerRadius,
          node.sweepAngle,
          node.topLandingMode,
          node.topLandingDepth,
          node.children.map((id: string) => nodes[id]),
        ]),
      )
      arrivalsByLevel.set(target, arrivals)
    }
    if ((node as any).type === 'wall') {
      const walls = wallsByLevel.get(levelId) ?? []
      walls.push(node as WallNode)
      wallsByLevel.set(levelId, walls)
    } else if (node.type === 'ceiling') {
      const ids = ceilingIdsByLevel.get(levelId) ?? []
      ids.push(node.id)
      ceilingIdsByLevel.set(levelId, ids)
    } else if (node.type === 'separator') {
      const values = separatorsByLevel.get(levelId) ?? []
      values.push(JSON.stringify([node.id, node.start, node.end]))
      separatorsByLevel.set(levelId, values)
    } else if ((node as any).type === 'zone') {
      const zones = zonesByLevel.get(levelId) ?? []
      zones.push(ZoneNode.parse(node))
      zonesByLevel.set(levelId, zones)
    } else if (node.type === 'floor-opening') {
      floorOpenings.push(node)
    } else if ((node as any).type === 'slab') {
      const elevations = slabElevationsByLevel.get(levelId) ?? []
      elevations.push(
        JSON.stringify([
          node.id,
          node.elevation ?? DEFAULT_AUTO_SLAB_ELEVATION,
          node.thickness,
          node.recessed,
          node.fillToTerrain,
          node.floorHeight,
          node.foundation,
          node.boundary,
          node.autoFromWalls,
          node.boundary === 'auto'
            ? node.holes?.filter(
                (_: unknown, i: number) => node.holeMetadata?.[i]?.source !== 'room',
              )
            : [node.polygon, node.holes],
        ]),
      )
      slabElevationsByLevel.set(levelId, elevations)
      if ((node as any).recessed !== true) {
        const undersides = coveringUndersidesByLevel.get(levelId) ?? []
        const elevation = ((node as any).elevation as number | undefined) ?? 0.05
        const thickness = ((node as any).thickness as number | undefined) ?? 0.05
        undersides.push(`${(node as any).id}:${(elevation - thickness).toFixed(4)}`)
        coveringUndersidesByLevel.set(levelId, undersides)
      }
    }
  }

  const openingsByLevel = new Map<string, string[]>()
  if (floorOpenings.length) {
    const index = createFloorOpeningIndex(nodes)
    for (const opening of floorOpenings) {
      const signature = JSON.stringify([
        opening.id,
        opening.parentId,
        opening.polygon,
        opening.hostZoneId,
        opening.drawnOn,
        opening.cutsPrimary,
        opening.cutsAdjacent,
        opening.source,
        opening.ownerId,
        opening.legacyPlateCuts,
      ])
      for (const target of floorOpeningTargets(nodes, opening, index)) {
        const signatures = openingsByLevel.get(target.levelId) ?? []
        signatures.push(signature)
        openingsByLevel.set(target.levelId, signatures)
      }
    }
  }

  const levelElevations = getLevelElevations(nodes as Record<AnyNodeId, any>)
  const snapshots = new Map<string, string>()
  const levelIds = new Set([
    ...arrivalsByLevel.keys(),
    ...ceilingIdsByLevel.keys(),
    ...wallsByLevel.keys(),
    ...zonesByLevel.keys(),
    ...separatorsByLevel.keys(),
    ...openingsByLevel.keys(),
  ])
  for (const levelId of levelIds) {
    const walls = wallsByLevel.get(levelId) ?? []
    const zones = zonesByLevel.get(levelId) ?? []
    const level = nodes[levelId]
    const storeyKey = level?.type === 'level' ? JSON.stringify(level.height) : ''
    const slabKey = (slabElevationsByLevel.get(levelId) ?? []).sort().join(';')
    const aboveId = findLevelAboveId(levelId, levelElevations)
    const aboveSlabKey = aboveId
      ? (coveringUndersidesByLevel.get(aboveId) ?? []).sort().join(';')
      : ''
    snapshots.set(
      levelId,
      `${(arrivalsByLevel.get(levelId) ?? []).sort().join('|')}#${(separatorsByLevel.get(levelId) ?? []).sort().join('|')}#${storeyKey}#${levelWallSnapshot(walls, nodes, levelId)}##${zones.map(zoneGeometrySignature).sort().join('||')}##${slabKey}##${aboveSlabKey}##${(ceilingIdsByLevel.get(levelId) ?? []).sort().join('|')}##${(openingsByLevel.get(levelId) ?? []).sort().join('|')}`,
    )
  }

  return snapshots
}

function buildSpace(levelId: string, room: ExtractedRoom): Space {
  const signature = polygonSignature(room.polygon)
  return {
    id: `space-${levelId}-${signature.slice(0, 12)}`,
    levelId,
    polygon: room.polygon.map(pointToTuple),
    holes: room.holes,
    wallIds: [...new Set(room.boundaryFaces.map((boundary) => boundary.wallId))],
    boundaryFaces: room.boundaryFaces,
    isExterior: false,
  }
}

function detectedRoomsByLevel(nodes: Record<string, any>) {
  const wallsByLevel = new Map<string, WallNode[]>()
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'wall' || !node.parentId) continue
    const walls = wallsByLevel.get(node.parentId) ?? []
    walls.push(node)
    wallsByLevel.set(node.parentId, walls)
  }
  return new Map(
    [...wallsByLevel].map(([levelId, walls]) => [levelId, extractRooms(walls)] as const),
  )
}

type SceneNodes = Record<string, any>

function levelChildren(nodes: SceneNodes, levelId: string) {
  const level = nodes[levelId]
  if (level?.type !== 'level') return []
  return level.children.flatMap((id: string) => {
    const node = nodes[id]
    return node ? [node] : []
  })
}

function changedWallIdsByLevel(
  before: SceneNodes,
  current: SceneNodes,
  candidateIds?: ReadonlySet<AnyNodeId>,
) {
  const changes = new Map<string, Set<string>>()
  const wallIds = new Set<string>(candidateIds)
  if (!candidateIds) {
    for (const node of Object.values(before)) {
      if (node?.type === 'wall') wallIds.add(node.id)
    }
    for (const node of Object.values(current)) {
      if (node?.type === 'wall') wallIds.add(node.id)
    }
  }

  const markChanged = (levelId: string | null | undefined, wallId: string) => {
    if (!levelId) return
    const ids = changes.get(levelId) ?? new Set<string>()
    ids.add(wallId)
    changes.set(levelId, ids)
  }

  for (const wallId of wallIds) {
    const previous = before[wallId]?.type === 'wall' ? (before[wallId] as WallNode) : null
    const next = current[wallId]?.type === 'wall' ? (current[wallId] as WallNode) : null
    if (previous === next) continue
    markChanged(previous?.parentId, wallId)
    markChanged(next?.parentId, wallId)
  }

  return changes
}

function descendantLevelIds(nodes: SceneNodes, rootId: string) {
  const levelIds = new Set<string>()
  const queue = [rootId]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const id = queue.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const node = nodes[id]
    if (!node) continue
    if (node.type === 'level') levelIds.add(node.id)
    if ('children' in node && Array.isArray(node.children)) queue.push(...node.children)
  }
  return levelIds
}

function fallbackLevelIdsForCandidates(
  before: SceneNodes,
  current: SceneNodes,
  candidateIds: ReadonlySet<AnyNodeId>,
) {
  const levelIds = new Set<string>()
  const addLevelAndLower = (
    levelId: string | null | undefined,
    nodes: SceneNodes,
    includeBelow: boolean,
  ) => {
    if (!levelId) return
    levelIds.add(levelId)
    if (includeBelow) {
      const lower = getLevelBelow(levelId, nodes)
      if (lower) levelIds.add(lower.id)
    }
  }
  let checkDisplacements = false
  for (const id of candidateIds) {
    for (const nodes of [before, current]) {
      const node = nodes[id]
      if (!node) continue
      if (node.type === 'level' || node.type === 'building' || node.type === 'site') {
        for (const levelId of descendantLevelIds(nodes, node.id)) levelIds.add(levelId)
        if (node.type === 'level') {
          const lower = getLevelBelow(node.id, nodes)
          if (lower) levelIds.add(lower.id)
        }
      } else if (node.type === 'stair' || node.type === 'stair-segment') {
        const stair = node.type === 'stair' ? node : nodes[node.parentId]
        const deck = nodes[stair?.deckSlabId]
        if (deck?.support === 'open' && deck.parentId) levelIds.add(deck.parentId)
        if (node.type === 'stair')
          for (const opening of Object.values(nodes))
            if (opening.type === 'floor-opening' && opening.ownerId === node.id)
              for (const target of floorOpeningTargets(nodes, opening)) levelIds.add(target.levelId)
      } else if (node.type === 'door' || node.type === 'window') {
        const wall = nodes[node.parentId]
        if (wall?.parentId) levelIds.add(wall.parentId)
      } else if (node.type === 'slab') {
        const old = before[id],
          next = current[id]
        const changed =
          !old ||
          !next ||
          ['thickness', 'floorHeight', 'polygon', 'holes', 'elevation'].some(
            (field) =>
              JSON.stringify((old as unknown as Record<string, unknown>)[field]) !==
              JSON.stringify((next as unknown as Record<string, unknown>)[field]),
          )
        addLevelAndLower(node.parentId, nodes, changed)
        if (node.plateRole === 'base' && changed) checkDisplacements = true
      } else if (node.type === 'ceiling') {
        if (!(before[id] && current[id]) && node.parentId) levelIds.add(node.parentId)
      } else if (node.type === 'floor-opening') {
        if (node.parentId) levelIds.add(node.parentId)
        for (const target of floorOpeningTargets(nodes, node)) levelIds.add(target.levelId)
      } else if (node.type === 'zone' || node.type === 'separator') {
        if (
          node.type === 'zone' &&
          before[id]?.type === 'zone' &&
          current[id]?.type === 'zone' &&
          zoneGeometrySignature(before[id]) === zoneGeometrySignature(current[id])
        )
          continue
        if (node.parentId) levelIds.add(node.parentId)
      }
    }
  }
  if (checkDisplacements)
    for (const levelId of changedLevelConstructionDisplacements(before, current))
      levelIds.add(levelId)
  return levelIds
}

function detectSpacesFromWalls(levelId: string, boundaries: BoundaryNode[]) {
  const rooms = extractRooms(boundaries)
  const walls = boundaries.filter((boundary): boundary is WallNode => boundary.type === 'wall')
  const roomPolygons = rooms.map((room) => room.polygon)
  const wallUpdates: WallSideUpdate[] = walls.map((wall) => ({
    wallId: wall.id,
    ...classifyWallSides(
      wall,
      rooms.flatMap((room) => room.spans),
    ),
  }))

  return {
    rooms,
    roomPolygons,
    spaces: rooms.map((room) => buildSpace(levelId, room)),
    wallUpdates,
  }
}

export function detectSpacesForLevel(levelId: string, walls: BoundaryNode[]) {
  return detectSpacesFromWalls(levelId, walls)
}

function syncSceneStructure(
  levelIds: string[],
  sceneStore: any,
  previousNodes: SceneNodes,
  mintId: StructureIdFactory,
) {
  applyStructureReconciliation(sceneStore, { levelIds, previousNodes, mintId })
}

function publishSpaces(levelIds: string[], nodes: SceneNodes, editorStore: any) {
  const existingSpaces = editorStore.getState().spaces as Record<string, Space>
  const nextSpaces = Object.fromEntries(
    Object.entries(existingSpaces).filter(([, space]) => !levelIds.includes(space.levelId)),
  )
  for (const levelId of levelIds) {
    const walls = levelChildren(nodes, levelId).filter(
      (node: AnyNode): node is WallNode => node.type === 'wall',
    )
    for (const space of detectSpacesFromWalls(levelId, walls).spaces) nextSpaces[space.id] = space
  }
  editorStore.getState().setSpaces(nextSpaces)
}

// Batch writers pause intermediate topology; the final resume reconciles every
// level whose intent changed, including batches completed outside a store commit.
let spaceDetectionPauseDepth = 0
const resumeListeners = new Set<() => void>()

/** Pause structure reconciliation. Refcounted — pair with `resumeSpaceDetection`. */
export function pauseSpaceDetection(): void {
  spaceDetectionPauseDepth += 1
}

/** Resume structure reconciliation. No-op if not currently paused. */
export function resumeSpaceDetection(): void {
  if (spaceDetectionPauseDepth === 0) return
  spaceDetectionPauseDepth -= 1
  if (spaceDetectionPauseDepth === 0) for (const reconcile of resumeListeners) reconcile()
}

/** True iff structure reconciliation is currently paused. */
export function isSpaceDetectionPaused(): boolean {
  return spaceDetectionPauseDepth > 0
}

export function createRoomTopologyIndex() {
  return new RoomTopologyIndex<ExtractedRoom>({
    detectRooms: extractRooms,
    sampleWall: (wall) => sampleWallPointsForRoomDetection(wall).map(pointToTuple),
    junctionTolerance: WALL_JUNCTION_TOLERANCE,
  })
}

export function initSpaceDetectionSync(
  sceneStore: any,
  editorStore: any,
  options: SpaceDetectionSyncOptions = {},
): () => void {
  // Baseline from whatever is already in the store. Detection reacts to wall
  // edits made IN-SESSION (create / move / delete); it must not re-litigate a
  // scene that merely loaded — rerunning on hydration resurrected auto slabs
  // the user had deleted in an earlier session.
  const initialNodes = sceneStore.getState().nodes
  const topologyIndex = new RoomTopologyIndex<ExtractedRoom>({
    detectRooms: extractRooms,
    sampleWall: (wall) => sampleWallPointsForRoomDetection(wall).map(pointToTuple),
    junctionTolerance: WALL_JUNCTION_TOLERANCE,
    includeSeparators: false,
  })
  let previousNodes = initialNodes
  let isProcessing = false
  const mintId = options.mintId ?? generateId

  const adoptSceneBaseline = (nodes: SceneNodes) => {
    topologyIndex.rebuild(nodes)
    const roomsByLevel = detectedRoomsByLevel(nodes)
    const spaces: Record<string, Space> = {}
    for (const [levelId, rooms] of roomsByLevel) {
      for (const room of rooms) {
        const space = buildSpace(levelId, room)
        spaces[space.id] = space
      }
    }
    editorStore.getState().setSpaces(spaces)
    previousNodes = nodes
  }

  adoptSceneBaseline(initialNodes)

  const unsubscribeCommits = subscribeSceneCommits((commit) => {
    if (commit.origin === 'local') return
    adoptSceneBaseline(commit.current.nodes)
  })

  // Keep reconciliation in this synchronous store subscription. Zundo emits
  // the originating local SceneCommit only after subscribers return, so the
  // history-paused derived writes below join that commit's current snapshot
  // and undo step. Running from subscribeSceneCommits would cross the snapshot
  // boundary, and the paused writes would emit no replacement commit.
  const unsubscribe = sceneStore.subscribe((state: any) => {
    if (isProcessing) return
    if (isRestoringSceneHistory()) {
      adoptSceneBaseline(state.nodes)
      return
    }
    if (getSceneHistoryPauseDepth() > 0 || sceneStore.temporal.getState().isTracking === false)
      return

    const nodes = state.nodes
    const candidateIds = activeSceneCommitNodeIds()

    if (spaceDetectionPauseDepth > 0) return

    const changedWalls = changedWallIdsByLevel(previousNodes, nodes, candidateIds)
    if (candidateIds && changedWalls.size > 0) {
      const fallbackLevels = fallbackLevelIdsForCandidates(previousNodes, nodes, candidateIds)
      for (const levelId of changedWalls.keys()) fallbackLevels.delete(levelId)
      isProcessing = true
      pauseSceneHistory(sceneStore)
      try {
        const levels = [...new Set([...changedWalls.keys(), ...fallbackLevels])]
        syncSceneStructure(levels, sceneStore, previousNodes, mintId)
        publishSpaces(levels, sceneStore.getState().nodes, editorStore)
        for (const [levelId, wallIds] of changedWalls) {
          const topologyDelta = topologyIndex.applyWallDelta(levelId, wallIds, previousNodes, nodes)
          options.onTopologyReconcile?.({
            levelId,
            strategy: topologyDelta.strategy,
            examinedWallIds: topologyDelta.examinedWallIds,
            affectedBeforeRoomCount: topologyDelta.beforeRooms.length,
            affectedCurrentRoomCount: topologyDelta.currentRooms.length,
          })
        }
        if (fallbackLevels.size > 0) {
          const liveNodes = sceneStore.getState().nodes
          for (const levelId of fallbackLevels) topologyIndex.rebuildLevel(levelId, liveNodes)
        }
      } finally {
        resumeSceneHistory(sceneStore)
        previousNodes = sceneStore.getState().nodes
        isProcessing = false
      }
      return
    }

    const levelsToUpdate = new Set<string>()
    if (candidateIds) {
      for (const levelId of fallbackLevelIdsForCandidates(previousNodes, nodes, candidateIds)) {
        levelsToUpdate.add(levelId)
      }
    } else {
      const previousSnapshots = levelStructureSnapshots(previousNodes)
      const currentSnapshots = levelStructureSnapshots(nodes)
      for (const levelId of new Set([...previousSnapshots.keys(), ...currentSnapshots.keys()])) {
        // First sight of a level is a hydration baseline, not a wall edit —
        // `setScene` delivers a loaded scene as one atomic update, and a level's
        // first wall can't close a room anyway. Record it (below) and only
        // react to subsequent changes.
        const previous = previousSnapshots.get(levelId)
        if (previous === undefined) continue
        if (previous !== (currentSnapshots.get(levelId) ?? '')) {
          levelsToUpdate.add(levelId)
        }
      }
    }

    if (levelsToUpdate.size === 0) {
      previousNodes = nodes
      return
    }

    isProcessing = true
    pauseSceneHistory(sceneStore)
    try {
      syncSceneStructure([...levelsToUpdate], sceneStore, previousNodes, mintId)
      publishSpaces([...levelsToUpdate], sceneStore.getState().nodes, editorStore)
    } finally {
      resumeSceneHistory(sceneStore)
      const liveNodes = sceneStore.getState().nodes
      for (const levelId of levelsToUpdate) topologyIndex.rebuildLevel(levelId, liveNodes)
      previousNodes = liveNodes
      isProcessing = false
    }
  })

  const reconcilePaused = () => {
    const capture = () => {
      const {
        nodes,
        rootNodeIds = [],
        collections = {},
        materials = {},
        installedPlugins = [],
      } = sceneStore.getState()
      return { nodes, rootNodeIds, collections, materials, installedPlugins }
    }
    const beforeCommit = capture()
    const nodes = beforeCommit.nodes
    const before = levelStructureSnapshots(previousNodes)
    const after = levelStructureSnapshots(nodes)
    const levels = [...new Set([...before.keys(), ...after.keys()])].filter(
      (id) => before.get(id) !== after.get(id),
    )
    if (!levels.length) return
    isProcessing = true
    pauseSceneHistory(sceneStore)
    try {
      syncSceneStructure(levels, sceneStore, previousNodes, mintId)
      publishSpaces(levels, sceneStore.getState().nodes, editorStore)
      for (const id of levels) topologyIndex.rebuildLevel(id, sceneStore.getState().nodes)
      previousNodes = sceneStore.getState().nodes
    } finally {
      resumeSceneHistory(sceneStore)
      isProcessing = false
    }
    // A pause may outlive the triggering commit; publish its completed derivation
    // so collaboration receives the originator's ids even for AI/template batches.
    notifySceneCommit({ origin: 'local', before: beforeCommit, current: capture() })
  }
  resumeListeners.add(reconcilePaused)

  return () => {
    unsubscribe()
    unsubscribeCommits()
    resumeListeners.delete(reconcilePaused)
  }
}

export function wallTouchesOthers(wall: WallNode, otherWalls: WallNode[]): boolean {
  const threshold = 0.1

  for (const other of otherWalls) {
    if (other.id === wall.id) continue

    if (
      distanceToSegment(wall.start, other.start, other.end) < threshold ||
      distanceToSegment(wall.end, other.start, other.end) < threshold ||
      distanceToSegment(other.start, wall.start, wall.end) < threshold ||
      distanceToSegment(other.end, wall.start, wall.end) < threshold
    ) {
      return true
    }
  }

  return false
}
