'use client'

import { useInteractive, useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BackSide, Color, MathUtils, Mesh, Scene, SphereGeometry, Vector3 } from 'three'
import { pmremTexture, positionWorldDirection, vec3 } from 'three/tsl'
import {
  MeshBasicNodeMaterial,
  PMREMGenerator,
  type RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'
import { resolveLocation } from '../../lib/daylight/location'
import type { DaylightAtmosphereSource } from '../../lib/daylight/look'
import { installDaylightMaterialHooks } from '../../lib/daylight/material-hooks'
import { restoreLampEmitters } from '../../lib/daylight/room-scene'
import { daylightRooms } from '../../lib/daylight/rooms'
import { daylightUniforms, setDaylightRenderer } from '../../lib/daylight/runtime'
import { createDaylightSky, WEATHER_COVER } from '../../lib/daylight/sky'
import {
  presetInstant,
  type SolarLight,
  solarClockInstant,
  solarLight,
} from '../../lib/daylight/solar'
import useViewer, { type RenderQuality } from '../../store/use-viewer'
import { SceneAtmosphere } from './scene-atmosphere'
import { useDaylightRooms } from './use-daylight-rooms'

/** Irradiance that renders at exposure 1 (≈ a clear afternoon exterior). */
const METER_REF = 3.2
/** Image-based lighting gain on the sky environment. */
const ENV_INTENSITY = 1.15
const MOON_COLOR = new Color('#9fb4ff')
/** Ground fog range (m), capped by the camera's far plane (the grounds add a horizon haze). */
const FOG_START = 250
const FOG_END = 2600
/** Eye-like chromatic adaptation strength (0 = off, 1 = full neutralisation). */
const WHITE_BALANCE = 0.75
/**
 * How much of its extra exposure lamp light seen from outside gives back, relative to the rooms'
 * indoor exposure (0 none … 1 all; a little is kept, so lit windows still read as glowing).
 */
const LAMP_VIEW_COMP = 0.8
/** Maximum metered exposure boost with the camera inside a room. */
const INTERIOR_EV = 2
/** Sun shadow map per quality tier. */
const SHADOW_MAP: Record<RenderQuality, number> = { high: 4096, medium: 2048, low: 1024 }
/** EON rough diffuse per quality tier. */
const EON: Record<RenderQuality, number> = { high: 0.6, medium: 0.6, low: 0 }
const luminance = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

type SiteFacts = {
  parcel?: { originLngLat?: readonly [number, number] | null } | null
  dossier?: { point?: { lat?: number; lng?: number } | null } | null
  northRotation?: number
}

/** Cosine-weighted hemisphere probes for the sky irradiance colour. */
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
const UP = new Vector3(0, 1, 0)

/**
 * The colored appearance's built-in sun and sky: real sun position for the site (or a fallback
 * location), a time-of-day preset and a weather preset. One shadowed key (the sun, or a cool moon
 * at night), the sky as a PMREM environment, metered exposure and eye-like white balance.
 * Installed through the generic `SceneAtmosphere` seam, so a plugin atmosphere mounted later
 * still takes precedence.
 */
export function DaylightAtmosphere() {
  const renderer = useThree((s) => s.gl) as unknown as WebGPURenderer
  const timeOfDay = useViewer((s) => s.timeOfDay)
  const timeOfDayMinutes = useViewer((s) => s.timeOfDayMinutes)
  const skyLive = useViewer((s) => s.skyLive)
  const weather = useViewer((s) => s.weather)
  const deviceLocation = useViewer((s) => s.deviceLocation)
  const transparent = useViewer((s) => s.transparentBackground)
  const quality = useViewer((s) => s.renderQuality)
  const site = useScene((state) => {
    for (const id of state.rootNodeIds) {
      const node = state.nodes[id]
      if (node?.type === 'site') return node as unknown as SiteFacts
    }
    return undefined
  })

  const sky = useMemo(() => createDaylightSky(), [])
  // The environment: a PMREM of the visible sky (clouds and aureole, no sun disc — the key light
  // is the sun), re-captured into the same target when the sun or the weather changes, so the
  // environment node installed once stays valid.
  const environment = useMemo(() => {
    const scene = new Scene()
    const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false })
    material.colorNode = sky.skyRadiance(positionWorldDirection, { disc: false })
    // Radiance, not an unlit surface: it keeps the exposure (see the material hooks).
    material.userData.daylightSky = true
    const dome = new Mesh(new SphereGeometry(10, 48, 24), material)
    scene.add(dome)
    // The viewer mounts its scene once the GPU renderer is initialized; anything else (a test
    // double) renders without the sky environment.
    const ready = (renderer as { hasInitialized?: () => boolean }).hasInitialized?.() === true
    if (!ready) return { dome, pmrem: null, target: null, capture: () => {} }
    const pmrem = new PMREMGenerator(renderer)
    const capture = (into: RenderTarget | null) =>
      pmrem.fromScene(scene, 0, 0.1, 100, {
        size: 256,
        renderTarget: into,
      } as never) as RenderTarget
    const target = capture(null)
    return { dome, pmrem, target, capture: () => capture(target) }
  }, [renderer, sky])
  const source = useMemo<DaylightAtmosphereSource>(
    () => ({
      skyRadiance: (dir) => sky.skyRadiance(dir),
      reflectionRadiance: (dir) => sky.skyRadiance(dir, { disc: false }).mul(ENV_INTENSITY),
      // Just above the horizon in the view's heading: what the ground fog and the backdrop meet at.
      fogRadiance: (dir) => sky.skyRadiance(vec3(dir.x, 0.004, dir.z), { disc: false }),
      environmentNode: (environment.target
        ? pmremTexture(environment.target.texture).mul(ENV_INTENSITY)
        : vec3(0)) as any,
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
      shadow: { mapSize: SHADOW_MAP.high, bias: -0.0002, normalBias: 0.035, radius: 2 },
      elevation: 45,
    }),
    [environment, sky],
  )

  const solar = useRef<SolarLight | null>(null)
  const meter = useRef({ ev: 0, keyE: 0, night: 0, skyLum: 0, outdoor: new Color(1, 1, 1) })
  const wbTarget = useMemo(() => new Vector3(1, 1, 1), [])
  useDaylightRooms()

  // Materials attach their daylight hooks for this renderer only (thumbnail canvases elsewhere
  // keep their plain look); the uniforms go back to neutral when the look leaves.
  useLayoutEffect(() => {
    installDaylightMaterialHooks()
    setDaylightRenderer(renderer, true)
    daylightUniforms.albedoClamp.value = 1
    return () => {
      restoreLampEmitters()
      setDaylightRenderer(renderer, false)
      daylightUniforms.albedoClamp.value = 0
      daylightUniforms.eon.value = 0
      daylightUniforms.lampLevel.value = 0
      daylightUniforms.glowComp.value = 1
      daylightUniforms.emitterExpInv.value = 1
      daylightRooms.lampView.value = 1
    }
  }, [renderer])

  useEffect(() => {
    daylightUniforms.eon.value = EON[quality]
    source.shadow.mapSize = SHADOW_MAP[quality]
    // The Low tier drops the soft room map (openings) and the sky patch.
    daylightRooms.softRooms.value = quality === 'low' ? 0 : 1
    daylightRooms.skyPatch.value = quality === 'low' ? 0 : 3
    daylightRooms.refresh()
  }, [quality, source])

  // The live sky moves on with the clock, a minute at a time.
  const [clockTick, setClockTick] = useState(0)
  useEffect(() => {
    if (!skyLive || transparent) return
    const timer = setInterval(() => setClockTick((tick) => tick + 1), 60_000)
    return () => clearInterval(timer)
  }, [skyLive, transparent])

  // Lamp switches follow the sun only when it crosses into or out of the evening, so the
  // person's own switches survive weather changes and the live clock's ticks.
  const lampsLit = useRef<boolean | null>(null)

  // Sun, sky and lights follow the time of day: the live clock, an exact time, or a preset
  // (pinned to a neutral fair midday for transparent captures).
  // biome-ignore lint/correctness/useExhaustiveDependencies: clockTick re-runs the live sky.
  useEffect(() => {
    const cover = transparent ? WEATHER_COVER.fair : WEATHER_COVER[weather]
    const { location } = resolveLocation(site, deviceLocation)
    const today = new Date()
    const when = transparent
      ? presetInstant(today, location.lat, location.lng, 'midday')
      : skyLive
        ? today
        : timeOfDayMinutes !== null
          ? solarClockInstant(today, location.lng, timeOfDayMinutes)
          : presetInstant(today, location.lat, location.lng, timeOfDay)
    const sun = solarLight(
      when,
      location.lat,
      location.lng,
      site?.northRotation ?? 0,
      solar.current ?? undefined,
    )
    solar.current = sun
    sky.update(sun, cover)
    source.elevation = sun.elevation

    // One key light: the sun, or below 1° a cool, dim moon high on the other side of the sky.
    // Clouds dim the sun statistically (no cloud shadows) and soften its shadows.
    if (sun.elevation < 1) {
      source.sunDirection
        .set(-sun.direction.x, Math.max(0.5, Math.abs(sun.direction.y)), -sun.direction.z)
        .normalize()
      source.sunColor.copy(MOON_COLOR)
      source.sunIntensity = 0.18 * sun.night
    } else {
      source.sunDirection.copy(sun.direction)
      source.sunColor.copy(sun.color)
      source.sunIntensity = 3.4 * sun.strength * (1 - 0.5 * cover ** 1.6)
    }
    source.moonIntensity = 0
    source.shadow.radius = 1.6 + 2.2 * (1 - MathUtils.smoothstep(sun.elevation, 2, 30)) + cover * 3
    meter.current.keyE = source.sunIntensity * Math.max(0.15, sun.direction.y)
    meter.current.night = sun.night

    // The outdoor illuminant (sky irradiance + the key light), for the white balance.
    const skyIrr = new Color(0, 0, 0)
    let weight = 0
    for (const d of HEMISPHERE) {
      skyIrr.add(sky.radianceCpu(d).multiplyScalar(d.y))
      weight += d.y
    }
    skyIrr.multiplyScalar((Math.PI / weight) * ENV_INTENSITY)
    source.skyColor.copy(skyIrr).multiplyScalar(1 / Math.PI)
    meter.current.skyLum = luminance(skyIrr)
    meter.current.outdoor
      .copy(skyIrr)
      .add(source.sunColor.clone().multiplyScalar(meter.current.keyE))

    // Windows let this sky (and sun) into the rooms.
    daylightRooms.updateSky(
      (dir) => sky.radianceCpu(dir).multiplyScalar(ENV_INTENSITY),
      sun.direction,
      sun.color,
      source.sunIntensity,
    )

    // Lamps follow the light: a smooth level for the room lamps, on/off for the lamp switches.
    daylightUniforms.lampLevel.value = 1 - MathUtils.smoothstep(sun.elevation, -5, 6)
    // Blue hour and night (the presets aim at −4° and −14°; golden hour at +6° stays unlit).
    const lit = sun.elevation < -2
    if (lit !== lampsLit.current) {
      lampsLit.current = lit
      useInteractive.getState().setLampDefault(lit, true)
    }

    // Re-capture the sky environment.
    environment.capture()
  }, [
    clockTick,
    deviceLocation,
    environment,
    site,
    skyLive,
    sky,
    source,
    timeOfDay,
    timeOfDayMinutes,
    transparent,
    weather,
  ])

  // Lamps loaded after the preset applied (items mount late, and an authored "on" default would
  // light them by day) join the time of day; the person's own switches are left alone after.
  useEffect(() => {
    const known = new Set(Object.keys(useInteractive.getState().lampItems))
    return useInteractive.subscribe((state) => {
      // A lamp that leaves (its item unmounts) is new again when it comes back.
      for (const id of known) if (!(id in state.lampItems)) known.delete(id)
      for (const [id, indices] of Object.entries(state.lampItems)) {
        if (known.has(id)) continue
        known.add(id)
        for (const index of indices) {
          if (
            state.items[id as keyof typeof state.items]?.controlValues[index] !== state.lampDefault
          )
            state.setControlValue(id as never, index, state.lampDefault)
        }
      }
    })
  }, [])

  useEffect(
    () => () => {
      environment.target?.dispose()
      environment.pmrem?.dispose()
      environment.dome.geometry.dispose()
      ;(environment.dome.material as MeshBasicNodeMaterial).dispose()
    },
    [environment],
  )

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1)
    // The ground must be fully fogged before the far plane clips it (no hard horizon line).
    source.fogEnd = Math.min(FOG_END, camera.far * 0.9)
    source.fogStart = Math.min(FOG_START, source.fogEnd * 0.1)
    ;(sky.cloudTime.value as number) += dt
    // Metered exposure: the irradiance where the camera stands — outside: sun + sky; inside a
    // room: its windows + bounce + lamps — exposed towards mid-grey with partial adaptation (dark
    // scenes stay a bit dark), up to +2 EV indoors.
    const { room, inside } = daylightRooms.isEnclosedAt(camera.position)
    daylightUniforms.cameraOutside.value = inside ? 0 : 1
    const skyE = Math.PI * 0.45 * luminance(sky.radianceCpu(UP)) * ENV_INTENSITY
    // Outside, the lit rooms in view count too: a cutaway of lamplit rooms exposes for them.
    const viewed = inside
      ? { sceneE: daylightRooms.meter(room, skyE), roomsE: 0, illuminant: null }
      : daylightRooms.viewedMeter(
          camera,
          meter.current.keyE + skyE,
          skyE,
          meter.current.outdoor,
          meter.current.skyLum,
        )
    const meterEV = (E: number, max: number) =>
      MathUtils.clamp(Math.log2(METER_REF / Math.max(E, 1e-4)) * 0.6, -0.5, max)
    const target = meterEV(viewed.sceneE, inside ? INTERIOR_EV : 2.2)
    meter.current.ev += (target - meter.current.ev) * Math.min(1, dt * 3)
    source.exposure = 2 ** meter.current.ev
    // Glows (window panes, lamp shades) stay out of the night exposure lift.
    daylightUniforms.glowComp.value = 1 / 2 ** Math.max(0, meter.current.ev - 0.5)
    daylightUniforms.emitterExpInv.value = 1 / source.exposure
    // Lamp light seen from outside gives back most of the exposure it gets above what those rooms
    // meter at from inside (back to 1 indoors), so lit rooms look from out there as they do in them.
    const lampView =
      inside || viewed.roomsE <= 0
        ? 1
        : 2 **
          (-LAMP_VIEW_COMP * Math.max(0, meter.current.ev - meterEV(viewed.roomsE, INTERIOR_EV)))
    const shown = daylightRooms.lampView.value as number
    daylightRooms.lampView.value = shown + (lampView - shown) * Math.min(1, dt * 3)
    // Eye-like chromatic adaptation (von Kries): divide out the illuminant where the camera is,
    // partially (golden hour and lamplight keep some warmth), luminance-preserving; a bit less
    // at night (moonlight stays blue-ish).
    // Outside, the eye adapts towards the lit rooms in view too (by their pull on the meter).
    const illum =
      (inside
        ? daylightRooms.roomIlluminant(room, meter.current.outdoor, meter.current.skyLum)
        : viewed.illuminant) ?? meter.current.outdoor
    const L = luminance(illum)
    if (L > 1e-5) {
      const k = WHITE_BALANCE * (1 - 0.35 * meter.current.night)
      wbTarget.set(
        MathUtils.lerp(1, L / Math.max(illum.r, 1e-4), k),
        MathUtils.lerp(1, L / Math.max(illum.g, 1e-4), k),
        MathUtils.lerp(1, L / Math.max(illum.b, 1e-4), k),
      )
      wbTarget.clampScalar(0.5, 2)
      wbTarget.divideScalar(0.2126 * wbTarget.x + 0.7152 * wbTarget.y + 0.0722 * wbTarget.z)
    }
    source.whiteBalance.lerp(wbTarget, Math.min(1, dt * 2))
  }, -2)

  return <SceneAtmosphere source={source} />
}
