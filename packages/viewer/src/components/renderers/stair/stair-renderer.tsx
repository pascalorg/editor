import { type AnyNodeId, type StairNode, type StairSegmentNode, useRegistry, useScene } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, DEFAULT_STAIR_MATERIAL } from '../../../lib/materials'
import { NodeRenderer } from '../node-renderer'

type SegmentTransform = {
  position: [number, number, number]
  rotation: number
}

type StairRailPathSide = 'left' | 'right' | 'front'

type StairRailSidePath = {
  side: StairRailPathSide
  points: [number, number, number][]
}

type StairSegmentRailPath = {
  layout: StairRailLayout
  sidePaths: StairRailSidePath[]
  connectFromPrevious: boolean
}

type StairRailLayout = {
  center: [number, number]
  elevation: number
  rotation: number
  segment: StairSegmentNode
}

type LandingChainNextStair = {
  nextStairLayout?: StairRailLayout
  isTerminalLandingBeforeStair: boolean
}

export const StairRenderer = ({ node }: { node: StairNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'stair', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'stair')

  const material = useMemo(() => {
    const mat = node.material
    if (!mat) return DEFAULT_STAIR_MATERIAL
    return createMaterial(mat)
  }, [node.material, node.material?.preset, node.material?.properties, node.material?.texture])

  return (
    <group
      position-x={node.position[0]}
      position-z={node.position[2]}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      <mesh castShadow material={material} name="merged-stair" receiveShadow>
        <boxGeometry args={[0, 0, 0]} />
      </mesh>
      {node.stairType === 'curved' || node.stairType === 'spiral' ? (
        <CurvedStairBody material={material} stair={node} />
      ) : null}
      <StairRailings material={material} stair={node} />
      <group name="segments-wrapper" visible={false}>
        {(node.children ?? []).map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
        ))}
      </group>
    </group>
  )
}

function StairRailings({ stair, material }: { stair: StairNode; material: THREE.Material }) {
  const nodes = useScene((state) => state.nodes)

  const segments = useMemo(
    () =>
      (stair.children ?? [])
        .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
        .filter((node): node is StairSegmentNode => node?.type === 'stair-segment' && node.visible !== false),
    [nodes, stair.children],
  )

  const railPaths = useMemo(() => buildStairRailPaths(segments, stair.railingMode ?? 'none'), [segments, stair.railingMode])

  const railHeight = stair.railingHeight ?? 0.92
  const midRailHeight = Math.max(railHeight * 0.45, 0.35)
  const railRadius = 0.022
  const balusterRadius = 0.018

  if ((stair.railingMode ?? 'none') === 'none') {
    return null
  }

  if (stair.stairType === 'curved' || stair.stairType === 'spiral') {
    const stepCount = Math.max(2, Math.round(stair.stepCount ?? 10))
    const sweepAngle = stair.sweepAngle ?? (stair.stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2)
    const stepSweep = sweepAngle / stepCount
    const stepHeight = Math.max(stair.totalRise ?? 2.5, 0.1) / stepCount
    const innerRadius = Math.max(stair.stairType === 'spiral' ? 0.05 : 0.2, stair.innerRadius ?? 0.9)
    const outerRadius = innerRadius + Math.max(stair.width ?? 1, 0.4)
    const leftRadius = sweepAngle >= 0 ? innerRadius + 0.04 : outerRadius - 0.04
    const rightRadius = sweepAngle >= 0 ? outerRadius - 0.04 : innerRadius + 0.04
    const radii =
      stair.railingMode === 'both'
        ? [leftRadius, rightRadius]
        : stair.railingMode === 'left'
          ? [leftRadius]
          : stair.railingMode === 'right'
            ? [rightRadius]
            : []

    return (
      <group name="stair-railing">
        {radii.map((radius, sideIndex) => {
          const sidePoints = Array.from({ length: stepCount }).map((_, index) => {
            const angle = -sweepAngle / 2 + stepSweep * index + stepSweep / 2
            return [
              Math.cos(angle) * radius,
              stair.stairType === 'spiral'
                ? stepHeight * index + Math.max(stair.thickness ?? 0.25, 0.02)
                : stepHeight * (index + 1),
              Math.sin(angle) * radius,
            ] as [number, number, number]
          })

          return (
            <group key={`${stair.id}-curved-railing-${sideIndex}`}>
              {sidePoints.map((point, pointIndex) => (
                <mesh
                  castShadow
                  geometry={BALUSTER_GEOMETRY}
                  key={`${stair.id}-curved-baluster-${sideIndex}-${pointIndex}`}
                  material={material}
                  position={[point[0], point[1] + railHeight / 2, point[2]]}
                  receiveShadow
                  scale={[balusterRadius, railHeight, balusterRadius]}
                />
              ))}
              {sidePoints.slice(0, -1).map((point, pointIndex) => {
                const nextPoint = sidePoints[pointIndex + 1]
                if (!nextPoint) return null

                return (
                  <group key={`${stair.id}-curved-rail-${sideIndex}-${pointIndex}`}>
                    <RailSegment
                      end={[nextPoint[0], nextPoint[1] + railHeight, nextPoint[2]]}
                      material={material}
                      radius={railRadius}
                      start={[point[0], point[1] + railHeight, point[2]]}
                    />
                    <RailSegment
                      end={[nextPoint[0], nextPoint[1] + midRailHeight, nextPoint[2]]}
                      material={material}
                      radius={railRadius * 0.8}
                      start={[point[0], point[1] + midRailHeight, point[2]]}
                    />
                  </group>
                )
              })}
            </group>
          )
        })}
      </group>
    )
  }

  if (railPaths.length === 0) {
    return null
  }

  return (
    <group name="stair-railing">
      {railPaths.map((segmentPath, index) => (
        <group
          key={`${segmentPath.layout.segment.id}-railing`}
          position={[segmentPath.layout.center[0], segmentPath.layout.elevation, segmentPath.layout.center[1]]}
          rotation-y={segmentPath.layout.rotation}
        >
          {segmentPath.sidePaths.map((sidePath, sideIndex) => (
            <group key={`${segmentPath.layout.segment.id}-${sidePath.side}-${sideIndex}`}>
              {sidePath.points.map((point, pointIndex) => (
                <mesh
                  castShadow
                  geometry={BALUSTER_GEOMETRY}
                  key={`${segmentPath.layout.segment.id}-${sidePath.side}-baluster-${pointIndex}`}
                  material={material}
                  position={[point[2], point[1] + railHeight / 2, point[0]]}
                  receiveShadow
                  scale={[balusterRadius, railHeight, balusterRadius]}
                />
              ))}
              {sidePath.points.slice(0, -1).map((point, pointIndex) => {
                const nextPoint = sidePath.points[pointIndex + 1]
                if (!nextPoint) return null

                return (
                  <group key={`${segmentPath.layout.segment.id}-${sidePath.side}-rail-${pointIndex}`}>
                    <RailSegment
                      end={[nextPoint[2], nextPoint[1] + railHeight, nextPoint[0]]}
                      material={material}
                      radius={railRadius}
                      start={[point[2], point[1] + railHeight, point[0]]}
                    />
                    <RailSegment
                      end={[nextPoint[2], nextPoint[1] + midRailHeight, nextPoint[0]]}
                      material={material}
                      radius={railRadius * 0.8}
                      start={[point[2], point[1] + midRailHeight, point[0]]}
                    />
                  </group>
                )
              })}
            </group>
          ))}
        </group>
      ))}
      {railPaths.slice(1).map((segmentPath, index) => {
        const previousPath = railPaths[index]
        if (!previousPath || !segmentPath.connectFromPrevious) return null
        if (previousPath.layout.segment.segmentType === 'landing') return null
        if (segmentPath.layout.segment.segmentType === 'landing') return null

        return segmentPath.sidePaths.map((sidePath, sideIndex) => {
          const currentPoint = sidePath.points[0]
          if (!currentPoint) return null

          const currentWorldPoint = toWorldRailPoint(segmentPath.layout, currentPoint)
          const previousSidePath = [...previousPath.sidePaths]
            .map((entry) => {
              const lastPoint = entry.points[entry.points.length - 1]
              return {
                entry,
                distance: lastPoint ? distance3(toWorldRailPoint(previousPath.layout, lastPoint), currentWorldPoint) : Number.POSITIVE_INFINITY,
              }
            })
            .sort((left, right) => left.distance - right.distance)[0]?.entry
          const previousPoint =
            previousSidePath && previousSidePath.points.length
              ? previousSidePath.points[previousSidePath.points.length - 1]
              : null

          if (!(previousPoint && currentPoint)) {
            return null
          }

          const previousWorldPoint = toWorldRailPoint(previousPath.layout, previousPoint)

          return (
            <group key={`${previousPath.layout.segment.id}-${segmentPath.layout.segment.id}-${sideIndex}`}>
              <RailSegment
                end={[currentWorldPoint[0], currentWorldPoint[1] + railHeight, currentWorldPoint[2]]}
                material={material}
                radius={railRadius}
                start={[previousWorldPoint[0], previousWorldPoint[1] + railHeight, previousWorldPoint[2]]}
              />
              <RailSegment
                end={[currentWorldPoint[0], currentWorldPoint[1] + midRailHeight, currentWorldPoint[2]]}
                material={material}
                radius={railRadius * 0.8}
                start={[previousWorldPoint[0], previousWorldPoint[1] + midRailHeight, previousWorldPoint[2]]}
              />
            </group>
          )
        })
      })}
    </group>
  )
}

const BALUSTER_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 8)
const RAIL_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 8)

function RailSegment({
  start,
  end,
  radius,
  material,
}: {
  start: [number, number, number]
  end: [number, number, number]
  radius: number
  material: THREE.Material
}) {
  const startVector = useMemo(() => new THREE.Vector3(...start), [start])
  const endVector = useMemo(() => new THREE.Vector3(...end), [end])
  const direction = useMemo(() => endVector.clone().sub(startVector), [endVector, startVector])
  const length = Math.max(direction.length(), 0.01)
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
    [direction],
  )
  const midpoint = useMemo(() => startVector.clone().add(endVector).multiplyScalar(0.5), [endVector, startVector])

  return (
    <mesh
      castShadow
      geometry={RAIL_GEOMETRY}
      material={material}
      position={[midpoint.x, midpoint.y, midpoint.z]}
      quaternion={quaternion}
      receiveShadow
      scale={[Math.max(radius, 0.01), length, Math.max(radius, 0.01)]}
    />
  )
}

function CurvedStairBody({ stair, material }: { stair: StairNode; material: THREE.Material }) {
  const stepCount = Math.max(2, Math.round(stair.stepCount ?? 10))
  const totalRise = Math.max(stair.totalRise ?? 2.5, 0.1)
  const stepHeight = totalRise / stepCount
  const isSpiral = stair.stairType === 'spiral'
  const innerRadius = Math.max(isSpiral ? 0.05 : 0.2, stair.innerRadius ?? 0.9)
  const outerRadius = innerRadius + Math.max(stair.width ?? 1, 0.4)
  const sweepAngle = stair.sweepAngle ?? (isSpiral ? Math.PI * 2 : Math.PI / 2)
  const stepSweep = sweepAngle / stepCount
  const thickness = Math.max(stair.thickness ?? 0.25, 0.02)
  const fillToFloor = stair.fillToFloor ?? true
  const spiralColumnRadius = Math.max(0.05, Math.min(innerRadius * 0.72, innerRadius - 0.03))
  const spiralColumnHeight = totalRise + thickness
  const spiralLandingDepth = Math.max(0.3, stair.topLandingDepth ?? Math.max((stair.width ?? 1) * 0.9, 0.8))
  const spiralLandingSweep =
    isSpiral && (stair.topLandingMode ?? 'none') === 'integrated'
      ? Math.min(Math.PI * 0.75, spiralLandingDepth / Math.max(innerRadius + (stair.width ?? 1) / 2, 0.1)) *
        Math.sign(sweepAngle || 1)
      : 0
  const spiralLastStepTop = stepHeight * Math.max(stepCount - 1, 0) + thickness
  const spiralLandingThickness =
    isSpiral && (stair.topLandingMode ?? 'none') === 'integrated'
      ? Math.max(0.02, totalRise - spiralLastStepTop)
      : 0

  return (
    <group name={isSpiral ? 'spiral-stair' : 'curved-stair'}>
      {isSpiral && (stair.showCenterColumn ?? true) ? (
        <mesh castShadow receiveShadow material={material} position={[0, spiralColumnHeight / 2, 0]}>
          <cylinderGeometry args={[spiralColumnRadius, spiralColumnRadius, spiralColumnHeight, 10]} />
        </mesh>
      ) : null}
      {Array.from({ length: stepCount }).map((_, index) => {
        const currentHeight = stepHeight * (index + 1)
        const actualStepHeight = isSpiral ? thickness : fillToFloor ? Math.max(currentHeight, thickness) : thickness
        const startAngle = -sweepAngle / 2 + stepSweep * index
        const endAngle = startAngle + stepSweep
        const stepY = isSpiral ? stepHeight * index : fillToFloor ? 0 : Math.max(currentHeight - thickness, 0)
        const midAngle = startAngle + stepSweep / 2

        return (
          <group key={`${stair.id}-${isSpiral ? 'spiral' : 'curved'}-step-${index}`} position-y={stepY}>
            {isSpiral && (stair.showStepSupports ?? true) ? (
              <mesh
                castShadow
                material={material}
                position={[
                  Math.cos(midAngle) * (spiralColumnRadius + Math.max(0.04, innerRadius - spiralColumnRadius + 0.04) / 2 - 0.02),
                  Math.max(thickness * 0.55, 0.025) / 2,
                  Math.sin(midAngle) * (spiralColumnRadius + Math.max(0.04, innerRadius - spiralColumnRadius + 0.04) / 2 - 0.02),
                ]}
                receiveShadow
                rotation-y={-midAngle}
              >
                <boxGeometry
                  args={[
                    Math.max(0.04, innerRadius - spiralColumnRadius + 0.04),
                    Math.max(thickness * 0.55, 0.025),
                    Math.max(0.04, Math.min(0.12, Math.max(thickness * 0.55, 0.025) * 1.5)),
                  ]}
                />
              </mesh>
            ) : null}
            <CurvedStepMesh
              endAngle={endAngle}
              innerRadius={innerRadius}
              material={material}
              outerRadius={outerRadius}
              positionY={0}
              startAngle={startAngle}
              stepHeight={actualStepHeight}
              thickness={thickness}
            />
          </group>
        )
      })}
      {isSpiral && (stair.topLandingMode ?? 'none') === 'integrated' ? (
        <CurvedStepMesh
          endAngle={sweepAngle / 2 + spiralLandingSweep}
          innerRadius={innerRadius}
          material={material}
          outerRadius={outerRadius}
          positionY={spiralLastStepTop}
          startAngle={sweepAngle / 2}
          stepHeight={spiralLandingThickness}
          thickness={spiralLandingThickness}
        />
      ) : null}
    </group>
  )
}

function CurvedStepMesh({
  innerRadius,
  outerRadius,
  startAngle,
  endAngle,
  stepHeight,
  thickness,
  positionY,
  material,
}: {
  innerRadius: number
  outerRadius: number
  startAngle: number
  endAngle: number
  stepHeight: number
  thickness: number
  positionY: number
  material: THREE.Material
}) {
  const geometry = useMemo(
    () => buildCurvedStepGeometry(innerRadius, outerRadius, startAngle, endAngle, Math.max(stepHeight, thickness)),
    [endAngle, innerRadius, outerRadius, startAngle, stepHeight, thickness],
  )

  return <mesh castShadow geometry={geometry} material={material} position-y={positionY} receiveShadow />
}

function buildCurvedStepGeometry(
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
  height: number,
) {
  const clampedHeight = Math.max(height, 0.02)
  const y0 = 0
  const y1 = clampedHeight
  const sweepAngle = endAngle - startAngle
  const sweepDirection = Math.sign(sweepAngle) || 1
  const segmentCount = Math.max(4, Math.min(24, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 18) + Math.max(0, (outerRadius - innerRadius) * 3))))

  const positions: number[] = []
  const normals: number[] = []

  const pointOnArc = (radius: number, angle: number, y: number) =>
    new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)

  const pushTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, normal: THREE.Vector3) => {
    const edgeAB = b.clone().sub(a)
    const edgeAC = c.clone().sub(a)
    const faceNormal = edgeAB.cross(edgeAC)
    const ordered = faceNormal.dot(normal) >= 0 ? [a, b, c] : [a, c, b]
    for (const point of ordered) {
      positions.push(point.x, point.y, point.z)
      normals.push(normal.x, normal.y, normal.z)
    }
  }

  const pushQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, normal: THREE.Vector3) => {
    pushTriangle(a, b, c, normal)
    pushTriangle(a, c, d, normal)
  }

  const upNormal = new THREE.Vector3(0, 1, 0)
  const downNormal = new THREE.Vector3(0, -1, 0)

  for (let index = 0; index < segmentCount; index++) {
    const t0 = index / segmentCount
    const t1 = (index + 1) / segmentCount
    const segStart = startAngle + sweepAngle * t0
    const segEnd = startAngle + sweepAngle * t1
    const midAngle = (segStart + segEnd) / 2

    const innerStartBottom = pointOnArc(innerRadius, segStart, y0)
    const innerEndBottom = pointOnArc(innerRadius, segEnd, y0)
    const outerStartBottom = pointOnArc(outerRadius, segStart, y0)
    const outerEndBottom = pointOnArc(outerRadius, segEnd, y0)
    const innerStartTop = pointOnArc(innerRadius, segStart, y1)
    const innerEndTop = pointOnArc(innerRadius, segEnd, y1)
    const outerStartTop = pointOnArc(outerRadius, segStart, y1)
    const outerEndTop = pointOnArc(outerRadius, segEnd, y1)

    const outerNormal = new THREE.Vector3(Math.cos(midAngle), 0, Math.sin(midAngle)).normalize()
    const innerNormal = new THREE.Vector3(-Math.cos(midAngle), 0, -Math.sin(midAngle)).normalize()

    pushQuad(innerStartTop, outerStartTop, outerEndTop, innerEndTop, upNormal)
    pushQuad(innerStartBottom, innerEndBottom, outerEndBottom, outerStartBottom, downNormal)
    pushQuad(innerStartBottom, innerStartTop, innerEndTop, innerEndBottom, innerNormal)
    pushQuad(outerStartBottom, outerEndBottom, outerEndTop, outerStartTop, outerNormal)
  }

  const startInnerBottom = pointOnArc(innerRadius, startAngle, y0)
  const startOuterBottom = pointOnArc(outerRadius, startAngle, y0)
  const startInnerTop = pointOnArc(innerRadius, startAngle, y1)
  const startOuterTop = pointOnArc(outerRadius, startAngle, y1)
  const endInnerBottom = pointOnArc(innerRadius, endAngle, y0)
  const endOuterBottom = pointOnArc(outerRadius, endAngle, y0)
  const endInnerTop = pointOnArc(innerRadius, endAngle, y1)
  const endOuterTop = pointOnArc(outerRadius, endAngle, y1)
  const startNormal = new THREE.Vector3(
    sweepDirection * Math.sin(startAngle),
    0,
    -sweepDirection * Math.cos(startAngle),
  ).normalize()
  const endNormal = new THREE.Vector3(
    -sweepDirection * Math.sin(endAngle),
    0,
    sweepDirection * Math.cos(endAngle),
  ).normalize()

  pushQuad(startInnerBottom, startOuterBottom, startOuterTop, startInnerTop, startNormal)
  pushQuad(endInnerBottom, endInnerTop, endOuterTop, endOuterBottom, endNormal)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.computeVertexNormals()
  return geometry
}

function buildStairRailPaths(
  segments: StairSegmentNode[],
  railingMode: StairNode['railingMode'],
): StairSegmentRailPath[] {
  if (!segments.length || railingMode === 'none') return []

  const layouts = computeStairRailLayouts(segments)
  const landingInset = 0.08

  if (railingMode === 'both') {
    const isStraightLineDoubleLandingLayout =
      layouts.length === 4 &&
      layouts[0]?.segment.segmentType === 'stair' &&
      layouts[1]?.segment.segmentType === 'landing' &&
      layouts[2]?.segment.segmentType === 'stair' &&
      layouts[2]?.segment.attachmentSide === 'front' &&
      layouts[3]?.segment.segmentType === 'landing' &&
      layouts[3]?.segment.attachmentSide === 'front'

    return layouts.map((layout, index) => {
      const previousLayout = index > 0 ? layouts[index - 1] : undefined
      const nextLayout = layouts[index + 1]
      const { nextStairLayout, isTerminalLandingBeforeStair } = resolveLandingChainNextStair(layouts, index)
      const hideLandingRailing =
        layout.segment.segmentType === 'landing' &&
        previousLayout?.segment.segmentType === 'stair' &&
        nextLayout?.segment.segmentType === 'stair'
      const visualTurnSide =
        isTerminalLandingBeforeStair && nextStairLayout?.segment.attachmentSide
          ? nextStairLayout.segment.attachmentSide
          : nextLayout?.segment.attachmentSide
      const sideCandidates =
        isTerminalLandingBeforeStair && layout.segment.segmentType === 'landing'
          ? visualTurnSide === 'left'
            ? (['front', 'right'] as const)
            : visualTurnSide === 'right'
              ? (['front', 'left'] as const)
              : (['left', 'right'] as const)
          : hideLandingRailing
          ? visualTurnSide === 'left'
            ? (['front', 'right'] as const)
            : visualTurnSide === 'right'
              ? (['front', 'left'] as const)
              : (['left', 'right'] as const)
          : layout.segment.segmentType === 'landing'
            ? nextLayout?.segment.segmentType === 'landing' && visualTurnSide === 'left'
              ? (['front', 'right'] as const)
              : nextLayout?.segment.segmentType === 'landing' && visualTurnSide === 'right'
                ? (['front', 'left'] as const)
                : visualTurnSide === 'left'
                  ? (['right'] as const)
                  : visualTurnSide === 'right'
                    ? (['left'] as const)
                    : (['left', 'right'] as const)
            : (['left', 'right'] as const)

      return {
        layout,
        sidePaths:
          isStraightLineDoubleLandingLayout && index === 1
            ? (['left', 'right'] as const).map((side) => buildSegmentRailPath(layouts, index, side, landingInset))
            : sideCandidates.map((side) => buildSegmentRailPath(layouts, index, side, landingInset)),
        connectFromPrevious:
          index > 0 &&
          !(previousLayout?.segment.segmentType === 'landing' && layout.segment.segmentType === 'landing'),
      }
    })
  }

  const isStraightLineDoubleLandingLayout =
    layouts.length === 4 &&
    layouts[0]?.segment.segmentType === 'stair' &&
    layouts[1]?.segment.segmentType === 'landing' &&
    layouts[2]?.segment.segmentType === 'stair' &&
    layouts[2]?.segment.attachmentSide === 'front' &&
    layouts[3]?.segment.segmentType === 'landing' &&
    layouts[3]?.segment.attachmentSide === 'front'

  return layouts.map((layout, index) => {
    const previousLayout = index > 0 ? layouts[index - 1] : undefined
    const nextLayout = layouts[index + 1]
    const { nextStairLayout, isTerminalLandingBeforeStair } = resolveLandingChainNextStair(layouts, index)
    const isMiddleLandingBetweenFlights =
      layout.segment.segmentType === 'landing' &&
      previousLayout?.segment.segmentType === 'stair' &&
      nextLayout?.segment.segmentType === 'stair'
    const nextAttachmentSide = nextLayout?.segment.attachmentSide
    const terminalNextAttachmentSide = nextStairLayout?.segment.attachmentSide
    const suppressMiddleLandingOnPreferredTurnSide =
      isMiddleLandingBetweenFlights &&
      nextAttachmentSide != null &&
      nextAttachmentSide !== 'front' &&
      nextAttachmentSide === railingMode
    const suppressLandingRailing =
      (layout.segment.segmentType === 'landing' &&
        nextLayout?.segment.segmentType === 'landing' &&
        nextAttachmentSide === railingMode) ||
      suppressMiddleLandingOnPreferredTurnSide
    const landingContinuesOnPreferredSide =
      layout.segment.segmentType === 'landing'
        ? nextAttachmentSide == null || nextAttachmentSide === 'front' || nextAttachmentSide === railingMode
        : true

    const sideCandidates =
      suppressLandingRailing
        ? ([] as StairRailPathSide[])
          : layout.segment.segmentType !== 'landing'
          ? [railingMode]
          : isTerminalLandingBeforeStair
            ? railingMode === 'left'
              ? terminalNextAttachmentSide === 'right'
                ? (['front', 'left'] as const)
                : terminalNextAttachmentSide === 'front' || terminalNextAttachmentSide == null
                  ? (['left'] as const)
                  : ([] as StairRailPathSide[])
              : railingMode === 'right'
                ? terminalNextAttachmentSide === 'left'
                  ? (['front', 'right'] as const)
                  : terminalNextAttachmentSide === 'front' || terminalNextAttachmentSide == null
                    ? (['right'] as const)
                    : ([] as StairRailPathSide[])
                : [railingMode]
          : isStraightLineDoubleLandingLayout
            ? [railingMode]
            : isMiddleLandingBetweenFlights && railingMode === 'left'
              ? nextAttachmentSide === 'right'
                ? (['front', 'left'] as const)
                : (['left'] as const)
              : isMiddleLandingBetweenFlights && railingMode === 'right'
                ? nextAttachmentSide === 'left'
                  ? (['front', 'right'] as const)
                  : (['right'] as const)
                : nextLayout?.segment.segmentType === 'landing' &&
                    nextAttachmentSide != null &&
                    nextAttachmentSide !== 'front' &&
                    nextAttachmentSide !== railingMode
                  ? (['front', railingMode] as StairRailPathSide[])
                  : [railingMode]

    return {
      layout,
      sidePaths: sideCandidates.map((side) => buildSegmentRailPath(layouts, index, side, landingInset)),
      connectFromPrevious:
        index > 0 &&
        !suppressLandingRailing &&
        sideCandidates.length > 0 &&
        (layout.segment.segmentType === 'landing' ? landingContinuesOnPreferredSide : true),
    }
  })
}

function resolveLandingChainNextStair(layouts: StairRailLayout[], index: number): LandingChainNextStair {
  const layout = layouts[index]
  if (!layout || layout.segment.segmentType !== 'landing') {
    return { isTerminalLandingBeforeStair: false }
  }

  let cursor = index
  while (cursor + 1 < layouts.length && layouts[cursor + 1]?.segment.segmentType === 'landing') {
    cursor += 1
  }

  const nextStairLayout =
    cursor + 1 < layouts.length && layouts[cursor + 1]?.segment.segmentType === 'stair'
      ? layouts[cursor + 1]
      : undefined

  return {
    nextStairLayout,
    isTerminalLandingBeforeStair: Boolean(nextStairLayout) && cursor === index,
  }
}

function computeStairRailLayouts(segments: StairSegmentNode[]): StairRailLayout[] {
  const transforms = computeSegmentTransforms(segments)
  return segments.map((segment, index) => {
    const transform = transforms[index]!
    const [centerOffsetX, centerOffsetZ] = rotateXZ(0, segment.length / 2, transform.rotation)
    return {
      center: [transform.position[0] + centerOffsetX, transform.position[2] + centerOffsetZ],
      elevation: transform.position[1],
      rotation: transform.rotation,
      segment,
    }
  })
}

function buildSegmentRailPath(
  layouts: StairRailLayout[],
  layoutIndex: number,
  side: StairRailPathSide,
  landingInset: number,
): StairRailSidePath {
  const layout = layouts[layoutIndex]!
  const segment = layout.segment
  const previousLayout = layoutIndex > 0 ? layouts[layoutIndex - 1] : undefined
  const nextLayout = layoutIndex >= 0 ? layouts[layoutIndex + 1] : undefined
  const steps = Math.max(1, segment.segmentType === 'landing' ? 1 : segment.stepCount)
  const stepDepth = segment.length / steps
  const stepHeight = segment.segmentType === 'landing' ? 0 : segment.height / steps
  const flightSideOffset = side === 'left' ? segment.width / 2 - 0.045 : -segment.width / 2 + 0.045
  const flightStartX =
    previousLayout?.segment.segmentType === 'landing' ? -segment.length / 2 + landingInset : -segment.length / 2
  const flightEndX =
    nextLayout?.segment.segmentType === 'landing' ? segment.length / 2 - landingInset : segment.length / 2
  const landingFrontX =
    previousLayout?.segment.segmentType === 'stair' &&
    segment.attachmentSide &&
    segment.attachmentSide !== 'front'
      ? -segment.length / 2 + landingInset
      : segment.length / 2 - landingInset

  if (segment.segmentType === 'landing') {
    const backX = -segment.length / 2 + landingInset
    const frontX = segment.length / 2 - landingInset
    const leftZ = segment.width / 2 - landingInset
    const rightZ = -segment.width / 2 + landingInset

    return {
      side,
      points:
        side === 'left'
          ? [
              [backX, 0, leftZ],
              [frontX, 0, leftZ],
            ]
          : side === 'right'
            ? [
                [backX, 0, rightZ],
                [frontX, 0, rightZ],
              ]
            : [
                [landingFrontX, 0, leftZ],
                [landingFrontX, 0, rightZ],
              ],
    }
  }

  return {
    side,
    points: [
      ...(previousLayout?.segment.segmentType === 'landing' ? [] : ([[flightStartX, stepHeight > 0 ? stepHeight : 0, flightSideOffset]] as [number, number, number][])),
      ...Array.from({ length: steps }).map(
        (_, index) =>
          [
            -segment.length / 2 + stepDepth * index + stepDepth / 2,
            stepHeight * (index + 1),
            flightSideOffset,
          ] as [number, number, number],
      ),
      ...(nextLayout?.segment.segmentType === 'landing'
        ? []
        : ([[flightEndX, segment.height, flightSideOffset]] as [number, number, number][])),
    ],
  }
}

function toWorldRailPoint(layout: StairRailLayout, point: [number, number, number]): [number, number, number] {
  const [localX, localY, localZ] = point
  const [offsetX, offsetZ] = rotateXZ(localZ, localX, layout.rotation)
  return [layout.center[0] + offsetX, layout.elevation + localY, layout.center[1] + offsetZ]
}

function computeSegmentTransforms(segments: StairSegmentNode[]): SegmentTransform[] {
  const transforms: SegmentTransform[] = []
  let currentPos = new THREE.Vector3(0, 0, 0)
  let currentRot = 0

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!

    if (i === 0) {
      transforms.push({ position: [currentPos.x, currentPos.y, currentPos.z], rotation: currentRot })
      continue
    }

    const prev = segments[i - 1]!
    const localAttachPos = new THREE.Vector3()
    let rotChange = 0

    switch (segment.attachmentSide) {
      case 'front':
        localAttachPos.set(0, prev.height, prev.length)
        break
      case 'left':
        localAttachPos.set(prev.width / 2, prev.height, prev.length / 2)
        rotChange = Math.PI / 2
        break
      case 'right':
        localAttachPos.set(-prev.width / 2, prev.height, prev.length / 2)
        rotChange = -Math.PI / 2
        break
    }

    localAttachPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), currentRot)
    currentPos = currentPos.clone().add(localAttachPos)
    currentRot += rotChange

    transforms.push({ position: [currentPos.x, currentPos.y, currentPos.z], rotation: currentRot })
  }

  return transforms
}

function rotateXZ(x: number, z: number, angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

function distance3(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
