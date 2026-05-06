import { type ColumnNode, useLiveTransforms, useRegistry } from '@pascal-app/core'
import { createContext, useContext, useMemo, useRef } from 'react'
import type { Group, Material } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { baseMaterial, createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'
import {
  createColumnBoxGeometry,
  createColumnCylinderGeometry,
  createColumnSphereGeometry,
  createColumnTorusGeometry,
} from '../../../systems/column/column-geometry'

const ColumnMaterialContext = createContext<Material>(baseMaterial as Material)
const ColumnEdgeSoftnessContext = createContext(0.025)

function ColumnMaterial() {
  const material = useContext(ColumnMaterialContext)
  return <primitive attach="material" object={material} />
}

function createColumnMaterial({
  material,
  materialPreset,
}: Pick<ColumnNode, 'material' | 'materialPreset'>) {
  const presetMaterial = createMaterialFromPresetRef(materialPreset)
  if (presetMaterial) return presetMaterial
  if (material) return createMaterial(material)
  return baseMaterial
}

function getSegments(node: ColumnNode) {
  if (node.crossSection === 'octagonal') return 8
  if (node.crossSection === 'sixteen-sided') return 16
  return 32
}

function getShaftProfile(node: ColumnNode) {
  return node.shaftProfile ?? (node.shaftTaper > 0 ? 'tapered' : 'straight')
}

function getShaftSegmentCount(node: ColumnNode) {
  const shaftProfile = getShaftProfile(node)
  const shaftTaper = node.shaftTaper ?? 0
  const hasTwist = Math.abs(node.shaftTwistStep ?? 0) > 0.001
  return Math.max(
    hasTwist ? 4 : 1,
    shaftProfile === 'straight' && shaftTaper <= 0 && !hasTwist
      ? 1
      : (node.shaftSegmentCount ?? (hasTwist ? 12 : 24)),
  )
}

function getShaftTwistRadians(node: ColumnNode, index: number) {
  return ((node.shaftTwistStep ?? 0) * Math.PI * index) / 180
}

function getShaftScaleAt(node: ColumnNode, t: number) {
  const shaftProfile = getShaftProfile(node)
  const shaftTaper = Math.min(node.shaftTaper ?? 0, 0.85)
  const startScale = node.shaftStartScale ?? 0.72
  const endScale = node.shaftEndScale ?? startScale
  const shaftBulge =
    node.shaftBulge ??
    (shaftProfile === 'bulged'
      ? 0.16
      : shaftProfile === 'baluster'
        ? 0.2
        : shaftProfile === 'hourglass'
          ? 0.18
          : 0)
  const taperedScale = 1 - shaftTaper * t
  const linearScale = (startScale + (endScale - startScale) * t) * taperedScale
  const bulgeCurve = Math.sin(Math.PI * t)
  const hourglassCurve = Math.abs(t - 0.5) * 2
  const profileScale =
    shaftProfile === 'bulged' || shaftProfile === 'baluster'
      ? linearScale + shaftBulge * bulgeCurve
      : shaftProfile === 'hourglass'
        ? linearScale - shaftBulge * (1 - hourglassCurve)
        : linearScale

  return Math.max(0.1, profileScale)
}

type VectorTuple = [number, number, number]

function MappedBox({
  depth,
  height,
  position,
  rotation,
  softenEdges = true,
  width,
}: {
  depth: number
  height: number
  position: VectorTuple
  rotation?: VectorTuple
  softenEdges?: boolean
  width: number
}) {
  const edgeSoftness = useContext(ColumnEdgeSoftnessContext)
  const minDimension = Math.max(0, Math.min(width, height, depth))
  const bevelRadius = softenEdges ? Math.min(Math.max(0, edgeSoftness), minDimension * 0.35) : 0
  const geometry = useMemo(() => {
    if (height <= 0 || width <= 0 || depth <= 0) return null
    return createColumnBoxGeometry(width, height, depth, bevelRadius)
  }, [bevelRadius, depth, height, width])

  if (!geometry) return null

  return (
    <mesh dispose={null} position={position} rotation={rotation}>
      <primitive attach="geometry" dispose={null} object={geometry} />
      <ColumnMaterial />
    </mesh>
  )
}

function MappedCylinder({
  height,
  position,
  radius,
  radiusBottom = radius,
  radiusTop = radius,
  radiusX = 1,
  radiusZ = 1,
  rotation,
  segments = 32,
}: {
  height: number
  position: VectorTuple
  radius: number
  radiusBottom?: number
  radiusTop?: number
  radiusX?: number
  radiusZ?: number
  rotation?: VectorTuple
  segments?: number
}) {
  const geometry = useMemo(() => {
    if (height <= 0 || radius <= 0 || radiusBottom < 0 || radiusTop < 0) return null
    return createColumnCylinderGeometry({
      height,
      radiusBottom,
      radiusTop,
      radiusX,
      radiusZ,
      segments,
    })
  }, [height, radius, radiusBottom, radiusTop, radiusX, radiusZ, segments])

  if (!geometry) return null

  return (
    <mesh dispose={null} position={position} rotation={rotation}>
      <primitive attach="geometry" dispose={null} object={geometry} />
      <ColumnMaterial />
    </mesh>
  )
}

function MappedCone({
  height,
  position,
  radiusX,
  radiusZ = radiusX,
  rotation,
  segments = 6,
}: {
  height: number
  position: VectorTuple
  radiusX: number
  radiusZ?: number
  rotation?: VectorTuple
  segments?: number
}) {
  const geometry = useMemo(() => {
    if (height <= 0 || radiusX <= 0 || radiusZ <= 0) return null
    return createColumnCylinderGeometry({
      height,
      radiusBottom: 1,
      radiusTop: 0,
      radiusX,
      radiusZ,
      segments,
    })
  }, [height, radiusX, radiusZ, segments])

  if (!geometry) return null

  return (
    <mesh dispose={null} position={position} rotation={rotation}>
      <primitive attach="geometry" dispose={null} object={geometry} />
      <ColumnMaterial />
    </mesh>
  )
}

function MappedSphere({
  position,
  radius,
  segments = 10,
  verticalSegments = 8,
}: {
  position: VectorTuple
  radius: number
  segments?: number
  verticalSegments?: number
}) {
  const geometry = useMemo(() => {
    if (radius <= 0) return null
    return createColumnSphereGeometry(radius, segments, verticalSegments)
  }, [radius, segments, verticalSegments])

  if (!geometry) return null

  return (
    <mesh dispose={null} position={position}>
      <primitive attach="geometry" dispose={null} object={geometry} />
      <ColumnMaterial />
    </mesh>
  )
}

function MappedTorus({
  arc,
  position,
  ringRadius,
  rotation,
  scaleX,
  scaleY,
  scaleZ,
  tubeRadius,
}: {
  arc?: number
  position: VectorTuple
  ringRadius: number
  rotation?: VectorTuple
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  tubeRadius: number
}) {
  const geometry = useMemo(() => {
    if (ringRadius <= 0 || tubeRadius <= 0) return null
    return createColumnTorusGeometry({ arc, ringRadius, scaleX, scaleY, scaleZ, tubeRadius })
  }, [arc, ringRadius, scaleX, scaleY, scaleZ, tubeRadius])

  if (!geometry) return null

  return (
    <mesh dispose={null} position={position} rotation={rotation}>
      <primitive attach="geometry" dispose={null} object={geometry} />
      <ColumnMaterial />
    </mesh>
  )
}

function SquareBlock({
  y,
  height,
  width,
  depth,
  softenEdges = true,
}: {
  y: number
  height: number
  width: number
  depth: number
  softenEdges?: boolean
}) {
  return (
    <MappedBox
      depth={depth}
      height={height}
      position={[0, y + height / 2, 0]}
      softenEdges={softenEdges}
      width={width}
    />
  )
}

function RoundBlock({
  x = 0,
  y,
  z = 0,
  height,
  radius,
  segments = 32,
}: {
  x?: number
  y: number
  z?: number
  height: number
  radius: number
  segments?: number
}) {
  return (
    <MappedCylinder
      height={height}
      position={[x, y + height / 2, z]}
      radius={radius}
      segments={segments}
    />
  )
}

function RoundedRectangleShaftSegment({
  y,
  height,
  width,
  depth,
  cornerRadius,
}: {
  y: number
  height: number
  width: number
  depth: number
  cornerRadius: number
}) {
  if (height <= 0) return null

  const radius = Math.min(Math.max(0, cornerRadius), Math.min(width, depth) * 0.45)
  if (radius <= 0.001) {
    return <SquareBlock depth={depth} height={height} width={width} y={y} />
  }

  const innerWidth = Math.max(0, width - radius * 2)
  const innerDepth = Math.max(0, depth - radius * 2)
  const cornerX = width / 2 - radius
  const cornerZ = depth / 2 - radius

  return (
    <group>
      {innerWidth > 0 && (
        <SquareBlock depth={depth} height={height} softenEdges={false} width={innerWidth} y={y} />
      )}
      {innerDepth > 0 && (
        <SquareBlock depth={innerDepth} height={height} softenEdges={false} width={width} y={y} />
      )}
      {(
        [
          [cornerX, cornerZ],
          [cornerX, -cornerZ],
          [-cornerX, cornerZ],
          [-cornerX, -cornerZ],
        ] satisfies [number, number][]
      ).map(([x, z], index) => (
        <RoundBlock height={height} key={index} radius={radius} segments={18} x={x} y={y} z={z} />
      ))}
    </group>
  )
}

function OvalBlock({
  y,
  height,
  width,
  depth,
  segments = 32,
}: {
  y: number
  height: number
  width: number
  depth: number
  segments?: number
}) {
  return (
    <MappedCylinder
      height={height}
      position={[0, y + height / 2, 0]}
      radius={1}
      radiusX={width / 2}
      radiusZ={depth / 2}
      segments={segments}
    />
  )
}

function ColumnBlock({
  node,
  y,
  height,
  scale = 1,
}: {
  node: ColumnNode
  y: number
  height: number
  scale?: number
}) {
  if (height <= 0) return null

  const width = node.width * scale
  const depth = node.depth * scale
  const radius = node.radius * scale

  if (node.crossSection === 'square' || node.crossSection === 'rectangular') {
    return <SquareBlock depth={depth} height={height} width={width} y={y} />
  }

  return <RoundBlock height={height} radius={radius} segments={getSegments(node)} y={y} />
}

function TaperedRoundShaft({ node, y, height }: { node: ColumnNode; y: number; height: number }) {
  const segmentCount = getShaftSegmentCount(node)
  const segmentHeight = height / segmentCount

  return (
    <group>
      {Array.from({ length: segmentCount }, (_, index) => {
        const t = (index + 0.5) / segmentCount
        const profileScale = getShaftScaleAt(node, t)
        return (
          <group key={index} rotation={[0, getShaftTwistRadians(node, index), 0]}>
            <RoundBlock
              height={segmentHeight * 1.015}
              radius={node.radius * profileScale}
              segments={getSegments(node)}
              y={y + index * segmentHeight}
            />
          </group>
        )
      })}
    </group>
  )
}

function TaperedSquareShaft({ node, y, height }: { node: ColumnNode; y: number; height: number }) {
  const segmentCount = getShaftSegmentCount(node)
  const segmentHeight = height / segmentCount

  return (
    <group>
      {Array.from({ length: segmentCount }, (_, index) => {
        const t = (index + 0.5) / segmentCount
        const profileScale = getShaftScaleAt(node, t)
        return (
          <group key={index} rotation={[0, getShaftTwistRadians(node, index), 0]}>
            <RoundedRectangleShaftSegment
              cornerRadius={(node.shaftCornerRadius ?? 0.035) * profileScale}
              depth={node.depth * profileScale}
              height={segmentHeight * 1.015}
              width={node.width * profileScale}
              y={y + index * segmentHeight}
            />
          </group>
        )
      })}
    </group>
  )
}

function Shaft({ node, y, height }: { node: ColumnNode; y: number; height: number }) {
  if (height <= 0) return null

  if (node.style === 'cluster') {
    const sideRadius = Math.max(0.04, node.radius * 0.36)
    const offset = Math.max(node.radius * 0.78, node.width * 0.22)
    return (
      <group>
        <RoundBlock height={height} radius={node.radius * 0.62} segments={24} y={y} />
        {(
          [
            [offset, 0],
            [-offset, 0],
            [0, offset],
            [0, -offset],
          ] satisfies [number, number][]
        ).map(([x, z], index) => (
          <RoundBlock
            height={height}
            key={`${x}-${z}-${index}`}
            radius={sideRadius}
            segments={16}
            x={x}
            y={y}
            z={z}
          />
        ))}
      </group>
    )
  }

  if (
    node.crossSection === 'round' ||
    node.crossSection === 'octagonal' ||
    node.crossSection === 'sixteen-sided'
  ) {
    return <TaperedRoundShaft height={height} node={node} y={y} />
  }

  return <TaperedSquareShaft height={height} node={node} y={y} />
}

function Base({ node, height }: { node: ColumnNode; height: number }) {
  if (height <= 0) return null

  const baseStyle = node.baseStyle ?? 'round-rings'
  const widthScale = node.baseWidthScale ?? 1.24
  const depthScale = node.baseDepthScale ?? widthScale

  if (baseStyle === 'none') return null

  if (baseStyle === 'simple-square') {
    return (
      <SquareBlock
        depth={node.depth * depthScale}
        height={height}
        width={node.width * widthScale}
        y={0}
      />
    )
  }

  if (baseStyle === 'square-plinth') {
    return (
      <group>
        <SquareBlock
          depth={node.depth * depthScale}
          height={height * 0.35}
          width={node.width * widthScale}
          y={0}
        />
        <SquareBlock
          depth={node.depth * Math.max(0.9, depthScale * 0.84)}
          height={height * 0.65}
          width={node.width * Math.max(0.9, widthScale * 0.84)}
          y={height * 0.35}
        />
      </group>
    )
  }

  if (baseStyle === 'stepped-square') {
    const tierCount = Math.max(3, node.baseTierCount ?? 3)
    const tierHeight = height / tierCount
    const stepSpread = node.baseStepSpread ?? 0.42
    return (
      <group>
        {Array.from({ length: tierCount }, (_, index) => {
          const t = index / Math.max(1, tierCount - 1)
          const widthScaleAt = Math.max(0.5, widthScale - t * stepSpread)
          const depthScaleAt = Math.max(0.5, depthScale - t * stepSpread)
          return (
            <SquareBlock
              depth={node.depth * depthScaleAt}
              height={tierHeight * 1.01}
              key={index}
              width={node.width * widthScaleAt}
              y={index * tierHeight}
            />
          )
        })}
      </group>
    )
  }

  if (baseStyle === 'round-rings') {
    const baseWidth = node.width * widthScale
    const baseDepth = node.depth * depthScale
    const plinthRatio = Math.min(0.7, Math.max(0.2, node.basePlinthHeightRatio ?? 0.44))
    const plinthHeight = height * plinthRatio
    const roundedHeight = height - plinthHeight
    const bandHeight = roundedHeight * 0.57
    const neckHeight = roundedHeight - bandHeight
    const bandScale = node.baseRoundBandScale ?? 0.92
    const neckScale = node.baseNeckScale ?? 0.72
    return (
      <group>
        <SquareBlock depth={baseDepth} height={plinthHeight} width={baseWidth} y={0} />
        <OvalBlock
          depth={baseDepth * bandScale}
          height={bandHeight}
          segments={32}
          width={baseWidth * bandScale}
          y={plinthHeight}
        />
        <OvalBlock
          depth={baseDepth * neckScale}
          height={neckHeight}
          segments={32}
          width={baseWidth * neckScale}
          y={plinthHeight + bandHeight}
        />
      </group>
    )
  }

  if (baseStyle === 'lotus' || baseStyle === 'ribbed-lotus') {
    const ribCount = node.baseRibCount ?? (baseStyle === 'ribbed-lotus' ? 24 : 14)
    const ribRadius = Math.max(0.01, node.width * 0.025)
    const baseRadius = Math.max(node.radius * widthScale, node.width * widthScale * 0.5)
    return (
      <group>
        <SquareBlock
          depth={node.depth * 1.28}
          height={height * 0.22}
          width={node.width * 1.28}
          y={0}
        />
        <RoundBlock
          height={height * 0.24}
          radius={baseRadius * 0.86}
          segments={32}
          y={height * 0.22}
        />
        {Array.from({ length: ribCount }, (_, index) => {
          const angle = (index / ribCount) * Math.PI * 2
          return (
            <MappedCylinder
              height={height * 0.38}
              key={index}
              position={[
                Math.cos(angle) * baseRadius * 0.86,
                height * 0.58,
                Math.sin(angle) * baseRadius * 0.86,
              ]}
              radius={ribRadius}
              rotation={[0, -angle, 0]}
              segments={6}
            />
          )
        })}
        <RoundBlock
          height={height * 0.16}
          radius={baseRadius * 0.72}
          segments={32}
          y={height * 0.82}
        />
      </group>
    )
  }

  if (baseStyle === 'panelled-pedestal') {
    const inset = node.basePanelInset ?? 0.02
    return (
      <group>
        <SquareBlock
          depth={node.depth * widthScale}
          height={height}
          width={node.width * widthScale}
          y={0}
        />
        {(
          [
            [0, node.depth * widthScale * 0.51, 0],
            [0, -node.depth * widthScale * 0.51, 0],
            [node.width * widthScale * 0.51, 0, Math.PI / 2],
            [-node.width * widthScale * 0.51, 0, Math.PI / 2],
          ] satisfies [number, number, number][]
        ).map(([x, z, rotation], index) => (
          <MappedBox
            depth={inset}
            height={height * 0.42}
            key={index}
            position={[x, height * 0.5, z]}
            rotation={[0, rotation, 0]}
            softenEdges={false}
            width={node.width * 0.36}
          />
        ))}
      </group>
    )
  }

  return <ColumnBlock height={height} node={node} scale={1.12} y={0} />
}

function BaseCarvings({ node, height }: { node: ColumnNode; height: number }) {
  const placement = node.carvingPlacement ?? 'capital'
  const carvingLevel = node.baseCarvingLevel ?? 0
  if (carvingLevel <= 0 || height <= 0 || (placement !== 'base' && placement !== 'all')) {
    return null
  }

  const count = Math.max(8, carvingLevel * 8)
  const radius = Math.max(node.radius * 1.04, Math.max(node.width, node.depth) * 0.5)
  const y = height * 0.52

  return (
    <group>
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2
        return (
          <MappedCone
            height={height * 0.28}
            key={index}
            position={[Math.cos(angle) * radius, y, Math.sin(angle) * radius]}
            radiusX={0.014}
            radiusZ={0.01}
            rotation={[0.36, -angle, 0]}
            segments={5}
          />
        )
      })}
    </group>
  )
}

function Rings({
  node,
  shaftY,
  shaftHeight,
}: {
  node: ColumnNode
  shaftY: number
  shaftHeight: number
}) {
  if (node.ringCount <= 0 || shaftHeight <= 0) return null

  const ringPlacement = node.ringPlacement ?? 'ends'
  const ringSpread = Math.min(0.45, Math.max(0.04, node.ringSpread ?? 0.16))
  const ringHeight = Math.min(
    node.ringThickness ?? 0.055,
    shaftHeight / Math.max(8, node.ringCount * 3),
  )
  const rings = Array.from({ length: node.ringCount }, (_, index) => {
    const pairIndex = Math.floor(index / 2)
    const nearTop = index % 2 === 1
    const pairCount = Math.ceil(node.ringCount / 2)
    const pairT = pairCount <= 1 ? 0 : pairIndex / (pairCount - 1)
    const offset = Math.min(0.48, 0.06 + pairT * Math.max(0, ringSpread - 0.06))
    const oneSideT =
      0.06 + (index / Math.max(1, node.ringCount - 1)) * Math.max(0, ringSpread - 0.06)
    const t =
      ringPlacement === 'even'
        ? (index + 1) / (node.ringCount + 1)
        : ringPlacement === 'top'
          ? 1 - Math.min(0.48, oneSideT)
          : ringPlacement === 'bottom'
            ? Math.min(0.48, oneSideT)
            : nearTop
              ? 1 - offset
              : offset
    return {
      scale: Math.min(1.4, getShaftScaleAt(node, t) + 0.12),
      y: shaftY + shaftHeight * t - ringHeight / 2,
    }
  }).sort((a, b) => a.y - b.y)

  return (
    <group>
      {rings.map((ring, index) => (
        <ColumnBlock height={ringHeight} key={index} node={node} scale={ring.scale} y={ring.y} />
      ))}
    </group>
  )
}

function LatheBands({
  node,
  shaftY,
  shaftHeight,
}: {
  node: ColumnNode
  shaftY: number
  shaftHeight: number
}) {
  const latheRingCount = Math.max(
    node.latheRingCount ?? 0,
    node.shaftDetail === 'lathe-turned' ? 8 : 0,
  )
  if (latheRingCount <= 0 || shaftHeight <= 0) return null

  const placement = node.latheRingSpacing ?? 'ends'
  const bandHeight = Math.min(0.04, shaftHeight / Math.max(12, latheRingCount * 3))
  const bands = Array.from({ length: latheRingCount }, (_, index) => {
    const pairIndex = Math.floor(index / 2)
    const nearTop = index % 2 === 1
    const offset = Math.min(0.48, 0.1 + pairIndex * 0.04)
    const t =
      placement === 'even'
        ? (index + 1) / (latheRingCount + 1)
        : placement === 'top'
          ? 1 - Math.min(0.48, 0.08 + index * 0.04)
          : placement === 'bottom'
            ? Math.min(0.48, 0.08 + index * 0.04)
            : nearTop
              ? 1 - offset
              : offset
    return shaftY + shaftHeight * t - bandHeight / 2
  }).sort((a, b) => a - b)

  return (
    <group>
      {bands.map((y, index) => (
        <ColumnBlock
          height={bandHeight}
          key={index}
          node={node}
          scale={0.82 + (index % 2) * 0.08}
          y={y}
        />
      ))}
    </group>
  )
}

function Flutes({
  node,
  shaftY,
  shaftHeight,
}: {
  node: ColumnNode
  shaftY: number
  shaftHeight: number
}) {
  const fluteCount = Math.max(node.fluteCount, node.shaftDetail === 'fluted' ? 16 : 0)
  if (fluteCount <= 0 || shaftHeight <= 0 || node.crossSection !== 'round') return null

  const fluteDepth = node.fluteDepth ?? 0.02
  const fluteWidth = node.fluteWidth ?? fluteDepth
  const fluteRadius = Math.max(0.006, fluteWidth * 0.42)
  const shaftRadius = node.radius * 0.74

  return (
    <group>
      {Array.from({ length: fluteCount }, (_, index) => {
        const angle = (index / fluteCount) * Math.PI * 2
        const x = Math.cos(angle) * shaftRadius
        const z = Math.sin(angle) * shaftRadius
        return (
          <MappedCylinder
            height={shaftHeight * 0.92}
            key={index}
            position={[x, shaftY + shaftHeight / 2, z]}
            radius={fluteRadius}
            segments={8}
          />
        )
      })}
    </group>
  )
}

function DravidianShaftPanels({
  node,
  shaftY,
  shaftHeight,
}: {
  node: ColumnNode
  shaftY: number
  shaftHeight: number
}) {
  const panelCount = Math.max(
    node.panelCount ?? 0,
    node.style === 'dravidian-carved' || node.shaftDetail === 'panelled' ? 3 : 0,
  )
  if (panelCount <= 0 || shaftHeight <= 0) return null

  const shaftWidth = node.width * 0.72
  const shaftDepth = node.depth * 0.72
  const panelHeight = Math.min(0.42, shaftHeight / Math.max(4, panelCount + 2))
  const panelWidth = node.width * 0.26
  const rail = Math.max(0.012, node.width * 0.028)
  const reliefDepth = Math.max(0.012, node.panelInsetDepth ?? node.width * 0.025)
  const rows = Array.from({ length: panelCount }, (_, index) => (index + 1) / (panelCount + 1))
  const panelShape = node.panelShape ?? 'rectangle'

  const PanelFace = ({
    position,
    rotation = 0,
  }: {
    position: [number, number, number]
    rotation?: number
  }) => (
    <group position={position} rotation={[0, rotation, 0]}>
      <MappedBox
        depth={reliefDepth}
        height={rail}
        position={[0, panelHeight / 2, 0]}
        softenEdges={false}
        width={panelWidth}
      />
      <MappedBox
        depth={reliefDepth}
        height={rail}
        position={[0, -panelHeight / 2, 0]}
        softenEdges={false}
        width={panelWidth}
      />
      <MappedBox
        depth={reliefDepth}
        height={panelHeight}
        position={[panelWidth / 2, 0, 0]}
        softenEdges={false}
        width={rail}
      />
      <MappedBox
        depth={reliefDepth}
        height={panelHeight}
        position={[-panelWidth / 2, 0, 0]}
        softenEdges={false}
        width={rail}
      />
      {panelShape === 'diamond' && (
        <MappedBox
          depth={reliefDepth}
          height={panelHeight * 0.42}
          position={[0, 0, 0]}
          rotation={[0, 0, Math.PI / 4]}
          softenEdges={false}
          width={rail * 1.2}
        />
      )}
      {panelShape === 'arched' && (
        <MappedTorus
          arc={Math.PI}
          position={[0, panelHeight * 0.28, 0]}
          ringRadius={panelWidth * 0.42}
          scaleX={panelWidth * 0.42}
          scaleY={rail}
          scaleZ={reliefDepth}
          tubeRadius={Math.max(rail, reliefDepth) * 0.18}
        />
      )}
    </group>
  )

  return (
    <group>
      {rows.map((t, rowIndex) => {
        const y = shaftY + shaftHeight * t
        return (
          <group key={rowIndex}>
            <PanelFace position={[0, y, shaftDepth / 2 + reliefDepth / 2]} />
            <PanelFace position={[0, y, -shaftDepth / 2 - reliefDepth / 2]} />
            <PanelFace position={[shaftWidth / 2 + reliefDepth / 2, y, 0]} rotation={Math.PI / 2} />
            <PanelFace
              position={[-shaftWidth / 2 - reliefDepth / 2, y, 0]}
              rotation={Math.PI / 2}
            />
          </group>
        )
      })}
    </group>
  )
}

function SpiralRibs({
  node,
  shaftY,
  shaftHeight,
}: {
  node: ColumnNode
  shaftY: number
  shaftHeight: number
}) {
  const spiralRibCount = node.spiralRibCount ?? 0
  const spiralTwist = node.spiralTwist ?? 0
  const shaftTaper = node.shaftTaper ?? 0
  const ribCountSetting = Math.max(spiralRibCount, node.shaftDetail === 'spiral' ? 12 : 0)
  if (ribCountSetting <= 0 || spiralTwist === 0 || shaftHeight <= 0) return null

  const ribCount = Math.min(ribCountSetting, 24)
  const stepCount = 28
  const ribDistance = node.radius * 0.78
  const ribWidth = Math.max(0.012, node.radius * 0.06)
  const segmentHeight = (shaftHeight / stepCount) * 1.18
  const lean = spiralTwist > 0 ? -0.55 : 0.55

  return (
    <group>
      {Array.from({ length: ribCount * stepCount }, (_, index) => {
        const ribIndex = index % ribCount
        const stepIndex = Math.floor(index / ribCount)
        const t = (stepIndex + 0.5) / stepCount
        const angle = (ribIndex / ribCount) * Math.PI * 2 + t * spiralTwist * Math.PI * 2
        const taperScale = 1 - Math.min(shaftTaper, 0.85) * t
        return (
          <MappedCylinder
            height={segmentHeight}
            key={index}
            position={[
              Math.cos(angle) * ribDistance * taperScale,
              shaftY + shaftHeight * t,
              Math.sin(angle) * ribDistance * taperScale,
            ]}
            radius={ribWidth}
            rotation={[0, -angle, lean]}
            segments={8}
          />
        )
      })}
    </group>
  )
}

function LowerCarvedBand({
  node,
  shaftY,
  shaftHeight,
}: {
  node: ColumnNode
  shaftY: number
  shaftHeight: number
}) {
  const placement = node.carvingPlacement ?? 'capital'
  if (
    !node.lowerBandEnabled ||
    shaftHeight <= 0 ||
    (placement !== 'shaft' && placement !== 'all')
  ) {
    return null
  }

  const bandHeight = Math.min(node.lowerBandHeight ?? 0.24, shaftHeight * 0.35)
  const y = shaftY + shaftHeight * 0.12
  const level = Math.max(1, node.lowerBandCarvingLevel ?? 1)
  const count = Math.max(6, level * 6)
  const distance = Math.max(node.radius * 0.82, Math.max(node.width, node.depth) * 0.36)

  return (
    <group>
      <ColumnBlock height={bandHeight} node={node} scale={0.84} y={y} />
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2
        return (
          <MappedCylinder
            height={bandHeight * 0.62}
            key={index}
            position={[
              Math.cos(angle) * distance,
              y + bandHeight * 0.5,
              Math.sin(angle) * distance,
            ]}
            radius={0.012}
            rotation={[0, -angle, 0]}
            segments={5}
          />
        )
      })}
    </group>
  )
}

function CapitalCarvings({
  node,
  capitalY,
  capitalHeight,
}: {
  node: ColumnNode
  capitalY: number
  capitalHeight: number
}) {
  const placement = node.carvingPlacement ?? 'capital'
  const carvingLevel = Math.max(node.carvingLevel ?? 0, node.capitalCarvingLevel ?? 0)
  const bandSetting = node.capitalBandCount ?? 0
  if (
    (carvingLevel <= 0 && bandSetting <= 0) ||
    capitalHeight <= 0 ||
    (placement !== 'capital' && placement !== 'all')
  ) {
    return null
  }

  const level = Math.min(Math.max(carvingLevel, bandSetting > 0 ? 1 : 0), 4)
  const bandHeight = Math.min(0.035, capitalHeight / 8)
  const bandCount = Math.min(bandSetting > 0 ? bandSetting : level + 1, 16)
  const bands = Array.from({ length: bandCount }, (_, index) => {
    const t = (index + 1) / (bandCount + 1)
    return capitalY + capitalHeight * t - bandHeight / 2
  })

  if (node.crossSection === 'square' || node.crossSection === 'rectangular') {
    const dentilCount = Math.max(node.dentilCount ?? 0, level * 4, 4)
    const dentilHeight = Math.min(0.08, capitalHeight * 0.28)
    const dentilDepth = Math.min(0.08, Math.min(node.width, node.depth) * 0.16)
    const dentilWidth = Math.max(0.025, node.width / (dentilCount * 1.75))
    const halfWidth = node.width * 0.56
    const halfDepth = node.depth * 0.56
    const y = capitalY + capitalHeight * 0.28
    const xPositions = Array.from({ length: dentilCount }, (_, index) => {
      const t = dentilCount === 1 ? 0.5 : index / (dentilCount - 1)
      return -halfWidth + t * halfWidth * 2
    })
    const zPositions = Array.from({ length: dentilCount }, (_, index) => {
      const t = dentilCount === 1 ? 0.5 : index / (dentilCount - 1)
      return -halfDepth + t * halfDepth * 2
    })

    return (
      <group>
        {bands.map((bandY, index) => (
          <ColumnBlock
            height={bandHeight}
            key={`band-${index}`}
            node={node}
            scale={1.28}
            y={bandY}
          />
        ))}
        {xPositions.map((x, index) => (
          <group key={`front-back-dentil-${index}`}>
            <MappedBox
              depth={dentilDepth}
              height={dentilHeight}
              position={[x, y, halfDepth]}
              softenEdges={false}
              width={dentilWidth}
            />
            <MappedBox
              depth={dentilDepth}
              height={dentilHeight}
              position={[x, y, -halfDepth]}
              softenEdges={false}
              width={dentilWidth}
            />
          </group>
        ))}
        {zPositions.map((z, index) => (
          <group key={`side-dentil-${index}`}>
            <MappedBox
              depth={dentilWidth}
              height={dentilHeight}
              position={[halfWidth, y, z]}
              softenEdges={false}
              width={dentilDepth}
            />
            <MappedBox
              depth={dentilWidth}
              height={dentilHeight}
              position={[-halfWidth, y, z]}
              softenEdges={false}
              width={dentilDepth}
            />
          </group>
        ))}
      </group>
    )
  }

  const beadCount = Math.max(node.beadCount ?? 0, 8, level * 8)
  const beadRadius = Math.max(0.012, Math.min(0.03, node.radius * 0.12))
  const beadDistance = node.radius * 1.24
  const beadY = capitalY + capitalHeight * 0.24

  return (
    <group>
      {bands.map((bandY, index) => (
        <ColumnBlock height={bandHeight} key={`band-${index}`} node={node} scale={1.24} y={bandY} />
      ))}
      {Array.from({ length: beadCount }, (_, index) => {
        const angle = (index / beadCount) * Math.PI * 2
        return (
          <MappedSphere
            key={`bead-${index}`}
            position={[Math.cos(angle) * beadDistance, beadY, Math.sin(angle) * beadDistance]}
            radius={beadRadius}
          />
        )
      })}
    </group>
  )
}

function Volutes({
  node,
  capitalY,
  capitalHeight,
}: {
  node: ColumnNode
  capitalY: number
  capitalHeight: number
}) {
  if (!['volute', 'ionic-volute'].includes(node.capitalStyle ?? 'simple') || capitalHeight <= 0)
    return null

  const y = capitalY + capitalHeight * 0.62
  const radius = node.voluteSize ?? Math.min(0.085, Math.max(0.04, node.width * 0.12))
  const x = node.width * 0.46
  const z = node.depth * 0.7
  const maxVolutes = Math.max(0, Math.min(node.voluteCount ?? 4, 8))
  const volutes = [
    {
      position: [x, y, z] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    },
    {
      position: [-x, y, z] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    },
    {
      position: [x, y, -z] as [number, number, number],
      rotation: [0, Math.PI, 0] as [number, number, number],
    },
    {
      position: [-x, y, -z] as [number, number, number],
      rotation: [0, Math.PI, 0] as [number, number, number],
    },
    {
      position: [z, y, x] as [number, number, number],
      rotation: [0, Math.PI / 2, 0] as [number, number, number],
    },
    {
      position: [z, y, -x] as [number, number, number],
      rotation: [0, Math.PI / 2, 0] as [number, number, number],
    },
    {
      position: [-z, y, x] as [number, number, number],
      rotation: [0, -Math.PI / 2, 0] as [number, number, number],
    },
    {
      position: [-z, y, -x] as [number, number, number],
      rotation: [0, -Math.PI / 2, 0] as [number, number, number],
    },
  ].slice(0, maxVolutes)

  return (
    <group>
      {volutes.map((volute, index) => (
        <MappedTorus
          key={index}
          position={volute.position}
          ringRadius={radius}
          rotation={volute.rotation}
          scaleZ={radius * 0.28}
          tubeRadius={radius * 0.18}
        />
      ))}
    </group>
  )
}

function LeafCarvings({
  node,
  capitalY,
  capitalHeight,
}: {
  node: ColumnNode
  capitalY: number
  capitalHeight: number
}) {
  if (
    !['leaf-carved', 'corinthian-leaf'].includes(node.capitalStyle ?? 'simple') ||
    capitalHeight <= 0
  ) {
    return null
  }

  const leafCount = node.leafCount ?? (node.crossSection === 'round' ? 18 : 12)
  const distance = Math.max(node.radius * 1.05, Math.max(node.width, node.depth) * 0.48)
  const rowCount = Math.max(0, Math.min(node.leafRows ?? 2, 4))
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    y: capitalY + capitalHeight * (0.3 + index * 0.16),
    scale: 0.28 - index * 0.04,
    offset: index % 2 === 0 ? 0 : Math.PI / leafCount,
  }))

  return (
    <group>
      {rows.flatMap((row, rowIndex) =>
        Array.from({ length: leafCount }, (_, index) => {
          const angle = (index / leafCount) * Math.PI * 2 + row.offset
          return (
            <MappedCone
              height={capitalHeight * row.scale}
              key={`${rowIndex}-${index}`}
              position={[Math.cos(angle) * distance, row.y, Math.sin(angle) * distance]}
              radiusX={0.018}
              radiusZ={0.01}
              rotation={[0.48, -angle, 0]}
              segments={6}
            />
          )
        }),
      )}
    </group>
  )
}

function Capital({ node, y, height }: { node: ColumnNode; y: number; height: number }) {
  if (height <= 0) return null

  const capitalStyle = node.capitalStyle ?? 'simple'
  if (capitalStyle === 'none') return null

  if (capitalStyle === 'south-indian-bracket' || capitalStyle === 'wood-bracket') {
    const tierCount = Math.max(1, node.bracketTierCount ?? 3)
    const tierHeight = height / tierCount
    const bracketDepth = node.bracketDepth ?? 0.35
    return (
      <group>
        {Array.from({ length: tierCount }, (_, index) => {
          const t = index / Math.max(1, tierCount - 1)
          const scale = (node.capitalWidthScale ?? 1.6) + t * 0.32
          return (
            <SquareBlock
              depth={node.depth * scale + bracketDepth * t}
              height={tierHeight}
              key={index}
              width={node.width * scale + bracketDepth * t}
              y={y + index * tierHeight}
            />
          )
        })}
        {Array.from({ length: node.pendantCount ?? 0 }, (_, index) => {
          const count = Math.max(1, node.pendantCount ?? 0)
          const angle = (index / count) * Math.PI * 2
          const distance = Math.max(node.width, node.depth) * 0.56
          return (
            <MappedCone
              height={height * 0.28}
              key={index}
              position={[Math.cos(angle) * distance, y - height * 0.1, Math.sin(angle) * distance]}
              radiusX={0.035}
              rotation={[0, 0, 0]}
              segments={6}
            />
          )
        })}
      </group>
    )
  }

  if (capitalStyle === 'rounded' || capitalStyle === 'doric') {
    const topWidth = node.width * (node.capitalWidthScale ?? 1.34)
    const topDepth = node.depth * (node.capitalDepthScale ?? node.capitalWidthScale ?? 1.34)
    return (
      <group>
        <OvalBlock
          depth={topDepth * 0.72}
          height={height * 0.24}
          segments={32}
          width={topWidth * 0.72}
          y={y}
        />
        <OvalBlock
          depth={topDepth * 0.92}
          height={height * 0.32}
          segments={32}
          width={topWidth * 0.92}
          y={y + height * 0.24}
        />
        <SquareBlock
          depth={topDepth}
          height={height * 0.44}
          width={topWidth}
          y={y + height * 0.56}
        />
      </group>
    )
  }

  if (capitalStyle === 'stepped') {
    const widthScale = node.capitalWidthScale ?? 1.46
    const depthScale = node.capitalDepthScale ?? widthScale
    const tierCount = Math.max(3, node.capitalTierCount ?? 3)
    const tierHeight = height / tierCount
    const stepSpread = node.capitalStepSpread ?? 0.42

    return (
      <group>
        {Array.from({ length: tierCount }, (_, index) => {
          const t = index / Math.max(1, tierCount - 1)
          const widthScaleAt = Math.max(0.5, widthScale - (1 - t) * stepSpread)
          const depthScaleAt = Math.max(0.5, depthScale - (1 - t) * stepSpread)
          return (
            <SquareBlock
              depth={node.depth * depthScaleAt}
              height={tierHeight * 1.01}
              key={index}
              width={node.width * widthScaleAt}
              y={y + index * tierHeight}
            />
          )
        })}
      </group>
    )
  }

  if (
    capitalStyle === 'volute' ||
    capitalStyle === 'ionic-volute' ||
    capitalStyle === 'leaf-carved' ||
    capitalStyle === 'corinthian-leaf'
  ) {
    const topWidth = node.width * (node.capitalWidthScale ?? 1.46)
    const topDepth = node.depth * (node.capitalDepthScale ?? node.capitalWidthScale ?? 1.46)

    return (
      <group>
        <ColumnBlock height={height * 0.24} node={node} scale={0.9} y={y} />
        <ColumnBlock height={height * 0.2} node={node} scale={1.08} y={y + height * 0.24} />
        <SquareBlock
          depth={topDepth}
          height={height * 0.28}
          width={topWidth}
          y={y + height * 0.44}
        />
        <Volutes capitalHeight={height} capitalY={y} node={node} />
        <LeafCarvings capitalHeight={height} capitalY={y} node={node} />
      </group>
    )
  }

  const widthScale = node.capitalWidthScale ?? (capitalStyle === 'simple-slab' ? 1.28 : 1.18)
  const depthScale = node.capitalDepthScale ?? widthScale

  if (node.crossSection === 'square' || node.crossSection === 'rectangular') {
    return (
      <SquareBlock
        depth={node.depth * depthScale}
        height={height}
        width={node.width * widthScale}
        y={y}
      />
    )
  }

  return (
    <RoundBlock
      height={height}
      radius={Math.max(node.radius * widthScale, node.width * widthScale * 0.5)}
      segments={getSegments(node)}
      y={y}
    />
  )
}

export const ColumnRenderer = ({ node }: { node: ColumnNode }) => {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node, 'column')
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const material = useMemo(
    () => createColumnMaterial({ material: node.material, materialPreset: node.materialPreset }),
    [
      node.material,
      node.material?.preset,
      node.material?.properties,
      node.material?.texture,
      node.materialPreset,
    ],
  )

  useRegistry(node.id, node.type, ref)

  const shaftLayout = useMemo(() => {
    const baseHeight = node.baseStyle === 'none' ? 0 : Math.min(node.baseHeight, node.height * 0.4)
    const capitalHeight =
      node.capitalStyle === 'none' ? 0 : Math.min(node.capitalHeight, node.height * 0.4)
    const shaftHeight = Math.max(0.1, node.height - baseHeight - capitalHeight)
    return { baseHeight, capitalHeight, shaftY: baseHeight, shaftHeight }
  }, [node.baseHeight, node.baseStyle, node.capitalHeight, node.capitalStyle, node.height])

  return (
    <ColumnMaterialContext.Provider value={material}>
      <ColumnEdgeSoftnessContext.Provider value={node.edgeSoftness ?? 0.025}>
        <group
          position={liveTransform?.position ?? node.position}
          ref={ref}
          rotation={[0, liveTransform?.rotation ?? node.rotation, 0]}
          visible={node.visible}
          {...handlers}
        >
          <Base height={shaftLayout.baseHeight} node={node} />
          <BaseCarvings height={shaftLayout.baseHeight} node={node} />
          <Shaft height={shaftLayout.shaftHeight} node={node} y={shaftLayout.shaftY} />
          <Rings node={node} shaftHeight={shaftLayout.shaftHeight} shaftY={shaftLayout.shaftY} />
          <LatheBands
            node={node}
            shaftHeight={shaftLayout.shaftHeight}
            shaftY={shaftLayout.shaftY}
          />
          <Flutes node={node} shaftHeight={shaftLayout.shaftHeight} shaftY={shaftLayout.shaftY} />
          <LowerCarvedBand
            node={node}
            shaftHeight={shaftLayout.shaftHeight}
            shaftY={shaftLayout.shaftY}
          />
          <DravidianShaftPanels
            node={node}
            shaftHeight={shaftLayout.shaftHeight}
            shaftY={shaftLayout.shaftY}
          />
          <SpiralRibs
            node={node}
            shaftHeight={shaftLayout.shaftHeight}
            shaftY={shaftLayout.shaftY}
          />
          <Capital
            height={shaftLayout.capitalHeight}
            node={node}
            y={shaftLayout.baseHeight + shaftLayout.shaftHeight}
          />
          <CapitalCarvings
            capitalHeight={shaftLayout.capitalHeight}
            capitalY={shaftLayout.baseHeight + shaftLayout.shaftHeight}
            node={node}
          />
        </group>
      </ColumnEdgeSoftnessContext.Provider>
    </ColumnMaterialContext.Provider>
  )
}
