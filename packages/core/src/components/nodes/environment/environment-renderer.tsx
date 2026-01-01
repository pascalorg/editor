'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import SunCalc from 'suncalc'
import * as THREE from 'three'
import { degToRad } from 'three/src/math/MathUtils.js'
import { Sky as SkyImpl } from 'three-stdlib'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '../../../hooks'

const tempVec = new THREE.Vector3()
const yAxis = new THREE.Vector3(0, 1, 0)

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

  const moonPosition = useMemo(() => {
    const pos = SunCalc.getMoonPosition(date, latitude, longitude)
    const { azimuth, altitude } = pos

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

    // Civil Twilight starts at ~-6deg (-0.1 rad)
    // We start transition at Civil Dawn (-0.1) and end at full Day (0.1)
    // This puts the midpoint (Sunrise/Sunset) at ~0 altitude, where we want the golden colors.
    const dawnAltitude = -0.1
    const dayAltitude = 0.1

    if (altitude < dawnAltitude) {
      // Night (Below horizon)
      ambientColor = new THREE.Color('#0d1b2a') // Deep night blue
      ambientIntensity = 0.2
      directionalColor = new THREE.Color('#415a77') // Cool moonlight
      directionalIntensity = 0 // Sun is off at night
    } else if (altitude < dayAltitude) {
      // Dawn/Dusk Transition
      const t = getT(altitude, dawnAltitude, dayAltitude)

      // Ambient: Night Blue -> Golden Orange -> Day White
      if (t < 0.5) {
        // Night to Dawn
        const localT = t * 2
        ambientColor = lerpColor('#0d1b2a', '#e07a5f', localT)
        ambientIntensity = THREE.MathUtils.lerp(0.2, 0.5, localT)
        directionalColor = lerpColor('#415a77', '#f2cc8f', localT)
        directionalIntensity = THREE.MathUtils.lerp(0, 0.8, localT)
      } else {
        // Dawn to Day
        const localT = (t - 0.5) * 2
        ambientColor = lerpColor('#e07a5f', '#ffffff', localT)
        ambientIntensity = THREE.MathUtils.lerp(0.5, 0.4, localT) // Smooth transition to day ambient (0.4)
        directionalColor = lerpColor('#f2cc8f', '#fffcf2', localT)
        directionalIntensity = THREE.MathUtils.lerp(0.8, 1, localT)
      }
    } else {
      // Day
      ambientColor = new THREE.Color('#ffffff')
      ambientIntensity = 0.4
      directionalColor = new THREE.Color('#fffcf2') // Warm white
      directionalIntensity = 1
    }

    // Moon calculation
    let moonIntensity = 0
    if (moonPosition.altitude > 0) {
      // Moon is visible
      // Fade in/out near horizon
      const horizonFade = Math.max(0, Math.min(1, moonPosition.altitude / 0.1))
      moonIntensity = 0.4 * horizonFade
    }

    return {
      ambientColor,
      ambientIntensity,
      directionalColor,
      directionalIntensity,
      moonIntensity,
    }
  }, [sunPosition, moonPosition])

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

  // const isNight = sunPosition.altitude < -0.05

  const keyLightRef = useRef<THREE.DirectionalLight>(null)
  const fillLightRef = useRef<THREE.DirectionalLight>(null)
  const backLightRef = useRef<THREE.DirectionalLight>(null)
  const pointLightRef = useRef<THREE.PointLight>(null)
  const moonLightRef = useRef<THREE.DirectionalLight>(null)

  const [sky] = useState(() => new SkyImpl())
  useGSAP(() => {
    gsap.to(sky.material.uniforms.sunPosition.value, {
      x: sunPosition.position.x,
      y: sunPosition.position.y,
      z: sunPosition.position.z,
      duration: 4,
    })

    // Adjusting 3 lights' positions
    if (
      !(
        keyLightRef.current &&
        fillLightRef.current &&
        backLightRef.current &&
        pointLightRef.current &&
        moonLightRef.current
      )
    )
      return

    const keyPos = sunPosition.position
    const radius = keyPos.length() // or use a fixed radius if you prefer

    // Key light: follows sun directly
    gsap.to(keyLightRef.current.position, {
      x: keyPos.x,
      y: keyPos.y,
      z: keyPos.z,
      duration: 4,
    })

    // Moon light: real position
    gsap.to(moonLightRef.current.position, {
      x: moonPosition.position.x,
      y: moonPosition.position.y,
      z: moonPosition.position.z,
      duration: 4,
    })

    // Moon intensity
    gsap.to(moonLightRef.current, {
      intensity: lighting.moonIntensity,
      duration: 4,
    })

    // Fill light: ~120° around Y axis, lower intensity in your material
    // Positioned opposite-ish to soften shadows
    tempVec.copy(keyPos)
    tempVec.y = 0 // project to XZ plane for rotation
    tempVec.applyAxisAngle(yAxis, degToRad(120))
    tempVec.y = keyPos.y * 0.25 // lower elevation than key
    tempVec.normalize().multiplyScalar(radius * 0.8)

    gsap.to(fillLightRef.current.position, {
      x: tempVec.x,
      y: tempVec.y,
      z: tempVec.z,
      duration: 4,
    })

    // Back light: ~200° around, higher up for rim lighting effect
    tempVec.copy(keyPos)
    tempVec.y = 0
    tempVec.applyAxisAngle(yAxis, degToRad(240))
    tempVec.y = keyPos.y * 0.5 // higher elevation
    tempVec.normalize().multiplyScalar(radius * 0.6)

    gsap.to(backLightRef.current.position, {
      x: tempVec.x,
      y: tempVec.y,
      z: tempVec.z,
      duration: 4,
    })

    gsap.to(pointLightRef.current, {
      intensity: sunPosition.altitude < 0 ? 25.5 : 0,
      duration: 4,
      delay: 2,
    })
  }, [sunPosition, moonPosition])

  useGSAP(() => {
    if (!(keyLightRef.current && fillLightRef.current && backLightRef.current)) return

    gsap.to(keyLightRef.current.color, {
      r: lighting.directionalColor.r,
      g: lighting.directionalColor.g,
      b: lighting.directionalColor.b,
      duration: 4,
    })
    gsap.to(fillLightRef.current.color, {
      r: lighting.directionalColor.r,
      g: lighting.directionalColor.g,
      b: lighting.directionalColor.b,
      duration: 4,
    })
    gsap.to(backLightRef.current.color, {
      r: lighting.directionalColor.r,
      g: lighting.directionalColor.g,
      b: lighting.directionalColor.b,
      duration: 4,
    })
  }, [lighting])

  return (
    <>
      {/* <Sky
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
      </sprite> */}

      {/* <Environment preset="city" /> */}

      <primitive
        material-uniforms-mieCoefficient-value={0.005}
        material-uniforms-mieDirectionalG-value={0.8}
        material-uniforms-rayleigh-value={0.5}
        material-uniforms-turbidity-value={10}
        object={sky}
        scale={1000}
      />
      {/* <Sky
        // azimuth={sunPosition.azimuth}
        // inclination={sunPosition.altitude}
        sunPosition={sunPosition.position}
      /> */}
      <pointLight
        castShadow
        distance={50}
        intensity={15.5}
        position={[0, 2.5, 0]}
        ref={pointLightRef}
      />

      <directionalLight
        castShadow
        intensity={2}
        position={[-3, 1, -3]} //lighting.directionalIntensity}
        ref={keyLightRef}
        shadow-bias={-0.000_05}
        shadow-camera-bottom={-40}
        shadow-camera-far={200}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight
        intensity={2}
        position={[3, 1, 3]} //lighting.directionalIntensity}
        ref={fillLightRef} //sunPosition.position}
      />
      <directionalLight
        intensity={1}
        position={[-3, 1, 3]} //lighting.directionalIntensity}
        ref={backLightRef} //sunPosition.position}
      />
      <directionalLight
        castShadow
        color="#b0c4de"
        intensity={0}
        position={[0, -100, 0]}
        ref={moonLightRef}
        shadow-bias={-0.000_05}
        shadow-camera-bottom={-40}
        shadow-camera-far={200}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-mapSize={[2048, 2048]}
      />
    </>
  )
})
