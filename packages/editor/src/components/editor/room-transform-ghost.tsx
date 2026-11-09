'use client'

import {
  type AnyNodeId,
  DEFAULT_LEVEL_HEIGHT,
  type Point,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  type Group,
  Path,
  Shape,
  ShapeGeometry,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import {
  type RoomTransformSession,
  transformRoomPoint,
  useRoomTransform,
} from '../../lib/room-transform-session'
import { useFloorplanRender } from '../editor-2d/floorplan-render-context'
import { DraftMeasurementLabel } from '../tools/shared/draft-measurement-label'

// The wall draft's colours: indigo while the room can land, red where it can't.
const GHOST_COLOR = '#818cf8'
const GHOST_COLOR_LIGHT_PLAN = '#6366f1'
const BLOCKED_COLOR = '#ef4444'

const noRaycast = () => {}

function ringShape<T extends Shape | Path>(target: T, ring: Point[]): T {
  ring.forEach(([x, z], i) => {
    if (i) target.lineTo(x, z)
    else target.moveTo(x, z)
  })
  target.closePath()
  return target
}

function ghostLabel(session: RoomTransformSession) {
  if (!session.valid) return session.message ?? null
  if (session.angle !== 0) {
    const degrees = Math.round((-session.angle * 180) / Math.PI)
    return `${degrees}°`
  }
  return null
}

/** The picked-up room riding the cursor in 3D: its floor and wall footprints. */
export function RoomTransformGhost3D() {
  const session = useRoomTransform((s) => s.session)
  const root = useRef<Group>(null)
  const levelId = session?.levelId
  const zone = useScene((s) => (session ? s.nodes[session.zoneId as AnyNodeId] : undefined))
  const levelHeight = useScene((s) => {
    const level = levelId ? s.nodes[levelId as AnyNodeId] : undefined
    return level?.type === 'level' ? (level.height ?? DEFAULT_LEVEL_HEIGHT) : DEFAULT_LEVEL_HEIGHT
  })
  const isDark = useViewer((s) => getSceneTheme(s.sceneTheme).appearance === 'dark')
  const elevation = zone?.type === 'zone' ? (zone.floor?.elevation ?? 0.05) : 0.05
  const color = session?.valid === false ? BLOCKED_COLOR : GHOST_COLOR
  const materials = useMemo(
    () => ({
      floor: new MeshBasicNodeMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        opacity: 0.22,
        side: DoubleSide,
        transparent: true,
      }),
      walls: new MeshBasicNodeMaterial({
        color,
        depthWrite: false,
        opacity: 0.35,
        side: DoubleSide,
        transparent: true,
      }),
      outline: new LineBasicNodeMaterial({ color, depthTest: false, depthWrite: false }),
    }),
    [color],
  )
  useEffect(
    () => () => {
      materials.floor.dispose()
      materials.walls.dispose()
      materials.outline.dispose()
    },
    [materials],
  )
  // Built once per pick-up at rest; the carry only moves the group below.
  const restOutline = session?.outline
  const restWalls = session?.walls
  const geometry = useMemo(() => {
    if (!(restOutline && restWalls)) return null
    const outline = restOutline
    const walls = restWalls
    const [outer, ...holes] = outline
    if (!outer) return null
    const shape = ringShape(new Shape(), outer)
    shape.holes = holes.map((ring) => ringShape(new Path(), ring))
    const floor = new ShapeGeometry(shape).rotateX(Math.PI / 2)
    const wallShapes = walls
      .filter((ring) => ring.length >= 3)
      .map((ring) => ringShape(new Shape(), ring))
    const wallMesh = wallShapes.length
      ? new ExtrudeGeometry(wallShapes, { depth: levelHeight, bevelEnabled: false }).rotateX(
          Math.PI / 2,
        )
      : null
    const positions: number[] = []
    for (const ring of [...outline, ...walls])
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          b = ring[(i + 1) % ring.length]!
        positions.push(a[0], 0, a[1], b[0], 0, b[1])
      }
    const lines = new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3),
    )
    return { floor, walls: wallMesh, lines }
  }, [restOutline, restWalls, levelHeight])
  useEffect(
    () => () => {
      geometry?.floor.dispose()
      geometry?.walls?.dispose()
      geometry?.lines.dispose()
    },
    [geometry],
  )
  useFrame(() => {
    const level = levelId ? sceneRegistry.nodes.get(levelId) : null
    if (!root.current) return
    root.current.visible = !!level
    if (level) {
      level.updateWorldMatrix(true, false)
      root.current.matrix.copy(level.matrixWorld)
    }
  })
  if (!(session && geometry)) return null
  const label = ghostLabel(session)
  const at = transformRoomPoint(session.pivot, session.pivot, session.angle, session.translate)
  // The planner's transform as a group transform: rotation about the pivot
  // (three's Y rotation has the planner's handedness), then the translation.
  const [px, pz] = session.pivot
  return (
    <group matrixAutoUpdate={false} ref={root}>
      <group
        position={[px + session.translate[0], 0, pz + session.translate[1]]}
        rotation={[0, session.angle, 0]}
      >
        <group position={[-px, 0, -pz]}>
          <mesh
            geometry={geometry.floor}
            layers={EDITOR_LAYER}
            material={materials.floor}
            position-y={elevation + 0.03}
            raycast={noRaycast}
            renderOrder={100}
          />
          {geometry.walls && (
            <mesh
              geometry={geometry.walls}
              layers={EDITOR_LAYER}
              material={materials.walls}
              // Extruded downward from the footprint plane, so lift it by the height.
              position-y={elevation + levelHeight}
              raycast={noRaycast}
              renderOrder={99}
            />
          )}
          <lineSegments
            geometry={geometry.lines}
            layers={EDITOR_LAYER}
            material={materials.outline}
            position-y={elevation + 0.04}
            raycast={noRaycast}
            renderOrder={101}
          />
        </group>
      </group>
      {label && (
        <DraftMeasurementLabel
          color={session.valid ? (isDark ? '#ffffff' : '#111111') : BLOCKED_COLOR}
          label={label}
          position={[at[0], elevation + 0.4, at[1]]}
          shadowColor={isDark ? '#111111' : '#ffffff'}
        />
      )}
    </group>
  )
}

/** The picked-up room on the plan. */
export function RoomTransformGhost2D({ levelId }: { levelId: string | null }) {
  const session = useRoomTransform((s) => s.session)
  const context = useFloorplanRender()
  const isDark = useViewer((s) => getSceneTheme(s.sceneTheme).appearance === 'dark')
  const restOutline = session?.outline
  const restWalls = session?.walls
  const paths = useMemo(() => {
    if (!(restOutline && restWalls)) return null
    const ring = (points: Point[]) => `M ${points.map((p) => p.join(' ')).join(' L ')} Z`
    return { floor: restOutline.map(ring).join(' '), walls: restWalls.map(ring).join(' ') }
  }, [restOutline, restWalls])
  if (!(session && paths) || session.levelId !== levelId) return null
  const upp = context?.unitsPerPixel ?? 0.01
  const color = session.valid ? (isDark ? GHOST_COLOR : GHOST_COLOR_LIGHT_PLAN) : BLOCKED_COLOR
  const label = ghostLabel(session)
  const at = transformRoomPoint(session.pivot, session.pivot, session.angle, session.translate)
  return (
    <g data-room-transform-ghost pointerEvents="none">
      <g
        transform={`translate(${session.pivot[0] + session.translate[0]} ${session.pivot[1] + session.translate[1]}) rotate(${(-session.angle * 180) / Math.PI}) translate(${-session.pivot[0]} ${-session.pivot[1]})`}
      >
        <path d={paths.floor} fill={color} fillOpacity={0.18} fillRule="evenodd" />
        <path
          d={paths.walls}
          fill={color}
          fillOpacity={0.35}
          stroke={color}
          strokeWidth={1.5 * upp}
        />
      </g>
      {label && (
        <g
          transform={`translate(${at[0]} ${at[1]}) rotate(${-(context?.sceneRotationDeg ?? 0)}) scale(${upp})`}
        >
          <text
            dominantBaseline="middle"
            fill={session.valid ? (context?.palette.measurementStroke ?? color) : BLOCKED_COLOR}
            fontSize={12}
            fontWeight={600}
            paintOrder="stroke"
            stroke={isDark ? '#0f172a' : '#ffffff'}
            strokeLinejoin="round"
            strokeWidth={3}
            textAnchor="middle"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  )
}
