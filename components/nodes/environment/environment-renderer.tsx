import { Sky } from '@react-three/drei'
import { memo, useEffect, useMemo, useState } from 'react'
import SunCalc from 'suncalc'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '@/hooks/use-editor'

export const EnvironmentRenderer = memo(() => {
  const { latitude, longitude } = useEditor(
    useShallow((state) => {
      const environment = state.scene.root.environment
      return {
        latitude: environment.latitude,
        longitude: environment.longitude,
        altitude: environment.altitude,
      }
    }),
  )

  const [date, setDate] = useState(new Date())

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setDate(new Date()), 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const sunPosition = useMemo(() => {
    const pos = SunCalc.getPosition(date, latitude, longitude)
    const { azimuth, altitude } = pos

    // SunCalc azimuth: 0 is South, increasing westward
    // Scene: +X South, +Z East
    // altitude is 0 at horizon, PI/2 at zenith

    // Standard spherical to Cartesian (y-up):
    // x = r * cos(alt) * cos(theta)
    // z = r * cos(alt) * sin(theta)
    // y = r * sin(alt)

    // We want 0 rad -> +X (South)
    // We want PI/2 rad -> -Z (West) (since +Z is East)

    // cos(0) = 1 (x=1)
    // sin(0) = 0 (z=0) -> Correct for South (+X)

    // cos(PI/2) = 0 (x=0)
    // sin(PI/2) = 1. We want -1 (-Z).
    // So z = -sin(azimuth)

    const r = 100
    const x = r * Math.cos(altitude) * Math.cos(azimuth)
    const y = r * Math.sin(altitude)
    const z = r * Math.cos(altitude) * Math.sin(azimuth) * -1

    return new THREE.Vector3(x, y, z)
  }, [date, latitude, longitude])

  return (
    <>
      <Sky sunPosition={sunPosition} />
      <directionalLight
        castShadow
        intensity={2}
        position={sunPosition}
        shadow-bias={-0.0001}
        shadow-camera-bottom={-30}
        shadow-camera-far={100}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-mapSize={[2048, 2048]}
      />
      <ambientLight intensity={0.2} />
    </>
  )
})
