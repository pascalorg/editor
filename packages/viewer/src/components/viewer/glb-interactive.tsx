'use client'

import {
  type AnyNodeId,
  type Interactive,
  pointInPolygon,
  type SceneGraph,
  type SliderControl,
  useInteractive,
} from '@pascal-app/core'
import {
  type EvaluatedLight,
  evaluateRecipe,
  type ProceduralItemNode,
} from '@pascal-app/core/procedural-items'
import { Html } from '@react-three/drei'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  type AnimationAction,
  LoopRepeat,
  MathUtils,
  type Object3D,
  type PointLight,
  Vector3,
} from 'three'
import { useShallow } from 'zustand/react/shallow'
import { SCENE_LAYER } from '../../lib/layers'
import {
  decorateProceduralEmission,
  proceduralSlotMeshes,
  setProceduralEmission,
} from '../../lib/procedural-emission'
import { useItemLightPool } from '../../store/use-item-light-pool'
import useViewer from '../../store/use-viewer'
import { ControlWidget } from '../../systems/interactive/control-widget'
import { proceduralControlDescriptors } from '../../systems/interactive/procedural-controls'

/** An interactive item recovered from the scene graph so the baked GLB can be
 *  re-lit / re-animated by joining on `pascalId`. The GLB carries the geometry
 *  + identity; the effects + controls live in the DB scene graph (no sidecar). */
export type GlbInteractiveItem = {
  pascalId: AnyNodeId
  label: string
  /** Item height (world units) for placing the controls overlay above it. */
  height: number
  interactive: Interactive
  procedural?: { lights: EvaluatedLight[]; parts: ProceduralItemNode['recipe']['parts'] }
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
    if (node?.type === 'procedural-item') {
      const procedural = raw as ProceduralItemNode
      const evaluation = evaluateRecipe(procedural.recipe, procedural.parameters)
      if (!evaluation.lights.length && !evaluation.motions.length) continue
      items.push({
        pascalId: id as AnyNodeId,
        label: procedural.name ?? id,
        height: evaluation.max[1],
        interactive: { controls: [], effects: [] },
        procedural: { lights: evaluation.lights, parts: procedural.recipe.parts },
      })
      continue
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

export function buildGlbLightRegs(
  items: GlbInteractiveItem[],
  identity: Map<string, Object3D>,
): GlbLightReg[] {
  const regs: GlbLightReg[] = []
  for (const item of items) {
    const object = identity.get(item.pascalId)
    if (!object) continue
    if (item.procedural) {
      const groups = new Map<string, Object3D>()
      object.traverse((child) => {
        const motion = child.userData.proceduralMotion as { groupId?: string } | undefined
        if (motion?.groupId) groups.set(motion.groupId, child)
      })
      for (const light of item.procedural.lights) {
        const motion = light.motionGroup ? groups.get(light.motionGroup) : undefined
        const local = new Vector3(...light.position)
        if (motion) local.sub(motion.position)
        regs.push({
          key: `${item.pascalId}:procedural:${light.id}`,
          nodeId: item.pascalId,
          object,
          color: light.color,
          distance: light.distance,
          getWorldPosition: (out) => {
            const anchor = motion ?? object
            anchor.updateWorldMatrix(true, false)
            out.copy(local).applyMatrix4(anchor.matrixWorld)
          },
          getIntensity: () => light.intensity,
          isOn: () =>
            useInteractive.getState().procedural[item.pascalId]?.lightsOn ??
            useInteractive.getState().lampDefault,
          levelId: findLevelId(object),
        })
      }
    }
    const controls = item.interactive.controls
    const toggleIndex = controls.findIndex((control) => control.kind === 'toggle')
    const sliderIndex = controls.findIndex((control) => control.kind === 'slider')
    const slider = sliderIndex >= 0 ? (controls[sliderIndex] as SliderControl) : null
    item.interactive.effects.forEach((effect, index) => {
      if (effect.kind !== 'light') return
      regs.push({
        key: `${item.pascalId}:${index}`,
        nodeId: item.pascalId,
        object,
        color: effect.color,
        distance: effect.distance ?? 0,
        getWorldPosition: (out) => {
          object.updateWorldMatrix(true, false)
          object.getWorldPosition(out)
          out.set(out.x + effect.offset[0], out.y + effect.offset[1], out.z + effect.offset[2])
        },
        getIntensity: () => {
          const values = useInteractive.getState().items[item.pascalId]?.controlValues
          const raw = slider ? ((values?.[sliderIndex] as number) ?? slider.min) : 1
          const fraction =
            slider && slider.max > slider.min ? (raw - slider.min) / (slider.max - slider.min) : 1
          return MathUtils.lerp(effect.intensityRange[0], effect.intensityRange[1], fraction)
        },
        isOn: () => {
          const values = useInteractive.getState().items[item.pascalId]?.controlValues
          return toggleIndex < 0 || Boolean(values?.[toggleIndex])
        },
        levelId: findLevelId(object),
      })
    })
  }
  return regs
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
  const scene = useThree((state) => state.scene)
  useLayoutEffect(() => {
    useItemLightPool.getState().setBakedCanvas(scene, true)
    return () => useItemLightPool.getState().setBakedCanvas(scene, false)
  }, [scene])
  // Baked animation toggles start on; light toggles follow the current theme.
  // Clear per-item state on unmount so it cannot carry into another scene.
  useEffect(() => {
    const store = useInteractive.getState()
    for (const item of items) {
      store.initItem(item.pascalId, item.interactive, true)
      const lampIndex = item.interactive.effects.some((effect) => effect.kind === 'light')
        ? item.interactive.controls.findIndex((control) => control.kind === 'toggle')
        : -1
      item.interactive.controls.forEach((control, index) => {
        if (control.kind === 'toggle' && index !== lampIndex)
          store.setControlValue(item.pascalId, index, true)
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

  const lightRegs = useMemo(() => buildGlbLightRegs(items, identity), [items, identity])
  const levelIndexById = useMemo(
    () => new Map(levelOrder.map((id, i) => [id, i] as const)),
    [levelOrder],
  )

  // Project the zone's baked-local polygon into world space so focused zone
  // membership still works after level stacking moves its parent.
  const focusedZoneId = useViewer((s) => s.selection.zoneId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
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
      {items
        .filter((item) => item.procedural?.lights.length)
        .map((item) => {
          const object = identity.get(item.pascalId)
          return object ? (
            <GlbProceduralEmission item={item} key={item.pascalId} object={object} />
          ) : null
        })}
      {items
        .filter((item) => worldPolygon?.length || selectedIds.includes(item.pascalId))
        .map((item) => {
          const object = identity.get(item.pascalId)
          return object ? (
            <GlbItemControls
              isSelected={selectedIds.includes(item.pascalId)}
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

function GlbProceduralEmission({ item, object }: { item: GlbInteractiveItem; object: Object3D }) {
  useEffect(() => {
    const lights = item.procedural?.lights ?? []
    const restore = decorateProceduralEmission(object, lights, true)
    const update = () => {
      const on =
        useInteractive.getState().procedural[item.pascalId]?.lightsOn ??
        useInteractive.getState().lampDefault
      const slots = new Set(lights.map((light) => light.emissiveSlot).filter(Boolean))
      for (const mesh of proceduralSlotMeshes(object, slots as Set<string>)) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) setProceduralEmission(material, on)
      }
    }
    update()
    const unsubscribe = useInteractive.subscribe((state, previous) => {
      if (
        state.procedural[item.pascalId] !== previous.procedural[item.pascalId] ||
        state.lampDefault !== previous.lampDefault
      )
        update()
    })
    return () => {
      unsubscribe()
      restore()
    }
  }, [item, object])
  return null
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

export type GlbLightReg = {
  key: string
  nodeId: AnyNodeId
  object: Object3D
  color: string
  distance: number
  getWorldPosition: (out: Vector3) => void
  getIntensity: () => number
  isOn: () => boolean
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

function isRendered(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible || !current.layers.isEnabled(SCENE_LAYER)) return false
    current = current.parent
  }
  return true
}

function scoreReg(
  reg: GlbLightReg,
  selectedLevelId: string | null,
  levelMode: string,
  levelIndexById: Map<string, number>,
): number {
  if (!reg.isOn() || !isRendered(reg.object)) return Number.POSITIVE_INFINITY
  if (selectedLevelId && reg.levelId !== selectedLevelId && levelMode === 'solo')
    return Number.POSITIVE_INFINITY
  reg.getWorldPosition(_lightWorld)
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
        score: scoreReg(reg, selectedLevelId, levelMode, levelIndexById),
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
              light.color.set(reg.color)
              light.distance = reg.distance
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
              light.color.set(reg.color)
              light.distance = reg.distance
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

      reg.getWorldPosition(_lightWorld)
      light.position.copy(_lightWorld)
      const targetIntensity = reg.isOn() && isRendered(reg.object) ? reg.getIntensity() : 0
      light.intensity = MathUtils.lerp(light.intensity, targetIntensity, dt * 12)
    }
  }, 6)

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

/** Controls overlay for a selected item or one inside the focused zone. */
function GlbItemControls({
  item,
  object,
  worldPolygon,
  isSelected,
}: {
  item: GlbInteractiveItem
  object: Object3D
  worldPolygon: [number, number][] | null
  isSelected: boolean
}) {
  const controlValues = useInteractive(useShallow((s) => s.items[item.pascalId]?.controlValues))
  const proceduralState = useInteractive((s) => s.procedural[item.pascalId])
  const lampDefault = useInteractive((s) => s.lampDefault)
  const setControlValue = useInteractive((s) => s.setControlValue)
  const togglePart = useInteractive((s) => s.toggleProceduralPart)
  const toggleLights = useInteractive((s) => s.toggleProceduralLights)
  const descriptors = item.procedural
    ? proceduralControlDescriptors(
        item.procedural.parts,
        proceduralState,
        (partId) => togglePart(item.pascalId, partId),
        () => toggleLights(item.pascalId),
        lampDefault,
      )
    : item.interactive.controls.map((control, index) => ({
        key: String(index),
        control,
        value: controlValues?.[index] ?? false,
        onChange: (value: import('@pascal-app/core').ControlValue) =>
          setControlValue(item.pascalId, index, value),
      }))

  let visible = isSelected
  if (worldPolygon?.length) {
    object.getWorldPosition(_itemPos)
    visible = visible || pointInPolygon(_itemPos.x, _itemPos.z, worldPolygon)
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

  if (!(mounted && descriptors.length)) return null

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
        {descriptors.map((descriptor) => (
          <ControlWidget
            control={descriptor.control}
            key={descriptor.key}
            onChange={descriptor.onChange}
            value={descriptor.value}
          />
        ))}
      </div>
    </Html>,
    object,
  )
}
