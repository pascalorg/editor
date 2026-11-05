'use client'

import { useInteractive, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, MathUtils, Vector3 } from 'three'
import { mix, uniform, vec3 } from 'three/tsl'
import { DaylightEnvironmentNode } from '../../lib/daylight/environment-node'
import { resolveLocation } from '../../lib/daylight/location'
import type { DaylightAtmosphereSource } from '../../lib/daylight/look'
import { createDaylightSky, WEATHER_COVER } from '../../lib/daylight/sky'
import { presetInstant, type SolarLight, solarLight } from '../../lib/daylight/solar'
import useViewer from '../../store/use-viewer'
import { SceneAtmosphere } from './scene-atmosphere'

/** Irradiance that renders at exposure 1 (≈ a clear afternoon exterior). */
const METER_REF = 3.2
/** Sky radiance → irradiance scale for the image-based lighting. */
const SKY_GAIN = 1.15
const MOON_COLOR = new Color('#9fb4ff')
/** Ground fog range (m), capped by the camera's far plane (the grounds add a horizon haze). */
const FOG_START = 250
const FOG_END = 2600
const luminance = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

type SiteFacts = {
  parcel?: { originLngLat?: readonly [number, number] | null } | null
  dossier?: { point?: { lat?: number; lng?: number } | null } | null
  northRotation?: number
}

const HEMISPHERE = [
  new Vector3(0, 1, 0),
  ...Array.from({ length: 6 }, (_, i) =>
    new Vector3(Math.cos((i * Math.PI) / 3), 0.6, Math.sin((i * Math.PI) / 3)).normalize(),
  ),
  ...Array.from({ length: 6 }, (_, i) =>
    new Vector3(
      Math.cos((i * Math.PI) / 3 + 0.5),
      0.15,
      Math.sin((i * Math.PI) / 3 + 0.5),
    ).normalize(),
  ),
]

/**
 * The colored appearance's built-in sun and sky: real sun position for the site (or a fallback
 * location), a time-of-day preset and a weather preset. Installed through the generic
 * `SceneAtmosphere` seam, so a plugin atmosphere mounted later still takes precedence.
 */
export function DaylightAtmosphere() {
  const timeOfDay = useViewer((s) => s.timeOfDay)
  const weather = useViewer((s) => s.weather)
  const deviceLocation = useViewer((s) => s.deviceLocation)
  const transparent = useViewer((s) => s.transparentBackground)
  // Solid shading is Lambert, which ignores image-based lighting: the sky reaches it as a
  // hemisphere light instead (rendered shading gets the sky through the environment).
  const solid = useViewer((s) => s.shading === 'solid')
  const site = useScene((state) => {
    for (const id of state.rootNodeIds) {
      const node = state.nodes[id]
      if (node?.type === 'site') return node as unknown as SiteFacts
    }
    return undefined
  })

  const sky = useMemo(() => createDaylightSky(), [])
  const skyAverage = useMemo(() => uniform(new Color(0.5, 0.6, 0.7)), [])
  const source = useMemo<DaylightAtmosphereSource>(() => {
    const light = (dir: any) => sky.lightRadiance(dir).mul(SKY_GAIN)
    const diffuse = (dir: any) => mix(light(dir), skyAverage, 0.4)
    return {
      skyRadiance: (dir) => sky.skyRadiance(dir),
      reflectionRadiance: (dir) => light(dir),
      // Just above the horizon in the view's heading: what the ground fog and the backdrop meet at.
      fogRadiance: (dir) => sky.lightRadiance(vec3(dir.x, 0.004, dir.z)),
      environmentNode: new DaylightEnvironmentNode(light, diffuse) as any,
      sunDirection: new Vector3(0, 1, 0),
      sunColor: new Color(1, 1, 1),
      sunIntensity: 3,
      moonDirection: new Vector3(0, 1, 0),
      moonColor: MOON_COLOR.clone(),
      moonIntensity: 0,
      skyColor: new Color(1, 1, 1),
      groundColor: new Color(0.5, 0.5, 0.5),
      hemisphereIntensity: 0,
      ambientIntensity: 0,
      exposure: 1,
      fogStart: FOG_START,
      fogEnd: FOG_END,
      whiteBalance: new Vector3(1, 1, 1),
    }
  }, [sky, skyAverage])

  const solar = useRef<SolarLight | null>(null)
  const meter = useRef({ ev: 0, sunE: 0, night: 0 })
  const wbTarget = useMemo(() => new Vector3(1, 1, 1), [])

  // Sun, sky and lights follow the presets (pinned to a neutral fair midday for transparent captures).
  useEffect(() => {
    const preset = transparent ? 'midday' : timeOfDay
    const cover = transparent ? WEATHER_COVER.fair : WEATHER_COVER[weather]
    const { location } = resolveLocation(site, deviceLocation)
    const when = presetInstant(new Date(), location.lat, location.lng, preset)
    const sun = solarLight(
      when,
      location.lat,
      location.lng,
      site?.northRotation ?? 0,
      solar.current ?? undefined,
    )
    solar.current = sun
    sky.update(sun, cover)

    source.sunDirection.copy(sun.direction)
    source.sunColor.copy(sun.color)
    // Clouds dim the disc statistically (no cloud shadows).
    source.sunIntensity = 3.4 * sun.strength * (1 - 0.5 * cover ** 1.6)
    // Night key: a cool, dim moon high on the other side of the sky.
    source.moonDirection
      .set(-sun.direction.x, Math.max(0.5, Math.abs(sun.direction.y)), -sun.direction.z)
      .normalize()
    source.moonIntensity = 0.18 * sun.night

    // Sky irradiance colour (for diffuse lighting + meters).
    const avg = new Color(0, 0, 0)
    let weight = 0
    for (const d of HEMISPHERE) {
      avg.add(sky.radianceCpu(d).multiplyScalar(d.y))
      weight += d.y
    }
    avg.multiplyScalar((1 / weight) * SKY_GAIN)
    ;(skyAverage.value as Color).copy(avg)
    source.skyColor.copy(avg)
    source.groundColor.copy(avg).multiplyScalar(0.35)
    source.hemisphereIntensity = solid ? Math.PI : 0
    meter.current.sunE =
      source.sunIntensity * Math.max(0.15, sun.direction.y) + source.moonIntensity * 0.5
    meter.current.night = sun.night

    // White balance target: divide out the illuminant (sun + sky), partially, luminance-preserving.
    const illum = avg
      .clone()
      .multiplyScalar(Math.PI)
      .add(sun.color.clone().multiplyScalar(meter.current.sunE))
    const L = Math.max(luminance(illum), 1e-5)
    const k = 0.75 * (1 - 0.35 * sun.night)
    wbTarget.set(
      MathUtils.lerp(1, L / Math.max(illum.r, 1e-4), k),
      MathUtils.lerp(1, L / Math.max(illum.g, 1e-4), k),
      MathUtils.lerp(1, L / Math.max(illum.b, 1e-4), k),
    )
    wbTarget.clampScalar(0.5, 2)
    wbTarget.divideScalar(0.2126 * wbTarget.x + 0.7152 * wbTarget.y + 0.0722 * wbTarget.z)

    // Lamps follow the light: on from blue hour.
    useInteractive.getState().setLampDefault(preset === 'blue' || preset === 'night', true)
  }, [
    deviceLocation,
    site,
    sky,
    skyAverage,
    solid,
    source,
    timeOfDay,
    transparent,
    weather,
    wbTarget,
  ])

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1)
    // The ground must be fully fogged before the far plane clips it (no hard horizon line).
    source.fogEnd = Math.min(FOG_END, camera.far * 0.9)
    source.fogStart = Math.min(FOG_START, source.fogEnd * 0.1)
    ;(sky.cloudTime.value as number) += dt
    // Metered exposure: expose the scene's irradiance towards mid-grey with partial adaptation.
    const skyE =
      Math.PI *
      0.45 *
      luminance((skyAverage.value as Color).clone().multiplyScalar(1 / SKY_GAIN)) *
      SKY_GAIN
    const sceneE = meter.current.sunE + skyE
    const target = MathUtils.clamp(Math.log2(METER_REF / Math.max(sceneE, 1e-4)) * 0.6, -0.5, 2.2)
    meter.current.ev += (target - meter.current.ev) * Math.min(1, dt * 3)
    source.exposure = 2 ** meter.current.ev
    source.whiteBalance.lerp(wbTarget, Math.min(1, dt * 2))
  }, -2)

  return <SceneAtmosphere source={source} />
}
