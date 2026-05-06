'use client'

import {
  type AnyNodeId,
  calculateLevelMiters,
  DEFAULT_WALL_HEIGHT,
  getScaledDimensions,
  getWallCurveLength,
  getWallMiterBoundaryPoints,
  getWallPlanFootprint,
  getWallSurfacePolygon,
  type ItemNode,
  isCurvedWall,
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
import { useMemo, useState } from 'react'
import * as THREE from 'three'

const GUIDE_Y_OFFSET = 0.08
const LABEL_LIFT = 0.08
const BAR_THICKNESS = 0.012
const LINE_OPACITY = 0.95
const HEIGHT_TICK_HALF_LENGTH = 0.14
const HEIGHT_GUIDE_OUTSIDE_OFFSET = 0.16

const BAR_AXIS = new THREE.Vector3(0, 1, 0)

type Vec3 = [number, number, number]

type MeasurementGuide = {
  guidePath: Vec3[]
  extStartStart: Vec3
  extStartEnd: Vec3
  extEndStart: Vec3
  extEndEnd: Vec3
  labelPosition: Vec3
  heightStart: Vec3
  heightEnd: Vec3
  heightBottomTickStart: Vec3
  heightBottomTickEnd: Vec3
  heightTopTickStart: Vec3
  heightTopTickEnd: Vec3
  heightLabelPosition: Vec3
}

type WallFaceLine = {
  start: Point2D
  end: Point2D
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
  const selectedNode = selectedId ? nodes[selectedId as AnyNodeId] : null
  const measurableNode =
    selectedNode?.type === 'wall' || selectedNode?.type === 'item' ? selectedNode : null

  const [objectState, setObjectState] = useState<{
    id: AnyNodeId
    object: THREE.Object3D
  } | null>(null)
  const selectedObject = selectedId && objectState?.id === selectedId ? objectState.object : null

  useFrame(() => {
    if (!selectedId || selectedObject) return

    const nextObject = sceneRegistry.nodes.get(selectedId)
    if (nextObject) {
      setObjectState({ id: selectedId as AnyNodeId, object: nextObject })
    }
  })

  if (!(measurableNode && selectedObject)) return null

  return createPortal(<SelectedMeasurementAnnotation node={measurableNode} />, selectedObject)
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

function pointMatchesWallPlanPoint(point: Point2D | undefined, planPoint: [number, number]) {
  if (!point) return false

  return Math.abs(point.x - planPoint[0]) < 1e-6 && Math.abs(point.y - planPoint[1]) < 1e-6
}

function getWallFaceLines(
  wall: WallNode,
  miterData: WallMiterData,
): { left: WallFaceLine; right: WallFaceLine } | null {
  if (isCurvedWall(wall)) return null

  const footprint = getWallPlanFootprint(wall, miterData)
  if (footprint.length < 4) return null

  const startRight = footprint[0]
  const endRight = footprint[1]
  const hasEndCenterPoint = pointMatchesWallPlanPoint(footprint[2], wall.end)
  const endLeft = footprint[hasEndCenterPoint ? 3 : 2]
  const lastPoint = footprint[footprint.length - 1]
  const hasStartCenterPoint = pointMatchesWallPlanPoint(lastPoint, wall.start)
  const startLeft = footprint[hasStartCenterPoint ? footprint.length - 2 : footprint.length - 1]

  if (!(startRight && endRight && endLeft && startLeft)) return null

  return {
    left: {
      start: startLeft,
      end: endLeft,
    },
    right: {
      start: startRight,
      end: endRight,
    },
  }
}

function getLineMidpoint(line: WallFaceLine): Point2D {
  return {
    x: (line.start.x + line.end.x) / 2,
    y: (line.start.y + line.end.y) / 2,
  }
}

function getLevelWallsCenter(levelWalls: WallNode[]): Point2D {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const candidateWall of levelWalls) {
    minX = Math.min(minX, candidateWall.start[0], candidateWall.end[0])
    maxX = Math.max(maxX, candidateWall.start[0], candidateWall.end[0])
    minY = Math.min(minY, candidateWall.start[1], candidateWall.end[1])
    maxY = Math.max(maxY, candidateWall.start[1], candidateWall.end[1])
  }

  return {
    x: minX === Number.POSITIVE_INFINITY ? 0 : (minX + maxX) / 2,
    y: minY === Number.POSITIVE_INFINITY ? 0 : (minY + maxY) / 2,
  }
}

function getWallOuterFaceLine(
  wall: WallNode,
  miterData: WallMiterData,
  levelWalls: WallNode[],
): WallFaceLine | null {
  const faceLines = getWallFaceLines(wall, miterData)
  if (!faceLines) return null

  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') {
    return faceLines.left
  }

  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') {
    return faceLines.right
  }

  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return null

  const wallMidpoint = {
    x: (wall.start[0] + wall.end[0]) / 2,
    y: (wall.start[1] + wall.end[1]) / 2,
  }
  const levelCenter = getLevelWallsCenter(levelWalls)
  const normal = { x: -dy / length, y: dx / length }
  const fromCenter = {
    x: wallMidpoint.x - levelCenter.x,
    y: wallMidpoint.y - levelCenter.y,
  }
  const outwardNormal =
    fromCenter.x * normal.x + fromCenter.y * normal.y >= 0 ? normal : { x: -normal.x, y: -normal.y }
  const rightMidpoint = getLineMidpoint(faceLines.right)
  const leftMidpoint = getLineMidpoint(faceLines.left)
  const rightScore =
    (rightMidpoint.x - wallMidpoint.x) * outwardNormal.x +
    (rightMidpoint.y - wallMidpoint.y) * outwardNormal.y
  const leftScore =
    (leftMidpoint.x - wallMidpoint.x) * outwardNormal.x +
    (leftMidpoint.y - wallMidpoint.y) * outwardNormal.y

  return rightScore >= leftScore ? faceLines.right : faceLines.left
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

function getWallExteriorOffsetSign(
  wall: Pick<WallNode, 'start' | 'end' | 'frontSide' | 'backSide'>,
  levelWalls: WallNode[],
) {
  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') {
    return 1
  }

  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') {
    return -1
  }

  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)

  if (length < 1e-6) return 1

  const wallMidpoint = {
    x: (wall.start[0] + wall.end[0]) / 2,
    y: (wall.start[1] + wall.end[1]) / 2,
  }
  const levelCenter = getLevelWallsCenter(levelWalls)
  const normal = { x: -dy / length, y: dx / length }
  const fromCenter = {
    x: wallMidpoint.x - levelCenter.x,
    y: wallMidpoint.y - levelCenter.y,
  }

  return fromCenter.x * normal.x + fromCenter.y * normal.y >= 0 ? 1 : -1
}

function getCurvedWallMeasurementPath(
  wall: WallNode,
  miterData: WallMiterData,
  levelWalls: WallNode[],
): Point2D[] | null {
  const boundaryPoints = getWallMiterBoundaryPoints(wall, miterData)
  if (!boundaryPoints) return null

  const surface = getWallSurfacePolygon(wall, 24, boundaryPoints)
  const sidePointCount = 25
  if (surface.length < sidePointCount * 2) return null

  const offsetSign = getWallExteriorOffsetSign(wall, levelWalls)
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
  const measurementLine = getWallOuterFaceLine(wall, miterData, levelWalls)
  const fallbackMiddlePoints = measurementLine ? null : getWallMiddlePoints(wall, miterData)
  const measurementPoints = measurementLine ?? fallbackMiddlePoints
  if (!measurementPoints) return null

  const height = wall.height ?? DEFAULT_WALL_HEIGHT
  const startLocal = worldPointToWallLocal(wall, measurementPoints.start)
  const endLocal = worldPointToWallLocal(wall, measurementPoints.end)
  const curvedMeasurementPath = isCurvedWall(wall)
    ? getCurvedWallMeasurementPath(wall, miterData, levelWalls)
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
  const rawHeightGuidePosition = [guideEnd[0], 0, guideEnd[2]] as Vec3
  const beforeGuideEnd = guidePath[guidePath.length - 2] ?? guideStart
  const tickDx = guideEnd[0] - beforeGuideEnd[0]
  const tickDz = guideEnd[2] - beforeGuideEnd[2]
  const tickLength = Math.hypot(tickDx, tickDz)
  const tangentX = tickLength > 1e-6 ? tickDx / tickLength : 1
  const tangentZ = tickLength > 1e-6 ? tickDz / tickLength : 0
  const tickUnitX = -tangentZ
  const tickUnitZ = tangentX
  const wallEndLocal = worldPointToWallLocal(wall, { x: wall.end[0], y: wall.end[1] })
  const endOutwardX = rawHeightGuidePosition[0] - wallEndLocal[0]
  const endOutwardZ = rawHeightGuidePosition[2] - wallEndLocal[2]
  const outsideSign = endOutwardX * tickUnitX + endOutwardZ * tickUnitZ >= 0 ? 1 : -1
  const heightGuidePosition = [
    rawHeightGuidePosition[0] + tickUnitX * outsideSign * HEIGHT_GUIDE_OUTSIDE_OFFSET,
    0,
    rawHeightGuidePosition[2] + tickUnitZ * outsideSign * HEIGHT_GUIDE_OUTSIDE_OFFSET,
  ] as Vec3
  const getHorizontalHeightTick = (y: number): { start: Vec3; end: Vec3 } => ({
    start: [
      heightGuidePosition[0] - tickUnitX * HEIGHT_TICK_HALF_LENGTH,
      y,
      heightGuidePosition[2] - tickUnitZ * HEIGHT_TICK_HALF_LENGTH,
    ],
    end: [
      heightGuidePosition[0] + tickUnitX * HEIGHT_TICK_HALF_LENGTH,
      y,
      heightGuidePosition[2] + tickUnitZ * HEIGHT_TICK_HALF_LENGTH,
    ],
  })
  const bottomHeightTick = getHorizontalHeightTick(0)
  const topHeightTick = getHorizontalHeightTick(height)

  return {
    guidePath,
    extStartStart: [extensionStartBase[0], height, extensionStartBase[2]],
    extStartEnd: [
      extensionStartBase[0],
      height + GUIDE_Y_OFFSET + extOvershoot,
      extensionStartBase[2],
    ],
    extEndStart: [extensionEndBase[0], height, extensionEndBase[2]],
    extEndEnd: [extensionEndBase[0], height + GUIDE_Y_OFFSET + extOvershoot, extensionEndBase[2]],
    labelPosition: [midpoint[0], midpoint[1] + LABEL_LIFT, midpoint[2]],
    heightStart: [heightGuidePosition[0], 0, heightGuidePosition[2]],
    heightEnd: [heightGuidePosition[0], height, heightGuidePosition[2]],
    heightBottomTickStart: bottomHeightTick.start,
    heightBottomTickEnd: bottomHeightTick.end,
    heightTopTickStart: topHeightTick.start,
    heightTopTickEnd: topHeightTick.end,
    heightLabelPosition: [heightGuidePosition[0], height / 2, heightGuidePosition[2]],
  }
}

type HeightGuide = {
  start: Vec3
  end: Vec3
  labelPosition: Vec3
}

function buildItemHeightGuide(item: ItemNode): { guide: HeightGuide; height: number } | null {
  const [width, height, depth] = getScaledDimensions(item)

  if (!Number.isFinite(height) || height < 0.01) return null

  const x = Number.isFinite(width) ? width / 2 + 0.18 : 0.18
  const z = Number.isFinite(depth) ? depth / 2 + 0.18 : 0.18

  return {
    height,
    guide: {
      start: [x, 0, z],
      end: [x, height, z],
      labelPosition: [x, height / 2, z],
    },
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

function MeasurementLabel({
  label,
  position,
  color,
  shadowColor,
}: {
  label: string
  position: Vec3
  color: string
  shadowColor: string
}) {
  return (
    <Html
      center
      position={position}
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
  )
}

function SelectedMeasurementAnnotation({ node }: { node: WallNode | ItemNode }) {
  if (node.type === 'wall') {
    return <WallMeasurementAnnotation wall={node} />
  }

  return <ItemHeightMeasurementAnnotation item={node} />
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
  const heightLabel = `H ${formatMeasurement(wall.height ?? DEFAULT_WALL_HEIGHT, unit)}`

  if (!(guide && Number.isFinite(length) && length >= 0.01)) return null

  return (
    <group>
      <MeasurementPath color={color} path={guide.guidePath} />
      <MeasurementBar color={color} end={guide.extStartEnd} start={guide.extStartStart} />
      <MeasurementBar color={color} end={guide.extEndEnd} start={guide.extEndStart} />
      <MeasurementBar color={color} end={guide.heightEnd} start={guide.heightStart} />
      <MeasurementBar
        color={color}
        end={guide.heightBottomTickEnd}
        start={guide.heightBottomTickStart}
      />
      <MeasurementBar color={color} end={guide.heightTopTickEnd} start={guide.heightTopTickStart} />

      <MeasurementLabel
        color={color}
        label={label}
        position={guide.labelPosition}
        shadowColor={shadowColor}
      />
      <MeasurementLabel
        color={color}
        label={heightLabel}
        position={guide.heightLabelPosition}
        shadowColor={shadowColor}
      />
    </group>
  )
}

function ItemHeightMeasurementAnnotation({ item }: { item: ItemNode }) {
  const theme = useViewer((state) => state.theme)
  const unit = useViewer((state) => state.unit)
  const isNight = theme === 'dark'
  const color = isNight ? '#ffffff' : '#111111'
  const shadowColor = isNight ? '#111111' : '#ffffff'

  const measurement = useMemo(() => buildItemHeightGuide(item), [item])

  if (!measurement) return null

  return (
    <group>
      <MeasurementBar color={color} end={measurement.guide.end} start={measurement.guide.start} />
      <MeasurementLabel
        color={color}
        label={`H ${formatMeasurement(measurement.height, unit)}`}
        position={measurement.guide.labelPosition}
        shadowColor={shadowColor}
      />
    </group>
  )
}
