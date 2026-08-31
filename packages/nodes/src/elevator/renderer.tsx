'use client'

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
import {
  type ColorPreset,
  createDefaultMaterial,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  CylinderGeometry,
  type Group,
  type InstancedMesh,
  type Material,
  Object3D,
  TorusGeometry,
} from 'three'
import { useShallow } from 'zustand/react/shallow'
import {
  ELEVATOR_CAB_SLOT_DEFAULT,
  ELEVATOR_DOORS_SLOT_DEFAULT,
  ELEVATOR_GLASS_SLOT_DEFAULT,
  ELEVATOR_SHAFT_SLOT_DEFAULT,
  type ElevatorSlotId,
} from './slots'

const DEFAULT_STRUCTURE_WHITE = '#f2f0ed'
const SHAFT_WALL_COLOR = DEFAULT_STRUCTURE_WHITE
const SHAFT_SIDE_COLOR = DEFAULT_STRUCTURE_WHITE
const SHAFT_TRIM_COLOR = DEFAULT_STRUCTURE_WHITE
const CAB_COLOR = DEFAULT_STRUCTURE_WHITE
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

type ElevatorMaterial = Material & {
  depthWrite?: boolean
  emissive?: { set: (color: string) => void }
  emissiveIntensity?: number
  metalness?: number
  opacity?: number
  roughness?: number
  transparent?: boolean
}

type ElevatorMaterialParams = {
  color: string
  depthWrite?: boolean
  emissive?: string
  emissiveIntensity?: number
  metalness?: number
  opacity?: number
  roughness?: number
  transparent?: boolean
}

function createElevatorMaterial(params: ElevatorMaterialParams, shading: RenderShading): Material {
  const material = createDefaultMaterial(
    params.color,
    params.roughness ?? 0.5,
    shading,
  ) as ElevatorMaterial

  if ('metalness' in material) material.metalness = params.metalness ?? 0
  if ('roughness' in material && params.roughness !== undefined) {
    material.roughness = params.roughness
  }
  if (params.depthWrite !== undefined) material.depthWrite = params.depthWrite
  if (params.opacity !== undefined) material.opacity = params.opacity
  if (params.transparent !== undefined) material.transparent = params.transparent
  if (params.emissive && material.emissive) material.emissive.set(params.emissive)
  if ('emissiveIntensity' in material && params.emissiveIntensity !== undefined) {
    material.emissiveIntensity = params.emissiveIntensity
  }
  material.needsUpdate = true
  return material
}

function createElevatorMaterials(
  shading: RenderShading,
  textures = true,
  colorPreset: ColorPreset = 'clay',
) {
  if (!textures) {
    const material = createSurfaceRoleMaterial('joinery', colorPreset)
    return {
      SHAFT_WALL_MATERIAL: material,
      SHAFT_SIDE_MATERIAL: material,
      SHAFT_TRIM_MATERIAL: material,
      CAB_MATERIAL: material,
      DOOR_MATERIAL: material,
      DOOR_GROOVE_MATERIAL: material,
      GLASS_MATERIAL: material,
      PANEL_MATERIAL: material,
      LANDING_PANEL_MATERIAL: material,
      INDICATOR_SCREEN_MATERIALS: {
        active: material,
        idle: material,
      },
      INDICATOR_GLYPH_MATERIALS: {
        active: material,
        idle: material,
      },
      BUTTON_FACE_MATERIALS: {
        active: material,
        queued: material,
        idle: material,
        disabled: material,
      },
      BUTTON_RING_MATERIALS: {
        active: material,
        queued: material,
        idle: material,
        disabled: material,
      },
      BUTTON_GLOW_MATERIALS: {
        active: material,
        queued: material,
      },
      BUTTON_LABEL_MATERIALS: {
        lit: material,
        idle: material,
        disabled: material,
      },
      QUEUE_STRIP_MATERIALS: {
        queued: material,
        idle: material,
      },
    }
  }

  return {
    SHAFT_WALL_MATERIAL: createElevatorMaterial(
      { color: SHAFT_WALL_COLOR, metalness: 0.08, roughness: 0.56 },
      shading,
    ),
    SHAFT_SIDE_MATERIAL: createElevatorMaterial(
      { color: SHAFT_SIDE_COLOR, metalness: 0.12, roughness: 0.58 },
      shading,
    ),
    SHAFT_TRIM_MATERIAL: createElevatorMaterial(
      { color: SHAFT_TRIM_COLOR, metalness: 0.2, roughness: 0.38 },
      shading,
    ),
    CAB_MATERIAL: createElevatorMaterial(
      { color: CAB_COLOR, metalness: 0.2, roughness: 0.48 },
      shading,
    ),
    DOOR_MATERIAL: createElevatorMaterial(
      { color: DOOR_COLOR, metalness: 0.34, roughness: 0.34 },
      shading,
    ),
    DOOR_GROOVE_MATERIAL: createElevatorMaterial(
      { color: '#5f6978', metalness: 0.28, roughness: 0.42 },
      shading,
    ),
    GLASS_MATERIAL: createElevatorMaterial(
      {
        color: GLASS_COLOR,
        depthWrite: false,
        metalness: 0,
        opacity: 0.2,
        roughness: 0.08,
        transparent: true,
      },
      shading,
    ),
    PANEL_MATERIAL: createElevatorMaterial(
      { color: PANEL_COLOR, metalness: 0.32, roughness: 0.36 },
      shading,
    ),
    LANDING_PANEL_MATERIAL: createElevatorMaterial(
      { color: PANEL_COLOR, metalness: 0.25, roughness: 0.4 },
      shading,
    ),
    INDICATOR_SCREEN_MATERIALS: {
      active: createElevatorMaterial(
        {
          color: '#041f2f',
          emissive: '#0ea5e9',
          emissiveIntensity: 0.16,
          metalness: 0.12,
          roughness: 0.38,
        },
        shading,
      ),
      idle: createElevatorMaterial({ color: '#111827', metalness: 0.12, roughness: 0.38 }, shading),
    },
    INDICATOR_GLYPH_MATERIALS: {
      active: createElevatorMaterial(
        {
          color: '#38bdf8',
          emissive: '#38bdf8',
          emissiveIntensity: 0.36,
          metalness: 0.08,
          roughness: 0.32,
        },
        shading,
      ),
      idle: createElevatorMaterial(
        {
          color: '#94a3b8',
          emissive: '#94a3b8',
          emissiveIntensity: 0.18,
          metalness: 0.08,
          roughness: 0.32,
        },
        shading,
      ),
    },
    BUTTON_FACE_MATERIALS: {
      active: createElevatorMaterial(
        {
          color: '#38bdf8',
          emissive: '#38bdf8',
          emissiveIntensity: 0.28,
          metalness: 0.22,
          roughness: 0.3,
        },
        shading,
      ),
      queued: createElevatorMaterial(
        {
          color: '#fbbf24',
          emissive: '#fbbf24',
          emissiveIntensity: 0.18,
          metalness: 0.22,
          roughness: 0.3,
        },
        shading,
      ),
      idle: createElevatorMaterial({ color: '#d6dde7', metalness: 0.22, roughness: 0.3 }, shading),
      disabled: createElevatorMaterial(
        { color: '#475569', metalness: 0.12, roughness: 0.52 },
        shading,
      ),
    },
    BUTTON_RING_MATERIALS: {
      active: createElevatorMaterial(
        {
          color: '#0ea5e9',
          emissive: '#0ea5e9',
          emissiveIntensity: 0.16,
          metalness: 0.48,
          roughness: 0.28,
        },
        shading,
      ),
      queued: createElevatorMaterial(
        {
          color: '#f59e0b',
          emissive: '#f59e0b',
          emissiveIntensity: 0.1,
          metalness: 0.48,
          roughness: 0.28,
        },
        shading,
      ),
      idle: createElevatorMaterial({ color: '#64748b', metalness: 0.48, roughness: 0.28 }, shading),
      disabled: createElevatorMaterial(
        { color: '#334155', metalness: 0.28, roughness: 0.5 },
        shading,
      ),
    },
    BUTTON_GLOW_MATERIALS: {
      active: createElevatorMaterial(
        {
          color: '#38bdf8',
          depthWrite: false,
          emissive: '#38bdf8',
          emissiveIntensity: 0.28,
          opacity: 0.58,
          transparent: true,
        },
        shading,
      ),
      queued: createElevatorMaterial(
        {
          color: '#fbbf24',
          depthWrite: false,
          emissive: '#fbbf24',
          emissiveIntensity: 0.18,
          opacity: 0.58,
          transparent: true,
        },
        shading,
      ),
    },
    BUTTON_LABEL_MATERIALS: {
      lit: createElevatorMaterial({ color: '#111827', metalness: 0.12, roughness: 0.34 }, shading),
      idle: createElevatorMaterial({ color: '#334155', metalness: 0.12, roughness: 0.34 }, shading),
      disabled: createElevatorMaterial(
        { color: '#94a3b8', metalness: 0.08, roughness: 0.5 },
        shading,
      ),
    },
    QUEUE_STRIP_MATERIALS: {
      queued: createElevatorMaterial(
        {
          color: '#fbbf24',
          emissive: '#fbbf24',
          emissiveIntensity: 0.16,
          metalness: 0.18,
          roughness: 0.42,
        },
        shading,
      ),
      idle: createElevatorMaterial({ color: '#64748b', metalness: 0.18, roughness: 0.42 }, shading),
    },
  }
}

type ElevatorMaterialSet = ReturnType<typeof createElevatorMaterials>

const elevatorMaterialsCache = new Map<string, ElevatorMaterialSet>()

function getElevatorMaterials(
  shading: RenderShading,
  textures = true,
  colorPreset: ColorPreset = 'clay',
): ElevatorMaterialSet {
  const cacheKey = `${shading}-${textures}-${colorPreset}`
  const cached = elevatorMaterialsCache.get(cacheKey)
  if (cached) return cached

  const materials = createElevatorMaterials(shading, textures, colorPreset)
  elevatorMaterialsCache.set(cacheKey, materials)
  return materials
}

type ElevatorSceneMaterials = ReturnType<typeof useScene.getState>['materials']

function resolveElevatorFinishMaterial(
  node: ElevatorNode,
  slotId: ElevatorSlotId,
  slotDefault: string,
  sceneMaterials: ElevatorSceneMaterials,
  shading: RenderShading,
  roughness: number,
): Material {
  const ref = node.slots?.[slotId]
  if (ref) {
    const resolved = resolveMaterialRef(ref, sceneMaterials, shading)
    if (resolved) return resolved
  }
  return resolveSlotDefaultMaterial(slotDefault, shading, roughness)
}

function withElevatorGlassTransparency(material: Material): Material {
  const glass = material.clone()
  glass.depthWrite = false
  glass.opacity = 0.2
  glass.transparent = true
  glass.needsUpdate = true
  return glass
}

function getResolvedElevatorMaterials(
  node: ElevatorNode,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneMaterials: ElevatorSceneMaterials,
): ElevatorMaterialSet {
  const materials = getElevatorMaterials(shading, textures, colorPreset)
  if (!textures) return materials

  const cab = resolveElevatorFinishMaterial(
    node,
    'cab',
    ELEVATOR_CAB_SLOT_DEFAULT,
    sceneMaterials,
    shading,
    0.48,
  )
  const doors = resolveElevatorFinishMaterial(
    node,
    'doors',
    ELEVATOR_DOORS_SLOT_DEFAULT,
    sceneMaterials,
    shading,
    0.34,
  )
  const shaft = resolveElevatorFinishMaterial(
    node,
    'shaft',
    ELEVATOR_SHAFT_SLOT_DEFAULT,
    sceneMaterials,
    shading,
    0.56,
  )
  const glass = withElevatorGlassTransparency(
    resolveElevatorFinishMaterial(
      node,
      'glass',
      ELEVATOR_GLASS_SLOT_DEFAULT,
      sceneMaterials,
      shading,
      0.08,
    ),
  )

  return {
    ...materials,
    SHAFT_WALL_MATERIAL: shaft,
    SHAFT_SIDE_MATERIAL: shaft,
    SHAFT_TRIM_MATERIAL: shaft,
    CAB_MATERIAL: cab,
    DOOR_MATERIAL: doors,
    DOOR_GROOVE_MATERIAL: doors,
    GLASS_MATERIAL: glass,
  }
}

const DEFAULT_ELEVATOR_MATERIALS = getElevatorMaterials('rendered')
const ElevatorMaterialsContext = createContext<ElevatorMaterialSet>(DEFAULT_ELEVATOR_MATERIALS)

function useElevatorMaterialSet(): ElevatorMaterialSet {
  return useContext(ElevatorMaterialsContext)
}

const ELEVATOR_SLOT_USER_DATA: Record<ElevatorSlotId, { slotId: ElevatorSlotId }> = {
  cab: { slotId: 'cab' },
  doors: { slotId: 'doors' },
  shaft: { slotId: 'shaft' },
  glass: { slotId: 'glass' },
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
  slotId,
}: {
  castShadow?: boolean
  material: Material
  position?: Vector3Tuple
  receiveShadow?: boolean
  rotation?: Vector3Tuple
  scale: Vector3Tuple
  slotId?: ElevatorSlotId
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
      userData={slotId ? ELEVATOR_SLOT_USER_DATA[slotId] : undefined}
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
  material: Material
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
  material: Material
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
  const { INDICATOR_GLYPH_MATERIALS, INDICATOR_SCREEN_MATERIALS, PANEL_MATERIAL } =
    useElevatorMaterialSet()
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
  material: Material
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
  const {
    BUTTON_FACE_MATERIALS,
    BUTTON_GLOW_MATERIALS,
    BUTTON_LABEL_MATERIALS,
    BUTTON_RING_MATERIALS,
  } = useElevatorMaterialSet()
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
  const { DOOR_GROOVE_MATERIAL, DOOR_MATERIAL, GLASS_MATERIAL } = useElevatorMaterialSet()
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
            slotId="doors"
          />
          <BoxPrimitive
            castShadow
            material={DOOR_MATERIAL}
            position={[0, -height / 2 + railHeight / 2, 0]}
            receiveShadow
            scale={[leafWidth, railHeight, 0.05]}
            slotId="doors"
          />
          <BoxPrimitive
            castShadow
            material={DOOR_MATERIAL}
            position={[-leafWidth / 2 + stileWidth / 2, 0, 0]}
            receiveShadow
            scale={[stileWidth, height, 0.05]}
            slotId="doors"
          />
          <BoxPrimitive
            castShadow
            material={DOOR_MATERIAL}
            position={[leafWidth / 2 - stileWidth / 2, 0, 0]}
            receiveShadow
            scale={[stileWidth, height, 0.05]}
            slotId="doors"
          />
          <BoxPrimitive
            material={GLASS_MATERIAL}
            position={[0, 0, -0.004]}
            scale={[glassWidth, glassHeight, 0.012]}
            slotId="glass"
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
            slotId="doors"
          />
          <BoxPrimitive
            material={DOOR_GROOVE_MATERIAL}
            position={[0, 0, -0.028]}
            scale={[0.018, panelInsetHeight, 0.01]}
            slotId="doors"
          />
          {resolvedPanelStyle === 'segmented-panel'
            ? Array.from({ length: segmentCount - 1 }).map((_, index) => (
                <BoxPrimitive
                  key={index}
                  material={DOOR_GROOVE_MATERIAL}
                  position={[0, -panelInsetHeight / 2 + segmentSpacing * (index + 1), -0.03]}
                  scale={[panelInsetWidth, 0.018, 0.012]}
                  slotId="doors"
                />
              ))
            : null}
          <BoxPrimitive
            material={DOOR_GROOVE_MATERIAL}
            position={[0, panelInsetHeight / 2, -0.029]}
            scale={[panelInsetWidth, 0.012, 0.01]}
            slotId="doors"
          />
          <BoxPrimitive
            material={DOOR_GROOVE_MATERIAL}
            position={[0, -panelInsetHeight / 2, -0.029]}
            scale={[panelInsetWidth, 0.012, 0.01]}
            slotId="doors"
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
  const { SHAFT_TRIM_MATERIAL, SHAFT_WALL_MATERIAL } = useElevatorMaterialSet()
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
        slotId="shaft"
      />
      <BoxPrimitive
        castShadow
        material={SHAFT_WALL_MATERIAL}
        position={[jambCenterOffset, levelY + levelHeight / 2, z]}
        receiveShadow
        scale={[jambWidth, levelHeight, wallDepth]}
        slotId="shaft"
      />
      {headerHeight > 0.01 && (
        <BoxPrimitive
          castShadow
          material={SHAFT_WALL_MATERIAL}
          position={[0, levelY + doorHeight + headerHeight / 2, z]}
          receiveShadow
          scale={[shaftWidth, headerHeight, wallDepth]}
          slotId="shaft"
        />
      )}
      <BoxPrimitive
        castShadow
        material={SHAFT_TRIM_MATERIAL}
        position={[0, levelY + trim / 2, z - 0.006]}
        receiveShadow
        scale={[doorWidth + trim * 2, trim, wallDepth * 1.12]}
        slotId="shaft"
      />
      <BoxPrimitive
        castShadow
        material={SHAFT_TRIM_MATERIAL}
        position={[-doorWidth / 2 - trim / 2, levelY + doorHeight / 2, z - 0.006]}
        receiveShadow
        scale={[trim, doorHeight, wallDepth * 1.12]}
        slotId="shaft"
      />
      <BoxPrimitive
        castShadow
        material={SHAFT_TRIM_MATERIAL}
        position={[doorWidth / 2 + trim / 2, levelY + doorHeight / 2, z - 0.006]}
        receiveShadow
        scale={[trim, doorHeight, wallDepth * 1.12]}
        slotId="shaft"
      />
      <BoxPrimitive
        castShadow
        material={SHAFT_TRIM_MATERIAL}
        position={[0, levelY + doorHeight + trim / 2, z - 0.006]}
        receiveShadow
        scale={[doorWidth + trim * 2, trim, wallDepth * 1.12]}
        slotId="shaft"
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
  const shading = useViewer((state) => state.shading)
  const textures = useViewer((state) => state.textures)
  const colorPreset = useViewer((state) => state.colorPreset)
  const sceneMaterials = useScene((state) => state.materials)
  const liveOverrides = useLiveNodeOverrides((state) => state.get(node.id))
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const renderNode = useMemo(
    () => (liveOverrides ? ({ ...node, ...liveOverrides } as ElevatorNode) : node),
    [liveOverrides, node],
  )
  const levelContextNodes = useScene(
    useShallow((state) => getElevatorLevelContextNodes(renderNode, state.nodes)),
  )
  const materials = useMemo(
    () => getResolvedElevatorMaterials(renderNode, shading, textures, colorPreset, sceneMaterials),
    [colorPreset, renderNode, sceneMaterials, shading, textures],
  )
  const {
    CAB_MATERIAL,
    GLASS_MATERIAL,
    LANDING_PANEL_MATERIAL,
    PANEL_MATERIAL,
    QUEUE_STRIP_MATERIALS,
    SHAFT_SIDE_MATERIAL,
    SHAFT_TRIM_MATERIAL,
  } = materials

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
  const shaftShellSlotId: ElevatorSlotId = shaftStyle === 'glass' ? 'glass' : 'shaft'
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
    <ElevatorMaterialsContext.Provider value={materials}>
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
          slotId={shaftShellSlotId}
        />
        <BoxPrimitive
          castShadow
          material={shaftShellMaterial}
          position={[-shaftWidth / 2 - shaftWallThickness / 2, shaftBodyCenterY, 0]}
          receiveShadow
          scale={[shaftWallThickness, shaftBodyHeight, shaftDepth + shaftWallThickness * 2]}
          slotId={shaftShellSlotId}
        />
        <BoxPrimitive
          castShadow
          material={shaftShellMaterial}
          position={[shaftWidth / 2 + shaftWallThickness / 2, shaftBodyCenterY, 0]}
          receiveShadow
          scale={[shaftWallThickness, shaftBodyHeight, shaftDepth + shaftWallThickness * 2]}
          slotId={shaftShellSlotId}
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
          slotId="shaft"
        />

        <group ref={cabRef} position={[0, cabBaseY, 0]}>
          <BoxPrimitive
            castShadow
            material={CAB_MATERIAL}
            position={[0, 0.04, cabCenterZ]}
            receiveShadow
            scale={[cabWidth, 0.08, cabDepth]}
            slotId="cab"
          />

          <BoxPrimitive
            castShadow
            material={CAB_MATERIAL}
            position={[0, cabHeight - 0.04, cabCenterZ]}
            receiveShadow
            scale={[cabWidth, 0.08, cabDepth]}
            slotId="cab"
          />

          <BoxPrimitive
            castShadow
            material={CAB_MATERIAL}
            position={[0, cabHeight / 2, cabCenterZ + cabDepth / 2 - 0.04]}
            receiveShadow
            scale={[cabWidth, cabHeight, 0.08]}
            slotId="cab"
          />

          <BoxPrimitive
            castShadow
            material={CAB_MATERIAL}
            position={[-cabWidth / 2 + 0.04, cabHeight / 2, cabCenterZ]}
            receiveShadow
            scale={[0.08, cabHeight, cabDepth]}
            slotId="cab"
          />

          <BoxPrimitive
            castShadow
            material={CAB_MATERIAL}
            position={[cabWidth / 2 - 0.04, cabHeight / 2, cabCenterZ]}
            receiveShadow
            scale={[0.08, cabHeight, cabDepth]}
            slotId="cab"
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
                  active={
                    !isDisabledLevel && !isServiceOnlyLevel && isCurrentLevel && doorOpen > 0.5
                  }
                  buttonKind="landing"
                  disabled={isDisabledLevel || isServiceOnlyLevel}
                  elevatorId={elevatorId}
                  levelId={entry.id as AnyNodeId}
                  position={[0, 0.06, -0.045]}
                  queued={isQueuedLevel}
                  radius={0.045}
                />
                <BoxPrimitive
                  material={
                    isQueuedLevel ? QUEUE_STRIP_MATERIALS.queued : QUEUE_STRIP_MATERIALS.idle
                  }
                  position={[0, -0.12, -0.035]}
                  scale={[0.095, 0.025, 0.012]}
                />
              </group>
            </group>
          )
        })}
      </group>
    </ElevatorMaterialsContext.Provider>
  )
}

export default ElevatorRenderer
