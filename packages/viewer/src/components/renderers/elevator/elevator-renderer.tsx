import {
  type AnyNode,
  type AnyNodeId,
  type ElevatorDoorSide,
  type ElevatorNode,
  getElevatorCabDepth,
  getElevatorCabWidth,
  getElevatorDoorLeafSides,
  getElevatorDoorLeafWidth,
  getElevatorDoorLeafX,
  getElevatorShaftDepth,
  getElevatorShaftWallThickness,
  getElevatorShaftWidth,
  getResolvedElevatorDoorPanelStyle as getResolvedDoorPanelStyle,
  getResolvedElevatorDoorStyle as getResolvedDoorStyle,
  getResolvedElevatorShaftStyle as getResolvedShaftStyle,
  resolveElevatorLevels,
  useInteractive,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  CylinderGeometry,
  type Group,
  type InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  TorusGeometry,
} from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useNodeEvents } from '../../../hooks/use-node-events'

const SHAFT_WALL_COLOR = '#d7dce4'
const SHAFT_SIDE_COLOR = '#4b5563'
const SHAFT_TRIM_COLOR = '#eef2f7'
const CAB_COLOR = '#d7dde5'
const GLASS_COLOR = '#f8fafc'
const DOOR_COLOR = '#8e98a6'
const PANEL_COLOR = '#1f2937'

type Vector3Tuple = [number, number, number]

const UNIT_BOX_GEOMETRY = new BoxGeometry(1, 1, 1)
const BUTTON_FACE_GEOMETRY = new CylinderGeometry(1, 0.92, 1, 24)
const BUTTON_GLOW_GEOMETRY = new CylinderGeometry(1.42, 1.42, 1, 24)
const BUTTON_RING_GEOMETRY = new TorusGeometry(1.12, 0.12, 8, 24)
const LABEL_MATRIX_DUMMY = new Object3D()
const SHAFT_TOP_FRAME_CLEARANCE = 0.006

type ElevatorDoorPanelStyleValue = ElevatorNode['doorPanelStyle']
type ElevatorDoorStyleValue = ElevatorNode['doorStyle']

const SHAFT_WALL_MATERIAL = new MeshStandardMaterial({
  color: SHAFT_WALL_COLOR,
  metalness: 0.08,
  roughness: 0.56,
})
const SHAFT_SIDE_MATERIAL = new MeshStandardMaterial({
  color: SHAFT_SIDE_COLOR,
  metalness: 0.12,
  roughness: 0.58,
})
const SHAFT_TRIM_MATERIAL = new MeshStandardMaterial({
  color: SHAFT_TRIM_COLOR,
  metalness: 0.2,
  roughness: 0.38,
})
const CAB_MATERIAL = new MeshStandardMaterial({
  color: CAB_COLOR,
  metalness: 0.2,
  roughness: 0.48,
})
const DOOR_MATERIAL = new MeshStandardMaterial({
  color: DOOR_COLOR,
  metalness: 0.34,
  roughness: 0.34,
})
const DOOR_GROOVE_MATERIAL = new MeshStandardMaterial({
  color: '#5f6978',
  metalness: 0.28,
  roughness: 0.42,
})
const GLASS_MATERIAL = new MeshStandardMaterial({
  color: GLASS_COLOR,
  depthWrite: false,
  metalness: 0,
  opacity: 0.2,
  roughness: 0.08,
  transparent: true,
})
const PANEL_MATERIAL = new MeshStandardMaterial({
  color: PANEL_COLOR,
  metalness: 0.32,
  roughness: 0.36,
})
const LANDING_PANEL_MATERIAL = new MeshStandardMaterial({
  color: PANEL_COLOR,
  metalness: 0.25,
  roughness: 0.4,
})
const INDICATOR_SCREEN_MATERIALS = {
  active: new MeshStandardMaterial({
    color: '#041f2f',
    emissive: '#0ea5e9',
    emissiveIntensity: 0.16,
    metalness: 0.12,
    roughness: 0.38,
  }),
  idle: new MeshStandardMaterial({
    color: '#111827',
    metalness: 0.12,
    roughness: 0.38,
  }),
}
const INDICATOR_GLYPH_MATERIALS = {
  active: new MeshStandardMaterial({
    color: '#38bdf8',
    emissive: '#38bdf8',
    emissiveIntensity: 0.36,
    metalness: 0.08,
    roughness: 0.32,
  }),
  idle: new MeshStandardMaterial({
    color: '#94a3b8',
    emissive: '#94a3b8',
    emissiveIntensity: 0.18,
    metalness: 0.08,
    roughness: 0.32,
  }),
}
const BUTTON_FACE_MATERIALS = {
  active: new MeshStandardMaterial({
    color: '#38bdf8',
    emissive: '#38bdf8',
    emissiveIntensity: 0.28,
    metalness: 0.22,
    roughness: 0.3,
  }),
  queued: new MeshStandardMaterial({
    color: '#fbbf24',
    emissive: '#fbbf24',
    emissiveIntensity: 0.18,
    metalness: 0.22,
    roughness: 0.3,
  }),
  idle: new MeshStandardMaterial({
    color: '#d6dde7',
    metalness: 0.22,
    roughness: 0.3,
  }),
  disabled: new MeshStandardMaterial({
    color: '#475569',
    metalness: 0.12,
    roughness: 0.52,
  }),
}
const BUTTON_RING_MATERIALS = {
  active: new MeshStandardMaterial({
    color: '#0ea5e9',
    emissive: '#0ea5e9',
    emissiveIntensity: 0.16,
    metalness: 0.48,
    roughness: 0.28,
  }),
  queued: new MeshStandardMaterial({
    color: '#f59e0b',
    emissive: '#f59e0b',
    emissiveIntensity: 0.1,
    metalness: 0.48,
    roughness: 0.28,
  }),
  idle: new MeshStandardMaterial({
    color: '#64748b',
    metalness: 0.48,
    roughness: 0.28,
  }),
  disabled: new MeshStandardMaterial({
    color: '#334155',
    metalness: 0.28,
    roughness: 0.5,
  }),
}
const BUTTON_GLOW_MATERIALS = {
  active: new MeshStandardMaterial({
    color: '#38bdf8',
    depthWrite: false,
    emissive: '#38bdf8',
    emissiveIntensity: 0.28,
    opacity: 0.58,
    transparent: true,
  }),
  queued: new MeshStandardMaterial({
    color: '#fbbf24',
    depthWrite: false,
    emissive: '#fbbf24',
    emissiveIntensity: 0.18,
    opacity: 0.58,
    transparent: true,
  }),
}
const BUTTON_LABEL_MATERIALS = {
  lit: new MeshStandardMaterial({
    color: '#111827',
    metalness: 0.12,
    roughness: 0.34,
  }),
  idle: new MeshStandardMaterial({
    color: '#334155',
    metalness: 0.12,
    roughness: 0.34,
  }),
  disabled: new MeshStandardMaterial({
    color: '#94a3b8',
    metalness: 0.08,
    roughness: 0.5,
  }),
}
const QUEUE_STRIP_MATERIALS = {
  queued: new MeshStandardMaterial({
    color: '#fbbf24',
    emissive: '#fbbf24',
    emissiveIntensity: 0.16,
    metalness: 0.18,
    roughness: 0.42,
  }),
  idle: new MeshStandardMaterial({
    color: '#64748b',
    metalness: 0.18,
    roughness: 0.42,
  }),
}

type ElevatorButtonAction = 'open-door' | 'request-level'

type SegmentName =
  | 'bottom'
  | 'lowerLeft'
  | 'lowerRight'
  | 'middle'
  | 'top'
  | 'upperLeft'
  | 'upperRight'

const DIGIT_SEGMENTS: Record<string, readonly SegmentName[]> = {
  '0': ['top', 'upperLeft', 'upperRight', 'lowerLeft', 'lowerRight', 'bottom'],
  '1': ['upperRight', 'lowerRight'],
  '2': ['top', 'upperRight', 'middle', 'lowerLeft', 'bottom'],
  '3': ['top', 'upperRight', 'middle', 'lowerRight', 'bottom'],
  '4': ['upperLeft', 'upperRight', 'middle', 'lowerRight'],
  '5': ['top', 'upperLeft', 'middle', 'lowerRight', 'bottom'],
  '6': ['top', 'upperLeft', 'middle', 'lowerLeft', 'lowerRight', 'bottom'],
  '7': ['top', 'upperRight', 'lowerRight'],
  '8': ['top', 'upperLeft', 'upperRight', 'middle', 'lowerLeft', 'lowerRight', 'bottom'],
  '9': ['top', 'upperLeft', 'upperRight', 'middle', 'lowerRight', 'bottom'],
  '-': ['middle'],
}

const SEGMENT_PROPS: Record<
  SegmentName,
  { position: [number, number, number]; size: [number, number, number] }
> = {
  bottom: { position: [0, -0.44, 0], size: [0.56, 0.11, 0.018] },
  lowerLeft: { position: [-0.32, -0.22, 0], size: [0.11, 0.42, 0.018] },
  lowerRight: { position: [0.32, -0.22, 0], size: [0.11, 0.42, 0.018] },
  middle: { position: [0, 0, 0], size: [0.52, 0.1, 0.018] },
  top: { position: [0, 0.44, 0], size: [0.56, 0.11, 0.018] },
  upperLeft: { position: [-0.32, 0.22, 0], size: [0.11, 0.42, 0.018] },
  upperRight: { position: [0.32, 0.22, 0], size: [0.11, 0.42, 0.018] },
}

function BoxPrimitive({
  castShadow = false,
  material,
  position,
  receiveShadow = false,
  rotation,
  scale,
}: {
  castShadow?: boolean
  material: MeshStandardMaterial
  position?: Vector3Tuple
  receiveShadow?: boolean
  rotation?: Vector3Tuple
  scale: Vector3Tuple
}) {
  return (
    <mesh
      castShadow={castShadow}
      dispose={null}
      geometry={UNIT_BOX_GEOMETRY}
      material={material}
      position={position}
      receiveShadow={receiveShadow}
      rotation={rotation}
      scale={scale}
    />
  )
}

function MeshButtonLabel({
  faceSign = 1,
  label,
  material,
  position,
  scale,
}: {
  faceSign?: -1 | 1
  label: string
  material: MeshStandardMaterial
  position: [number, number, number]
  scale: number
}) {
  const ref = useRef<InstancedMesh>(null)
  const instances = useMemo(() => {
    const characters = label.split('').filter((character) => DIGIT_SEGMENTS[character])
    const spacing = 0.72 * scale
    const startX = -((characters.length - 1) * spacing) / 2

    return characters.flatMap((character, charIndex) =>
      (DIGIT_SEGMENTS[character] ?? []).map((segment) => {
        const props = SEGMENT_PROPS[segment]
        return {
          position: [
            faceSign * (startX + charIndex * spacing + props.position[0] * scale),
            props.position[1] * scale,
            props.position[2],
          ] as Vector3Tuple,
          scale: [props.size[0] * scale, props.size[1] * scale, props.size[2]] as Vector3Tuple,
        }
      }),
    )
  }, [faceSign, label, scale])

  const applyInstanceMatrices = useCallback(
    (mesh: InstancedMesh) => {
      for (let index = 0; index < instances.length; index += 1) {
        const instance = instances[index]
        if (!instance) continue
        LABEL_MATRIX_DUMMY.position.set(...instance.position)
        LABEL_MATRIX_DUMMY.rotation.set(0, 0, 0)
        LABEL_MATRIX_DUMMY.scale.set(...instance.scale)
        LABEL_MATRIX_DUMMY.updateMatrix()
        mesh.setMatrixAt(index, LABEL_MATRIX_DUMMY.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    },
    [instances],
  )

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    applyInstanceMatrices(mesh)
  }, [applyInstanceMatrices])

  if (instances.length === 0) return null

  return (
    <instancedMesh
      args={[UNIT_BOX_GEOMETRY, material, instances.length]}
      dispose={null}
      onUpdate={applyInstanceMatrices}
      position={position}
      ref={ref}
    />
  )
}

function ElevatorDirectionGlyph({
  direction,
  material,
  position,
  scale,
}: {
  direction: 'down' | 'up' | null
  material: MeshStandardMaterial
  position: [number, number, number]
  scale: number
}) {
  if (!direction) {
    return (
      <BoxPrimitive
        material={material}
        position={position}
        scale={[0.08 * scale, 0.08 * scale, 0.018]}
      />
    )
  }

  const ySign = direction === 'up' ? -1 : 1
  return (
    <group position={position}>
      <BoxPrimitive
        material={material}
        position={[-0.04 * scale, -0.02 * ySign * scale, 0]}
        rotation={[0, 0, (-ySign * Math.PI) / 4]}
        scale={[0.16 * scale, 0.035 * scale, 0.018]}
      />
      <BoxPrimitive
        material={material}
        position={[0.04 * scale, -0.02 * ySign * scale, 0]}
        rotation={[0, 0, (ySign * Math.PI) / 4]}
        scale={[0.16 * scale, 0.035 * scale, 0.018]}
      />
    </group>
  )
}

function ElevatorFloorIndicator({
  active,
  direction,
  faceSign = -1,
  label,
  position,
  scale = 1,
  showReadout = true,
}: {
  active: boolean
  direction: 'down' | 'up' | null
  faceSign?: -1 | 1
  label: string
  position: [number, number, number]
  scale?: number
  showReadout?: boolean
}) {
  const glyphMaterial = active ? INDICATOR_GLYPH_MATERIALS.active : INDICATOR_GLYPH_MATERIALS.idle
  const screenMaterial = active
    ? INDICATOR_SCREEN_MATERIALS.active
    : INDICATOR_SCREEN_MATERIALS.idle
  const displayLabel = label || '-'
  const screenZ = faceSign * 0.026 * scale
  const glyphZ = faceSign * 0.041 * scale

  return (
    <group position={position}>
      <BoxPrimitive
        castShadow
        material={PANEL_MATERIAL}
        receiveShadow
        scale={[0.42 * scale, 0.16 * scale, 0.045 * scale]}
      />
      <BoxPrimitive
        material={screenMaterial}
        position={[0, 0, screenZ]}
        scale={[0.34 * scale, 0.095 * scale, 0.012 * scale]}
      />
      {showReadout ? (
        <>
          <ElevatorDirectionGlyph
            direction={direction}
            material={glyphMaterial}
            position={[-0.115 * faceSign * scale, 0, glyphZ]}
            scale={scale}
          />
          <MeshButtonLabel
            faceSign={faceSign}
            label={displayLabel}
            material={glyphMaterial}
            position={[0.075 * faceSign * scale, 0, glyphZ]}
            scale={0.055 * scale}
          />
        </>
      ) : (
        <BoxPrimitive
          material={glyphMaterial}
          position={[0, 0, glyphZ]}
          scale={[0.13 * scale, 0.018 * scale, 0.018]}
        />
      )}
    </group>
  )
}

function DoorOpenGlyph({
  material,
  positionZ,
  scale,
}: {
  material: MeshStandardMaterial
  positionZ: number
  scale: number
}) {
  return (
    <group position={[0, 0, positionZ]}>
      <BoxPrimitive
        material={material}
        position={[-0.014 * scale, 0, 0]}
        scale={[0.006 * scale, 0.052 * scale, 0.012]}
      />
      <BoxPrimitive
        material={material}
        position={[0.014 * scale, 0, 0]}
        scale={[0.006 * scale, 0.052 * scale, 0.012]}
      />
      <BoxPrimitive
        material={material}
        position={[-0.033 * scale, 0, 0]}
        rotation={[0, 0, Math.PI / 4]}
        scale={[0.026 * scale, 0.005 * scale, 0.012]}
      />
      <BoxPrimitive
        material={material}
        position={[-0.033 * scale, 0, 0]}
        rotation={[0, 0, -Math.PI / 4]}
        scale={[0.026 * scale, 0.005 * scale, 0.012]}
      />
      <BoxPrimitive
        material={material}
        position={[0.033 * scale, 0, 0]}
        rotation={[0, 0, Math.PI / 4]}
        scale={[0.026 * scale, 0.005 * scale, 0.012]}
      />
      <BoxPrimitive
        material={material}
        position={[0.033 * scale, 0, 0]}
        rotation={[0, 0, -Math.PI / 4]}
        scale={[0.026 * scale, 0.005 * scale, 0.012]}
      />
    </group>
  )
}

function ElevatorMeshButton({
  action = 'request-level',
  active,
  buttonKind,
  disabled = false,
  elevatorId,
  faceSign = -1,
  glyph,
  label,
  levelId,
  position,
  queued,
  radius = 0.055,
}: {
  action?: ElevatorButtonAction
  active: boolean
  buttonKind: 'cab' | 'landing'
  disabled?: boolean
  elevatorId: AnyNodeId
  faceSign?: -1 | 1
  glyph?: 'door-open'
  label?: string
  levelId?: AnyNodeId
  position: [number, number, number]
  queued: boolean
  radius?: number
}) {
  const state = disabled ? 'disabled' : active ? 'active' : queued ? 'queued' : 'idle'
  const depth = active ? 0.028 : 0.04
  const faceZ = faceSign * (depth / 2 + 0.004)
  const labelMaterial = disabled
    ? BUTTON_LABEL_MATERIALS.disabled
    : active || queued
      ? BUTTON_LABEL_MATERIALS.lit
      : BUTTON_LABEL_MATERIALS.idle
  const userData = useMemo(
    () => ({
      elevatorButton: {
        action,
        disabled,
        elevatorId,
        kind: buttonKind,
        levelId,
      },
    }),
    [action, buttonKind, disabled, elevatorId, levelId],
  )

  return (
    <group position={position} userData={userData}>
      {!disabled && (active || queued) && (
        <mesh
          dispose={null}
          geometry={BUTTON_GLOW_GEOMETRY}
          material={active ? BUTTON_GLOW_MATERIALS.active : BUTTON_GLOW_MATERIALS.queued}
          position={[0, 0, faceSign * (depth + 0.004)]}
          receiveShadow
          rotation-x={Math.PI / 2}
          scale={[radius, 0.012, radius]}
        />
      )}
      <mesh
        castShadow
        dispose={null}
        geometry={BUTTON_RING_GEOMETRY}
        material={BUTTON_RING_MATERIALS[state]}
        position={[0, 0, faceSign * (depth / 2 + 0.003)]}
        receiveShadow
        scale={[radius, radius, radius]}
      />
      <mesh
        castShadow
        dispose={null}
        geometry={BUTTON_FACE_GEOMETRY}
        material={BUTTON_FACE_MATERIALS[state]}
        receiveShadow
        rotation-x={Math.PI / 2}
        scale={[radius, depth, radius]}
      />
      {label && (
        <MeshButtonLabel
          faceSign={faceSign}
          label={label}
          material={labelMaterial}
          position={[0, 0, faceZ]}
          scale={radius * 0.72}
        />
      )}
      {glyph === 'door-open' && (
        <DoorOpenGlyph material={labelMaterial} positionZ={faceZ} scale={radius / 0.055} />
      )}
    </group>
  )
}

function getElevatorLevelContextNodes(
  elevator: ElevatorNode,
  nodes: ReturnType<typeof useScene.getState>['nodes'],
): Record<AnyNodeId, AnyNode> {
  const result: Record<string, AnyNode> = {}
  const building = elevator.parentId ? nodes[elevator.parentId as AnyNodeId] : null
  if (building?.type !== 'building') return result as Record<AnyNodeId, AnyNode>

  result[building.id] = building

  for (const childId of building.children) {
    const level = nodes[childId as AnyNodeId]
    if (level?.type !== 'level') continue

    result[level.id] = level
    for (const levelChildId of level.children) {
      const child = nodes[levelChildId as AnyNodeId]
      if (child?.type === 'ceiling' || child?.type === 'wall') {
        result[child.id] = child
      }
    }
  }

  return result as Record<AnyNodeId, AnyNode>
}

function DoorLeaf({
  animated,
  doorOpen,
  doorPanelStyle,
  doorStyle,
  height,
  side,
  width,
  y,
  z,
}: {
  animated?:
    | {
        elevatorId: AnyNodeId
        kind: 'cab'
      }
    | {
        elevatorId: AnyNodeId
        kind: 'landing'
        levelId: AnyNodeId
      }
  doorOpen: number
  doorPanelStyle: ElevatorDoorPanelStyleValue
  doorStyle: ElevatorDoorStyleValue
  height: number
  side: ElevatorDoorSide
  width: number
  y: number
  z: number
}) {
  const ref = useRef<Group>(null)
  const getLeafX = (openAmount: number) => getElevatorDoorLeafX(side, width, openAmount, doorStyle)
  const leafWidth = getElevatorDoorLeafWidth(width, doorStyle)
  const resolvedPanelStyle = getResolvedDoorPanelStyle(doorPanelStyle)
  const railHeight = Math.min(0.09, Math.max(0.055, height * 0.04))
  const stileWidth = Math.min(0.07, Math.max(0.04, leafWidth * 0.18))
  const glassWidth = Math.max(leafWidth - stileWidth * 2.2, 0.03)
  const glassHeight = Math.max(height - railHeight * 3, 0.2)
  const panelInsetWidth = Math.max(leafWidth - 0.12, 0.05)
  const panelInsetHeight = Math.max(height - 0.26, 0.2)
  const segmentCount = 4
  const segmentSpacing = panelInsetHeight / segmentCount

  useFrame(() => {
    if (!(animated && ref.current)) return
    const runtime = useInteractive.getState().elevators[animated.elevatorId]
    const nextDoorOpen =
      animated.kind === 'cab'
        ? (runtime?.doorOpen ?? 0)
        : runtime?.currentLevelId === animated.levelId
          ? (runtime?.doorOpen ?? 0)
          : 0
    ref.current.position.x = getLeafX(nextDoorOpen)
  }, 2.6)

  return (
    <group ref={ref} position={[getLeafX(doorOpen), y + height / 2, z]}>
      {resolvedPanelStyle === 'glass-frame' ? (
        <>
          <BoxPrimitive
            castShadow
            material={DOOR_MATERIAL}
            position={[0, height / 2 - railHeight / 2, 0]}
            receiveShadow
            scale={[leafWidth, railHeight, 0.05]}
          />
          <BoxPrimitive
            castShadow
            material={DOOR_MATERIAL}
            position={[0, -height / 2 + railHeight / 2, 0]}
            receiveShadow
            scale={[leafWidth, railHeight, 0.05]}
          />
          <BoxPrimitive
            castShadow
            material={DOOR_MATERIAL}
            position={[-leafWidth / 2 + stileWidth / 2, 0, 0]}
            receiveShadow
            scale={[stileWidth, height, 0.05]}
          />
          <BoxPrimitive
            castShadow
            material={DOOR_MATERIAL}
            position={[leafWidth / 2 - stileWidth / 2, 0, 0]}
            receiveShadow
            scale={[stileWidth, height, 0.05]}
          />
          <BoxPrimitive
            material={GLASS_MATERIAL}
            position={[0, 0, -0.004]}
            scale={[glassWidth, glassHeight, 0.012]}
          />
        </>
      ) : (
        <>
          <BoxPrimitive
            castShadow
            material={DOOR_MATERIAL}
            position={[0, 0, 0]}
            receiveShadow
            scale={[leafWidth, height, 0.05]}
          />
          <BoxPrimitive
            material={DOOR_GROOVE_MATERIAL}
            position={[0, 0, -0.028]}
            scale={[0.018, panelInsetHeight, 0.01]}
          />
          {resolvedPanelStyle === 'segmented-panel'
            ? Array.from({ length: segmentCount - 1 }).map((_, index) => (
                <BoxPrimitive
                  key={index}
                  material={DOOR_GROOVE_MATERIAL}
                  position={[0, -panelInsetHeight / 2 + segmentSpacing * (index + 1), -0.03]}
                  scale={[panelInsetWidth, 0.018, 0.012]}
                />
              ))
            : null}
          <BoxPrimitive
            material={DOOR_GROOVE_MATERIAL}
            position={[0, panelInsetHeight / 2, -0.029]}
            scale={[panelInsetWidth, 0.012, 0.01]}
          />
          <BoxPrimitive
            material={DOOR_GROOVE_MATERIAL}
            position={[0, -panelInsetHeight / 2, -0.029]}
            scale={[panelInsetWidth, 0.012, 0.01]}
          />
        </>
      )}
    </group>
  )
}

function ElevatorDoorLeaves({
  animated,
  doorOpen,
  doorPanelStyle,
  doorStyle,
  height,
  width,
  y,
  z,
}: {
  animated?:
    | {
        elevatorId: AnyNodeId
        kind: 'cab'
      }
    | {
        elevatorId: AnyNodeId
        kind: 'landing'
        levelId: AnyNodeId
      }
  doorOpen: number
  doorPanelStyle: ElevatorDoorPanelStyleValue
  doorStyle: ElevatorDoorStyleValue
  height: number
  width: number
  y: number
  z: number
}) {
  return (
    <>
      {getElevatorDoorLeafSides(doorStyle).map((side) => (
        <DoorLeaf
          animated={animated}
          doorOpen={doorOpen}
          doorPanelStyle={doorPanelStyle}
          doorStyle={doorStyle}
          height={height}
          key={side}
          side={side}
          width={width}
          y={y}
          z={z}
        />
      ))}
    </>
  )
}

function LandingDoorFrame({
  doorHeight,
  doorWidth,
  levelTopY,
  levelY,
  shaftWidth,
  z,
}: {
  doorHeight: number
  doorWidth: number
  levelTopY: number
  levelY: number
  shaftWidth: number
  z: number
}) {
  const wallDepth = 0.09
  const levelHeight = Math.max(levelTopY - levelY, 0.01)
  const jambWidth = Math.max((shaftWidth - doorWidth) / 2, 0.08)
  const jambCenterOffset = doorWidth / 2 + jambWidth / 2
  const headerHeight = Math.max(levelTopY - (levelY + doorHeight), 0)
  const trim = 0.055

  return (
    <>
      <BoxPrimitive
        castShadow
        material={SHAFT_WALL_MATERIAL}
        position={[-jambCenterOffset, levelY + levelHeight / 2, z]}
        receiveShadow
        scale={[jambWidth, levelHeight, wallDepth]}
      />
      <BoxPrimitive
        castShadow
        material={SHAFT_WALL_MATERIAL}
        position={[jambCenterOffset, levelY + levelHeight / 2, z]}
        receiveShadow
        scale={[jambWidth, levelHeight, wallDepth]}
      />
      {headerHeight > 0.01 && (
        <BoxPrimitive
          castShadow
          material={SHAFT_WALL_MATERIAL}
          position={[0, levelY + doorHeight + headerHeight / 2, z]}
          receiveShadow
          scale={[shaftWidth, headerHeight, wallDepth]}
        />
      )}
      <BoxPrimitive
        castShadow
        material={SHAFT_TRIM_MATERIAL}
        position={[0, levelY + trim / 2, z - 0.006]}
        receiveShadow
        scale={[doorWidth + trim * 2, trim, wallDepth * 1.12]}
      />
      <BoxPrimitive
        castShadow
        material={SHAFT_TRIM_MATERIAL}
        position={[-doorWidth / 2 - trim / 2, levelY + doorHeight / 2, z - 0.006]}
        receiveShadow
        scale={[trim, doorHeight, wallDepth * 1.12]}
      />
      <BoxPrimitive
        castShadow
        material={SHAFT_TRIM_MATERIAL}
        position={[doorWidth / 2 + trim / 2, levelY + doorHeight / 2, z - 0.006]}
        receiveShadow
        scale={[trim, doorHeight, wallDepth * 1.12]}
      />
      <BoxPrimitive
        castShadow
        material={SHAFT_TRIM_MATERIAL}
        position={[0, levelY + doorHeight + trim / 2, z - 0.006]}
        receiveShadow
        scale={[doorWidth + trim * 2, trim, wallDepth * 1.12]}
      />
    </>
  )
}

function LandingDoor({
  animated,
  doorPanelStyle,
  doorStyle,
  elevatorId,
  doorOpen,
  doorHeight,
  doorWidth,
  levelId,
  levelY,
  z,
}: {
  animated: boolean
  doorPanelStyle: ElevatorDoorPanelStyleValue
  doorStyle: ElevatorDoorStyleValue
  elevatorId: AnyNodeId
  doorOpen: number
  doorHeight: number
  doorWidth: number
  levelId: AnyNodeId
  levelY: number
  z: number
}) {
  return (
    <ElevatorDoorLeaves
      animated={animated ? { elevatorId, kind: 'landing', levelId } : undefined}
      doorOpen={doorOpen}
      doorPanelStyle={doorPanelStyle}
      doorStyle={doorStyle}
      height={doorHeight}
      width={doorWidth}
      y={levelY}
      z={z}
    />
  )
}

export const ElevatorRenderer = ({ node }: { node: ElevatorNode }) => {
  const ref = useRef<Group>(null!)
  const cabRef = useRef<Group>(null)
  const handlers = useNodeEvents(node, 'elevator')
  const liveOverrides = useLiveNodeOverrides((state) => state.get(node.id))
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const renderNode = useMemo(
    () => (liveOverrides ? ({ ...node, ...liveOverrides } as ElevatorNode) : node),
    [liveOverrides, node],
  )
  const levelContextNodes = useScene(
    useShallow((state) => getElevatorLevelContextNodes(renderNode, state.nodes)),
  )

  useRegistry(node.id, 'elevator', ref)

  const { entries, defaultEntry, shaftBaseY, totalHeight } = useMemo(
    () => resolveElevatorLevels(renderNode, levelContextNodes),
    [renderNode, levelContextNodes],
  )
  const elevatorId = node.id as AnyNodeId
  const runtimeStatus = useInteractive(
    useShallow((state) => {
      const runtime = state.elevators[elevatorId]
      if (!runtime) return null
      return {
        currentLevelId: runtime.currentLevelId,
        phase: runtime.phase,
        queue: runtime.queue,
        targetLevelId: runtime.targetLevelId,
      }
    }),
  )

  useFrame(() => {
    if (!cabRef.current) return
    const runtime = useInteractive.getState().elevators[elevatorId]
    if (!runtime) return
    cabRef.current.position.y = runtime.carY
  }, 2.6)

  const cabWidth = getElevatorCabWidth(renderNode)
  const cabDepth = getElevatorCabDepth(renderNode)
  const shaftWidth = getElevatorShaftWidth(renderNode, cabWidth)
  const shaftDepth = getElevatorShaftDepth(renderNode, cabDepth)
  const cabHeight = Math.max(renderNode.cabHeight, 1.4)
  const shaftWallThickness = getElevatorShaftWallThickness(renderNode)
  const doorWidth = Math.min(
    Math.max(renderNode.doorWidth, 0.45),
    cabWidth - 0.18,
    shaftWidth - 0.18,
  )
  const doorHeight = Math.min(Math.max(renderNode.doorHeight, 1.2), cabHeight - 0.1)
  const doorPanelStyle = getResolvedDoorPanelStyle(renderNode.doorPanelStyle)
  const doorStyle = getResolvedDoorStyle(renderNode.doorStyle)
  const shaftStyle = getResolvedShaftStyle(renderNode.shaftStyle)
  const shaftShellMaterial = shaftStyle === 'glass' ? GLASS_MATERIAL : SHAFT_SIDE_MATERIAL
  const shaftTopMaterial = shaftStyle === 'glass' ? SHAFT_TRIM_MATERIAL : SHAFT_SIDE_MATERIAL
  const shaftHeight = Math.max(totalHeight, cabHeight + 0.3)
  const shaftBodyHeight = Math.max(shaftHeight - shaftWallThickness, 0.01)
  const shaftBodyCenterY = shaftBaseY + shaftBodyHeight / 2
  const shaftTopCapBottomY = shaftBaseY + shaftHeight - shaftWallThickness
  const shaftFrameTopY = Math.max(shaftBaseY, shaftTopCapBottomY - SHAFT_TOP_FRAME_CLEARANCE)
  const runtimeSnapshot = useInteractive.getState().elevators[elevatorId]
  const cabBaseY = runtimeSnapshot?.carY ?? defaultEntry?.baseY ?? 0
  const activeLevelId =
    runtimeStatus?.currentLevelId ?? runtimeSnapshot?.currentLevelId ?? defaultEntry?.id ?? null
  const pendingLevelId =
    runtimeStatus?.targetLevelId ??
    runtimeSnapshot?.targetLevelId ??
    runtimeStatus?.queue[0] ??
    runtimeSnapshot?.queue[0] ??
    null
  const currentEntry =
    entries.find((entry) => entry.id === activeLevelId) ?? defaultEntry ?? entries[0] ?? null
  const pendingEntry = pendingLevelId ? entries.find((entry) => entry.id === pendingLevelId) : null
  const indicatorEntry = pendingEntry ?? currentEntry
  const indicatorDirection =
    currentEntry && pendingEntry && Math.abs(pendingEntry.baseY - currentEntry.baseY) > 0.001
      ? pendingEntry.baseY > currentEntry.baseY
        ? 'up'
        : 'down'
      : null
  const indicatorActive = Boolean(
    pendingEntry ||
      runtimeStatus?.phase === 'moving' ||
      runtimeSnapshot?.phase === 'moving' ||
      runtimeStatus?.phase === 'opening' ||
      runtimeSnapshot?.phase === 'opening',
  )
  const queuedLevelIds = useMemo(() => {
    const next = new Set<string>()
    for (const levelId of runtimeStatus?.queue ?? runtimeSnapshot?.queue ?? []) next.add(levelId)
    const targetLevelId = runtimeStatus?.targetLevelId ?? runtimeSnapshot?.targetLevelId
    if (targetLevelId) next.add(targetLevelId)
    return next
  }, [
    runtimeSnapshot?.queue,
    runtimeSnapshot?.targetLevelId,
    runtimeStatus?.queue,
    runtimeStatus?.targetLevelId,
  ])
  const disabledLevelIds = useMemo(
    () => new Set(renderNode.disabledLevelIds ?? []),
    [renderNode.disabledLevelIds],
  )
  const serviceOnlyLevelIds = useMemo(
    () => new Set(renderNode.serviceOnlyLevelIds ?? []),
    [renderNode.serviceOnlyLevelIds],
  )
  const doorOpen = runtimeSnapshot?.doorOpen ?? 0
  const doorOpenButtonActive =
    doorOpen > 0.12 ||
    runtimeStatus?.phase === 'opening' ||
    runtimeSnapshot?.phase === 'opening' ||
    runtimeStatus?.phase === 'open' ||
    runtimeSnapshot?.phase === 'open'
  const frontWallZ = -shaftDepth / 2 - shaftWallThickness / 2
  const frontZ = frontWallZ - shaftWallThickness / 2 - 0.018
  const landingPanelX = Math.min(shaftWidth / 2 - 0.16, doorWidth / 2 + 0.18)
  const cabCenterZ = -shaftDepth / 2 + cabDepth / 2
  const cabPanelX = cabWidth / 2 - 0.075
  const cabPanelZ = cabCenterZ - cabDepth / 2 + 0.36
  const cabButtonColumns = entries.length > 1 ? 2 : 1
  const cabButtonRows = Math.max(1, Math.ceil(entries.length / cabButtonColumns))
  const cabButtonSpacingX = 0.14
  const cabButtonSpacingY = 0.15
  const cabDoorButtonOffsetX = 0.17
  const cabFloorButtonOffsetX = entries.length > 0 ? -cabDoorButtonOffsetX / 2 : 0
  const cabDoorButtonX =
    cabFloorButtonOffsetX + ((cabButtonColumns - 1) / 2) * cabButtonSpacingX + cabDoorButtonOffsetX
  const cabDoorButtonY = -((cabButtonRows - 1) / 2) * cabButtonSpacingY
  const cabPanelWidth = cabButtonColumns * cabButtonSpacingX + 0.13 + cabDoorButtonOffsetX
  const cabPanelHeight = cabButtonRows * cabButtonSpacingY + 0.12
  const panelRelativeY = Math.min(Math.max(doorHeight * 0.6, 0.95), cabHeight - 0.35)
  const cabPanelY = panelRelativeY
  const entrySpans = useMemo(
    () =>
      entries.map((entry, index) => {
        const nextEntry = entries[index + 1]
        const minDoorFrameTopY = entry.baseY + doorHeight + 0.12
        const targetTopY = Math.max(nextEntry?.baseY ?? shaftFrameTopY, minDoorFrameTopY)

        return {
          entry,
          levelTopY: nextEntry ? targetTopY : Math.min(targetTopY, shaftFrameTopY),
        }
      }),
    [doorHeight, entries, shaftFrameTopY],
  )

  return (
    <group
      position={liveTransform?.position ?? renderNode.position}
      ref={ref}
      rotation-y={liveTransform?.rotation ?? renderNode.rotation}
      visible={renderNode.visible}
      {...handlers}
    >
      <BoxPrimitive
        castShadow
        material={shaftShellMaterial}
        position={[0, shaftBodyCenterY, shaftDepth / 2 + shaftWallThickness / 2]}
        receiveShadow
        scale={[shaftWidth + shaftWallThickness * 2, shaftBodyHeight, shaftWallThickness]}
      />
      <BoxPrimitive
        castShadow
        material={shaftShellMaterial}
        position={[-shaftWidth / 2 - shaftWallThickness / 2, shaftBodyCenterY, 0]}
        receiveShadow
        scale={[shaftWallThickness, shaftBodyHeight, shaftDepth + shaftWallThickness * 2]}
      />
      <BoxPrimitive
        castShadow
        material={shaftShellMaterial}
        position={[shaftWidth / 2 + shaftWallThickness / 2, shaftBodyCenterY, 0]}
        receiveShadow
        scale={[shaftWallThickness, shaftBodyHeight, shaftDepth + shaftWallThickness * 2]}
      />
      <BoxPrimitive
        castShadow
        material={shaftTopMaterial}
        position={[0, shaftBaseY + shaftHeight - shaftWallThickness / 2, 0]}
        receiveShadow
        scale={[
          shaftWidth + shaftWallThickness * 2,
          shaftWallThickness,
          shaftDepth + shaftWallThickness * 2,
        ]}
      />

      <group ref={cabRef} position={[0, cabBaseY, 0]}>
        <BoxPrimitive
          castShadow
          material={CAB_MATERIAL}
          position={[0, 0.04, cabCenterZ]}
          receiveShadow
          scale={[cabWidth, 0.08, cabDepth]}
        />

        <BoxPrimitive
          castShadow
          material={CAB_MATERIAL}
          position={[0, cabHeight - 0.04, cabCenterZ]}
          receiveShadow
          scale={[cabWidth, 0.08, cabDepth]}
        />

        <BoxPrimitive
          castShadow
          material={CAB_MATERIAL}
          position={[0, cabHeight / 2, cabCenterZ + cabDepth / 2 - 0.04]}
          receiveShadow
          scale={[cabWidth, cabHeight, 0.08]}
        />

        <BoxPrimitive
          castShadow
          material={CAB_MATERIAL}
          position={[-cabWidth / 2 + 0.04, cabHeight / 2, cabCenterZ]}
          receiveShadow
          scale={[0.08, cabHeight, cabDepth]}
        />

        <BoxPrimitive
          castShadow
          material={CAB_MATERIAL}
          position={[cabWidth / 2 - 0.04, cabHeight / 2, cabCenterZ]}
          receiveShadow
          scale={[0.08, cabHeight, cabDepth]}
        />

        <ElevatorDoorLeaves
          animated={{ elevatorId, kind: 'cab' }}
          doorOpen={doorOpen}
          doorPanelStyle={doorPanelStyle}
          doorStyle={doorStyle}
          height={doorHeight}
          width={doorWidth}
          y={0}
          z={frontZ}
        />

        <ElevatorFloorIndicator
          active={indicatorActive}
          direction={indicatorDirection}
          faceSign={1}
          label={indicatorEntry?.label ?? '-'}
          position={[0, doorHeight + 0.13, frontZ + 0.055]}
          scale={0.78}
        />

        <group position={[cabPanelX, cabPanelY, cabPanelZ]} rotation-y={-Math.PI / 2}>
          <BoxPrimitive
            castShadow
            material={PANEL_MATERIAL}
            receiveShadow
            scale={[cabPanelWidth, cabPanelHeight, 0.045]}
          />

          {entries.map((entry, index) => {
            const column = index % cabButtonColumns
            const row = Math.floor(index / cabButtonColumns)
            const isDisabledLevel = disabledLevelIds.has(entry.id)
            const x =
              cabFloorButtonOffsetX + (column - (cabButtonColumns - 1) / 2) * cabButtonSpacingX
            const y = (row - (cabButtonRows - 1) / 2) * cabButtonSpacingY

            return (
              <ElevatorMeshButton
                active={!isDisabledLevel && activeLevelId === entry.id}
                buttonKind="cab"
                disabled={isDisabledLevel}
                elevatorId={elevatorId}
                faceSign={1}
                key={entry.id}
                label={entry.label}
                levelId={entry.id as AnyNodeId}
                position={[x, y, 0.045]}
                queued={!isDisabledLevel && queuedLevelIds.has(entry.id)}
              />
            )
          })}
          <ElevatorMeshButton
            action="open-door"
            active={doorOpenButtonActive}
            buttonKind="cab"
            elevatorId={elevatorId}
            faceSign={1}
            glyph="door-open"
            position={[cabDoorButtonX, cabDoorButtonY, 0.045]}
            queued={false}
            radius={0.047}
          />
        </group>
      </group>

      {entrySpans.map(({ entry, levelTopY }) => {
        const isCurrentLevel = activeLevelId === entry.id
        const isDisabledLevel = disabledLevelIds.has(entry.id)
        const isServiceOnlyLevel = serviceOnlyLevelIds.has(entry.id)
        const isQueuedLevel = !isDisabledLevel && queuedLevelIds.has(entry.id)
        const isPendingLevel = pendingLevelId === entry.id
        const showLandingReadout = isCurrentLevel || isPendingLevel || isQueuedLevel

        return (
          <group key={entry.id}>
            <LandingDoorFrame
              doorHeight={doorHeight}
              doorWidth={doorWidth}
              levelTopY={levelTopY}
              levelY={entry.baseY}
              shaftWidth={shaftWidth}
              z={frontWallZ}
            />
            <LandingDoor
              animated={isCurrentLevel}
              doorPanelStyle={doorPanelStyle}
              doorStyle={doorStyle}
              elevatorId={elevatorId}
              doorHeight={doorHeight}
              doorOpen={isCurrentLevel ? doorOpen : 0}
              doorWidth={doorWidth}
              levelId={entry.id as AnyNodeId}
              levelY={entry.baseY}
              z={frontZ - 0.02}
            />
            <ElevatorFloorIndicator
              active={showLandingReadout}
              direction={showLandingReadout ? indicatorDirection : null}
              label={entry.label}
              position={[0, entry.baseY + doorHeight + 0.16, frontZ - 0.055]}
              scale={0.62}
              showReadout={showLandingReadout}
            />
            <group position={[landingPanelX, entry.baseY + panelRelativeY, frontZ - 0.035]}>
              <BoxPrimitive
                castShadow
                material={LANDING_PANEL_MATERIAL}
                receiveShadow
                scale={[0.18, 0.42, 0.04]}
              />
              <ElevatorMeshButton
                active={!isDisabledLevel && !isServiceOnlyLevel && isCurrentLevel && doorOpen > 0.5}
                buttonKind="landing"
                disabled={isDisabledLevel || isServiceOnlyLevel}
                elevatorId={elevatorId}
                levelId={entry.id as AnyNodeId}
                position={[0, 0.06, -0.045]}
                queued={isQueuedLevel}
                radius={0.045}
              />
              <BoxPrimitive
                material={isQueuedLevel ? QUEUE_STRIP_MATERIALS.queued : QUEUE_STRIP_MATERIALS.idle}
                position={[0, -0.12, -0.035]}
                scale={[0.095, 0.025, 0.012]}
              />
            </group>
          </group>
        )
      })}
    </group>
  )
}
