'use client'

import {
  type AnyNode,
  emitter,
  findLevelAboveId,
  type GridEvent,
  getLevelElevations,
  type LevelNode,
  RoofNode,
  RoofSegmentNode,
  RoofType as RoofTypeSchema,
  type SceneApi,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearSurfacePlanSnapFeedback,
  EDITOR_LAYER,
  isGridSnapActive,
  markToolCancelConsumed,
  resolveSurfacePlanPointSnap,
  snapWorldXZForActiveBuilding,
  triggerSFX,
  useEditor,
  useFloorplanDraftPreview,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import useRoofOutlineSnap, {
  buildingOutlines,
  type OutlineSnap,
  snapToBuildingOutline,
  squareFromFace,
} from './outline-snap'
import { collectRoofAlignmentAnchors, createRoofNodes, getRoofSnapWalls } from './tool'

type PlanPoint = [number, number]

const DEFAULT_PITCH_DEG = 40
const Y_OFFSET = 0.02
// A click this close to the first point closes the outline (metres).
const CLOSE_DISTANCE = 0.25

const rotatePlan = ([x, z]: PlanPoint, angle: number): PlanPoint => [
  x * Math.cos(angle) + z * Math.sin(angle),
  -x * Math.sin(angle) + z * Math.cos(angle),
]

/**
 * Where a roof drawn over `outline` goes: its rectangle follows the longest
 * side of the outline and bounds it; the ridge runs along the longer side of
 * that rectangle unless `quarterTurn` swaps it. Pure, for the tool and tests.
 */
export function resolveOutlineRoofPlacement(outline: readonly PlanPoint[], quarterTurn: boolean) {
  let longest = 0
  let direction = 0
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length]!
    const length = Math.hypot(next[0] - point[0], next[1] - point[1])
    if (length > longest) {
      longest = length
      direction = Math.atan2(next[1] - point[1], next[0] - point[0])
    }
  })
  // Roof frame: local x along the longest side (`rotatePlan(local, r)` → level).
  const rotation = -direction
  const local = outline.map((point) => rotatePlan(point, -rotation))
  const xs = local.map((point) => point[0])
  const zs = local.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const centerLocal: PlanPoint = [(minX + maxX) / 2, (minZ + maxZ) / 2]
  const center = rotatePlan(centerLocal, rotation)
  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  // A gable's ridge runs along the segment's local x: put it on the longer span.
  const turn = spanZ > spanX !== quarterTurn
  const segmentRotation = turn ? Math.PI / 2 : 0
  return {
    center,
    rotation,
    segmentRotation,
    width: turn ? spanZ : spanX,
    depth: turn ? spanX : spanZ,
    footprint: local.map(([x, z]) =>
      rotatePlan([x - centerLocal[0], z - centerLocal[1]], -segmentRotation),
    ),
  }
}

export function commitRoofOutline(
  sceneApi: SceneApi,
  levelId: LevelNode['id'],
  outline: readonly PlanPoint[],
  quarterTurn: boolean,
): AnyNode['id'] | null {
  if (outline.length < 3) return null
  const nodes = sceneApi.nodes()
  const defaults = useEditor.getState().toolDefaults.roof ?? {}
  const parsedRoofType = RoofTypeSchema.safeParse(defaults.roofType)
  const roofType = parsedRoofType.success ? parsedRoofType.data : 'gable'
  if (roofType === 'conical') return null
  const placement = resolveOutlineRoofPlacement(outline, quarterTurn)
  const segment = RoofSegmentNode.parse({
    pitch: DEFAULT_PITCH_DEG,
    roofType: 'gable',
    ...defaults,
    // Seated on the walls, like a roof made from a room.
    wallHeight: 0,
    width: placement.width,
    depth: placement.depth,
    position: [0, 0, 0],
    rotation: placement.segmentRotation,
    footprint: placement.footprint,
  })
  // A roof belongs to the storey above the walls it covers; the top floor keeps
  // it on the walls' own level (same rule as a roof made from a room).
  const parentLevelId = (findLevelAboveId(levelId, getLevelElevations(nodes)) ??
    levelId) as LevelNode['id']
  const roofCount = Object.values(nodes).filter((node) => node.type === 'roof').length
  const roof = RoofNode.parse({
    ...defaults,
    name: `Roof ${roofCount + 1}`,
    position: [placement.center[0], 0, placement.center[1]],
    rotation: placement.rotation,
    // Follows the wall tops under it (`RoofElevationSystem`).
    support: { kind: 'walls' },
    children: [segment.id],
  })
  createRoofNodes(sceneApi, [
    { node: roof, parentId: parentLevelId },
    { node: segment, parentId: roof.id },
  ])
  triggerSFX('sfx:structure-build')
  return roof.id
}

/**
 * Outline mode of the roof tool: each click adds a point (snapped to wall
 * corners and faces like the other roof modes); clicking near the first point
 * or pressing Enter closes the outline and builds the roof of the selected
 * type over it. R turns the ridge 90°.
 */
export const RoofOutlineTool: React.FC = () => {
  const { activeLevelId: currentLevelId, sceneApi, selectNode } = useRegistryToolContext()
  const cursorRef = useRef<Group>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const [points, setPoints] = useState<PlanPoint[]>([])
  // The outer face the last point sits on (null: a corner or a free point).
  const lastFaceRef = useRef<OutlineSnap['face']>(null)
  const [cursor, setCursor] = useState<PlanPoint>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const [quarterTurn, setQuarterTurn] = useState(false)
  const roofDefaults = useEditor((state) => state.toolDefaults.roof)
  const parsedRoofType = RoofTypeSchema.safeParse(roofDefaults?.roofType)
  const roofType = parsedRoofType.success ? parsedRoofType.data : 'gable'
  const outlineSnap = useRoofOutlineSnap((state) => state.snap)

  useEffect(() => {
    useEditor.getState().setDraftVertexCount(points.length)
    useFloorplanDraftPreview.getState().setPolygonDraft('roof', points)
  }, [points])
  useEffect(
    () => () => {
      useEditor.getState().setDraftVertexCount(0)
      const draftPreview = useFloorplanDraftPreview.getState()
      if (draftPreview.polygonDraftType === 'roof') draftPreview.setPolygonDraft(null, [])
      draftPreview.setCursorPoint(null)
      clearSurfacePlanSnapFeedback()
    },
    [],
  )

  useEffect(() => {
    if (!currentLevelId) return
    const alignmentCandidates = collectRoofAlignmentAnchors(
      sceneApi.nodes(),
      currentLevelId,
      roofType,
    )
    // The building's outer contour (this storey and the one below), partitions excluded.
    const outlines =
      outlineSnap === 'building'
        ? buildingOutlines(getRoofSnapWalls(currentLevelId, sceneApi.nodes(), roofType))
        : []
    const resolveSnap = (event: GridEvent): OutlineSnap => {
      const rawPoint: PlanPoint = [event.localPosition[0], event.localPosition[2]]
      if (outlineSnap === 'building') {
        const last = points[points.length - 1]
        const square =
          last && lastFaceRef.current
            ? squareFromFace(last, lastFaceRef.current, rawPoint, outlines)
            : null
        return (
          square ?? snapToBuildingOutline(rawPoint, outlines) ?? { point: rawPoint, face: null }
        )
      }
      return { point: resolveGridPoint(event, rawPoint), face: null }
    }
    const resolvePoint = (event: GridEvent) => resolveSnap(event).point
    const resolveGridPoint = (event: GridEvent, rawPoint: PlanPoint): PlanPoint => {
      const gridFallback: PlanPoint = isGridSnapActive()
        ? snapWorldXZForActiveBuilding(
            event.position[0],
            event.position[2],
            useEditor.getState().gridSnapStep,
          ).local
        : rawPoint
      return resolveSurfacePlanPointSnap({
        rawPoint,
        fallbackPoint: gridFallback,
        walls: getRoofSnapWalls(currentLevelId, sceneApi.nodes(), roofType),
        candidates: alignmentCandidates,
        movingId: '__roof-outline__',
        highlightWalls: true,
      }).point
    }

    const finish = () => {
      // a double-click lands its two clicks on the same point: one corner
      const ring = points.filter((point, index) => {
        const next = points[(index + 1) % points.length]!
        return Math.hypot(next[0] - point[0], next[1] - point[1]) > 1e-6
      })
      if (ring.length < 3) return
      const roofId = commitRoofOutline(sceneApi, currentLevelId, ring, quarterTurn)
      if (roofId) selectNode(roofId)
      setPoints([])
      lastFaceRef.current = null
    }

    const onMove = (event: GridEvent) => {
      const point = resolvePoint(event)
      setCursor(point)
      setLevelY(event.localPosition[1])
      useFloorplanDraftPreview.getState().setCursorPoint(point)
      cursorRef.current?.position.set(point[0], event.localPosition[1], point[1])
    }
    const onClick = (event: GridEvent) => {
      const { point, face } = resolveSnap(event)
      const first = points[0]
      if (
        points.length >= 3 &&
        first &&
        Math.hypot(point[0] - first[0], point[1] - first[1]) < CLOSE_DISTANCE
      ) {
        finish()
        return
      }
      triggerSFX('sfx:structure-build-start')
      lastFaceRef.current = face
      setPoints([...points, point])
    }
    const onCancel = () => {
      if (points.length > 0) markToolCancelConsumed()
      setPoints([])
      lastFaceRef.current = null
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        finish()
      } else if ((event.key === 'r' || event.key === 'R') && !event.metaKey && !event.ctrlKey) {
        setQuarterTurn((value) => !value)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('grid:double-click', finish)
    emitter.on('tool:cancel', onCancel)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('grid:double-click', finish)
      emitter.off('tool:cancel', onCancel)
    }
  }, [currentLevelId, outlineSnap, points, quarterTurn, roofType, sceneApi, selectNode])

  useEffect(() => {
    if (!(mainLineRef.current && closingLineRef.current)) return
    const y = levelY + Y_OFFSET
    const line = [...points, cursor].map(([x, z]) => new Vector3(x, y, z))
    mainLineRef.current.visible = points.length > 0
    closingLineRef.current.visible = points.length >= 2
    if (points.length > 0) {
      mainLineRef.current.geometry.dispose()
      mainLineRef.current.geometry = new BufferGeometry().setFromPoints(line)
    }
    const first = points[0]
    if (points.length >= 2 && first) {
      closingLineRef.current.geometry.dispose()
      closingLineRef.current.geometry = new BufferGeometry().setFromPoints([
        new Vector3(cursor[0], y, cursor[1]),
        new Vector3(first[0], y, first[1]),
      ])
    }
  }, [points, cursor, levelY])

  const previewShape = useMemo(() => {
    if (points.length < 2) return null
    const all = [...points, cursor]
    const shape = new Shape()
    shape.moveTo(all[0]![0], -all[0]![1])
    for (const [x, z] of all.slice(1)) shape.lineTo(x, -z)
    shape.closePath()
    return shape
  }, [points, cursor])

  return (
    <group>
      <CursorSphere ref={cursorRef} />
      {previewShape && (
        <mesh
          frustumCulled={false}
          layers={EDITOR_LAYER}
          position={[0, levelY + Y_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#818cf8"
            depthTest={false}
            opacity={0.15}
            side={DoubleSide}
            transparent
          />
        </mesh>
      )}
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={mainLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial color="#818cf8" depthTest={false} depthWrite={false} linewidth={3} />
      </line>
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        // @ts-expect-error
        ref={closingLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.5}
          transparent
        />
      </line>
      {points.map(([x, z], index) => (
        <CursorSphere
          color="#818cf8"
          height={0}
          key={index}
          position={[x, levelY + Y_OFFSET + 0.01, z]}
          showTooltip={false}
        />
      ))}
    </group>
  )
}
