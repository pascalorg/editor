'use client'

import {
  type AnyNodeId,
  type RoofSegmentNode,
  SKYLIGHT_TYPE_PRESETS,
  type SkylightNode,
  type SkylightOpeningSide,
  useInteractive,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  type ColorPreset,
  createMaterial,
  createMaterialFromPresetRef,
  createSurfaceRoleMaterial,
  getRoofOuterSurfaceFrameAtPoint,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { surfaceQuatFromNormal } from '../shared/roof-surface'
import { TrimClippedMesh, useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import { buildFrameGeometry } from './frame-csg'
import { buildLanternGlassGeometry, clamp01, paneSize } from './geometry'

const yAxis = new THREE.Vector3(0, 1, 0)

const defaultFrameMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.3,
  metalness: 0.5,
})

// MeshBasicMaterial: only requires position (slot 0). Safe with DoubleSide
// because Basic doesn't write to the additional MRT targets that
// MeshStandardMaterial/Physical do, so the WebGPU "writeMask not zero"
// error doesn't fire. Also avoids the "vertex buffer slot 1 not set" error
// that MeshLambertNodeMaterial triggers when inline <boxGeometry> JSX
// recreates geometry on resize — the node-material pipeline expects normals
// in slot 1, but the new geometry instance isn't fully bound yet at draw time.
// MeshBasicMaterial at 30% opacity gives visually identical glass without
// those constraints.
const defaultGlassMaterial = new THREE.MeshBasicMaterial({
  color: 0x87_ce_eb,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
  depthWrite: false,
})

function FrameBar({
  end,
  material,
  radius,
  start,
}: {
  end: [number, number, number]
  material: THREE.Material | THREE.Material[]
  radius: number
  start: [number, number, number]
}) {
  const transform = useMemo(() => {
    const startPoint = new THREE.Vector3(...start)
    const endPoint = new THREE.Vector3(...end)
    const direction = endPoint.clone().sub(startPoint)
    const length = direction.length()
    const midpoint = startPoint.clone().add(endPoint).multiplyScalar(0.5)
    const quaternion = new THREE.Quaternion()
    if (length > 1e-6) {
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    }
    return { length, midpoint, quaternion }
  }, [start, end])

  if (transform.length <= 1e-6) return null

  return (
    <mesh
      castShadow
      material={material}
      name="skylight-surface"
      position={transform.midpoint}
      quaternion={transform.quaternion}
      receiveShadow
    >
      <cylinderGeometry args={[radius, radius, transform.length, 8]} />
    </mesh>
  )
}

function GlassPane({
  glassThickness,
  material,
  name = 'skylight-glass',
  paneDepth,
  position = [0, 0, 0],
  rotation,
  width,
  segment,
  parentToSegment,
}: {
  glassThickness: number
  material: THREE.Material | THREE.Material[]
  name?: string
  paneDepth: number
  position?: [number, number, number]
  rotation?: [number, number, number]
  width: number
  // Trim-clip context: when provided, the glass pane is sliced by the host
  // segment's trim (so the glazing matches the roof cutaway). Absent in
  // contexts with no host segment frame.
  segment?: RoofSegmentNode
  parentToSegment?: THREE.Matrix4
}) {
  const geometry = useMemo(
    () => new THREE.BoxGeometry(paneSize(width), paneSize(glassThickness), paneSize(paneDepth)),
    [width, glassThickness, paneDepth],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  if (segment && parentToSegment) {
    return (
      <TrimClippedMesh
        geometry={geometry}
        material={material}
        name={name}
        parentToSegment={parentToSegment}
        position={position}
        receiveShadow
        rotation={rotation}
        segment={segment}
      />
    )
  }

  return (
    <mesh
      geometry={geometry}
      material={material}
      name={name}
      position={position}
      receiveShadow
      rotation={rotation}
    />
  )
}

function PaneFrame({
  depth,
  railHeight,
  railWidth,
  material,
  position = [0, 0, 0],
  width,
}: {
  depth: number
  railHeight: number
  railWidth: number
  material: THREE.Material | THREE.Material[]
  position?: [number, number, number]
  width: number
}) {
  const halfW = width / 2
  const halfD = depth / 2
  const y = railHeight / 2

  return (
    <group position={position}>
      <mesh
        castShadow
        material={material}
        name="skylight-surface"
        position={[0, y, halfD]}
        receiveShadow
      >
        <boxGeometry args={[paneSize(width + railWidth), railHeight, railWidth]} />
      </mesh>
      <mesh
        castShadow
        material={material}
        name="skylight-surface"
        position={[0, y, -halfD]}
        receiveShadow
      >
        <boxGeometry args={[paneSize(width + railWidth), railHeight, railWidth]} />
      </mesh>
      <mesh
        castShadow
        material={material}
        name="skylight-surface"
        position={[-halfW, y, 0]}
        receiveShadow
      >
        <boxGeometry args={[railWidth, railHeight, paneSize(depth + railWidth)]} />
      </mesh>
      <mesh
        castShadow
        material={material}
        name="skylight-surface"
        position={[halfW, y, 0]}
        receiveShadow
      >
        <boxGeometry args={[railWidth, railHeight, paneSize(depth + railWidth)]} />
      </mesh>
    </group>
  )
}

function LanternGlass({
  curbHeight,
  frameMaterial,
  glassMaterial,
  node,
  segment,
  parentToSegment,
}: {
  curbHeight: number
  frameMaterial: THREE.Material | THREE.Material[]
  glassMaterial: THREE.Material | THREE.Material[]
  node: SkylightNode
  segment?: RoofSegmentNode
  parentToSegment?: THREE.Matrix4
}) {
  const preset = SKYLIGHT_TYPE_PRESETS.lantern
  const width = node.width - 0.01
  const depth = node.height - 0.01
  const height = Math.max(0.05, node.lanternHeight ?? preset.lanternHeight)
  const topScale = clamp01(node.lanternTopScale ?? preset.lanternTopScale)
  const baseHalfW = paneSize(width) / 2
  const baseHalfD = paneSize(depth) / 2
  const topHalfW = baseHalfW * topScale
  const topHalfD = baseHalfD * topScale
  const frameRadius = Math.max(0.008, node.frameThickness * 0.16)
  const baseCorners: [number, number, number][] = [
    [-baseHalfW, 0, baseHalfD],
    [baseHalfW, 0, baseHalfD],
    [baseHalfW, 0, -baseHalfD],
    [-baseHalfW, 0, -baseHalfD],
  ]
  const topCorners: [number, number, number][] =
    topScale <= 1e-4
      ? [
          [0, height, 0],
          [0, height, 0],
          [0, height, 0],
          [0, height, 0],
        ]
      : [
          [-topHalfW, height, topHalfD],
          [topHalfW, height, topHalfD],
          [topHalfW, height, -topHalfD],
          [-topHalfW, height, -topHalfD],
        ]
  const geometry = useMemo(
    () => buildLanternGlassGeometry(width, depth, height, topScale),
    [depth, height, topScale, width],
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  const glassParentToSegment =
    segment && parentToSegment
      ? new THREE.Matrix4()
          .copy(parentToSegment)
          .multiply(new THREE.Matrix4().makeTranslation(0, curbHeight, 0))
      : undefined

  return (
    <group position={[0, curbHeight, 0]}>
      {segment && glassParentToSegment ? (
        <TrimClippedMesh
          geometry={geometry}
          material={glassMaterial}
          name="skylight-glass"
          parentToSegment={glassParentToSegment}
          receiveShadow
          segment={segment}
        />
      ) : (
        <mesh geometry={geometry} material={glassMaterial} name="skylight-glass" receiveShadow />
      )}
      {baseCorners.map((corner, index) => (
        <FrameBar
          end={baseCorners[(index + 1) % baseCorners.length] ?? corner}
          key={`lantern-base-${index}`}
          material={frameMaterial}
          radius={frameRadius}
          start={corner}
        />
      ))}
      {baseCorners.map((corner, index) => (
        <FrameBar
          end={topCorners[index] ?? corner}
          key={`lantern-hip-${index}`}
          material={frameMaterial}
          radius={frameRadius}
          start={corner}
        />
      ))}
      {topScale > 1e-4 &&
        topCorners.map((corner, index) => (
          <FrameBar
            end={topCorners[(index + 1) % topCorners.length] ?? corner}
            key={`lantern-top-${index}`}
            material={frameMaterial}
            radius={frameRadius}
            start={corner}
          />
        ))}
    </group>
  )
}

function getHingedPaneTransform(
  side: SkylightOpeningSide,
  width: number,
  depth: number,
  openingAngle: number,
): {
  hingePosition: [number, number, number]
  panePosition: [number, number, number]
  rotation: [number, number, number]
} {
  if (side === 'bottom') {
    return {
      hingePosition: [0, 0, -depth / 2],
      panePosition: [0, 0, depth / 2],
      rotation: [-openingAngle, 0, 0],
    }
  }
  if (side === 'left') {
    return {
      hingePosition: [-width / 2, 0, 0],
      panePosition: [width / 2, 0, 0],
      rotation: [0, 0, openingAngle],
    }
  }
  if (side === 'right') {
    return {
      hingePosition: [width / 2, 0, 0],
      panePosition: [-width / 2, 0, 0],
      rotation: [0, 0, -openingAngle],
    }
  }
  return {
    hingePosition: [0, 0, depth / 2],
    panePosition: [0, 0, -depth / 2],
    rotation: [openingAngle, 0, 0],
  }
}

function ElectricMotorHousing({
  curbHeight,
  frameMaterial,
  glassThickness,
  node,
  side,
}: {
  curbHeight: number
  frameMaterial: THREE.Material | THREE.Material[]
  glassThickness: number
  node: SkylightNode
  side: SkylightOpeningSide
}) {
  const size = Math.max(
    0.03,
    node.motorHousingSize ?? SKYLIGHT_TYPE_PRESETS.opening.motorHousingSize,
  )
  const y = curbHeight + glassThickness + size / 2
  const isHorizontalHinge = side === 'top' || side === 'bottom'
  return (
    <mesh
      castShadow
      material={frameMaterial}
      name="skylight-surface"
      position={[
        side === 'left' ? -node.width / 2 : side === 'right' ? node.width / 2 : 0,
        y,
        side === 'top' ? node.height / 2 : side === 'bottom' ? -node.height / 2 : 0,
      ]}
      receiveShadow
    >
      <boxGeometry
        args={
          isHorizontalHinge
            ? [paneSize(node.width), size, size]
            : [size, size, paneSize(node.height)]
        }
      />
    </mesh>
  )
}

function HingedGlass({
  curbHeight,
  frameMaterial,
  glassMaterial,
  glassThickness,
  hasMotorHousing,
  node,
  openAmount,
  segment,
  parentToSegment,
}: {
  curbHeight: number
  frameMaterial: THREE.Material | THREE.Material[]
  glassMaterial: THREE.Material | THREE.Material[]
  glassThickness: number
  hasMotorHousing: boolean
  node: SkylightNode
  openAmount: number
  segment?: RoofSegmentNode
  parentToSegment?: THREE.Matrix4
}) {
  const preset = SKYLIGHT_TYPE_PRESETS.opening
  const side = node.openingSide ?? preset.openingSide
  const openingAngle = Math.max(0, node.openingAngle ?? preset.openingAngle) * clamp01(openAmount)
  const width = node.width - 0.01
  const depth = node.height - 0.01
  const transform = getHingedPaneTransform(side, width, depth, openingAngle)
  const frameRadius = Math.max(0.006, node.frameThickness * 0.13)
  const sashRailWidth = Math.max(0.018, node.frameThickness * 0.42)
  const sashRailHeight = Math.max(glassThickness * 1.4, node.frameThickness * 0.2)
  const showSupport = side === 'top' && openingAngle > 0.04
  const supportX = width / 2 + node.frameThickness * 0.35
  const supportStartZ = -depth / 2 + Math.min(0.12, depth * 0.12)
  const supportTravel = depth * 0.78
  const supportEndY = curbHeight + glassThickness + Math.sin(openingAngle) * supportTravel
  const supportEndZ = depth / 2 - Math.cos(openingAngle) * supportTravel

  // The hinge group offsets + rotates the pane; compose that onto the
  // skylight→segment matrix so the glass clips in segment-local space.
  const hingeToSegment =
    segment && parentToSegment
      ? new THREE.Matrix4()
          .copy(parentToSegment)
          .multiply(
            new THREE.Matrix4().compose(
              new THREE.Vector3(
                transform.hingePosition[0],
                curbHeight + glassThickness / 2,
                transform.hingePosition[2],
              ),
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                  transform.rotation[0],
                  transform.rotation[1],
                  transform.rotation[2],
                ),
              ),
              new THREE.Vector3(1, 1, 1),
            ),
          )
      : undefined

  return (
    <>
      <group
        position={[
          transform.hingePosition[0],
          curbHeight + glassThickness / 2,
          transform.hingePosition[2],
        ]}
        rotation={transform.rotation}
      >
        <GlassPane
          glassThickness={glassThickness}
          material={glassMaterial}
          paneDepth={depth}
          parentToSegment={hingeToSegment}
          position={transform.panePosition}
          segment={segment}
          width={width}
        />
        <PaneFrame
          depth={depth}
          material={frameMaterial}
          position={transform.panePosition}
          railHeight={sashRailHeight}
          railWidth={sashRailWidth}
          width={width}
        />
      </group>
      {showSupport && (
        <>
          <FrameBar
            end={[-supportX, supportEndY, supportEndZ]}
            material={frameMaterial}
            radius={frameRadius * 0.72}
            start={[-supportX, curbHeight + 0.018, supportStartZ]}
          />
          <FrameBar
            end={[supportX, supportEndY, supportEndZ]}
            material={frameMaterial}
            radius={frameRadius * 0.72}
            start={[supportX, curbHeight + 0.018, supportStartZ]}
          />
        </>
      )}
      {hasMotorHousing && (
        <ElectricMotorHousing
          curbHeight={curbHeight}
          frameMaterial={frameMaterial}
          glassThickness={glassThickness}
          node={node}
          side={side}
        />
      )}
    </>
  )
}

function SlidingGlass({
  curbHeight,
  frameMaterial,
  glassMaterial,
  glassThickness,
  node,
  openAmount,
  segment,
  parentToSegment,
}: {
  curbHeight: number
  frameMaterial: THREE.Material | THREE.Material[]
  glassMaterial: THREE.Material | THREE.Material[]
  glassThickness: number
  node: SkylightNode
  openAmount: number
  segment?: RoofSegmentNode
  parentToSegment?: THREE.Matrix4
}) {
  const preset = SKYLIGHT_TYPE_PRESETS.sliding
  const slideDirection = node.slideDirection ?? preset.slideDirection
  const slideFraction = clamp01(openAmount)
  const trackWidth = Math.max(0.02, node.trackWidth ?? preset.trackWidth)
  const y = curbHeight + glassThickness / 2
  const railY = curbHeight + glassThickness + trackWidth / 2
  const sashRailWidth = Math.max(0.016, node.frameThickness * 0.36)
  const sashRailHeight = Math.max(glassThickness * 1.25, node.frameThickness * 0.18)

  if (slideDirection === 'x') {
    const paneWidth = (node.width - trackWidth) / 2
    const fixedX = -node.width / 4
    const movingX = node.width / 4 - slideFraction * paneWidth
    const fixedPanePosition: [number, number, number] = [fixedX, y, 0]
    const movingPanePosition: [number, number, number] = [movingX, y + glassThickness + 0.003, 0]
    return (
      <>
        <GlassPane
          glassThickness={glassThickness}
          material={glassMaterial}
          paneDepth={node.height - 0.01}
          parentToSegment={parentToSegment}
          position={fixedPanePosition}
          segment={segment}
          width={paneWidth}
        />
        <PaneFrame
          depth={node.height - 0.01}
          material={frameMaterial}
          position={fixedPanePosition}
          railHeight={sashRailHeight}
          railWidth={sashRailWidth}
          width={paneWidth}
        />
        <GlassPane
          glassThickness={glassThickness}
          material={glassMaterial}
          paneDepth={node.height - 0.01}
          parentToSegment={parentToSegment}
          position={movingPanePosition}
          segment={segment}
          width={paneWidth}
        />
        <PaneFrame
          depth={node.height - 0.01}
          material={frameMaterial}
          position={movingPanePosition}
          railHeight={sashRailHeight}
          railWidth={sashRailWidth}
          width={paneWidth}
        />
        <mesh
          material={frameMaterial}
          name="skylight-surface"
          position={[0, railY, node.height / 2]}
          receiveShadow
        >
          <boxGeometry args={[paneSize(node.width + trackWidth * 2), trackWidth, trackWidth]} />
        </mesh>
        <mesh
          material={frameMaterial}
          name="skylight-surface"
          position={[0, railY, -node.height / 2]}
          receiveShadow
        >
          <boxGeometry args={[paneSize(node.width + trackWidth * 2), trackWidth, trackWidth]} />
        </mesh>
      </>
    )
  }

  const paneDepth = (node.height - trackWidth) / 2
  const fixedZ = -node.height / 4
  const movingZ = node.height / 4 - slideFraction * paneDepth
  const fixedPanePosition: [number, number, number] = [0, y, fixedZ]
  const movingPanePosition: [number, number, number] = [0, y + glassThickness + 0.003, movingZ]
  return (
    <>
      <GlassPane
        glassThickness={glassThickness}
        material={glassMaterial}
        paneDepth={paneDepth}
        parentToSegment={parentToSegment}
        position={fixedPanePosition}
        segment={segment}
        width={node.width - 0.01}
      />
      <PaneFrame
        depth={paneDepth}
        material={frameMaterial}
        position={fixedPanePosition}
        railHeight={sashRailHeight}
        railWidth={sashRailWidth}
        width={node.width - 0.01}
      />
      <GlassPane
        glassThickness={glassThickness}
        material={glassMaterial}
        paneDepth={paneDepth}
        parentToSegment={parentToSegment}
        position={movingPanePosition}
        segment={segment}
        width={node.width - 0.01}
      />
      <PaneFrame
        depth={paneDepth}
        material={frameMaterial}
        position={movingPanePosition}
        railHeight={sashRailHeight}
        railWidth={sashRailWidth}
        width={node.width - 0.01}
      />
      <mesh
        material={frameMaterial}
        name="skylight-surface"
        position={[node.width / 2, railY, 0]}
        receiveShadow
      >
        <boxGeometry args={[trackWidth, trackWidth, paneSize(node.height + trackWidth * 2)]} />
      </mesh>
      <mesh
        material={frameMaterial}
        name="skylight-surface"
        position={[-node.width / 2, railY, 0]}
        receiveShadow
      >
        <boxGeometry args={[trackWidth, trackWidth, paneSize(node.height + trackWidth * 2)]} />
      </mesh>
    </>
  )
}

const SkylightRenderer = ({ node: storeNode }: { node: SkylightNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'skylight', ref)
  const handlers = useNodeEvents(storeNode, 'skylight')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id))
  const node = useMemo(
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as SkylightNode) : storeNode),
    [storeNode, liveOverrides],
  )

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const frameGeo = useMemo(() => {
    return buildFrameGeometry({
      curb: node.curb,
      curbHeight: node.curbHeight,
      frameDepth: node.frameDepth,
      frameThickness: node.frameThickness,
      height: node.height,
      width: node.width,
    })
  }, [node.width, node.height, node.frameThickness, node.frameDepth, node.curb, node.curbHeight])

  useEffect(() => {
    return () => {
      frameGeo?.dispose()
    }
  }, [frameGeo])

  const frameMaterial = useMemo(() => {
    // Untextured frame (and everything in textures-off mode) takes the
    // themed 'joinery' role colour; explicit paint shows when textures on.
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('joinery', colorPreset, undefined, sceneTheme)
    }
    if (node.material) return createMaterial(node.material, shading)
    return createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultFrameMaterial
  }, [textures, colorPreset, sceneTheme, shading, node.material, node.materialPreset])

  const activeType = node.skylightType ?? 'flat'
  const typePreset = SKYLIGHT_TYPE_PRESETS[activeType]
  const glassThickness = Math.max(0.002, node.glassThickness ?? typePreset.glassThickness)
  const runtimeOpenAmount = useInteractive(
    (state) => state.skylights[storeNode.id as AnyNodeId]?.operationState,
  )
  const openAmount = runtimeOpenAmount ?? node.operationState ?? typePreset.operationState

  const glassMaterial = useMemo(() => {
    // Untextured glass (and textures-off mode) takes the themed 'glazing'
    // role material from the shared cache, so it must not be mutated.
    if (!textures || (!node.glassMaterial && !node.glassMaterialPreset)) {
      return createSurfaceRoleMaterial('glazing', colorPreset, undefined, sceneTheme)
    }
    const mat = node.glassMaterial
      ? createMaterial(node.glassMaterial, shading)
      : (createMaterialFromPresetRef(node.glassMaterialPreset, shading) ??
        defaultGlassMaterial.clone())
    if (mat && typeof mat === 'object') {
      if (mat instanceof THREE.MeshPhysicalMaterial) {
        mat.thickness = glassThickness
      }
    }
    return mat
  }, [
    textures,
    colorPreset,
    sceneTheme,
    shading,
    glassThickness,
    node.glassMaterial,
    node.glassMaterialPreset,
  ])

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const surfaceFrame = useMemo(() => {
    if (!segment) return { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }
    return getRoofOuterSurfaceFrameAtPoint(segment, node.position[0] ?? 0, node.position[2] ?? 0)
  }, [segment, node.position[0], node.position[2], node.rotation, liveOverrides, storeNode.id])

  const surfaceQuat = useMemo(
    () => surfaceQuatFromNormal(surfaceFrame.normal, new THREE.Quaternion()),
    [surfaceFrame.normal],
  )

  // Compose the surface tilt with the skylight's own yaw so the
  // registered ref group below carries the complete "skylight pose in
  // segment frame" as a single local position+quaternion. Registry
  // handles (`portal: 'grandparent'`) read this Object3D's *local*
  // pose, so splitting the tilt and the yaw across nested groups would
  // leave the registered group with just the yaw and put the handles
  // at the wrong spot.
  const composedQuat = useMemo(() => {
    const q = new THREE.Quaternion().copy(surfaceQuat)
    q.multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, node.rotation ?? 0))
    return q
  }, [surfaceQuat, node.rotation])

  const hasCurb = node.curb ?? false
  const curbH = hasCurb ? Math.max(0, node.curbHeight ?? 0.1) : 0

  // Map skylight-local geometry into the host segment's local frame (where the
  // trim cut prisms live) — the same pose the inner registered group is mounted
  // with (position [x, surfaceY, z] + surfaceQuat·yaw). Only the structural
  // frame is clipped; the thin glass panes live inside animated sub-components
  // (sliding / hinged) with their own internal transforms and ride with the
  // frame. Computed before the early return so the hook order stays stable.
  const localToSegment = useMemo(
    () =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(node.position[0] ?? 0, surfaceFrame.point.y, node.position[2] ?? 0),
        composedQuat,
        new THREE.Vector3(1, 1, 1),
      ),
    [node.position[0], node.position[2], surfaceFrame.point.y, composedQuat],
  )
  const clippedFrame = useSegmentTrimClippedGeometry(frameGeo, segment, localToSegment)

  if (!segment || !frameGeo) return null

  const surfaceY = surfaceFrame.point.y

  return (
    <group
      position={segment.position}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...handlers}
    >
      {/*
        Single registered transform group carries the full skylight pose
        in segment frame: translation = (skylight.x, surfaceY, skylight.z),
        quaternion = surfaceQuat · Y(node.rotation). Used to be three
        nested groups; collapsed because registry handles read this
        Object3D's *local* position/quaternion (grandparent portal mode),
        and a split tree would only expose the bottom group's local pose
        (the yaw) — handles would land at the segment origin on the roof
        base instead of on the skylight.
      */}
      <group
        position={[node.position[0] ?? 0, surfaceY, node.position[2] ?? 0]}
        quaternion={composedQuat}
        ref={ref}
      >
        <mesh
          castShadow
          geometry={clippedFrame ?? frameGeo}
          material={frameMaterial}
          name="skylight-surface"
          receiveShadow
        />
        {activeType === 'lantern' && (
          <LanternGlass
            curbHeight={curbH}
            frameMaterial={frameMaterial}
            glassMaterial={glassMaterial}
            node={node}
            parentToSegment={localToSegment}
            segment={segment}
          />
        )}
        {activeType === 'sliding' && (
          <SlidingGlass
            curbHeight={curbH}
            frameMaterial={frameMaterial}
            glassMaterial={glassMaterial}
            glassThickness={glassThickness}
            node={node}
            openAmount={openAmount}
            parentToSegment={localToSegment}
            segment={segment}
          />
        )}
        {activeType === 'opening' && (
          <HingedGlass
            curbHeight={curbH}
            frameMaterial={frameMaterial}
            glassMaterial={glassMaterial}
            glassThickness={glassThickness}
            hasMotorHousing={node.motorHousing ?? false}
            node={node}
            openAmount={openAmount}
            parentToSegment={localToSegment}
            segment={segment}
          />
        )}
        {(activeType === 'flat' || activeType === 'walk-on') && (
          <GlassPane
            glassThickness={glassThickness}
            material={glassMaterial}
            paneDepth={node.height + 0.004}
            parentToSegment={localToSegment}
            position={[0, curbH + glassThickness / 2, 0]}
            segment={segment}
            width={node.width + 0.004}
          />
        )}
      </group>
    </group>
  )
}

export default SkylightRenderer
