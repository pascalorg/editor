import { type SpawnNode, useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import type { Group } from 'three'
import { Color, Shape } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'

// Mirrors the current first-person controller capsule in the editor package:
// colliderCapsuleArgs={[0.25, 0.8, 4, 8]} with the controller center 0.8m above the floor.
const PLAYER_CAPSULE_RADIUS = 0.25
const PLAYER_CAPSULE_LENGTH = 0.8
const PLAYER_CAPSULE_CENTER_Y = 0.8

const SPAWN_COLOR = new Color('#22c55e')

export const SpawnRenderer = ({ node }: { node: SpawnNode }) => {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node, 'spawn')
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const walkthroughMode = useViewer((state) => state.walkthroughMode)

  useRegistry(node.id, 'spawn', ref)

  const materialProps = useMemo(
    () => ({
      color: SPAWN_COLOR,
      emissive: SPAWN_COLOR,
      emissiveIntensity: 0.08,
      metalness: 0.03,
      roughness: 0.42,
    }),
    [],
  )

  const arrowShape = useMemo(() => {
    const shape = new Shape()
    // Positive local Y becomes negative world Z after the -90deg X rotation below,
    // so this tip points "forward" for the player/spawn direction.
    shape.moveTo(0, 0.24)
    shape.lineTo(-0.18, -0.14)
    shape.lineTo(0.18, -0.14)
    shape.closePath()
    return shape
  }, [])

  return (
    <group
      position={liveTransform?.position ?? node.position}
      ref={ref}
      rotation={[0, liveTransform?.rotation ?? node.rotation, 0]}
      visible={!walkthroughMode}
    >
      <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} {...handlers}>
        <ringGeometry args={[0.34, 0.48, 48]} />
        <meshStandardMaterial {...materialProps} />
      </mesh>

      <mesh
        position={[0, 0.1, -0.52]}
        rotation={[-Math.PI / 2, 0, ( Math.PI) / 180]}
        {...handlers}
      >
        <shapeGeometry args={[arrowShape]} />
        <meshStandardMaterial {...materialProps} />
      </mesh>

      <group position={[0, 0.09, 0]}>
        <mesh position={[0, 0.48, 0]} {...handlers}>
          <boxGeometry args={[0.4, 0.82, 0.28]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>

        <mesh position={[0, 1.08, 0]} {...handlers}>
          <boxGeometry args={[0.24, 0.24, 0.24]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      </group>
    </group>
  )
}
