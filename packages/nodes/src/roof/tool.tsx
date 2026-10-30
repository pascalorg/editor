import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  getActiveRoofHeight,
  getWallArcData,
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
  getWallThickness,
  isCurvedWall,
  type LevelNode,
  type RoofFootprintTarget,
  RoofNode,
  RoofSegmentNode,
  type RoofType,
  RoofType as RoofTypeSchema,
  resolveBuildingForLevel,
  resolveLevelId,
  type SceneApi,
  type WallEvent,
  type WallNode,
  wallSegmentAnchors,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearSurfacePlanSnapFeedback,
  EDITOR_LAYER,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  resolveSurfacePlanPointSnap,
  snapWorldXZForActiveBuilding,
  triggerSFX,
  useEditor,
  useFloorplanDraftPreview,
  useInteractionScope,
  useRegistryToolContext,
  visibleScene,
} from '@pascal-app/editor'
import { generateRoofSegmentGeometry, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  type Line,
  Vector3,
} from 'three'
import { createConicalRoofSectorAboveWall } from './conical-roof'
import { resolveConicalRoofPlacement } from './conical-roof-placement'
import {
  isStandardRoofWallEligible,
  parseRoofFootprintSource,
  pickRoofRoom,
  resolveRoofFootprintElevation,
  resolveRoofFootprintWorldElevation,
  resolveRoofWallTopWorldElevation,
  roofEdgeAnchors,
  roofFootprintPreviewIds,
  roofSnapEdges,
  subscribeToConicalRoofWallClicks,
} from './roof-footprint'
import useRoofFootprintSource from './roof-footprint-source'
import {
  drawnRoofLevelTarget,
  drawnRoofSupport,
  roofLevelTarget,
  roofLevelTargetOffset,
  seatedRoofElevation,
  writeRoofNodes,
  writeSeatedRoofEdit,
} from './roof-level-target'
import useRoofPlacementMode, { type RoofPlacementMode } from './roof-placement-mode'
import useRoofRidgeMode, { type RoofRidgeMode, ridgeQuarterTurn } from './roof-ridge-mode'
import {
  bearingWallThickness,
  type RoofCatchLine,
  roofCatchWalls,
  segmentWallLine,
  settleSegmentOnEdges,
} from './wall-catch'

// Rafters bear on the top plate, as standard trusses do; a raised heel is the segment's Wall Height.
const DEFAULT_HEEL_HEIGHT = 0
// A cone's curb: it stands on the ground or on another roof, not on a plate.
const DEFAULT_CONICAL_CURB_HEIGHT = 0.5
const DEFAULT_PITCH_DEG = 40
const GRID_OFFSET = 0.02

function placementOptions(mode: RoofPlacementMode) {
  return {
    allowRoofSupport: mode !== 'ground',
    requireRoofSupport: mode === 'roof',
  }
}

/**
 * A placed segment's quarter turn: given outright, or from a ridge mode, which
 * runs the ridge along the footprint's long side ('long') or across it.
 */
function resolveQuarterTurn(
  ridge: boolean | RoofRidgeMode,
  footprintWidth: number,
  footprintDepth: number,
): boolean {
  return typeof ridge === 'boolean'
    ? ridge
    : ridgeQuarterTurn(footprintWidth, footprintDepth, ridge)
}

function resolveRoofDraftPlacement(
  footprintWidth: number,
  footprintDepth: number,
  ridge: boolean | RoofRidgeMode,
  parentRotation = 0,
  roofType: RoofType = 'gable',
) {
  if (roofType === 'conical') {
    const diameter = Math.max(footprintWidth, footprintDepth)
    return { width: diameter, depth: diameter, rotation: -parentRotation }
  }
  const quarterTurn = resolveQuarterTurn(ridge, footprintWidth, footprintDepth)
  return {
    width: quarterTurn ? footprintDepth : footprintWidth,
    depth: quarterTurn ? footprintWidth : footprintDepth,
    rotation: -parentRotation + (quarterTurn ? Math.PI / 2 : 0),
  }
}

// Walls that are direct children of a level.
function getLevelWalls(
  levelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
): WallNode[] {
  if (!levelId) return []
  const levelNode = nodes[levelId]
  if (levelNode?.type !== 'level') return []
  return (levelNode as LevelNode).children
    .map((childId) => nodes[childId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

// The level directly beneath the active one. Levels share the same local XZ
// origin (they only differ in world Y), so its walls live in the identical
// coordinate frame and feed straight into both the alignment pool and the
// magnetic wall-snap pipeline — letting a roof drawn on the upper floor snap
// onto the wall corners of the floor below.
function getBelowLevel(
  currentLevelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
): LevelNode | undefined {
  if (!currentLevelId) return undefined
  const currentLevel = nodes[currentLevelId]
  if (currentLevel?.type !== 'level') return undefined
  const buildingId = resolveBuildingForLevel(currentLevel.id, nodes)
  if (!buildingId) return undefined
  const building = nodes[buildingId]
  if (building?.type !== 'building') return undefined
  const currentIndex = (currentLevel as LevelNode).level
  return (building.children ?? [])
    .map((childId) => nodes[childId])
    .filter((node): node is LevelNode => node?.type === 'level' && node.level < currentIndex)
    .sort((a, b) => b.level - a.level)[0]
}

// Walls on the level directly beneath the active one.
function getBelowLevelWalls(
  currentLevelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
): WallNode[] {
  return getLevelWalls(getBelowLevel(currentLevelId, nodes)?.id ?? null, nodes)
}

// The active level and the one beneath it, whose rooms' edges a roof draws to.
function roofEdgeLevelIds(
  currentLevelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
): string[] {
  const below = getBelowLevel(currentLevelId, nodes)
  return [currentLevelId, below?.id].filter((id): id is string => !!id)
}

// Current-level + floor-below walls — the magnetic snap targets the roof draft
// locks onto (corners, midpoints, crossings, wall bodies), matching the wall
// tool. Same coordinate frame, so no transform is needed. A porch, deck or
// patio is drawn to as the house is: its invisible walls, and its railings at
// their outside faces in place of their centre lines (`roofSnapEdges`).
function getRoofSnapWalls(
  currentLevelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
  roofType: RoofType,
): WallNode[] {
  const walls = [
    ...getLevelWalls(currentLevelId, nodes),
    ...getBelowLevelWalls(currentLevelId, nodes),
  ]
  if (roofType === 'conical') return walls.filter((wall) => isCurvedWall(wall))
  const edges = roofSnapEdges(nodes, roofEdgeLevelIds(currentLevelId, nodes))
  return [...walls.filter((wall) => !edges.faced.has(wall.id)), ...edges.references].filter(
    isStandardRoofWallEligible,
  )
}

// Current-level alignment anchors plus the floor-below wall corners, and both
// levels' invisible walls and porch, deck and patio corners.
export function collectRoofAlignmentAnchors(
  nodes: Readonly<Record<string, AnyNode>>,
  currentLevelId: string | null,
  roofType: RoofType,
): AlignmentAnchor[] {
  const anchors = [
    ...collectAlignmentAnchors(nodes, '', currentLevelId),
    ...getBelowLevelWalls(currentLevelId, nodes).flatMap((wall) =>
      wallSegmentAnchors(wall.id, wall.start, wall.end, wall.thickness, wall.justification),
    ),
    ...(roofType === 'conical'
      ? []
      : roofEdgeAnchors(nodes, roofEdgeLevelIds(currentLevelId, nodes))),
  ]
  if (roofType === 'conical') {
    return anchors.filter((anchor) => {
      const node = nodes[anchor.nodeId]
      return node?.type !== 'wall' || isCurvedWall(node)
    })
  }
  return anchors.filter((anchor) => {
    const node = nodes[anchor.nodeId]
    return node?.type !== 'wall' || isStandardRoofWallEligible(node)
  })
}

/**
 * A grid event's point as the roof tools draft and commit it, the 3D tool and the plan's alike:
 * through the shared surface snap pipeline, magnetic lock onto wall corners / midpoints / crossings
 * / bodies on the active level and the floor below (raising the green beacon), falling back to
 * alignment guides, then to the building-grid snap. The pipeline reads the active snapping mode
 * (grid / lines / angles / off). `levelId` is intentionally omitted so the explicit floor-below
 * `walls` aren't filtered back out.
 */
export function resolveRoofDraftPoint(
  event: GridEvent,
  levelId: string,
  nodes: Readonly<Record<string, AnyNode>>,
  roofType: RoofType,
  candidates: readonly AlignmentAnchor[],
): [number, number] {
  const rawPoint: [number, number] = [event.localPosition[0], event.localPosition[2]]
  const gridFallback: [number, number] = isGridSnapActive()
    ? snapWorldXZForActiveBuilding(
        event.position[0],
        event.position[2],
        useEditor.getState().gridSnapStep,
      ).local
    : rawPoint
  return resolveSurfacePlanPointSnap({
    rawPoint,
    fallbackPoint: gridFallback,
    walls: getRoofSnapWalls(levelId, nodes, roofType),
    candidates,
    movingId: '__roof-draft__',
    highlightWalls: true,
  }).point
}

/**
 * A drawn segment whose gable and heel walls stand flush on the walls it is drawn over, and whose
 * walls' outer faces stand on the rooms' edges it is drawn out to: a porch's invisible walls, a
 * deck's railings at their outside faces (`settleSegmentOnEdges`).
 */
function onBearingWalls(
  segment: RoofSegmentNode,
  roof: Pick<RoofNode, 'position' | 'rotation'>,
  walls: readonly RoofCatchLine[],
): RoofSegmentNode {
  const thickness = bearingWallThickness(segmentWallLine(roof, segment), walls)
  const bearing = thickness === null ? segment : { ...segment, wallThickness: thickness }
  return { ...bearing, ...settleSegmentOnEdges(roof, bearing, walls) }
}

/**
 * A new roof's place, and its one segment centred in it: the segment settled onto a room's edge
 * (`onBearingWalls`) moves off the roof's centre, so the roof moves with it.
 */
function centredRoof(
  roof: Pick<RoofNode, 'position' | 'rotation'>,
  segment: RoofSegmentNode,
): { center: [number, number]; segment: RoofSegmentNode } {
  const [x, z] = segmentWallLine(roof, segment).center
  return { center: [x, z], segment: { ...segment, position: [0, segment.position[1], 0] } }
}

/**
 * Creates a roof group with one default gable segment. `ridge` is a quarter
 * turn outright, or a ridge mode: 'long' runs the ridge along the drawn
 * rectangle's long side, 'short' across it.
 */
export const commitRoofPlacement = (
  sceneApi: SceneApi,
  levelId: LevelNode['id'],
  corner1: [number, number, number],
  corner2: [number, number, number],
  selectedIds: string[],
  ridge: boolean | RoofRidgeMode,
  placementMode: RoofPlacementMode,
): AnyNode['id'] | null => {
  const nodes = sceneApi.nodes()

  // A placed roof preset seeds `toolDefaults.roof` with the flattened
  // subtree params (roofType, pitch, wallHeight, overhang, materials, …)
  // before the tool activates. The footprint (width/depth) and placement
  // come from the drawn rectangle and always win; the segment carries the
  // shape/material params, the roof container picks up the materials.
  const defaults = useEditor.getState().toolDefaults.roof ?? {}
  const parsedRoofType = RoofTypeSchema.safeParse(defaults.roofType)
  const roofType = parsedRoofType.success ? parsedRoofType.data : 'gable'

  const centerX = (corner1[0] + corner2[0]) / 2
  const centerZ = (corner1[2] + corner2[2]) / 2

  const footprintWidth = Math.max(Math.abs(corner2[0] - corner1[0]), 1)
  const footprintDepth = Math.max(Math.abs(corner2[2] - corner1[2]), 1)

  if (roofType === 'conical') {
    const diameter = Math.max(footprintWidth, footprintDepth)
    const curbHeight =
      typeof defaults.wallHeight === 'number' ? defaults.wallHeight : DEFAULT_CONICAL_CURB_HEIGHT
    const cone = RoofSegmentNode.parse({
      pitch: DEFAULT_PITCH_DEG,
      ...defaults,
      roofType,
      width: diameter,
      depth: diameter,
    })
    const target = drawnRoofLevelTarget(nodes, levelId, curbHeight + getActiveRoofHeight(cone), {
      center: [centerX, centerZ],
      width: diameter,
      depth: diameter,
      roofType,
    })
    const resolved = resolveConicalRoofPlacement({
      nodes: target.nodes,
      levelId: target.levelId,
      center: [centerX, centerZ],
      radius: diameter / 2,
      curbHeight,
      ...placementOptions(placementMode),
    })
    if (!resolved.valid) return null

    const roofCount = Object.values(nodes).filter((node) => node.type === 'roof').length
    const segment = RoofSegmentNode.parse({
      pitch: DEFAULT_PITCH_DEG,
      roofType: 'gable',
      ...defaults,
      width: diameter,
      depth: diameter,
      wallHeight: resolved.wallHeight,
      position: [0, 0, 0],
      rotation: 0,
    })
    const roof = RoofNode.parse({
      ...defaults,
      name: `Roof ${roofCount + 1}`,
      position: resolved.position,
      support: resolved.support,
      children: [segment.id],
    })

    writeRoofNodes(sceneApi, target, [
      { node: roof, parentId: target.levelId },
      { node: segment, parentId: roof.id },
    ])
    triggerSFX('sfx:structure-build')
    return roof.id
  }

  // Determine if there is an active roof node we should add to
  let targetRoofId: RoofNode['id'] | null = null
  const selectedId = selectedIds[0]
  if (selectedIds.length === 1 && selectedId) {
    const selectedNode = nodes[selectedId as AnyNodeId]
    if (selectedNode?.type === 'roof') {
      targetRoofId = selectedNode.id
    } else if (selectedNode?.type === 'roof-segment' && selectedNode.parentId) {
      targetRoofId = selectedNode.parentId as RoofNode['id']
    }
  }

  if (targetRoofId) {
    const targetRoof = nodes[targetRoofId] as RoofNode
    // The corners are in the level's plan, the roof's frame: its own place and turn in it. (Its
    // mesh's world matrix also carries the building's, which would throw the plane off.)
    const dx = centerX - targetRoof.position[0]
    const dz = centerZ - targetRoof.position[2]
    const angle = -targetRoof.rotation
    const localX = dx * Math.cos(angle) - dz * Math.sin(angle)
    const localZ = dx * Math.sin(angle) + dz * Math.cos(angle)

    const placement = resolveRoofDraftPlacement(
      footprintWidth,
      footprintDepth,
      ridge,
      targetRoof.rotation,
      roofType,
    )

    const sibling = targetRoof.children
      .map((id) => nodes[id])
      .find((node) => node?.type === 'roof-segment')
    const drawn = RoofSegmentNode.parse({
      roofSystem: sibling?.type === 'roof-segment' ? sibling.roofSystem : undefined,
      glazing: sibling?.type === 'roof-segment' ? sibling.glazing : undefined,
      barrelRise: sibling?.type === 'roof-segment' ? sibling.barrelRise : undefined,
      barrelSegments: sibling?.type === 'roof-segment' ? sibling.barrelSegments : undefined,
      // A wing bears where the roof it joins does: on the plate, or on the same raised heel.
      wallHeight: sibling?.type === 'roof-segment' ? sibling.wallHeight : DEFAULT_HEEL_HEIGHT,
      pitch: DEFAULT_PITCH_DEG,
      roofType: 'gable',
      ...defaults,
      width: placement.width,
      depth: placement.depth,
      position: [localX, 0, localZ],
      rotation: placement.rotation,
    })
    const segment = onBearingWalls(drawn, targetRoof, roofCatchWalls(nodes, targetRoof.parentId))

    writeSeatedRoofEdit(sceneApi, {
      create: [{ node: segment, parentId: targetRoofId as AnyNode['id'] }],
    })
    triggerSFX('sfx:structure-build')
    return segment.id // Returns segment ID so it can be selected immediately
  }

  // Count existing roofs for naming
  const roofCount = Object.values(nodes).filter((n) => n.type === 'roof').length
  const name = `Roof ${roofCount + 1}`
  const roofRotation = typeof defaults.rotation === 'number' ? defaults.rotation : 0
  const placement = resolveRoofDraftPlacement(
    footprintWidth,
    footprintDepth,
    ridge,
    roofRotation,
    roofType,
  )

  // Create the segment first (centered in its new parent)
  const drawnRoof = {
    position: [centerX, 0, centerZ] as [number, number, number],
    rotation: roofRotation,
  }
  const {
    center: [roofX, roofZ],
    segment,
  } = centredRoof(
    drawnRoof,
    onBearingWalls(
      RoofSegmentNode.parse({
        wallHeight: DEFAULT_HEEL_HEIGHT,
        pitch: DEFAULT_PITCH_DEG,
        roofType: 'gable',
        ...defaults,
        width: placement.width,
        depth: placement.depth,
        position: [0, 0, 0],
        rotation: placement.rotation,
      }),
      drawnRoof,
      roofCatchWalls(nodes, levelId),
    ),
  )

  // Drawn over a storey's walls, the roof goes on the level above them.
  const target = drawnRoofLevelTarget(
    nodes,
    levelId,
    segment.wallHeight + getActiveRoofHeight(segment),
    { center: [centerX, centerZ], width: footprintWidth, depth: footprintDepth, roofType },
  )
  const support = drawnRoofSupport(target, levelId)
  // Create the roof container. Segment-shaped params (roofType, pitch, …) are
  // dropped by the RoofNode schema; surface materials in `defaults` carry over.
  const placed = RoofNode.parse({
    ...defaults,
    name,
    position: [roofX, 0, roofZ],
    support,
    children: [segment.id],
  })
  const roof =
    support.kind === 'walls'
      ? RoofNode.parse({
          ...placed,
          position: [roofX, seatedRoofElevation(target, placed, [segment]), roofZ],
        })
      : placed
  // Create roof first (so segment can be parented to it), then segment
  writeRoofNodes(sceneApi, target, [
    { node: roof, parentId: target.levelId },
    { node: segment, parentId: roof.id },
  ])

  triggerSFX('sfx:structure-build')
  return roof.id
}

export const commitRoofFootprint = (
  sceneApi: SceneApi,
  levelId: LevelNode['id'],
  target: RoofFootprintTarget,
  ridge: boolean | RoofRidgeMode,
): AnyNode['id'] | null => {
  if (!target.rectangular) return null
  const quarterTurn = resolveQuarterTurn(ridge, target.width, target.depth)
  const nodes = sceneApi.nodes()
  const defaults = useEditor.getState().toolDefaults.roof ?? {}
  const parsedRoofType = RoofTypeSchema.safeParse(defaults.roofType)
  const roofType = parsedRoofType.success ? parsedRoofType.data : 'gable'
  if (roofType === 'conical') return null
  const roofCount = Object.values(nodes).filter((node) => node.type === 'roof').length
  const walls = target.wallIds
    .map((id) => nodes[id])
    .filter((node): node is WallNode => node?.type === 'wall')
  const picked = RoofSegmentNode.parse({
    pitch: DEFAULT_PITCH_DEG,
    roofType: 'gable',
    ...defaults,
    // Its gable and heel walls stand flush on the room's walls.
    ...(walls.length > 0 && { wallThickness: Math.max(...walls.map(getWallThickness)) }),
    wallHeight: 0,
    width: quarterTurn ? target.depth : target.width,
    depth: quarterTurn ? target.width : target.depth,
    position: [0, 0, 0],
    rotation: quarterTurn ? Math.PI / 2 : 0,
  })
  // A roof belongs to the level above the walls it covers, whichever level the tool was armed
  // on: over the top floor, the building's roof level.
  const firstWall = walls[0]
  const wallsLevelId = (target.levelId ??
    (firstWall ? resolveLevelId(firstWall, nodes) : levelId)) as LevelNode['id']
  // Over a porch, deck or patio, the roof's walls stand their outer faces on the room's outside
  // edge, as a house roof's stand on the walls' outside faces.
  const pickedRoof = {
    position: [target.center[0], 0, target.center[1]] as [number, number, number],
    rotation: target.rotation,
  }
  const { center, segment } = centredRoof(pickedRoof, {
    ...picked,
    ...settleSegmentOnEdges(pickedRoof, picked, roofCatchWalls(nodes, wallsLevelId)),
  })
  const level = roofLevelTarget(nodes, wallsLevelId, getActiveRoofHeight(segment))
  const roof = RoofNode.parse({
    ...defaults,
    name: `Roof ${roofCount + 1}`,
    position: [
      center[0],
      resolveRoofFootprintElevation(level.levelId, target, level.nodes),
      center[1],
    ],
    rotation: target.rotation,
    support: { kind: 'walls' },
    children: [segment.id],
  })
  writeRoofNodes(sceneApi, level, [
    { node: roof, parentId: level.levelId },
    { node: segment, parentId: roof.id },
  ])
  triggerSFX('sfx:structure-build')
  return roof.id
}

type PreviewState = {
  corner1: [number, number, number] | null
  cursorPosition: [number, number, number]
  levelY: number
}

function buildRoofGhostGeometry(
  width: number,
  depth: number,
  wallHeight: number,
  pitchDeg: number,
  roofType: RoofType,
) {
  const safeWidth = Math.max(width, 0.1)
  const safeDepth = Math.max(depth, 0.1)
  const halfWidth = safeWidth / 2
  const halfDepth = safeDepth / 2
  const ridgeHeight = wallHeight + Math.tan((pitchDeg * Math.PI) / 180) * halfDepth

  if (roofType === 'conical') {
    const roofHeight = Math.max(0.001, Math.tan((pitchDeg * Math.PI) / 180) * halfWidth)
    const geometry = new THREE.ConeGeometry(halfWidth, roofHeight, 48)
    geometry.translate(0, wallHeight + roofHeight / 2, 0)
    return geometry
  }

  const vertices = [
    // Front slope
    -halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    ridgeHeight,
    0,

    -halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    ridgeHeight,
    0,

    // Back slope
    -halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    wallHeight,
    halfDepth,

    -halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    wallHeight,
    halfDepth,
    -halfWidth,
    wallHeight,
    halfDepth,

    // Left gable
    -halfWidth,
    wallHeight,
    -halfDepth,
    -halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    wallHeight,
    halfDepth,

    // Right gable
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    halfDepth,
    halfWidth,
    ridgeHeight,
    0,
  ]

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

function buildRoofGhostEdges(
  width: number,
  depth: number,
  wallHeight: number,
  pitchDeg: number,
  roofType: RoofType,
) {
  const safeWidth = Math.max(width, 0.1)
  const safeDepth = Math.max(depth, 0.1)
  const halfWidth = safeWidth / 2
  const halfDepth = safeDepth / 2
  const ridgeHeight = wallHeight + Math.tan((pitchDeg * Math.PI) / 180) * halfDepth

  if (roofType === 'conical') {
    const roofHeight = Math.max(0.001, Math.tan((pitchDeg * Math.PI) / 180) * halfWidth)
    const cone = new THREE.ConeGeometry(halfWidth, roofHeight, 48)
    cone.translate(0, wallHeight + roofHeight / 2, 0)
    const edges = new THREE.EdgesGeometry(cone, 10)
    cone.dispose()
    return edges
  }

  const vertices = [
    // Base rectangle
    -halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    wallHeight,
    halfDepth,
    halfWidth,
    wallHeight,
    halfDepth,
    -halfWidth,
    wallHeight,
    halfDepth,
    -halfWidth,
    wallHeight,
    halfDepth,
    -halfWidth,
    wallHeight,
    -halfDepth,

    // Ridge + gable edges
    -halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    wallHeight,
    -halfDepth,
    -halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    ridgeHeight,
    0,
    -halfWidth,
    wallHeight,
    halfDepth,
    halfWidth,
    wallHeight,
    -halfDepth,
    halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    ridgeHeight,
    0,
    halfWidth,
    wallHeight,
    halfDepth,
  ]

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  return geometry
}

export const RoofTool: React.FC = () => {
  const { activeLevelId: currentLevelId, sceneApi, selectNode } = useRegistryToolContext()
  const cursorRef = useRef<Group>(null)
  const outlineRef = useRef<Line>(null!)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setPreviewSelectedIds = useViewer((state) => state.setPreviewSelectedIds)
  const roofDefaults = useEditor((state) => state.toolDefaults.roof)
  const placementMode = useRoofPlacementMode((state) => state.mode)
  const subscribeToNodes = useMemo(
    () => (onChange: () => void) => sceneApi.subscribeNodes?.(() => onChange()) ?? (() => {}),
    [sceneApi],
  )
  const nodes = useSyncExternalStore(subscribeToNodes, sceneApi.nodes, sceneApi.nodes)
  const parsedRoofType = RoofTypeSchema.safeParse(roofDefaults?.roofType)
  const roofType = parsedRoofType.success ? parsedRoofType.data : 'gable'
  const footprintSourceChoice = useRoofFootprintSource((state) => state.source)
  const footprintSource = parseRoofFootprintSource(footprintSourceChoice, roofType)
  const previewWallHeight =
    typeof roofDefaults?.wallHeight === 'number'
      ? roofDefaults.wallHeight
      : roofType === 'conical'
        ? DEFAULT_CONICAL_CURB_HEIGHT
        : DEFAULT_HEEL_HEIGHT
  const previewPitch =
    typeof roofDefaults?.pitch === 'number' ? roofDefaults.pitch : DEFAULT_PITCH_DEG

  const selectedIdsRef = useRef(selectedIds)
  useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])

  useEffect(() => {
    if (!currentLevelId) return
    const draft = RoofNode.parse({
      ...useEditor.getState().toolDefaults.roof,
      name: 'Roof preview',
      parentId: currentLevelId,
    })
    useInteractionScope.getState().begin({
      kind: 'placing',
      node: draft,
      nodeId: draft.id,
      nodeType: draft.type,
      view: '3d',
      pressDrag: false,
      driver: 'registry-tool',
    })
    return () => {
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'placing' && scope.nodeId === draft.id)
    }
  }, [currentLevelId])

  // Clear preset-seeded defaults on deactivation so a later manual roof draw
  // isn't built with a stale preset's parameters. Unmount-only.
  useEffect(() => () => useEditor.getState().setToolDefaults('roof', null), [])
  // Each arming starts with the ridge along the long side. Unmount-only.
  useEffect(() => () => useRoofRidgeMode.getState().reset(), [])

  const corner1Ref = useRef<[number, number, number] | null>(null)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const ridgeMode = useRoofRidgeMode((state) => state.mode)
  const [footprintTarget, setFootprintTarget] = useState<RoofFootprintTarget | null>(null)
  const previewTargetIdRef = useRef<string | null>(null)
  const [previewedConicalWallId, setPreviewedConicalWallId] = useState<WallNode['id'] | null>(null)
  const [invalidStandardWallHover, setInvalidStandardWallHover] = useState(false)
  const [preview, setPreview] = useState<PreviewState>({
    corner1: null,
    cursorPosition: [0, 0, 0],
    levelY: 0,
  })

  useEffect(() => {
    if (footprintSource === 'room') return
    previewTargetIdRef.current = null
    setFootprintTarget(null)
  }, [footprintSource])

  useEffect(() => {
    if (!currentLevelId) return

    outlineRef.current.geometry = new BufferGeometry()
    // The 2D draft's ridge line follows the drawn rectangle and the ridge mode.
    const syncDraftRidge = (corner1: [number, number, number], corner2: [number, number, number]) =>
      useFloorplanDraftPreview
        .getState()
        .setRoofDraftQuarterTurn(
          ridgeQuarterTurn(
            Math.abs(corner2[0] - corner1[0]),
            Math.abs(corner2[2] - corner1[2]),
            useRoofRidgeMode.getState().mode,
          ),
        )
    let lastCursor: [number, number, number] | null = null

    // Alignment candidates — anchors of every alignable object on the active
    // level plus the wall corners of the floor directly below, so a roof drawn
    // on the upper floor aligns to the walls beneath it. Refreshed after each
    // roof commits. Both corners of the rectangle align.
    let alignmentCandidates = collectRoofAlignmentAnchors(
      sceneApi.nodes(),
      currentLevelId,
      roofType,
    )

    const resolveDraftPoint = (event: GridEvent) =>
      resolveRoofDraftPoint(event, currentLevelId, sceneApi.nodes(), roofType, alignmentCandidates)

    const updateFootprintPreview = (target: RoofFootprintTarget | null) => {
      setFootprintTarget((previous) => (previous?.id === target?.id ? previous : target))
      if (previewTargetIdRef.current === (target?.id ?? null)) return
      previewTargetIdRef.current = target?.id ?? null
      setPreviewSelectedIds(roofFootprintPreviewIds(target))
    }

    const updateOutline = (
      corner1: [number, number, number],
      corner2: [number, number, number],
    ) => {
      let gridY = corner1[1] + GRID_OFFSET

      if (roofType === 'conical') {
        const centerX = (corner1[0] + corner2[0]) / 2
        const centerZ = (corner1[2] + corner2[2]) / 2
        const diameter = Math.max(
          Math.abs(corner2[0] - corner1[0]),
          Math.abs(corner2[2] - corner1[2]),
        )
        const defaults = useEditor.getState().toolDefaults.roof
        const curbHeight =
          typeof defaults?.wallHeight === 'number'
            ? defaults.wallHeight
            : DEFAULT_CONICAL_CURB_HEIGHT
        const target = drawnRoofLevelTarget(sceneApi.nodes(), currentLevelId, 0, {
          center: [centerX, centerZ],
          width: diameter,
          depth: diameter,
          roofType,
        })
        const placement = resolveConicalRoofPlacement({
          nodes: target.nodes,
          levelId: target.levelId,
          center: [centerX, centerZ],
          radius: diameter / 2,
          curbHeight,
          ...placementOptions(useRoofPlacementMode.getState().mode),
        })
        if (placement.valid) {
          gridY =
            corner1[1] +
            roofLevelTargetOffset(target, currentLevelId) +
            placement.position[1] +
            (placement.kind === 'roof' ? placement.wallHeight - curbHeight : 0) +
            GRID_OFFSET
        }
      }

      const groundPoints =
        roofType === 'conical'
          ? (() => {
              const centerX = (corner1[0] + corner2[0]) / 2
              const centerZ = (corner1[2] + corner2[2]) / 2
              const diameter = Math.max(
                Math.abs(corner2[0] - corner1[0]),
                Math.abs(corner2[2] - corner1[2]),
              )
              return Array.from({ length: 49 }, (_, index) => {
                const angle = (index / 48) * Math.PI * 2
                return new Vector3(
                  centerX + Math.cos(angle) * (diameter / 2),
                  gridY,
                  centerZ + Math.sin(angle) * (diameter / 2),
                )
              })
            })()
          : [
              new Vector3(corner1[0], gridY, corner1[2]),
              new Vector3(corner2[0], gridY, corner1[2]),
              new Vector3(corner2[0], gridY, corner2[2]),
              new Vector3(corner1[0], gridY, corner2[2]),
              new Vector3(corner1[0], gridY, corner1[2]),
            ]

      outlineRef.current.geometry.dispose()
      outlineRef.current.geometry = new BufferGeometry().setFromPoints(groundPoints)
      outlineRef.current.visible = true
    }

    // In 2D-only view the plan's own roof tool owns the input (`floorplan-tool.tsx`); this tool,
    // mounted behind the hidden canvas from an earlier visit, still hears the plan's grid events,
    // so it must not also draft or commit (every roof would be made twice).
    const planOwnsInput = () => visibleScene(useEditor.getState()) === '2d'

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current || planOwnsInput()) return

      if (footprintSource !== 'draw') {
        const [snappedX, snappedZ] = resolveDraftPoint(event)
        let target: RoofFootprintTarget | null = null
        if (footprintSource === 'room') {
          const room = pickRoofRoom(currentLevelId, sceneApi.nodes(), [snappedX, snappedZ])
          target = room.target
          useRoofFootprintSource.getState().setRoomPick(room.pick)
          updateFootprintPreview(target)
        }
        cursorRef.current.position.set(
          snappedX,
          target
            ? resolveRoofFootprintWorldElevation(currentLevelId, target, sceneApi.nodes()) +
                GRID_OFFSET
            : event.localPosition[1] + GRID_OFFSET,
          snappedZ,
        )
        return
      }

      const [gridX, gridZ] = resolveDraftPoint(event)
      const y = event.localPosition[1]

      const cursorPosition: [number, number, number] = [gridX, y, gridZ]
      const gridY = y + GRID_OFFSET

      cursorRef.current.position.set(gridX, gridY, gridZ)

      if (
        (isGridSnapActive() || isMagneticSnapActive()) &&
        corner1Ref.current &&
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]

      setPreview({
        corner1: corner1Ref.current,
        cursorPosition,
        levelY: y,
      })

      if (corner1Ref.current) {
        const draftPreview = useFloorplanDraftPreview.getState()
        draftPreview.setRoofDraftStart([corner1Ref.current[0], corner1Ref.current[2]])
        draftPreview.setRoofDraftEnd([gridX, gridZ])
        syncDraftRidge(corner1Ref.current, cursorPosition)
        updateOutline(corner1Ref.current, cursorPosition)
      }
      lastCursor = cursorPosition
    }

    const onGridClick = (event: GridEvent) => {
      if (!currentLevelId || planOwnsInput()) return

      if (footprintSource !== 'draw') {
        if (footprintSource !== 'room') return
        const [snappedX, snappedZ] = resolveDraftPoint(event)
        const { target, pick } = pickRoofRoom(currentLevelId, sceneApi.nodes(), [
          snappedX,
          snappedZ,
        ])
        useRoofFootprintSource.getState().setRoomPick(pick)
        if (!target) return
        const roofId = commitRoofFootprint(
          sceneApi,
          currentLevelId,
          target,
          useRoofRidgeMode.getState().mode,
        )
        if (roofId) selectNode(roofId)
        return
      }

      const [gridX, gridZ] = resolveDraftPoint(event)
      const y = event.localPosition[1]

      if (corner1Ref.current) {
        const roofId = commitRoofPlacement(
          sceneApi,
          currentLevelId,
          corner1Ref.current,
          [gridX, y, gridZ],
          selectedIdsRef.current,
          useRoofRidgeMode.getState().mode,
          useRoofPlacementMode.getState().mode,
        )

        if (!roofId) return

        selectNode(roofId as AnyNode['id'])

        corner1Ref.current = null
        const draftPreview = useFloorplanDraftPreview.getState()
        draftPreview.setRoofDraftStart(null)
        draftPreview.setRoofDraftEnd(null)
        outlineRef.current.visible = false
        alignmentCandidates = collectRoofAlignmentAnchors(
          sceneApi.nodes(),
          currentLevelId,
          roofType,
        )
        clearSurfacePlanSnapFeedback()
      } else {
        corner1Ref.current = [gridX, y, gridZ]
        const draftPreview = useFloorplanDraftPreview.getState()
        draftPreview.setRoofDraftStart([gridX, gridZ])
        draftPreview.setRoofDraftEnd([gridX, gridZ])
        triggerSFX('sfx:structure-build-start')
        setPreview((prev) => ({
          ...prev,
          corner1: corner1Ref.current,
        }))
      }
    }

    const dropCorner = () => {
      corner1Ref.current = null
      outlineRef.current.visible = false
      setPreview((prev) => ({ ...prev, corner1: null }))
    }

    // A corner opened before the view went 2D-only would end the next rectangle drawn back in
    // split view. The plan's tool clears the shared draft as it takes over.
    const unsubscribeView = useEditor.subscribe((state) => {
      if (corner1Ref.current && visibleScene(state) === '2d') dropCorner()
    })

    const onCancel = () => {
      if (corner1Ref.current) {
        markToolCancelConsumed()
        dropCorner()
        const draftPreview = useFloorplanDraftPreview.getState()
        draftPreview.setRoofDraftStart(null)
        draftPreview.setRoofDraftEnd(null)
      }
      clearSurfacePlanSnapFeedback()
      previewTargetIdRef.current = null
      setPreviewSelectedIds([])
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (planOwnsInput()) return
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return
      }
      if (roofType === 'conical') {
        if (
          (event.key === 'p' || event.key === 'P') &&
          !event.repeat &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault()
          useRoofPlacementMode.getState().cycleMode()
          triggerSFX('sfx:grid-snap')
        }
        return
      }
      if (
        (event.key !== 'r' && event.key !== 'R') ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return
      }

      event.preventDefault()
      useRoofRidgeMode.getState().toggle()
      triggerSFX('sfx:item-rotate')
    }
    // The HUD chip flips the mode too; either way the 2D draft follows.
    const unsubscribeRidgeMode = useRoofRidgeMode.subscribe(() => {
      if (corner1Ref.current && lastCursor) syncDraftRidge(corner1Ref.current, lastCursor)
    })

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    const onWallHover = (event: WallEvent) => {
      setInvalidStandardWallHover(
        footprintSource === 'draw' &&
          roofType !== 'conical' &&
          !isStandardRoofWallEligible(event.node),
      )
    }
    const onWallLeave = () => setInvalidStandardWallHover(false)
    emitter.on('wall:enter', onWallHover)
    emitter.on('wall:move', onWallHover)
    emitter.on('wall:leave', onWallLeave)
    const unsubscribeConicalRoofWallClicks = subscribeToConicalRoofWallClicks({
      footprintSource,
      currentLevelId,
      getNodes: sceneApi.nodes,
      onPreview: (wall) => {
        setPreviewedConicalWallId(wall?.id ?? null)
        setPreviewSelectedIds(wall ? [wall.id] : [])
      },
      onSelect: (wall) => {
        setPreviewedConicalWallId(null)
        setPreviewSelectedIds([])
        const segmentId = createConicalRoofSectorAboveWall(
          wall,
          sceneApi.nodes(),
          sceneApi,
          currentLevelId as LevelNode['id'],
        )
        if (segmentId) selectNode(segmentId)
      },
      roofType,
    })
    window.addEventListener('keydown', onKeyDown)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      emitter.off('wall:enter', onWallHover)
      emitter.off('wall:move', onWallHover)
      emitter.off('wall:leave', onWallLeave)
      unsubscribeConicalRoofWallClicks()
      window.removeEventListener('keydown', onKeyDown)
      unsubscribeRidgeMode()
      unsubscribeView()
      clearSurfacePlanSnapFeedback()
      previewTargetIdRef.current = null
      setPreviewedConicalWallId(null)
      setInvalidStandardWallHover(false)
      setPreviewSelectedIds([])
      useRoofFootprintSource.getState().setRoomPick(null)

      corner1Ref.current = null
      const draftPreview = useFloorplanDraftPreview.getState()
      draftPreview.setRoofDraftStart(null)
      draftPreview.setRoofDraftEnd(null)
      draftPreview.setRoofDraftQuarterTurn(false)
    }
  }, [currentLevelId, footprintSource, roofType, sceneApi, selectNode, setPreviewSelectedIds])

  const { corner1, cursorPosition, levelY } = preview

  const previewDimensions = useMemo(() => {
    if (!corner1) return null
    const length = Math.abs(cursorPosition[0] - corner1[0])
    const width = Math.abs(cursorPosition[2] - corner1[2])
    const centerX = (corner1[0] + cursorPosition[0]) / 2
    const centerZ = (corner1[2] + cursorPosition[2]) / 2
    return { length, width, centerX, centerZ }
  }, [corner1, cursorPosition])

  const resolvedPreviewDimensions =
    footprintSource === 'draw'
      ? previewDimensions
      : footprintTarget
        ? {
            length: footprintTarget.width,
            width: footprintTarget.depth,
            centerX: footprintTarget.center[0],
            centerZ: footprintTarget.center[1],
          }
        : null

  // A roof drawn over the armed level's walls lands on the level above them; its ghost does too.
  const drawTarget = useMemo(
    () =>
      currentLevelId && footprintSource === 'draw' && previewDimensions
        ? drawnRoofLevelTarget(nodes, currentLevelId, 0, {
            center: [previewDimensions.centerX, previewDimensions.centerZ],
            width: previewDimensions.length,
            depth: previewDimensions.width,
            roofType,
          })
        : null,
    [currentLevelId, footprintSource, nodes, previewDimensions, roofType],
  )
  const drawLift =
    drawTarget && currentLevelId ? roofLevelTargetOffset(drawTarget, currentLevelId) : 0

  const conicalPlacement = useMemo(() => {
    if (!(drawTarget && previewDimensions && roofType === 'conical')) return null
    return resolveConicalRoofPlacement({
      nodes: drawTarget.nodes,
      levelId: drawTarget.levelId,
      center: [previewDimensions.centerX, previewDimensions.centerZ],
      radius: Math.max(previewDimensions.length, previewDimensions.width) / 2,
      curbHeight: previewWallHeight,
      ...placementOptions(placementMode),
    })
  }, [drawTarget, placementMode, previewDimensions, previewWallHeight, roofType])

  const conicalWallGhost = useMemo(() => {
    if (!(roofType === 'conical' && footprintSource === 'walls' && previewedConicalWallId))
      return null
    const wall = nodes[previewedConicalWallId]
    if (wall?.type !== 'wall') return null
    const arc = getWallArcData(wall)
    if (!arc) return null
    const segment = RoofSegmentNode.parse({
      roofType: 'conical',
      width: arc.radius * 2,
      depth: arc.radius * 2,
      wallHeight: 0,
      pitch: DEFAULT_PITCH_DEG,
      conicalStartAngle: arc.startAngle,
      conicalSweepAngle: arc.delta,
      conicalFullCircle: true,
    })
    const geometry = generateRoofSegmentGeometry(segment)
    return {
      edges: new THREE.EdgesGeometry(geometry, 10),
      geometry,
      position: [
        arc.center.x,
        currentLevelId
          ? resolveRoofWallTopWorldElevation(currentLevelId, wall, nodes)
          : getWallBaseElevationForNodes(wall, nodes) + getWallEffectiveHeightForNodes(wall, nodes),
        arc.center.y,
      ] as [number, number, number],
    }
  }, [currentLevelId, footprintSource, nodes, previewedConicalWallId, roofType])

  const ghostWallHeight =
    footprintSource !== 'draw'
      ? 0
      : conicalPlacement?.valid === true
        ? conicalPlacement.wallHeight
        : previewWallHeight
  const ghostBaseY =
    footprintSource !== 'draw' && footprintTarget && currentLevelId
      ? resolveRoofFootprintWorldElevation(currentLevelId, footprintTarget, nodes)
      : levelY + drawLift + (conicalPlacement?.valid === true ? conicalPlacement.position[1] : 0)
  const ghostColor =
    footprintSource !== 'draw' &&
    footprintTarget &&
    !footprintTarget.rectangular &&
    roofType !== 'conical'
      ? '#ef4444'
      : footprintSource !== 'draw'
        ? '#22c55e'
        : conicalPlacement?.valid === false
          ? '#ef4444'
          : conicalPlacement?.kind === 'roof'
            ? '#22c55e'
            : '#818cf8'

  const roofGhostGeometry = useMemo(() => {
    if (
      invalidStandardWallHover ||
      !resolvedPreviewDimensions ||
      (roofType === 'conical' && footprintSource !== 'draw')
    )
      return null
    const placement = resolveRoofDraftPlacement(
      resolvedPreviewDimensions.length,
      resolvedPreviewDimensions.width,
      ridgeMode,
      0,
      roofType,
    )
    return buildRoofGhostGeometry(
      placement.width,
      placement.depth,
      ghostWallHeight,
      previewPitch,
      roofType,
    )
  }, [
    footprintSource,
    ghostWallHeight,
    invalidStandardWallHover,
    previewPitch,
    ridgeMode,
    resolvedPreviewDimensions,
    roofType,
  ])

  const roofGhostEdges = useMemo(() => {
    if (
      invalidStandardWallHover ||
      !resolvedPreviewDimensions ||
      (roofType === 'conical' && footprintSource !== 'draw')
    )
      return null
    const placement = resolveRoofDraftPlacement(
      resolvedPreviewDimensions.length,
      resolvedPreviewDimensions.width,
      ridgeMode,
      0,
      roofType,
    )
    return buildRoofGhostEdges(
      placement.width,
      placement.depth,
      ghostWallHeight,
      previewPitch,
      roofType,
    )
  }, [
    footprintSource,
    ghostWallHeight,
    invalidStandardWallHover,
    previewPitch,
    ridgeMode,
    resolvedPreviewDimensions,
    roofType,
  ])

  useEffect(() => {
    if (invalidStandardWallHover) outlineRef.current.visible = false
  }, [invalidStandardWallHover])

  useEffect(
    () => () => {
      roofGhostGeometry?.dispose()
      roofGhostEdges?.dispose()
    },
    [roofGhostEdges, roofGhostGeometry],
  )

  useEffect(
    () => () => {
      conicalWallGhost?.geometry.dispose()
      conicalWallGhost?.edges.dispose()
    },
    [conicalWallGhost],
  )

  return (
    <group>
      <CursorSphere ref={cursorRef} />

      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={outlineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.3}
          transparent
        />
      </line>

      {corner1 && (
        <CursorSphere
          color="#818cf8"
          position={[corner1[0], levelY + GRID_OFFSET, corner1[2]]}
          showTooltip={false}
        />
      )}

      {conicalWallGhost && (
        <group
          layers={EDITOR_LAYER}
          position={[
            conicalWallGhost.position[0],
            conicalWallGhost.position[1] + GRID_OFFSET,
            conicalWallGhost.position[2],
          ]}
        >
          <mesh geometry={conicalWallGhost.geometry} layers={EDITOR_LAYER} renderOrder={1}>
            <meshBasicMaterial
              color="#22c55e"
              depthTest={false}
              depthWrite={false}
              opacity={0.2}
              side={DoubleSide}
              transparent
            />
          </mesh>
          <lineSegments geometry={conicalWallGhost.edges} layers={EDITOR_LAYER} renderOrder={2}>
            <lineBasicMaterial
              color="#22c55e"
              depthTest={false}
              depthWrite={false}
              opacity={0.7}
              transparent
            />
          </lineSegments>
        </group>
      )}

      {!invalidStandardWallHover &&
        resolvedPreviewDimensions &&
        resolvedPreviewDimensions.length > 0.1 &&
        resolvedPreviewDimensions.width > 0.1 && (
          <group
            layers={EDITOR_LAYER}
            position={[
              resolvedPreviewDimensions.centerX,
              ghostBaseY + GRID_OFFSET,
              resolvedPreviewDimensions.centerZ,
            ]}
            rotation={[
              0,
              (footprintSource !== 'draw' ? (footprintTarget?.rotation ?? 0) : 0) +
                (roofType !== 'conical' &&
                ridgeQuarterTurn(
                  resolvedPreviewDimensions.length,
                  resolvedPreviewDimensions.width,
                  ridgeMode,
                )
                  ? Math.PI / 2
                  : 0),
              0,
            ]}
          >
            {roofGhostGeometry && (
              <mesh geometry={roofGhostGeometry} layers={EDITOR_LAYER} renderOrder={1}>
                <meshBasicMaterial
                  color={ghostColor}
                  depthTest={false}
                  depthWrite={false}
                  opacity={0.16}
                  side={DoubleSide}
                  transparent
                />
              </mesh>
            )}
            {roofGhostEdges && (
              <lineSegments geometry={roofGhostEdges} layers={EDITOR_LAYER} renderOrder={2}>
                <lineBasicMaterial
                  color={ghostColor}
                  depthTest={false}
                  depthWrite={false}
                  opacity={0.5}
                  transparent
                />
              </lineSegments>
            )}
          </group>
        )}
    </group>
  )
}

export default RoofTool
