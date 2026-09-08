'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { EDITOR_LAYER, isGridSnapActive, isMagneticSnapActive, useEditor } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { type ConnectionProfile, connectionCompatibility } from './connection-compatibility'
import { collectScenePorts, findNearestPort3D, type ScenePort } from './ports'

const COLORS = { match: '#16a34a', adapter: '#d97706', incompatible: '#dc2626', unknown: '#d97706' }

export function ConnectionFeedback({
  point,
  profile,
  levelId,
  target,
}: {
  point: [number, number, number] | null
  profile: ConnectionProfile
  levelId: AnyNodeId
  target?: ScenePort | null
}) {
  useEditor((state) => state.snappingModeByContext)
  if (!point || !(isGridSnapActive() || isMagneticSnapActive())) return null
  const port = target ?? findNearestPort3D(point, collectScenePorts({ levelId }), 0.5)
  if (!port) return null
  const feedback = connectionCompatibility(profile, port)
  const color = COLORS[feedback.status]
  return (
    <group position={[...port.position]}>
      <mesh layers={EDITOR_LAYER} raycast={() => {}}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.55} />
      </mesh>
      <Html center position={[0, 0.35, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[110, 0]}>
        <div
          role="status"
          className="whitespace-nowrap rounded-full border bg-background/95 px-3 py-1 text-xs shadow-sm"
          style={{ borderColor: color, color }}
        >
          {feedback.label}
        </div>
      </Html>
    </group>
  )
}
