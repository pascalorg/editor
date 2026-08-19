'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  type Group,
  LineBasicMaterial,
  LineSegments,
  Quaternion,
  Line as ThreeLine,
  Vector3,
} from 'three'
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
        <CaptureLine
          color="#222326"
          key={segment}
          lineWidth={lineWidth}
          opacity={0.78}
          points={points}
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
  const points = [
    ...corners.map((corner) => [apex, corner] as const),
    [topRight, topLeft] as const,
    [topLeft, bottomLeft] as const,
    [bottomLeft, bottomRight] as const,
    [bottomRight, topRight] as const,
  ].flat()

  return (
    <group>
      <CaptureLine color="#f5b900" lineWidth={lineWidth} points={points} segments />
      <mesh>
        <sphereGeometry args={[0.025, 12, 12]} />
        <meshBasicMaterial color="#ffd84d" />
      </mesh>
    </group>
  )
}

function CaptureLine({
  color,
  lineWidth,
  opacity = 1,
  points,
  segments = false,
}: {
  color: string
  lineWidth: number
  opacity?: number
  points: readonly [number, number, number][]
  segments?: boolean
}) {
  const line = useMemo(() => {
    const geometry = new BufferGeometry().setFromPoints(
      points.map(([x, y, z]) => new Vector3(x, y, z)),
    )
    const material = new LineBasicMaterial({
      color,
      depthWrite: opacity >= 1,
      linewidth: lineWidth,
      opacity,
      transparent: opacity < 1,
    })
    const object = segments
      ? new LineSegments(geometry, material)
      : new ThreeLine(geometry, material)
    object.frustumCulled = false
    return object
  }, [color, lineWidth, opacity, points, segments])

  useEffect(
    () => () => {
      line.geometry.dispose()
      line.material.dispose()
    },
    [line],
  )

  return <primitive object={line} />
}
