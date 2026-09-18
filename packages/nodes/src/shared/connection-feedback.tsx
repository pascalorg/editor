'use client'

import type { AnyNodeId } from '@pascal-app/core'
import {
  EDITOR_LAYER,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  useEditor,
} from '@pascal-app/editor'
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
  if (!point || !(isGridSnapActive() || isMagneticSnapActive() || isAngleSnapActive())) return null
  const port =
    target === undefined ? findNearestPort3D(point, collectScenePorts({ levelId }), 0.5) : target
  if (!port) return null
  const feedback = connectionCompatibility(profile, port)
  const color = COLORS[feedback.status]
  return (
    <group position={[...port.position]}>
      <mesh layers={EDITOR_LAYER} raycast={() => {}}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.55} />
      </mesh>
    </group>
  )
}
