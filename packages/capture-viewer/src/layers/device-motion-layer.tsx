'use client'

import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { type Group, Quaternion, Vector3 } from 'three'
import { type DeviceTrajectory, sampleDeviceTrajectory } from '../trajectory'

export const DEVICE_MOTION_PLAYBACK_SPEED = 3

export function CaptureDeviceMotionLayer({
  lineWidth = 2.5,
  trajectory,
}: {
  lineWidth?: number
  trajectory: DeviceTrajectory
}) {
  const deviceRef = useRef<Group>(null)
  const elapsedRef = useRef(0)
  const position = useMemo(() => new Vector3(), [])
  const toPosition = useMemo(() => new Vector3(), [])
  const fromQuaternion = useMemo(() => new Quaternion(), [])
  const toQuaternion = useMemo(() => new Quaternion(), [])
  const trajectorySegments = useMemo(() => {
    const segments = new Map<number, [number, number, number][]>()
    for (const pose of trajectory.poses) {
      const points = segments.get(pose.segment) ?? []
      points.push(pose.position)
      segments.set(pose.segment, points)
    }
    return [...segments.entries()]
      .filter(([, points]) => points.length > 1)
      .map(([segment, points]) => ({ points, segment }))
  }, [trajectory])

  useFrame((_, delta) => {
    if (!deviceRef.current) return
    elapsedRef.current += delta * DEVICE_MOTION_PLAYBACK_SPEED

    const frame = sampleDeviceTrajectory(trajectory, elapsedRef.current)
    position
      .fromArray(frame.from.position)
      .lerp(toPosition.fromArray(frame.to.position), frame.alpha)
    fromQuaternion.fromArray(frame.from.quaternion)
    toQuaternion.fromArray(frame.to.quaternion)
    deviceRef.current.position.copy(position)
    deviceRef.current.quaternion.slerpQuaternions(fromQuaternion, toQuaternion, frame.alpha)
  })

  return (
    <group>
      {trajectorySegments.map(({ points, segment }) => (
        <Line
          color="#222326"
          key={segment}
          lineWidth={lineWidth}
          opacity={0.78}
          points={points}
          transparent
        />
      ))}
      <group ref={deviceRef}>
        <CameraFrustum lineWidth={lineWidth} />
      </group>
    </group>
  )
}

function CameraFrustum({ lineWidth }: { lineWidth: number }) {
  const apex: [number, number, number] = [0, 0, 0]
  const topRight: [number, number, number] = [0.14, 0.1, -0.28]
  const topLeft: [number, number, number] = [-0.14, 0.1, -0.28]
  const bottomLeft: [number, number, number] = [-0.14, -0.1, -0.28]
  const bottomRight: [number, number, number] = [0.14, -0.1, -0.28]
  const corners: [number, number, number][] = [topRight, topLeft, bottomLeft, bottomRight]
  const edges = [
    ...corners.map((corner) => [apex, corner] as const),
    [topRight, topLeft] as const,
    [topLeft, bottomLeft] as const,
    [bottomLeft, bottomRight] as const,
    [bottomRight, topRight] as const,
  ]

  return (
    <group>
      {edges.map((points, index) => (
        <Line color="#f5b900" key={index} lineWidth={lineWidth} points={points} />
      ))}
      <mesh>
        <sphereGeometry args={[0.025, 12, 12]} />
        <meshBasicMaterial color="#ffd84d" />
      </mesh>
    </group>
  )
}
