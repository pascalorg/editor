'use client'

import {
  type AnyNode,
  type AnyNodeId,
  containsPoint,
  type Interactive,
  isScriptedNode,
  type Polygon,
  type SceneGraph,
  type ScriptedNode,
  type SliderControl,
  scriptedInteractive,
  scriptedSize,
  useInteractive,
} from '@pascal-app/core'
import {
  type EvaluatedLight,
  evaluateRecipe,
  type ProceduralItemNode,
} from '@pascal-app/core/procedural-items'
import { Html } from '@react-three/drei'
import { createPortal, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  type AnimationAction,
  LoopRepeat,
  MathUtils,
  type Object3D,
  Quaternion,
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
import { type ScriptedClipActions, ScriptedClips } from '../../systems/interactive/scripted-clips'
import { type PooledLight, PooledLights } from '../../systems/item-light/pooled-lights'

/** An interactive item recovered from the scene graph so the baked GLB can be
 *  re-lit / re-animated by joining on `pascalId`. The GLB carries the geometry
 *  + identity; the effects + controls live in the DB scene graph (no sidecar). */
export type GlbInteractiveItem = {
  pascalId: AnyNodeId
  label: string
  /** Item height (world units) for placing the controls overlay above it. */
  height: number
  interactive: Interactive
  /** Built from a script: its clips keep the script's names (`<pascalId>: <name>`
   *  in the GLB) and its toggles start at their own defaults. */
  scripted?: boolean
  localScale?: [number, number, number]
  procedural?: {
    lights: EvaluatedLight[]
    parts: ProceduralItemNode['recipe']['parts']
    /** v2: the recipe's parts and joints, so non-fixed joints get controls too. */
    recipe?: Pick<ProceduralItemNode['recipe'], 'parts' | 'joints'>
  }
}

/** A baked zone's identity node + its local floor polygon (from `extras`). */
export type GlbZoneRef = {
  id: string
  node: Object3D
  polygon: [number, number][]
  holes?: [number, number][][]
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
        procedural: {
          lights: evaluation.lights,
          parts: procedural.recipe.parts,
          recipe: procedural.recipe,
        },
      })
      continue
    }
    // A node built from a script: its controls come from what the script
    // emitted, as in the editor.
    if (isScriptedNode(raw as AnyNode)) {
      const scripted = raw as ScriptedNode
      const interactive = scriptedInteractive(scripted)
      if (!interactive) continue
      const [, height] = scriptedSize(scripted.source.manifest)
      items.push({
        pascalId: id as AnyNodeId,
        label:
          scripted.name ??
          (scripted.type === 'item'
            ? scripted.asset.name
            : `${scripted.type[0]!.toUpperCase()}${scripted.type.slice(1)}`),
        // A window or door is placed by its centre, everything else by its base.
        height:
          scripted.type === 'window' || scripted.type === 'door'
            ? height / 2
            : height * (scripted.type === 'item' ? (scripted.scale?.[1] ?? 1) : 1),
        interactive,
        scripted: true,
        localScale: scripted.type === 'item' ? scripted.scale : [1, 1, 1],
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
        // A nested group's position is relative to its parent group: the design-space pivot
        // is the sum along its chain of motion groups.
        for (let group = motion; group && group !== object; group = group.parent ?? undefined)
          if (group.userData.proceduralMotion) local.sub(group.position)
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
            return true
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
        spot: effect.spot,
        shadows: effect.shadows,
        glow: effect.glow,
        peak: effect.intensityRange[1],
        getWorldDirection: (out) => {
          out.set(...(effect.spot?.direction ?? [0, -1, 0])).normalize()
          out.applyQuaternion(object.getWorldQuaternion(_quaternion))
        },
        getWorldPosition: (out) => {
          object.updateWorldMatrix(true, false)
          if (item.scripted) {
            const scale = item.localScale ?? [1, 1, 1]
            out
              .set(
                effect.offset[0] * scale[0],
                effect.offset[1] * scale[1],
                effect.offset[2] * scale[2],
              )
              .applyMatrix4(object.matrixWorld)
            return true
          }
          object.getWorldPosition(out)
          out.set(out.x + effect.offset[0], out.y + effect.offset[1], out.z + effect.offset[2])
          return true
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
  // Baked catalog animation toggles start on; light toggles follow the current
  // theme; an authored object's toggles keep their own defaults, as in the
  // editor. Clear per-item state on unmount so it cannot carry into another scene.
  useEffect(() => {
    const store = useInteractive.getState()
    for (const item of items) {
      store.initItem(item.pascalId, item.interactive, true)
      if (item.scripted) continue
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
  const worldPolygon = useMemo<Polygon | null>(() => {
    if (!focusedZoneId) return null
    const zone = zones.find((z) => z.id === focusedZoneId)
    if (!zone) return null
    zone.node.updateWorldMatrix(true, false)
    const project = (ring: [number, number][]) =>
      ring.map(([x, z]): [number, number] => {
        const v = new Vector3(x, 0, z).applyMatrix4(zone.node.matrixWorld)
        return [v.x, v.z]
      })
    return { outer: project(zone.polygon), holes: (zone.holes ?? []).map(project) }
  }, [focusedZoneId, zones])

  return (
    <>
      <GlbItemLights levelIndexById={levelIndexById} regs={lightRegs} />
      {animationItems.map((item) =>
        item.scripted ? (
          <GlbScriptedClips actions={actions} item={item} key={item.pascalId} />
        ) : (
          <GlbItemAnimation actions={actions} item={item} key={item.pascalId} />
        ),
      )}
      {items
        .filter((item) => item.procedural?.lights.length)
        .map((item) => {
          const object = identity.get(item.pascalId)
          return object ? (
            <GlbProceduralEmission item={item} key={item.pascalId} object={object} />
          ) : null
        })}
      {items
        .filter((item) => worldPolygon || selectedIds.includes(item.pascalId))
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
// The same pools as the parametric `ItemLightSystem`, fed from the baked
// Object3Ds: mounting a light per item instead would blow the renderer's light
// budget on a large house.

export type GlbLightReg = PooledLight & {
  nodeId: AnyNodeId
  object: Object3D
  getIntensity: () => number
  isOn: () => boolean
  levelId: string | null
}

const _dir = new Vector3()
const _lightWorld = new Vector3()
const _quaternion = new Quaternion()

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
  camPos: Vector3,
  camFwd: Vector3,
  selectedLevelId: string | null,
  levelMode: string,
  levelIndexById: Map<string, number>,
): number {
  if (!reg.isOn() || !isRendered(reg.object)) return Number.POSITIVE_INFINITY
  if (selectedLevelId && reg.levelId !== selectedLevelId && levelMode === 'solo')
    return Number.POSITIVE_INFINITY
  reg.getWorldPosition(_lightWorld)
  _dir.copy(_lightWorld).sub(camPos).normalize()
  const angular = 1 - camFwd.dot(_dir)
  const dist = camPos.distanceTo(_lightWorld) / 200
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
  return (
    <PooledLights<GlbLightReg>
      getLights={() => regs}
      intensity={(reg) => (reg.isOn() && isRendered(reg.object) ? reg.getIntensity() : 0)}
      score={(reg, camPos, camFwd) => {
        const viewer = useViewer.getState()
        return scoreReg(
          reg,
          camPos,
          camFwd,
          viewer.selection.levelId,
          viewer.levelMode,
          levelIndexById,
        )
      }}
    />
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

/** Plays an authored object's baked clips through the shared `ScriptedClips`,
 *  addressing each by the name the script gave it. */
function GlbScriptedClips({
  item,
  actions,
}: {
  item: GlbInteractiveItem
  actions: Record<string, AnimationAction | null>
}) {
  // drei creates each action on first read, once the scene root is mounted, so
  // forward reads instead of copying the actions during render.
  const scriptActions = useMemo(() => {
    const prefix = `${item.pascalId}: `
    const forwarded: ScriptedClipActions = {}
    for (const name of Object.keys(actions)) {
      if (!name.startsWith(prefix)) continue
      Object.defineProperty(forwarded, name.slice(prefix.length), {
        enumerable: true,
        get: () => actions[name],
      })
    }
    return forwarded
  }, [actions, item.pascalId])
  return (
    <ScriptedClips actions={scriptActions} interactive={item.interactive} nodeId={item.pascalId} />
  )
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
  worldPolygon: Polygon | null
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
        item.procedural.recipe ?? { parts: item.procedural.parts },
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
  if (worldPolygon) {
    object.getWorldPosition(_itemPos)
    visible = visible || containsPoint([worldPolygon], [_itemPos.x, _itemPos.z])
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
