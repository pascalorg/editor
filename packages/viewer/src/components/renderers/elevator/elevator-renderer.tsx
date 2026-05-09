import {
  type AnyNodeId,
  type ElevatorNode,
  useInteractive,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { resolveElevatorLevels } from '../../../systems/elevator/elevator-utils'

const SHAFT_WALL_COLOR = '#d7dce4'
const SHAFT_SIDE_COLOR = '#4b5563'
const SHAFT_TRIM_COLOR = '#eef2f7'
const CAB_COLOR = '#d7dde5'
const GLASS_COLOR = '#f8fafc'
const DOOR_COLOR = '#8e98a6'
const PANEL_COLOR = '#1f2937'

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

function MeshButtonLabel({
  color,
  label,
  position,
  scale,
}: {
  color: string
  label: string
  position: [number, number, number]
  scale: number
}) {
  const characters = label.split('').filter((character) => DIGIT_SEGMENTS[character])
  const spacing = 0.72 * scale
  const startX = -((characters.length - 1) * spacing) / 2

  if (characters.length === 0) return null

  return (
    <group position={position}>
      {characters.map((character, charIndex) => (
        <group key={`${character}-${charIndex}`} position={[startX + charIndex * spacing, 0, 0]}>
          {(DIGIT_SEGMENTS[character] ?? []).map((segment) => {
            const props = SEGMENT_PROPS[segment]
            return (
              <mesh
                key={segment}
                position={[props.position[0] * scale, props.position[1] * scale, props.position[2]]}
              >
                <boxGeometry args={[props.size[0] * scale, props.size[1] * scale, props.size[2]]} />
                <meshStandardMaterial color={color} metalness={0.12} roughness={0.34} />
              </mesh>
            )
          })}
        </group>
      ))}
    </group>
  )
}

function ElevatorDirectionGlyph({
  color,
  direction,
  position,
  scale,
}: {
  color: string
  direction: 'down' | 'up' | null
  position: [number, number, number]
  scale: number
}) {
  if (!direction) {
    return (
      <mesh position={position}>
        <boxGeometry args={[0.08 * scale, 0.08 * scale, 0.018]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.28}
          metalness={0.08}
          roughness={0.32}
        />
      </mesh>
    )
  }

  const ySign = direction === 'up' ? 1 : -1
  return (
    <group position={position}>
      <mesh
        position={[-0.04 * scale, -0.02 * ySign * scale, 0]}
        rotation-z={(-ySign * Math.PI) / 4}
      >
        <boxGeometry args={[0.16 * scale, 0.035 * scale, 0.018]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.36}
          metalness={0.08}
          roughness={0.32}
        />
      </mesh>
      <mesh position={[0.04 * scale, -0.02 * ySign * scale, 0]} rotation-z={(ySign * Math.PI) / 4}>
        <boxGeometry args={[0.16 * scale, 0.035 * scale, 0.018]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.36}
          metalness={0.08}
          roughness={0.32}
        />
      </mesh>
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
}: {
  active: boolean
  direction: 'down' | 'up' | null
  faceSign?: -1 | 1
  label: string
  position: [number, number, number]
  scale?: number
}) {
  const glowColor = active ? '#38bdf8' : '#94a3b8'
  const screenColor = active ? '#041f2f' : '#111827'
  const displayLabel = label || '-'
  const screenZ = faceSign * 0.026 * scale
  const glyphZ = faceSign * 0.041 * scale

  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.42 * scale, 0.16 * scale, 0.045 * scale]} />
        <meshStandardMaterial color={PANEL_COLOR} metalness={0.36} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0, screenZ]}>
        <boxGeometry args={[0.34 * scale, 0.095 * scale, 0.012 * scale]} />
        <meshStandardMaterial
          color={screenColor}
          emissive={active ? '#0ea5e9' : '#000000'}
          emissiveIntensity={active ? 0.16 : 0}
          metalness={0.12}
          roughness={0.38}
        />
      </mesh>
      <ElevatorDirectionGlyph
        color={glowColor}
        direction={direction}
        position={[-0.115 * scale, 0, glyphZ]}
        scale={scale}
      />
      <MeshButtonLabel
        color={glowColor}
        label={displayLabel}
        position={[0.075 * scale, 0, glyphZ]}
        scale={0.055 * scale}
      />
    </group>
  )
}

function ElevatorMeshButton({
  active,
  buttonKind,
  elevatorId,
  faceSign = -1,
  label,
  levelId,
  onRequest,
  position,
  queued,
  radius = 0.055,
}: {
  active: boolean
  buttonKind: 'cab' | 'landing'
  elevatorId: AnyNodeId
  faceSign?: -1 | 1
  label?: string
  levelId: AnyNodeId
  onRequest: () => void
  position: [number, number, number]
  queued: boolean
  radius?: number
}) {
  const buttonColor = active ? '#38bdf8' : queued ? '#fbbf24' : '#d6dde7'
  const labelColor = active || queued ? '#111827' : '#334155'
  const ringColor = active ? '#0ea5e9' : queued ? '#f59e0b' : '#64748b'
  const depth = active ? 0.028 : 0.04
  const faceZ = faceSign * (depth / 2 + 0.004)
  const userData = useMemo(
    () => ({
      elevatorButton: {
        elevatorId,
        kind: buttonKind,
        levelId,
      },
    }),
    [buttonKind, elevatorId, levelId],
  )

  const press = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return
    onRequest()
  }

  return (
    <group onPointerDown={press} position={position} userData={userData}>
      {(active || queued) && (
        <mesh position={[0, 0, faceSign * (depth + 0.004)]} receiveShadow rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[radius * 1.42, radius * 1.42, 0.012, 32]} />
          <meshStandardMaterial
            color={buttonColor}
            depthWrite={false}
            emissive={buttonColor}
            emissiveIntensity={active ? 0.28 : 0.18}
            opacity={0.58}
            transparent
          />
        </mesh>
      )}
      <mesh castShadow position={[0, 0, faceSign * (depth / 2 + 0.003)]} receiveShadow>
        <torusGeometry args={[radius * 1.12, radius * 0.12, 8, 32]} />
        <meshStandardMaterial
          color={ringColor}
          emissive={active || queued ? ringColor : '#000000'}
          emissiveIntensity={active ? 0.16 : queued ? 0.1 : 0}
          metalness={0.48}
          roughness={0.28}
        />
      </mesh>
      <mesh castShadow receiveShadow rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[radius, radius * 0.92, depth, 32]} />
        <meshStandardMaterial
          color={buttonColor}
          emissive={active || queued ? buttonColor : '#000000'}
          emissiveIntensity={active ? 0.28 : queued ? 0.18 : 0}
          metalness={0.22}
          roughness={0.3}
        />
      </mesh>
      {label && (
        <MeshButtonLabel
          color={labelColor}
          label={label}
          position={[0, 0, faceZ]}
          scale={radius * 0.72}
        />
      )}
    </group>
  )
}

function DoorLeaf({
  animated,
  doorOpen,
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
  height: number
  side: 'left' | 'right'
  width: number
  y: number
  z: number
}) {
  const ref = useRef<Group>(null)
  const direction = side === 'left' ? -1 : 1
  const getLeafX = (openAmount: number) => direction * (width / 4 + openAmount * width * 0.34)
  const leafWidth = Math.max(width / 2 - 0.018, 0.12)
  const railHeight = Math.min(0.09, Math.max(0.055, height * 0.04))
  const stileWidth = Math.min(0.07, Math.max(0.04, leafWidth * 0.18))
  const glassWidth = Math.max(leafWidth - stileWidth * 2.2, 0.03)
  const glassHeight = Math.max(height - railHeight * 3, 0.2)

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
      <mesh castShadow position={[0, height / 2 - railHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[leafWidth, railHeight, 0.05]} />
        <meshStandardMaterial color={DOOR_COLOR} metalness={0.34} roughness={0.34} />
      </mesh>
      <mesh castShadow position={[0, -height / 2 + railHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[leafWidth, railHeight, 0.05]} />
        <meshStandardMaterial color={DOOR_COLOR} metalness={0.34} roughness={0.34} />
      </mesh>
      <mesh castShadow position={[-leafWidth / 2 + stileWidth / 2, 0, 0]} receiveShadow>
        <boxGeometry args={[stileWidth, height, 0.05]} />
        <meshStandardMaterial color={DOOR_COLOR} metalness={0.34} roughness={0.34} />
      </mesh>
      <mesh castShadow position={[leafWidth / 2 - stileWidth / 2, 0, 0]} receiveShadow>
        <boxGeometry args={[stileWidth, height, 0.05]} />
        <meshStandardMaterial color={DOOR_COLOR} metalness={0.34} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0, -0.004]}>
        <boxGeometry args={[glassWidth, glassHeight, 0.012]} />
        <meshStandardMaterial
          color={GLASS_COLOR}
          depthWrite={false}
          metalness={0}
          opacity={0.2}
          roughness={0.08}
          transparent
        />
      </mesh>
    </group>
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
  const levelHeight = Math.max(levelTopY - levelY, doorHeight + 0.24)
  const jambWidth = Math.max((shaftWidth - doorWidth) / 2, 0.08)
  const jambCenterOffset = doorWidth / 2 + jambWidth / 2
  const headerHeight = Math.max(levelHeight - doorHeight, 0.14)
  const trim = 0.055

  return (
    <>
      <mesh castShadow position={[-jambCenterOffset, levelY + levelHeight / 2, z]} receiveShadow>
        <boxGeometry args={[jambWidth, levelHeight, wallDepth]} />
        <meshStandardMaterial color={SHAFT_WALL_COLOR} metalness={0.08} roughness={0.56} />
      </mesh>
      <mesh castShadow position={[jambCenterOffset, levelY + levelHeight / 2, z]} receiveShadow>
        <boxGeometry args={[jambWidth, levelHeight, wallDepth]} />
        <meshStandardMaterial color={SHAFT_WALL_COLOR} metalness={0.08} roughness={0.56} />
      </mesh>
      <mesh castShadow position={[0, levelY + doorHeight + headerHeight / 2, z]} receiveShadow>
        <boxGeometry args={[shaftWidth, headerHeight, wallDepth]} />
        <meshStandardMaterial color={SHAFT_WALL_COLOR} metalness={0.08} roughness={0.56} />
      </mesh>
      <mesh castShadow position={[0, levelY + trim / 2, z - 0.006]} receiveShadow>
        <boxGeometry args={[doorWidth + trim * 2, trim, wallDepth * 1.12]} />
        <meshStandardMaterial color={SHAFT_TRIM_COLOR} metalness={0.2} roughness={0.38} />
      </mesh>
      <mesh
        castShadow
        position={[-doorWidth / 2 - trim / 2, levelY + doorHeight / 2, z - 0.006]}
        receiveShadow
      >
        <boxGeometry args={[trim, doorHeight, wallDepth * 1.12]} />
        <meshStandardMaterial color={SHAFT_TRIM_COLOR} metalness={0.2} roughness={0.38} />
      </mesh>
      <mesh
        castShadow
        position={[doorWidth / 2 + trim / 2, levelY + doorHeight / 2, z - 0.006]}
        receiveShadow
      >
        <boxGeometry args={[trim, doorHeight, wallDepth * 1.12]} />
        <meshStandardMaterial color={SHAFT_TRIM_COLOR} metalness={0.2} roughness={0.38} />
      </mesh>
      <mesh castShadow position={[0, levelY + doorHeight + trim / 2, z - 0.006]} receiveShadow>
        <boxGeometry args={[doorWidth + trim * 2, trim, wallDepth * 1.12]} />
        <meshStandardMaterial color={SHAFT_TRIM_COLOR} metalness={0.2} roughness={0.38} />
      </mesh>
    </>
  )
}

function LandingDoor({
  animated,
  elevatorId,
  doorOpen,
  doorHeight,
  doorWidth,
  levelId,
  levelY,
  z,
}: {
  animated: boolean
  elevatorId: AnyNodeId
  doorOpen: number
  doorHeight: number
  doorWidth: number
  levelId: AnyNodeId
  levelY: number
  z: number
}) {
  return (
    <>
      <DoorLeaf
        animated={animated ? { elevatorId, kind: 'landing', levelId } : undefined}
        doorOpen={doorOpen}
        height={doorHeight}
        side="left"
        width={doorWidth}
        y={levelY}
        z={z}
      />
      <DoorLeaf
        animated={animated ? { elevatorId, kind: 'landing', levelId } : undefined}
        doorOpen={doorOpen}
        height={doorHeight}
        side="right"
        width={doorWidth}
        y={levelY}
        z={z}
      />
    </>
  )
}

export const ElevatorRenderer = ({ node }: { node: ElevatorNode }) => {
  const ref = useRef<Group>(null!)
  const cabRef = useRef<Group>(null)
  const nodes = useScene((state) => state.nodes)
  const handlers = useNodeEvents(node, 'elevator')
  const liveOverrides = useLiveNodeOverrides((state) => state.get(node.id))
  const renderNode = useMemo(
    () => (liveOverrides ? ({ ...node, ...liveOverrides } as ElevatorNode) : node),
    [liveOverrides, node],
  )

  useRegistry(node.id, 'elevator', ref)

  const { entries, defaultEntry, shaftBaseY, shaftTopY, totalHeight } = useMemo(
    () => resolveElevatorLevels(renderNode, nodes),
    [renderNode, nodes],
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

  useEffect(() => {
    if (!defaultEntry) return

    const elevatorId = node.id as AnyNodeId
    const interactive = useInteractive.getState()
    const current = interactive.elevators[elevatorId]
    if (!current) {
      interactive.initElevator(elevatorId, defaultEntry.id as AnyNodeId, defaultEntry.baseY)
    } else if (!entries.some((entry) => entry.id === current.currentLevelId)) {
      interactive.setElevatorState(elevatorId, {
        carY: defaultEntry.baseY,
        currentLevelId: defaultEntry.id as AnyNodeId,
        doorOpen: 0,
        phase: 'idle',
        phaseStartedAt: null,
        queue: [],
        targetLevelId: null,
      })
    }
  }, [defaultEntry, entries, node.id])

  useEffect(() => {
    return () => {
      useInteractive.getState().removeElevator(elevatorId)
    }
  }, [elevatorId])

  useFrame(() => {
    if (!cabRef.current) return
    const runtime = useInteractive.getState().elevators[elevatorId]
    if (!runtime) return
    cabRef.current.position.y = runtime.carY
  }, 2.6)

  const shaftWidth = Math.max(renderNode.width, 0.8)
  const shaftDepth = Math.max(renderNode.depth, 0.8)
  const cabHeight = Math.max(renderNode.cabHeight, 1.4)
  const doorWidth = Math.min(Math.max(renderNode.doorWidth, 0.45), shaftWidth - 0.18)
  const doorHeight = Math.min(Math.max(renderNode.doorHeight, 1.2), cabHeight - 0.1)
  const shaftHeight = Math.max(totalHeight, cabHeight + 0.3)
  const resolvedShaftTopY = Math.max(shaftTopY, shaftBaseY + shaftHeight)
  const shaftWallThickness = 0.09
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
  const queuedLevelIds = new Set<string>()
  for (const levelId of runtimeStatus?.queue ?? runtimeSnapshot?.queue ?? [])
    queuedLevelIds.add(levelId)
  if (runtimeStatus?.targetLevelId ?? runtimeSnapshot?.targetLevelId) {
    queuedLevelIds.add((runtimeStatus?.targetLevelId ?? runtimeSnapshot?.targetLevelId)!)
  }
  const doorOpen = runtimeSnapshot?.doorOpen ?? 0
  const frontWallZ = -shaftDepth / 2 - shaftWallThickness / 2
  const frontZ = frontWallZ - shaftWallThickness / 2 - 0.018
  const landingPanelX = Math.min(shaftWidth / 2 - 0.16, doorWidth / 2 + 0.18)
  const cabPanelX = shaftWidth / 2 - 0.075
  const cabPanelZ = -shaftDepth / 2 + 0.36
  const cabButtonColumns = entries.length > 1 ? 2 : 1
  const cabButtonRows = Math.max(1, Math.ceil(entries.length / cabButtonColumns))
  const cabButtonSpacingX = 0.14
  const cabButtonSpacingY = 0.15
  const cabPanelWidth = cabButtonColumns * cabButtonSpacingX + 0.13
  const cabPanelHeight = cabButtonRows * cabButtonSpacingY + 0.12
  const panelRelativeY = Math.min(Math.max(doorHeight * 0.6, 0.95), cabHeight - 0.35)
  const cabPanelY = panelRelativeY
  const entrySpans = entries.map((entry, index) => {
    const nextEntry = entries[index + 1]
    return {
      entry,
      levelTopY: Math.max(nextEntry?.baseY ?? resolvedShaftTopY, entry.baseY + doorHeight + 0.24),
    }
  })
  const requestLevel = (levelId: AnyNodeId) => {
    useInteractive.getState().requestElevator(elevatorId, levelId)
  }

  return (
    <group
      position={renderNode.position}
      ref={ref}
      rotation-y={renderNode.rotation}
      visible={renderNode.visible}
      {...handlers}
    >
      <mesh
        castShadow
        position={[0, shaftBaseY + shaftHeight / 2, shaftDepth / 2 + shaftWallThickness / 2]}
        receiveShadow
      >
        <boxGeometry
          args={[shaftWidth + shaftWallThickness * 2, shaftHeight, shaftWallThickness]}
        />
        <meshStandardMaterial color={SHAFT_SIDE_COLOR} metalness={0.12} roughness={0.58} />
      </mesh>
      <mesh
        castShadow
        position={[-shaftWidth / 2 - shaftWallThickness / 2, shaftBaseY + shaftHeight / 2, 0]}
        receiveShadow
      >
        <boxGeometry
          args={[shaftWallThickness, shaftHeight, shaftDepth + shaftWallThickness * 2]}
        />
        <meshStandardMaterial color={SHAFT_SIDE_COLOR} metalness={0.12} roughness={0.58} />
      </mesh>
      <mesh
        castShadow
        position={[shaftWidth / 2 + shaftWallThickness / 2, shaftBaseY + shaftHeight / 2, 0]}
        receiveShadow
      >
        <boxGeometry
          args={[shaftWallThickness, shaftHeight, shaftDepth + shaftWallThickness * 2]}
        />
        <meshStandardMaterial color={SHAFT_SIDE_COLOR} metalness={0.12} roughness={0.58} />
      </mesh>
      <mesh
        castShadow
        position={[0, shaftBaseY + shaftHeight - shaftWallThickness / 2, 0]}
        receiveShadow
      >
        <boxGeometry
          args={[
            shaftWidth + shaftWallThickness * 2,
            shaftWallThickness,
            shaftDepth + shaftWallThickness * 2,
          ]}
        />
        <meshStandardMaterial color={SHAFT_SIDE_COLOR} metalness={0.12} roughness={0.58} />
      </mesh>

      <group ref={cabRef} position={[0, cabBaseY, 0]}>
        <mesh castShadow position={[0, 0.04, 0]} receiveShadow>
          <boxGeometry args={[shaftWidth, 0.08, shaftDepth]} />
          <meshStandardMaterial color={CAB_COLOR} metalness={0.18} roughness={0.45} />
        </mesh>

        <mesh castShadow position={[0, cabHeight - 0.04, 0]} receiveShadow>
          <boxGeometry args={[shaftWidth, 0.08, shaftDepth]} />
          <meshStandardMaterial color={CAB_COLOR} metalness={0.18} roughness={0.45} />
        </mesh>

        <mesh castShadow position={[0, cabHeight / 2, shaftDepth / 2 - 0.04]} receiveShadow>
          <boxGeometry args={[shaftWidth, cabHeight, 0.08]} />
          <meshStandardMaterial color={CAB_COLOR} metalness={0.2} roughness={0.48} />
        </mesh>

        <mesh castShadow position={[-shaftWidth / 2 + 0.04, cabHeight / 2, 0]} receiveShadow>
          <boxGeometry args={[0.08, cabHeight, shaftDepth]} />
          <meshStandardMaterial color={CAB_COLOR} metalness={0.2} roughness={0.48} />
        </mesh>

        <mesh castShadow position={[shaftWidth / 2 - 0.04, cabHeight / 2, 0]} receiveShadow>
          <boxGeometry args={[0.08, cabHeight, shaftDepth]} />
          <meshStandardMaterial color={CAB_COLOR} metalness={0.2} roughness={0.48} />
        </mesh>

        <DoorLeaf
          animated={{ elevatorId, kind: 'cab' }}
          doorOpen={doorOpen}
          height={doorHeight}
          side="left"
          width={doorWidth}
          y={0}
          z={frontZ}
        />
        <DoorLeaf
          animated={{ elevatorId, kind: 'cab' }}
          doorOpen={doorOpen}
          height={doorHeight}
          side="right"
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
          <mesh castShadow receiveShadow>
            <boxGeometry args={[cabPanelWidth, cabPanelHeight, 0.045]} />
            <meshStandardMaterial color={PANEL_COLOR} metalness={0.32} roughness={0.36} />
          </mesh>

          {entries.map((entry, index) => {
            const column = index % cabButtonColumns
            const row = Math.floor(index / cabButtonColumns)
            const x = (column - (cabButtonColumns - 1) / 2) * cabButtonSpacingX
            const y = ((cabButtonRows - 1) / 2 - row) * cabButtonSpacingY

            return (
              <ElevatorMeshButton
                active={activeLevelId === entry.id}
                buttonKind="cab"
                elevatorId={elevatorId}
                faceSign={1}
                key={entry.id}
                label={entry.label}
                levelId={entry.id as AnyNodeId}
                onRequest={() => requestLevel(entry.id as AnyNodeId)}
                position={[x, y, 0.045]}
                queued={queuedLevelIds.has(entry.id)}
              />
            )
          })}
        </group>
      </group>

      {entrySpans.map(({ entry, levelTopY }) => (
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
            animated={activeLevelId === entry.id}
            elevatorId={elevatorId}
            doorHeight={doorHeight}
            doorOpen={activeLevelId === entry.id ? doorOpen : 0}
            doorWidth={doorWidth}
            levelId={entry.id as AnyNodeId}
            levelY={entry.baseY}
            z={frontZ - 0.02}
          />
          <ElevatorFloorIndicator
            active={indicatorActive || activeLevelId === entry.id || queuedLevelIds.has(entry.id)}
            direction={indicatorDirection}
            label={indicatorEntry?.label ?? entry.label}
            position={[0, entry.baseY + doorHeight + 0.16, frontZ - 0.055]}
            scale={0.62}
          />
          <group position={[landingPanelX, entry.baseY + panelRelativeY, frontZ - 0.035]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.18, 0.42, 0.04]} />
              <meshStandardMaterial color={PANEL_COLOR} metalness={0.25} roughness={0.4} />
            </mesh>
            <ElevatorMeshButton
              active={activeLevelId === entry.id && doorOpen > 0.5}
              buttonKind="landing"
              elevatorId={elevatorId}
              levelId={entry.id as AnyNodeId}
              onRequest={() => requestLevel(entry.id as AnyNodeId)}
              position={[0, 0.06, -0.045]}
              queued={queuedLevelIds.has(entry.id)}
              radius={0.045}
            />
            <mesh position={[0, -0.12, -0.035]}>
              <boxGeometry args={[0.095, 0.025, 0.012]} />
              <meshStandardMaterial
                color={queuedLevelIds.has(entry.id) ? '#fbbf24' : '#64748b'}
                emissive={queuedLevelIds.has(entry.id) ? '#fbbf24' : '#000000'}
                emissiveIntensity={queuedLevelIds.has(entry.id) ? 0.16 : 0}
                metalness={0.18}
                roughness={0.42}
              />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}
