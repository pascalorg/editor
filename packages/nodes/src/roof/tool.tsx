'use client'

import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  getWallArcData,
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
  isCurvedWall,
  type LevelNode,
  RoofNode,
  RoofSegmentNode,
  type RoofType,
  RoofType as RoofTypeSchema,
  resolveBuildingForLevel,
  type SceneApi,
  sceneRegistry,
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
  type RoofFootprintTarget,
  resolveRoofFootprintElevation,
  resolveRoofFootprintWorldElevation,
  resolveRoofWallTopWorldElevation,
  resolveRoomRoofFootprint,
  subscribeToConicalRoofWallClicks,
} from './roof-footprint'
import useRoofPlacementMode, { type RoofPlacementMode } from './roof-placement-mode'

const DEFAULT_WALL_HEIGHT = 0.5
const DEFAULT_PITCH_DEG = 40
const GRID_OFFSET = 0.02

function createRoofNodes(
  sceneApi: SceneApi,
  ops: Parameters<NonNullable<SceneApi['createMany']>>[0],
): void {
  if (sceneApi.createMany) {
    sceneApi.createMany(ops)
    return
  }
  for (const op of ops) sceneApi.upsert(op.node, op.parentId)
}

function placementOptions(mode: RoofPlacementMode) {
  return {
    allowRoofSupport: mode !== 'ground',
    requireRoofSupport: mode === 'roof',
  }
}

function resolveRoofDraftPlacement(
  footprintWidth: number,
  footprintDepth: number,
  quarterTurn: boolean,
  parentRotation = 0,
  roofType: RoofType = 'gable',
) {
  if (roofType === 'conical') {
    const diameter = Math.max(footprintWidth, footprintDepth)
    return { width: diameter, depth: diameter, rotation: -parentRotation }
  }
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

// Walls on the level directly beneath the active one. Levels share the same
// local XZ origin (they only differ in world Y), so these walls live in the
// identical coordinate frame and feed straight into both the alignment pool
// and the magnetic wall-snap pipeline — letting a roof drawn on the upper
// floor snap onto the wall corners of the floor below.
function getBelowLevelWalls(
  currentLevelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
): WallNode[] {
  if (!currentLevelId) return []
  const currentLevel = nodes[currentLevelId]
  if (currentLevel?.type !== 'level') return []
  const buildingId = resolveBuildingForLevel(currentLevel.id, nodes)
  if (!buildingId) return []
  const building = nodes[buildingId]
  if (building?.type !== 'building') return []
  const currentIndex = (currentLevel as LevelNode).level
  const belowLevel = (building.children ?? [])
    .map((childId) => nodes[childId])
    .filter((node): node is LevelNode => node?.type === 'level' && node.level < currentIndex)
    .sort((a, b) => b.level - a.level)[0]
  return getLevelWalls(belowLevel?.id ?? null, nodes)
}

// Current-level + floor-below walls — the magnetic snap targets the roof draft
// locks onto (corners, midpoints, crossings, wall bodies), matching the wall
// tool. Same coordinate frame, so no transform is needed.
function getRoofSnapWalls(
  currentLevelId: string | null,
  nodes: Readonly<Record<string, AnyNode>>,
  roofType: RoofType,
): WallNode[] {
  const walls = [
    ...getLevelWalls(currentLevelId, nodes),
    ...getBelowLevelWalls(currentLevelId, nodes),
  ]
  return roofType === 'conical'
    ? walls.filter((wall) => isCurvedWall(wall))
    : walls.filter(isStandardRoofWallEligible)
}

// Current-level alignment anchors plus the floor-below wall corners.
function collectRoofAlignmentAnchors(
  nodes: Readonly<Record<string, AnyNode>>,
  currentLevelId: string | null,
  roofType: RoofType,
): AlignmentAnchor[] {
  const anchors = [
    ...collectAlignmentAnchors(nodes, '', currentLevelId),
    ...getBelowLevelWalls(currentLevelId, nodes).flatMap((wall) =>
      wallSegmentAnchors(wall.id, wall.start, wall.end, wall.thickness),
    ),
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
 * Creates a roof group with one default gable segment
 */
const commitRoofPlacement = (
  sceneApi: SceneApi,
  levelId: LevelNode['id'],
  corner1: [number, number, number],
  corner2: [number, number, number],
  selectedIds: string[],
  quarterTurn: boolean,
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
      typeof defaults.wallHeight === 'number' ? defaults.wallHeight : DEFAULT_WALL_HEIGHT
    const resolved = resolveConicalRoofPlacement({
      nodes,
      levelId,
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

    createRoofNodes(sceneApi, [
      { node: roof, parentId: levelId },
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
    let localX = centerX
    let localZ = centerZ

    // Convert world coordinates to the local space of the parent roof
    const targetObj = sceneRegistry.nodes.get(targetRoofId)
    if (targetObj) {
      const worldVec = new THREE.Vector3(centerX, 0, centerZ)
      targetObj.worldToLocal(worldVec)
      localX = worldVec.x
      localZ = worldVec.z
    } else {
      // Math fallback if mesh isn't ready
      const dx = centerX - targetRoof.position[0]
      const dz = centerZ - targetRoof.position[2]
      const angle = -targetRoof.rotation
      localX = dx * Math.cos(angle) - dz * Math.sin(angle)
      localZ = dx * Math.sin(angle) + dz * Math.cos(angle)
    }

    const placement = resolveRoofDraftPlacement(
      footprintWidth,
      footprintDepth,
      quarterTurn,
      targetRoof.rotation,
      roofType,
    )

    const segment = RoofSegmentNode.parse({
      wallHeight: DEFAULT_WALL_HEIGHT,
      pitch: DEFAULT_PITCH_DEG,
      roofType: 'gable',
      ...defaults,
      width: placement.width,
      depth: placement.depth,
      position: [localX, 0, localZ],
      rotation: placement.rotation,
    })

    sceneApi.upsert(segment, targetRoofId as AnyNode['id'])
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
    quarterTurn,
    roofRotation,
    roofType,
  )

  // Create the segment first (centered in its new parent)
  const segment = RoofSegmentNode.parse({
    wallHeight: DEFAULT_WALL_HEIGHT,
    pitch: DEFAULT_PITCH_DEG,
    roofType: 'gable',
    ...defaults,
    width: placement.width,
    depth: placement.depth,
    position: [0, 0, 0],
    rotation: placement.rotation,
  })

  // Create the roof container. Segment-shaped params (roofType, pitch, …) are
  // dropped by the RoofNode schema; surface materials in `defaults` carry over.
  const roof = RoofNode.parse({
    ...defaults,
    name,
    position: [centerX, 0, centerZ],
    children: [segment.id],
  })

  // Create roof first (so segment can be parented to it), then segment
  createRoofNodes(sceneApi, [
    { node: roof, parentId: levelId },
    { node: segment, parentId: roof.id },
  ])

  triggerSFX('sfx:structure-build')
  return roof.id
}

const commitRoofFootprint = (
  sceneApi: SceneApi,
  levelId: LevelNode['id'],
  target: RoofFootprintTarget,
  quarterTurn: boolean,
): AnyNode['id'] | null => {
  if (!target.rectangular) return null
  const nodes = sceneApi.nodes()
  const defaults = useEditor.getState().toolDefaults.roof ?? {}
  const parsedRoofType = RoofTypeSchema.safeParse(defaults.roofType)
  const roofType = parsedRoofType.success ? parsedRoofType.data : 'gable'
  if (roofType === 'conical') return null
  const roofCount = Object.values(nodes).filter((node) => node.type === 'roof').length
  const segment = RoofSegmentNode.parse({
    pitch: DEFAULT_PITCH_DEG,
    roofType: 'gable',
    ...defaults,
    wallHeight: 0,
    width: quarterTurn ? target.depth : target.width,
    depth: quarterTurn ? target.width : target.depth,
    position: [0, 0, 0],
    rotation: quarterTurn ? Math.PI / 2 : 0,
  })
  const roof = RoofNode.parse({
    ...defaults,
    name: `Roof ${roofCount + 1}`,
    position: [
      target.center[0],
      resolveRoofFootprintElevation(levelId, target, nodes),
      target.center[1],
    ],
    rotation: target.rotation,
    children: [segment.id],
  })
  createRoofNodes(sceneApi, [
    { node: roof, parentId: levelId },
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
  const footprintSource = parseRoofFootprintSource(roofDefaults?.footprintSource, roofType)
  const previewWallHeight =
    typeof roofDefaults?.wallHeight === 'number' ? roofDefaults.wallHeight : DEFAULT_WALL_HEIGHT
  const previewPitch =
    typeof roofDefaults?.pitch === 'number' ? roofDefaults.pitch : DEFAULT_PITCH_DEG

  const selectedIdsRef = useRef(selectedIds)
  useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])

  useEffect(() => {
    useRoofPlacementMode.getState().setConical(roofType === 'conical')
    return () => useRoofPlacementMode.getState().setConical(false)
  }, [roofType])

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

  const corner1Ref = useRef<[number, number, number] | null>(null)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const quarterTurnRef = useRef(false)
  const [quarterTurn, setQuarterTurn] = useState(false)
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
    useFloorplanDraftPreview.getState().setRoofDraftQuarterTurn(quarterTurnRef.current)

    // Alignment candidates — anchors of every alignable object on the active
    // level plus the wall corners of the floor directly below, so a roof drawn
    // on the upper floor aligns to the walls beneath it. Refreshed after each
    // roof commits. Both corners of the rectangle align.
    let alignmentCandidates = collectRoofAlignmentAnchors(
      sceneApi.nodes(),
      currentLevelId,
      roofType,
    )

    // Resolve a grid:move/click into the drafted corner via the shared surface
    // snap pipeline: magnetic lock onto wall corners / midpoints / crossings /
    // bodies on the active level + floor below (raising the green beacon),
    // falling back to alignment guides, then to the world-grid snap. The same
    // path the slab/ceiling tools use, so the beacon and coloring match. The
    // pipeline reads the active snapping mode (grid / lines / angles / off),
    // so this tool never inspects the flags. `levelId` is intentionally omitted
    // so the explicit floor-below `walls` aren't filtered back out.
    const resolveDraftPoint = (event: GridEvent): [number, number] => {
      const rawPoint: [number, number] = [event.localPosition[0], event.localPosition[2]]
      const gridFallback: [number, number] = isGridSnapActive()
        ? snapWorldXZForActiveBuilding(
            event.position[0],
            event.position[2],
            useEditor.getState().gridSnapStep,
          ).local
        : rawPoint
      const nodes = sceneApi.nodes()
      return resolveSurfacePlanPointSnap({
        rawPoint,
        fallbackPoint: gridFallback,
        walls: getRoofSnapWalls(currentLevelId, nodes, roofType),
        candidates: alignmentCandidates,
        movingId: '__roof-draft__',
        highlightWalls: true,
      }).point
    }

    const updateFootprintPreview = (target: RoofFootprintTarget | null) => {
      setFootprintTarget((previous) => (previous?.id === target?.id ? previous : target))
      if (previewTargetIdRef.current === (target?.id ?? null)) return
      previewTargetIdRef.current = target?.id ?? null
      setPreviewSelectedIds(target?.wallIds ?? [])
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
          typeof defaults?.wallHeight === 'number' ? defaults.wallHeight : DEFAULT_WALL_HEIGHT
        const placement = resolveConicalRoofPlacement({
          nodes: sceneApi.nodes(),
          levelId: currentLevelId,
          center: [centerX, centerZ],
          radius: diameter / 2,
          curbHeight,
          ...placementOptions(useRoofPlacementMode.getState().mode),
        })
        if (placement.valid) {
          gridY =
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

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return

      if (footprintSource !== 'draw') {
        const [snappedX, snappedZ] = resolveDraftPoint(event)
        let target: RoofFootprintTarget | null = null
        if (footprintSource === 'room') {
          target = resolveRoomRoofFootprint(
            currentLevelId,
            sceneApi.nodes(),
            [snappedX, snappedZ],
            {
              rectangularOnly: true,
            },
          )
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
        updateOutline(corner1Ref.current, cursorPosition)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (!currentLevelId) return

      if (footprintSource !== 'draw') {
        if (footprintSource !== 'room') return
        const [snappedX, snappedZ] = resolveDraftPoint(event)
        const target = resolveRoomRoofFootprint(
          currentLevelId,
          sceneApi.nodes(),
          [snappedX, snappedZ],
          { rectangularOnly: true },
        )
        if (!target) return
        const roofId = commitRoofFootprint(sceneApi, currentLevelId, target, quarterTurnRef.current)
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
          quarterTurnRef.current,
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

    const onCancel = () => {
      if (corner1Ref.current) {
        markToolCancelConsumed()
        corner1Ref.current = null
        const draftPreview = useFloorplanDraftPreview.getState()
        draftPreview.setRoofDraftStart(null)
        draftPreview.setRoofDraftEnd(null)
        outlineRef.current.visible = false
        setPreview((prev) => ({ ...prev, corner1: null }))
      }
      clearSurfacePlanSnapFeedback()
      previewTargetIdRef.current = null
      setPreviewSelectedIds([])
    }

    const onKeyDown = (event: KeyboardEvent) => {
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
      const nextQuarterTurn = !quarterTurnRef.current
      quarterTurnRef.current = nextQuarterTurn
      setQuarterTurn(nextQuarterTurn)
      useFloorplanDraftPreview.getState().setRoofDraftQuarterTurn(nextQuarterTurn)
      triggerSFX('sfx:item-rotate')
    }

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
      clearSurfacePlanSnapFeedback()
      previewTargetIdRef.current = null
      setPreviewedConicalWallId(null)
      setInvalidStandardWallHover(false)
      setPreviewSelectedIds([])

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

  const conicalPlacement = useMemo(() => {
    if (!(currentLevelId && previewDimensions && roofType === 'conical')) return null
    return resolveConicalRoofPlacement({
      nodes,
      levelId: currentLevelId,
      center: [previewDimensions.centerX, previewDimensions.centerZ],
      radius: Math.max(previewDimensions.length, previewDimensions.width) / 2,
      curbHeight: previewWallHeight,
      ...placementOptions(placementMode),
    })
  }, [currentLevelId, nodes, placementMode, previewDimensions, previewWallHeight, roofType])

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
      : conicalPlacement?.valid === true
        ? conicalPlacement.position[1]
        : levelY
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
      quarterTurn,
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
    quarterTurn,
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
      quarterTurn,
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
    quarterTurn,
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
                (roofType === 'conical' ? 0 : quarterTurn ? Math.PI / 2 : 0),
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
