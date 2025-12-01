import { Sky, SoftShadows } from '@react-three/drei'
import { memo, useEffect, useMemo, useState } from 'react'
import SunCalc from 'suncalc'
import * as THREE from 'three'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '@/hooks/use-editor'

export const EnvironmentRenderer = memo(() => {
  const { latitude, longitude, timeMode, staticTime } = useEditor(
    useShallow((state) => {
      const environment = state.scene.root.environment
      return {
        latitude: environment.latitude,
        longitude: environment.longitude,
        altitude: environment.altitude,
        timeMode: environment.timeMode,
        staticTime: environment.staticTime,
      }
    }),
  )

  const [date, setDate] = useState(new Date())

  // Update time based on mode
  useEffect(() => {
    if (timeMode === 'custom' && staticTime) {
      setDate(new Date(staticTime))
      return
    }

    // Default to 'now' behavior
    setDate(new Date())
    const timer = setInterval(() => setDate(new Date()), 60 * 1000)
    return () => clearInterval(timer)
  }, [timeMode, staticTime])

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

    return {
      position: new THREE.Vector3(x, y, z),
      altitude,
      azimuth,
    }
  }, [date, latitude, longitude])

  const lighting = useMemo(() => {
    const { altitude } = sunPosition
    // altitude is in radians.
    // -PI/2 (nadir) to PI/2 (zenith)

    // Helper to interpolate colors
    const lerpColor = (c1: string, c2: string, t: number) => {
      const col1 = new THREE.Color(c1)
      const col2 = new THREE.Color(c2)
      return col1.lerp(col2, t)
    }

    // Helper to clamp and normalize t based on range
    const getT = (val: number, min: number, max: number) =>
      Math.max(0, Math.min(1, (val - min) / (max - min)))

    let ambientColor = new THREE.Color('#ffffff')
    let ambientIntensity = 0.4
    let directionalColor = new THREE.Color('#ffffff')
    let directionalIntensity = 1

    if (altitude < -0.05) {
      // Night (Below horizon)
      ambientColor = new THREE.Color('#0d1b2a') // Deep night blue
      ambientIntensity = 0.2
      directionalColor = new THREE.Color('#415a77') // Cool moonlight
      directionalIntensity = 0.2 // Dim moonlight
    } else if (altitude < 0.1) {
      // Dawn/Dusk Transition
      const t = getT(altitude, -0.05, 0.1)

      // Ambient: Night Blue -> Golden Orange -> Day White
      if (t < 0.5) {
        // Night to Dawn
        const localT = t * 2
        ambientColor = lerpColor('#0d1b2a', '#e07a5f', localT)
        ambientIntensity = THREE.MathUtils.lerp(0.2, 0.5, localT)
        directionalColor = lerpColor('#415a77', '#f2cc8f', localT)
        directionalIntensity = THREE.MathUtils.lerp(0.2, 0.8, localT)
      } else {
        // Dawn to Day
        const localT = (t - 0.5) * 2
        ambientColor = lerpColor('#e07a5f', '#ffffff', localT)
        ambientIntensity = THREE.MathUtils.lerp(0.1, 0.1, localT)
        directionalColor = lerpColor('#f2cc8f', '#fffcf2', localT)
        directionalIntensity = THREE.MathUtils.lerp(0.5, 0.5, localT)
      }
    } else {
      // Day
      ambientColor = new THREE.Color('#ffffff')
      ambientIntensity = 0.4
      directionalColor = new THREE.Color('#fffcf2') // Warm white
      directionalIntensity = 1
    }

    return {
      ambientColor,
      ambientIntensity,
      directionalColor,
      directionalIntensity,
    }
  }, [sunPosition])

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
    () => sunPosition.position.clone().normalize().multiplyScalar(400),
    [sunPosition],
  )

  const isNight = sunPosition.altitude < -0.05

  return (
    <>
      <Sky
        distance={1000}
        mieCoefficient={0.005}
        mieDirectionalG={0.7}
        rayleigh={isNight ? 0.1 : 3}
        sunPosition={sunPosition.position}
        turbidity={isNight ? 10 : 1}
      />

      <sprite position={spritePosition} scale={[60, 60, 1]}>
        <spriteMaterial
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          map={sunTexture}
          opacity={isNight ? 0 : 0.8}
          toneMapped={false}
          transparent
        />
      </sprite>

      <directionalLight
        castShadow
        color={lighting.directionalColor}
        intensity={lighting.directionalIntensity}
        position={sunPosition.position}
        shadow-bias={-0.0001}
        shadow-camera-bottom={-40}
        shadow-camera-far={200}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-mapSize={[2048, 2048]}
      />
      <ambientLight color={lighting.ambientColor} intensity={lighting.ambientIntensity} />
    </>
  )
})
