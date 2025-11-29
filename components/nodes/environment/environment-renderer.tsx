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

  const sunTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const context = canvas.getContext('2d')!

    const gradient = context.createRadialGradient(256, 256, 20, 256, 256, 256)

    // Core
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)')
    gradient.addColorStop(0.1, 'rgba(255, 255, 240, 0.8)')

    // Corona/Glow
    gradient.addColorStop(0.2, 'rgba(255, 245, 220, 0.4)')
    gradient.addColorStop(0.4, 'rgba(255, 220, 180, 0.1)')
    gradient.addColorStop(1, 'rgba(255, 140, 0, 0)')

    context.fillStyle = gradient
    context.fillRect(0, 0, 512, 512)

    const texture = new THREE.CanvasTexture(canvas)
    return texture
  }, [])

  // Position sprite far away but visible
  const spritePosition = useMemo(
    () => sunPosition.clone().normalize().multiplyScalar(400),
    [sunPosition],
  )

  return (
    <>
      <Sky
        distance={1000}
        mieCoefficient={0.002}
        mieDirectionalG={0.8}
        rayleigh={1}
        sunPosition={sunPosition}
        turbidity={2}
      />

      <sprite position={spritePosition} scale={[60, 60, 1]}>
        <spriteMaterial
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          map={sunTexture}
          opacity={0.8}
          toneMapped={false}
          transparent
        />
      </sprite>

      <directionalLight
        castShadow
        intensity={1}
        position={sunPosition}
        shadow-bias={-0.0001}
        shadow-camera-bottom={-40}
        shadow-camera-far={200}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-mapSize={[1024, 1024]}
      />
      <ambientLight intensity={0.4} />
    </>
  )
})
