'use client'

import {
  type AnyNodeId,
  calculateLevelMiters,
  DEFAULT_WALL_HEIGHT,
  getWallCurveLength,
  getWallMiterBoundaryPoints,
  isCurvedWall,
  getWallPlanFootprint,
  getWallSurfacePolygon,
  type Point2D,
  pointToKey,
  sampleWallCenterline,
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
  guidePath: Vec3[]
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

function getWallExteriorOffsetSign(wall: Pick<WallNode, 'frontSide' | 'backSide'>) {
  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') {
    return 1
  }

  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') {
    return -1
  }

  return 1
}

function getCurvedWallMeasurementPath(
  wall: WallNode,
  miterData: WallMiterData,
): Point2D[] | null {
  const boundaryPoints = getWallMiterBoundaryPoints(wall, miterData)
  if (!boundaryPoints) return null

  const surface = getWallSurfacePolygon(wall, 24, boundaryPoints)
  const sidePointCount = 25
  if (surface.length < sidePointCount * 2) return null

  const offsetSign = getWallExteriorOffsetSign(wall)
  if (offsetSign >= 0) {
    return surface.slice(sidePointCount).reverse()
  }

  return surface.slice(0, sidePointCount)
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
  const curvedMeasurementPath = isCurvedWall(wall)
    ? getCurvedWallMeasurementPath(wall, miterData)
    : null
  const guidePath: Vec3[] = curvedMeasurementPath
    ? curvedMeasurementPath.map((point) => {
        const localPoint = worldPointToWallLocal(wall, point)
        return [localPoint[0], height + GUIDE_Y_OFFSET, localPoint[2]]
      })
    : isCurvedWall(wall)
      ? sampleWallCenterline(wall, 24).map((point, index, points) => {
          const localPoint =
            index === 0
              ? startLocal
              : index === points.length - 1
                ? endLocal
                : worldPointToWallLocal(wall, point)

          return [localPoint[0], height + GUIDE_Y_OFFSET, localPoint[2]]
        })
    : [
        [startLocal[0], height + GUIDE_Y_OFFSET, startLocal[2]],
        [endLocal[0], height + GUIDE_Y_OFFSET, endLocal[2]],
      ]

  if (guidePath.length < 2) return null

  let guideLength = 0
  for (let index = 1; index < guidePath.length; index += 1) {
    const prev = guidePath[index - 1]!
    const next = guidePath[index]!
    guideLength += Math.hypot(next[0] - prev[0], next[2] - prev[2])
  }

  if (!Number.isFinite(guideLength) || guideLength < 0.001) return null

  // Extension lines coming out of the extremity markers of the wall
  const extOvershoot = 0.04
  const guideStart = guidePath[0]!
  const guideEnd = guidePath[guidePath.length - 1]!
  const extensionStartBase = curvedMeasurementPath ? guideStart : startLocal
  const extensionEndBase = curvedMeasurementPath ? guideEnd : endLocal
  const midpoint = curvedMeasurementPath
    ? guidePath[Math.floor(guidePath.length / 2)]!
    : ([
        (guideStart[0] + guideEnd[0]) / 2,
        guideStart[1],
        (guideStart[2] + guideEnd[2]) / 2,
      ] as Vec3)

  return {
    guidePath,
    extStartStart: [extensionStartBase[0], height, extensionStartBase[2]],
    extStartEnd: [
      extensionStartBase[0],
      height + GUIDE_Y_OFFSET + extOvershoot,
      extensionStartBase[2],
    ],
    extEndStart: [extensionEndBase[0], height, extensionEndBase[2]],
    extEndEnd: [
      extensionEndBase[0],
      height + GUIDE_Y_OFFSET + extOvershoot,
      extensionEndBase[2],
    ],
    labelPosition: [midpoint[0], midpoint[1] + LABEL_LIFT, midpoint[2]],
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

function MeasurementPath({ path, color }: { path: Vec3[]; color: string }) {
  return (
    <>
      {path.slice(1).map((point, index) => (
        <MeasurementBar color={color} end={point} key={index} start={path[index]!} />
      ))}
    </>
  )
}

function WallMeasurementAnnotation({ wall }: { wall: WallNode }) {
  const nodes = useScene((state) => state.nodes)
  const theme = useViewer((state) => state.theme)
  const unit = useViewer((state) => state.unit)
  const isNight = theme === 'dark'
  const color = isNight ? '#ffffff' : '#111111'
  const shadowColor = isNight ? '#111111' : '#ffffff'

  const guide = useMemo(
    () =>
      buildMeasurementGuide(
        wall,
        nodes as Record<string, WallNode | { type: string; children?: string[] }>,
      ),
    [nodes, wall],
  )
  const length = useMemo(() => {
    if (!guide?.guidePath?.length || guide.guidePath.length < 2) {
      return getWallCurveLength(wall)
    }

    let total = 0
    for (let index = 1; index < guide.guidePath.length; index += 1) {
      const prev = guide.guidePath[index - 1]!
      const next = guide.guidePath[index]!
      total += Math.hypot(next[0] - prev[0], next[2] - prev[2])
    }
    return total
  }, [guide, wall])
  const label = formatMeasurement(length, unit)

  if (!(guide && Number.isFinite(length) && length >= 0.01)) return null

  return (
    <group>
      <MeasurementPath color={color} path={guide.guidePath} />
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
