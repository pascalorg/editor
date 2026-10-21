'use client'

import type { AnyNodeId } from '@pascal-app/core'
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
  type PortScreenPoint,
  type ScenePort,
} from '@pascal-app/editor/distribution'
import { Html } from '@react-three/drei'
import { createPortal } from 'react-dom'

const COLORS = { match: '#16a34a', adapter: '#d97706', incompatible: '#dc2626', unknown: '#d97706' }

export function ConnectionFeedback({
  point,
  profile,
  levelId,
  target,
  screen,
  detail,
  error,
}: {
  point: [number, number, number] | null
  profile: ConnectionProfile
  levelId: AnyNodeId
  detail?: string
  error?: string | null
  screen?: PortScreenPoint | null
  target?: ScenePort | null
}) {
  useEditor((state) => state.snappingModeByContext)
  if (
    !point ||
    (!error && !detail && !(isGridSnapActive() || isMagneticSnapActive() || isAngleSnapActive()))
  )
    return null
  const port =
    target === undefined ? findNearestPort3D(point, collectScenePorts({ levelId }), 0.5) : target
  if (!port && !detail && !error) return null
  const feedback = port
    ? connectionCompatibility(profile, port)
    : { status: 'adapter' as const, label: 'Route preview' }
  const color = COLORS[error ? 'incompatible' : feedback.status]
  const label = (
    <div
      role="status"
      className="whitespace-nowrap rounded-md border bg-background/95 px-2 py-1 text-xs shadow-sm"
      style={{ borderColor: color }}
    >
      {error || feedback.label}
      {detail && <div className="mt-1 max-w-72 whitespace-normal">{detail}</div>}
    </div>
  )
  return (
    <group position={[...(port?.position ?? point)]}>
      <Html center position={[0, 0.35, 0]} style={{ pointerEvents: 'none' }}>
        {screen
          ? createPortal(
              <div
                style={{
                  position: 'fixed',
                  left: screen.x,
                  top: screen.y - 32,
                  transform: 'translateX(-50%)',
                  pointerEvents: 'none',
                  zIndex: 110,
                }}
              >
                {label}
              </div>,
              document.body,
            )
          : label}
      </Html>
      <mesh layers={EDITOR_LAYER} raycast={() => {}}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.55} />
      </mesh>
    </group>
  )
}
