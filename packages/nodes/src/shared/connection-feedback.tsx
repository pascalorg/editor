'use client'

import { type AnyNodeId, type NodePort, portConnection } from '@pascal-app/core'
import {
  EDITOR_LAYER,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  useEditor,
} from '@pascal-app/editor'
import {
  type ConnectionProfile,
  collectScenePorts,
  connectionCompatibility,
  findNearestPort3D,
  type ScenePort,
} from '@pascal-app/editor/distribution'
import { Html } from '@react-three/drei'

const COLORS = { match: '#16a34a', adapter: '#d97706', incompatible: '#dc2626', unknown: '#d97706' }

export function ConnectionFeedback({
  point,
  profile,
  levelId,
  target,
}: {
  point: [number, number, number] | null
  profile: ConnectionProfile & { direction?: NodePort['direction'] }
  levelId: AnyNodeId
  target?: ScenePort | null
}) {
  useEditor((state) => state.snappingModeByContext)
  if (!point || !(isGridSnapActive() || isMagneticSnapActive() || isAngleSnapActive())) return null
  const port =
    target === undefined ? findNearestPort3D(point, collectScenePorts({ levelId }), 0.5) : target
  if (!port) return null
  const feedback = profile.direction
    ? portConnection(
        { ...profile, id: 'preview', position: port.position, direction: profile.direction },
        port,
      )
    : connectionCompatibility(profile, port)
  const color = COLORS[feedback.status]
  return (
    <group position={[...port.position]}>
      <Html center position={[0, 0.25, 0]} style={{ pointerEvents: 'none' }}>
        <div
          role="status"
          className="whitespace-nowrap rounded border bg-background/95 px-2 py-1 text-xs text-foreground"
          style={{ borderColor: color }}
        >
          {feedback.label}
        </div>
      </Html>
      <mesh layers={EDITOR_LAYER} raycast={() => {}}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.55} />
      </mesh>
    </group>
  )
}
