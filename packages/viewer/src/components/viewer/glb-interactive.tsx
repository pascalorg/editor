'use client'

import {
  type AnyNodeId,
  type Interactive,
  type LightEffect,
  pointInPolygon,
  type SceneGraph,
  type SliderControl,
  useInteractive,
} from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { createPortal, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type AnimationAction,
  LoopRepeat,
  MathUtils,
  type Object3D,
  type PointLight,
  Vector3,
} from 'three'
import { useShallow } from 'zustand/react/shallow'
import useViewer from '../../store/use-viewer'
import { ControlWidget } from '../../systems/interactive/control-widget'

/** An interactive item recovered from the scene graph so the baked GLB can be
 *  re-lit / re-animated by joining on `pascalId`. The GLB carries the geometry
 *  + identity; the effects + controls live in the DB scene graph (no sidecar). */
export type GlbInteractiveItem = {
  pascalId: AnyNodeId
  label: string
  /** Item height (world units) for placing the controls overlay above it. */
  height: number
  interactive: Interactive
}

/** A baked zone's identity node + its local floor polygon (from `extras`). */
export type GlbZoneRef = {
  id: string
  node: Object3D
  polygon: [number, number][]
}

/** Pull the interactive items out of a scene graph. Only items that actually
 *  carry effects (light / animation) are returned — everything else baked
 *  faithfully and needs no runtime help. */
export function buildGlbInteractiveItems(
  sceneGraph: SceneGraph | null | undefined,
): GlbInteractiveItem[] {
  const nodes = sceneGraph?.nodes
  if (!nodes) return []
  const items: GlbInteractiveItem[] = []
  for (const [id, raw] of Object.entries(nodes)) {
    const node = raw as {
      type?: string
      scale?: [number, number, number]
      asset?: { name?: string; dimensions?: [number, number, number]; interactive?: Interactive }
    }
    if (node?.type !== 'item') continue
    const interactive = node.asset?.interactive
    if (!interactive?.effects?.length) continue
    const dims = node.asset?.dimensions ?? [1, 1, 1]
    const scaleY = node.scale?.[1] ?? 1
    items.push({
      pascalId: id as AnyNodeId,
      label: node.asset?.name ?? id,
      height: (dims[1] ?? 1) * scaleY,
      interactive,
    })
  }
  return items
}

const _itemPos = new Vector3()

/**
 * Re-creates the item-driven interactivity the parametric viewer has — pooled
 * lights, ambient animation, and the controls overlay — on top of a baked GLB.
 * Effects come from the DB scene graph (`items`); world transforms come from the
 * baked Object3Ds (`identity`), joined on `pascalId`. Nothing is stamped into
 * the GLB itself, so the artifact stays integrator-clean.
 */
export function GlbInteractive({
  items,
  identity,
  zones,
  actions,
  levelOrder,
}: {
  items: GlbInteractiveItem[]
  identity: Map<string, Object3D>
  zones: GlbZoneRef[]
  /** Baked animation actions keyed by clip name — ambient item loops play from
   *  `<pascalId>: loop`. */
  actions: Record<string, AnimationAction | null>
  /** Level pascalIds bottom-to-top, so the light pool can prefer ground-floor
   *  lights when nothing is focused (mirrors the parametric level factor). */
  levelOrder: string[]
}) {
  // Seed control state for every interactive item. The viewer shows a baked
  // scene "lit": toggles default ON (the editor defaults them off) and sliders
  // to their authored default, so lamps glow and fans spin on load. Explicit
  // overlay toggles then win. Cleared on unmount so the global store never
  // carries state across scenes.
  useEffect(() => {
    const store = useInteractive.getState()
    for (const item of items) {
      store.initItem(item.pascalId, item.interactive)
      item.interactive.controls.forEach((control, i) => {
        if (control.kind === 'toggle') store.setControlValue(item.pascalId, i, true)
      })
    }
    return () => {
      const store = useInteractive.getState()
      for (const item of items) store.removeItem(item.pascalId)
    }
  }, [items])

  const animationItems = useMemo(
    () => items.filter((item) => item.interactive.effects.some((e) => e.kind === 'animation')),
    [items],
  )

  // Light registrations: one per item with a light effect, joined to its baked
  // node. Fed to a fixed pool (below) rather than mounting a light per item.
  const lightRegs = useMemo<GlbLightReg[]>(() => {
    const regs: GlbLightReg[] = []
    for (const item of items) {
      const effect = item.interactive.effects.find((e) => e.kind === 'light') as
        | LightEffect
        | undefined
      if (!effect) continue
      const object = identity.get(item.pascalId)
      if (!object) continue
      const controls = item.interactive.controls
      const toggleIndex = controls.findIndex((c) => c.kind === 'toggle')
      const sliderIndex = controls.findIndex((c) => c.kind === 'slider')
      const slider = sliderIndex >= 0 ? (controls[sliderIndex] as SliderControl) : null
      regs.push({
        key: item.pascalId,
        object,
        effect,
        toggleIndex,
        sliderIndex,
        hasSlider: !!slider,
        sliderMin: slider?.min ?? 0,
        sliderMax: slider?.max ?? 1,
        levelId: findLevelId(object),
      })
    }
    return regs
  }, [items, identity])
  const levelIndexById = useMemo(
    () => new Map(levelOrder.map((id, i) => [id, i] as const)),
    [levelOrder],
  )

  // Controls overlay is scoped to the focused zone (matches the parametric
  // viewer). Project the zone's baked-local polygon into world space once so an
  // item's world position can be point-tested regardless of level stacking.
  const focusedZoneId = useViewer((s) => s.selection.zoneId)
  const worldPolygon = useMemo<[number, number][] | null>(() => {
    if (!focusedZoneId) return null
    const zone = zones.find((z) => z.id === focusedZoneId)
    if (!zone) return null
    zone.node.updateWorldMatrix(true, false)
    return zone.polygon.map(([x, z]) => {
      const v = new Vector3(x, 0, z).applyMatrix4(zone.node.matrixWorld)
      return [v.x, v.z]
    })
  }, [focusedZoneId, zones])

  return (
    <>
      <GlbItemLights levelIndexById={levelIndexById} regs={lightRegs} />
      {animationItems.map((item) => (
        <GlbItemAnimation actions={actions} item={item} key={item.pascalId} />
      ))}
      {items.map((item) => {
        const object = identity.get(item.pascalId)
        return object ? (
          <GlbItemControls
            item={item}
            key={item.pascalId}
            object={object}
            worldPolygon={worldPolygon}
          />
        ) : null
      })}
    </>
  )
}

// ── Pooled item lights ──────────────────────────────────────────────────────
//
// Mirrors the parametric `ItemLightSystem`: a fixed pool of point lights is
// assigned to the nearest/most-visible lit items each tick (camera-proximity
// scored, with hysteresis), snapped to the item's world position + offset, and
// faded in/out on reassignment. Mounting a light per item instead would blow
// the renderer's light budget on a large house.

const POOL_SIZE = 12
const REASSIGN_INTERVAL = 0.2
const HYSTERESIS = 0.15
const CAM_MOVE_DIST = 0.5
const CAM_ROT_DOT = 0.995

type GlbLightReg = {
  key: AnyNodeId
  object: Object3D
  effect: LightEffect
  toggleIndex: number
  sliderIndex: number
  hasSlider: boolean
  sliderMin: number
  sliderMax: number
  levelId: string | null
}

type SlotRuntime = { key: string | null; pendingKey: string | null; isFadingOut: boolean }

const _camPos = new Vector3()
const _camFwd = new Vector3()
const _dir = new Vector3()
const _lightWorld = new Vector3()

/** The nearest level-identity ancestor's pascalId, for the level factor. */
function findLevelId(object: Object3D): string | null {
  let cur: Object3D | null = object
  while (cur) {
    const ud = cur.userData as { kind?: string; pascalId?: string }
    if (ud.kind === 'level' && ud.pascalId) return ud.pascalId
    cur = cur.parent
  }
  return null
}

function scoreReg(
  reg: GlbLightReg,
  selectedLevelId: string | null,
  levelMode: string,
  levelIndexById: Map<string, number>,
  interactiveState: ReturnType<typeof useInteractive.getState>,
): number {
  // Toggled-off lights contribute no illumination — drop them from the pool.
  if (reg.toggleIndex >= 0 && !interactiveState.items[reg.key]?.controlValues?.[reg.toggleIndex]) {
    return Number.POSITIVE_INFINITY
  }
  reg.object.getWorldPosition(_lightWorld)
  _lightWorld.x += reg.effect.offset[0]
  _lightWorld.y += reg.effect.offset[1]
  _lightWorld.z += reg.effect.offset[2]
  _dir.copy(_lightWorld).sub(_camPos).normalize()
  const angular = 1 - _camFwd.dot(_dir)
  const dist = _camPos.distanceTo(_lightWorld) / 200
  let levelPenalty = 0
  if (selectedLevelId) {
    if (reg.levelId !== selectedLevelId) levelPenalty = levelMode === 'solo' ? 100 : 0.8
  } else if (reg.levelId && (levelIndexById.get(reg.levelId) ?? 0) !== 0) {
    levelPenalty = 0.3
  }
  return angular * 0.7 + dist * 0.3 + levelPenalty
}

function GlbItemLights({
  regs,
  levelIndexById,
}: {
  regs: GlbLightReg[]
  levelIndexById: Map<string, number>
}) {
  const lightRefs = useRef<Array<PointLight | null>>(Array.from({ length: POOL_SIZE }, () => null))
  const slots = useRef<SlotRuntime[]>(
    Array.from({ length: POOL_SIZE }, () => ({ key: null, pendingKey: null, isFadingOut: false })),
  )
  const reassignTimer = useRef(0)
  const prevCamPos = useRef(new Vector3())
  const prevCamFwd = useRef(new Vector3(0, 0, -1))
  const regByKey = useMemo(() => new Map(regs.map((r) => [r.key as string, r])), [regs])

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1)
    const interactiveState = useInteractive.getState()
    camera.getWorldPosition(_camPos)
    camera.getWorldDirection(_camFwd)

    const camMoved =
      _camPos.distanceTo(prevCamPos.current) > CAM_MOVE_DIST ||
      _camFwd.dot(prevCamFwd.current) < CAM_ROT_DOT
    reassignTimer.current -= delta

    if (reassignTimer.current <= 0 || camMoved) {
      reassignTimer.current = REASSIGN_INTERVAL
      prevCamPos.current.copy(_camPos)
      prevCamFwd.current.copy(_camFwd)
      const viewer = useViewer.getState()
      const selectedLevelId = viewer.selection.levelId
      const levelMode = viewer.levelMode

      const scored = regs.map((reg) => ({
        key: reg.key as string,
        score: scoreReg(reg, selectedLevelId, levelMode, levelIndexById, interactiveState),
      }))
      scored.sort((a, b) => a.score - b.score)
      const scoreByKey = new Map(scored.map((s) => [s.key, s.score] as const))
      const desired = scored
        .filter((s) => Number.isFinite(s.score))
        .slice(0, POOL_SIZE)
        .map((s) => s.key)

      const currentlyAssigned = new Map<string, number>()
      for (let i = 0; i < POOL_SIZE; i++) {
        const s = slots.current[i]
        const k = s?.key ?? s?.pendingKey
        if (k) currentlyAssigned.set(k, i)
      }

      const usedSlots = new Set<number>()
      const assignedKeys = new Set<string>()
      // Pass 1: keep existing slots whose key is still wanted.
      for (const key of desired) {
        const existingSlot = currentlyAssigned.get(key)
        if (existingSlot !== undefined && !usedSlots.has(existingSlot)) {
          usedSlots.add(existingSlot)
          assignedKeys.add(key)
        }
      }
      // Pass 2: assign the rest to free slots, evicting only on a clear win.
      let freeSlot = 0
      for (const key of desired) {
        if (assignedKeys.has(key)) continue
        while (freeSlot < POOL_SIZE && usedSlots.has(freeSlot)) freeSlot++
        if (freeSlot >= POOL_SIZE) break

        const freeSlotData = slots.current[freeSlot]
        const currentKey = freeSlotData ? (freeSlotData.key ?? freeSlotData.pendingKey) : null
        if (currentKey && !desired.includes(currentKey)) {
          const currentScore = scoreByKey.get(currentKey) ?? Number.POSITIVE_INFINITY
          const newScore = scoreByKey.get(key) ?? 0
          if (currentScore - newScore < HYSTERESIS) {
            freeSlot++
            continue
          }
        }

        usedSlots.add(freeSlot)
        assignedKeys.add(key)
        const slot = slots.current[freeSlot]
        if (slot && slot.key !== key) {
          slot.pendingKey = key
          slot.isFadingOut = slot.key !== null
          if (!slot.isFadingOut) {
            slot.key = key
            slot.pendingKey = null
            const light = lightRefs.current[freeSlot]
            const reg = regByKey.get(key)
            if (light && reg) {
              light.color.set(reg.effect.color)
              light.distance = reg.effect.distance ?? 0
            }
          }
        }
        freeSlot++
      }

      // Retire slots whose key is no longer wanted.
      for (let i = 0; i < POOL_SIZE; i++) {
        if (!usedSlots.has(i)) {
          const slot = slots.current[i]
          if (slot?.key && !desired.includes(slot.key)) {
            slot.pendingKey = null
            slot.isFadingOut = true
          }
        }
      }
    }

    // Per-frame: fade, snap position, and track intensity from control state.
    // The pool lights stay permanently `visible` — only `intensity` is animated
    // (an idle light just lerps to 0). Toggling `visible` would change the
    // active-light count, which forces the WebGPU renderer to recompile every
    // material's lighting node — a hard frame-time spike on every reassignment
    // (i.e. on every camera move). Keeping the count fixed avoids that entirely.
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = lightRefs.current[i]
      const slot = slots.current[i]
      if (!(light && slot)) continue

      if (slot.isFadingOut) {
        light.intensity = MathUtils.lerp(light.intensity, 0, dt * 12)
        if (light.intensity < 0.01) {
          light.intensity = 0
          slot.isFadingOut = false
          slot.key = slot.pendingKey
          slot.pendingKey = null
          if (slot.key) {
            const reg = regByKey.get(slot.key)
            if (reg) {
              light.color.set(reg.effect.color)
              light.distance = reg.effect.distance ?? 0
            }
          }
        }
        continue
      }

      if (!slot.key) {
        light.intensity = MathUtils.lerp(light.intensity, 0, dt * 12)
        continue
      }
      const reg = regByKey.get(slot.key)
      if (!reg) {
        slot.key = null
        continue
      }

      reg.object.getWorldPosition(_lightWorld)
      light.position.set(
        _lightWorld.x + reg.effect.offset[0],
        _lightWorld.y + reg.effect.offset[1],
        _lightWorld.z + reg.effect.offset[2],
      )

      const values = interactiveState.items[reg.key]?.controlValues
      const isOn = reg.toggleIndex >= 0 ? Boolean(values?.[reg.toggleIndex]) : true
      let t = 1
      if (reg.hasSlider) {
        const raw = (values?.[reg.sliderIndex] as number) ?? reg.sliderMin
        t =
          reg.sliderMax > reg.sliderMin
            ? (raw - reg.sliderMin) / (reg.sliderMax - reg.sliderMin)
            : 1
      }
      const targetIntensity = isOn
        ? MathUtils.lerp(reg.effect.intensityRange[0], reg.effect.intensityRange[1], t)
        : reg.effect.intensityRange[0]
      light.intensity = MathUtils.lerp(light.intensity, targetIntensity, dt * 12)
    }
  })

  return (
    <>
      {Array.from({ length: POOL_SIZE }, (_, i) => (
        <pointLight
          castShadow={false}
          intensity={0}
          key={i}
          ref={(el) => {
            lightRefs.current[i] = el
          }}
        />
      ))}
    </>
  )
}

/** Plays an item's baked ambient loop (a fan's spin), gated on its toggle.
 *  The clip and its targets are already in the GLB; we only start/stop it. */
function GlbItemAnimation({
  item,
  actions,
}: {
  item: GlbInteractiveItem
  actions: Record<string, AnimationAction | null>
}) {
  const values = useInteractive(useShallow((s) => s.items[item.pascalId]?.controlValues))
  const toggleIndex = item.interactive.controls.findIndex((c) => c.kind === 'toggle')
  const isOn = toggleIndex >= 0 ? Boolean(values?.[toggleIndex] ?? true) : true

  useEffect(() => {
    const action = actions[`${item.pascalId}: loop`]
    if (!action) return
    action.loop = LoopRepeat
    action.clampWhenFinished = false
    if (isOn) {
      action.enabled = true
      action.paused = false
      if (!action.isRunning()) action.play()
    } else {
      action.stop()
    }
  }, [actions, item.pascalId, isOn])

  return null
}

const FADE_MS = 300

/** Controls overlay for one item — fades in while the item sits inside the
 *  focused zone, portaled above the baked node. */
function GlbItemControls({
  item,
  object,
  worldPolygon,
}: {
  item: GlbInteractiveItem
  object: Object3D
  worldPolygon: [number, number][] | null
}) {
  const controlValues = useInteractive(useShallow((s) => s.items[item.pascalId]?.controlValues))
  const setControlValue = useInteractive((s) => s.setControlValue)

  let visible = false
  if (worldPolygon?.length) {
    object.getWorldPosition(_itemPos)
    visible = pointInPolygon(_itemPos.x, _itemPos.z, worldPolygon)
  }

  // Fade in on mount and fade out before unmounting the <Html>.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (visible) {
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    const timeout = setTimeout(() => setMounted(false), FADE_MS)
    return () => clearTimeout(timeout)
  }, [visible])

  if (!(mounted && controlValues)) return null

  return createPortal(
    <Html
      center
      distanceFactor={8}
      eps={-1}
      position={[0, item.height + 0.3, 0]}
      zIndexRange={[20, 0]}
    >
      {/* Stop pointer/click events from reaching the canvas — otherwise R3F's
          pointer-missed fires and deselects the zone the moment you toggle. */}
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          borderRadius: 8,
          padding: '8px 12px',
          minWidth: 120,
          pointerEvents: visible ? 'auto' : 'none',
          userSelect: 'none',
          opacity: shown ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
        }}
      >
        {item.interactive.controls.map((control, i) => (
          <ControlWidget
            control={control}
            key={i}
            onChange={(v) => setControlValue(item.pascalId, i, v)}
            value={controlValues[i] ?? false}
          />
        ))}
      </div>
    </Html>,
    object,
  )
}
