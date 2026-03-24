'use client'

import {
  type AnyNodeId,
  calculateLevelMiters,
  DEFAULT_WALL_HEIGHT,
  getWallPlanFootprint,
  type Point2D,
  pointToKey,
  sceneRegistry,
  useScene,
  type WallMiterData,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'

const GUIDE_Y_OFFSET = 0.08
const LABEL_LIFT = 0.08
const BAR_THICKNESS = 0.012
const LINE_OPACITY = 0.95

const BAR_AXIS = new THREE.Vector3(0, 1, 0)

type Vec3 = [number, number, number]

type MeasurementGuide = {
  guideStart: Vec3
  guideEnd: Vec3
  extStartStart: Vec3
  extStartEnd: Vec3
  extEndStart: Vec3
  extEndEnd: Vec3
  labelPosition: Vec3
}

function formatMeasurement(value: number, unit: 'metric' | 'imperial') {
  if (unit === 'imperial') {
    const feet = value * 3.280_84
    const wholeFeet = Math.floor(feet)
    const inches = Math.round((feet - wholeFeet) * 12)
    if (inches === 12) return `${wholeFeet + 1}'0"`
    return `${wholeFeet}'${inches}"`
  }
  return `${Number.parseFloat(value.toFixed(2))}m`
}

export function WallMeasurementLabel() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedNode = selectedId ? nodes[selectedId as WallNode['id']] : null
  const wall = selectedNode?.type === 'wall' ? selectedNode : null

  const [wallObject, setWallObject] = useState<THREE.Object3D | null>(null)

  useEffect(() => {
    setWallObject(null)
  }, [selectedId])

  useFrame(() => {
    if (!selectedId || wallObject) return

    const nextWallObject = sceneRegistry.nodes.get(selectedId)
    if (nextWallObject) {
      setWallObject(nextWallObject)
    }
  })

  if (!(wall && wallObject)) return null

  return createPortal(<WallMeasurementAnnotation wall={wall} />, wallObject)
}

function getLevelWalls(
  wall: WallNode,
  nodes: Record<string, WallNode | { type: string; children?: string[] }>,
): WallNode[] {
  if (!wall.parentId) return [wall]

  const levelNode = nodes[wall.parentId as AnyNodeId]
  if (!(levelNode && levelNode.type === 'level' && Array.isArray(levelNode.children))) {
    return [wall]
  }

  return levelNode.children
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is WallNode => Boolean(node && node.type === 'wall'))
}

function getWallMiddlePoints(
  wall: WallNode,
  miterData: WallMiterData,
): { start: Point2D; end: Point2D } | null {
  const footprint = getWallPlanFootprint(wall, miterData)
  if (footprint.length < 4) return null

  const startKey = pointToKey({ x: wall.start[0], y: wall.start[1] })
  const startJunction = miterData.junctionData.get(startKey)?.get(wall.id)

  const rightStart = footprint[0]
  const rightEnd = footprint[1]
  const leftEnd = footprint[startJunction ? footprint.length - 3 : footprint.length - 2]
  const leftStart = footprint[startJunction ? footprint.length - 2 : footprint.length - 1]

  if (!(leftStart && leftEnd && rightStart && rightEnd)) return null

  return {
    start: {
      x: (leftStart.x + rightStart.x) / 2,
      y: (leftStart.y + rightStart.y) / 2,
    },
    end: {
      x: (leftEnd.x + rightEnd.x) / 2,
      y: (leftEnd.y + rightEnd.y) / 2,
    },
  }
}

function worldPointToWallLocal(wall: WallNode, point: Point2D): Vec3 {
  const dx = point.x - wall.start[0]
  const dz = point.y - wall.start[1]
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const cosA = Math.cos(-angle)
  const sinA = Math.sin(-angle)

  return [dx * cosA - dz * sinA, 0, dx * sinA + dz * cosA]
}

function buildMeasurementGuide(
  wall: WallNode,
  nodes: Record<string, WallNode | { type: string; children?: string[] }>,
): MeasurementGuide | null {
  const levelWalls = getLevelWalls(wall, nodes)
  const miterData = calculateLevelMiters(levelWalls)
  const middlePoints = getWallMiddlePoints(wall, miterData)
  if (!middlePoints) return null

  const height = wall.height ?? DEFAULT_WALL_HEIGHT
  const startLocal = worldPointToWallLocal(wall, middlePoints.start)
  const endLocal = worldPointToWallLocal(wall, middlePoints.end)

  const guideStart: Vec3 = [startLocal[0], height + GUIDE_Y_OFFSET, startLocal[2]]
  const guideEnd: Vec3 = [endLocal[0], height + GUIDE_Y_OFFSET, endLocal[2]]

  const dirX = guideEnd[0] - guideStart[0]
  const dirZ = guideEnd[2] - guideStart[2]
  const dirLength = Math.hypot(dirX, dirZ)

  if (!Number.isFinite(dirLength) || dirLength < 0.001) return null

  // Extension lines coming out of the extremity markers of the wall
  const extOvershoot = 0.04

  return {
    guideStart,
    guideEnd,
    extStartStart: [startLocal[0], height, startLocal[2]],
    extStartEnd: [startLocal[0], height + GUIDE_Y_OFFSET + extOvershoot, startLocal[2]],
    extEndStart: [endLocal[0], height, endLocal[2]],
    extEndEnd: [endLocal[0], height + GUIDE_Y_OFFSET + extOvershoot, endLocal[2]],
    labelPosition: [
      (guideStart[0] + guideEnd[0]) / 2,
      guideStart[1] + LABEL_LIFT,
      (guideStart[2] + guideEnd[2]) / 2,
    ],
  }
}

function MeasurementBar({ start, end, color }: { start: Vec3; end: Vec3; color: string }) {
  const segment = useMemo(() => {
    const startVector = new THREE.Vector3(...start)
    const endVector = new THREE.Vector3(...end)
    const direction = endVector.clone().sub(startVector)
    const length = direction.length()

    if (!Number.isFinite(length) || length < 0.0001) return null

    return {
      length,
      position: startVector.clone().add(endVector).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(BAR_AXIS, direction.normalize()),
    }
  }, [end, start])

  if (!segment) return null

  return (
    <mesh
      position={[segment.position.x, segment.position.y, segment.position.z]}
      quaternion={segment.quaternion}
      renderOrder={1000}
    >
      <boxGeometry args={[BAR_THICKNESS, segment.length, BAR_THICKNESS]} />
      <meshBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        opacity={LINE_OPACITY}
        toneMapped={false}
        transparent
      />
    </mesh>
  )
}

function WallMeasurementAnnotation({ wall }: { wall: WallNode }) {
  const nodes = useScene((state) => state.nodes)
  const theme = useViewer((state) => state.theme)
  const unit = useViewer((state) => state.unit)
  const isNight = theme === 'dark'
  const color = isNight ? '#ffffff' : '#111111'
  const shadowColor = isNight ? '#111111' : '#ffffff'

  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  const label = formatMeasurement(length, unit)
  const guide = useMemo(
    () =>
      buildMeasurementGuide(
        wall,
        nodes as Record<string, WallNode | { type: string; children?: string[] }>,
      ),
    [nodes, wall],
  )

  if (!(guide && Number.isFinite(length) && length >= 0.01)) return null

  return (
    <group>
      <MeasurementBar color={color} end={guide.guideEnd} start={guide.guideStart} />
      <MeasurementBar color={color} end={guide.extStartEnd} start={guide.extStartStart} />
      <MeasurementBar color={color} end={guide.extEndEnd} start={guide.extEndStart} />

      <Html
        center
        position={guide.labelPosition}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[20, 0]}
      >
        <div
          className="whitespace-nowrap font-bold font-mono text-[15px]"
          style={{
            color,
            textShadow: `-1.5px -1.5px 0 ${shadowColor}, 1.5px -1.5px 0 ${shadowColor}, -1.5px 1.5px 0 ${shadowColor}, 1.5px 1.5px 0 ${shadowColor}, 0 0 4px ${shadowColor}, 0 0 4px ${shadowColor}`,
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  )
}
