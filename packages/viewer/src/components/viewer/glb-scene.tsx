'use client'

import {
  type AnyNode,
  type AnyNodeId,
  bakePolicyOf,
  containsPoint,
  distanceToBoundary,
  itemInteraction,
  itemPrompt,
  operateItem,
  polygonInteriorPoint,
  type SurfaceRole,
  useInteractive,
} from '@pascal-app/core'
import {
  type EvaluatedMotion,
  operableParts,
  ProceduralMotionController,
} from '@pascal-app/core/procedural-items'
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { lerp } from 'three/src/math/MathUtils.js'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { useGLTFKTX2 } from '../../hooks/use-gltf-ktx2'
import { createSurfaceRoleMaterial } from '../../lib/materials'
import { applyShadowOnly, clearShadowOnly } from '../../lib/shadow-only'
import useViewer from '../../store/use-viewer'
import { useClipActions } from '../../systems/interactive/scripted-clips'
import { resolveLevelVisibility } from '../../systems/level/level-utils'
import { GlbInteractive, type GlbInteractiveItem } from './glb-interactive'
import { bakedLoopMechanisms } from './glb-mechanisms'
import { GlbReferenceNodes } from './glb-reference-nodes'
import { GlbReplaceInstances } from './glb-replace-instances'

/** Vertical gap added per floor in `exploded` level mode (matches LevelSystem). */
const EXPLODED_GAP = 5

/** Baked `kind` → surface role, so monochrome can recolor by role like the
 *  parametric viewer (textures-off collapses each face to its themed clay). */
const ROLE_BY_KIND: Record<string, SurfaceRole> = {
  wall: 'wall',
  slab: 'floor',
  floor: 'floor',
  ceiling: 'ceiling',
  roof: 'roof',
  'roof-segment': 'roof',
  window: 'glazing',
  door: 'joinery',
  item: 'furnishing',
}

/**
 * A pointer on the baked building, handed to the host's selection rules: the
 * baked node under it (its `pascalId`) and the hit in its level's local XZ,
 * or null for empty space.
 */
export type GlbPickEvent = {
  type: 'click' | 'hover'
  pick: { nodeId: string; point: [number, number] | null } | null
  modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }
}

/** Kinds a pointer passes through to what lies behind (they frame, they don't get picked). */
const PASS_THROUGH_KINDS = new Set(['site', 'building', 'level', 'zone', 'ceiling', 'spawn'])

/** Walkthrough HUD state, reported each frame: the floor/room the camera is in
 *  and the interactive part directly in view (for the reticle prompt). */
export type GlbWalkthrough = {
  zoneLabel: string | null
  floorLabel: string | null
  door: { label: string; isOpen: boolean; verb?: string } | null
} | null

type GlbLevelEntry = { id: string; node: THREE.Object3D; baseY: number }
type GlbZoneEntry = {
  id: string
  node: THREE.Object3D
  levelId: string | null
  polygon: [number, number][]
  holes: [number, number][][]
  label: string
  color: string
  /** Interior pole (zone-local x, z), outside any room holes. */
  centroid: [number, number]
}

type PascalExtras = {
  pascalId?: string
  kind?: string
  label?: string
  openable?: boolean
  clips?: string[]
  proceduralMotion?: {
    nodeId: string
    partId: string
    groupId: string
    kind: 'hinge' | 'slide' | 'spin'
    clip?: string
    activeWindow?: [number, number]
  }
  polygon?: [number, number][]
  holes?: [number, number][][]
  color?: string
  camera?: { position: [number, number, number]; target: [number, number, number] }
}

/** The subset of the camera-controls instance the scene drives (drei makeDefault). */
type LookAtControls = {
  setLookAt: (
    px: number,
    py: number,
    pz: number,
    tx: number,
    ty: number,
    tz: number,
    enableTransition?: boolean,
  ) => unknown
  /** Wraps the wound-up azimuth so a transition rotates the short way, not 360°. */
  normalizeRotations?: () => unknown
  /** Pans camera + target together (keeps angle + distance) to re-center a point. */
  moveTo?: (x: number, y: number, z: number, enableTransition?: boolean) => unknown
}

type HitCandidate = { object: THREE.Object3D; point: THREE.Vector3 }

function findIdentityAncestor(object: THREE.Object3D): THREE.Object3D | null {
  let current: THREE.Object3D | null = object
  while (current) {
    if ((current.userData as PascalExtras).pascalId) return current
    current = current.parent
  }
  return null
}

function findProceduralMotionAncestor(object: THREE.Object3D): PascalExtras['proceduralMotion'] {
  let current: THREE.Object3D | null = object
  while (current) {
    const motion = (current.userData as PascalExtras).proceduralMotion
    if (motion) return motion
    current = current.parent
  }
  return undefined
}

function findAncestorLevelId(object: THREE.Object3D): string | null {
  let current = object.parent
  while (current) {
    const extras = current.userData as PascalExtras
    if (extras.kind === 'level' && extras.pascalId) return extras.pascalId
    current = current.parent
  }
  return null
}

const _local = new THREE.Vector3()
const _camBox = new THREE.Box3()
const _camCenter = new THREE.Vector3()
const _camSize = new THREE.Vector3()
const _walkPos = new THREE.Vector3()
const _reticleNdc = new THREE.Vector2(0, 0)
const _reticleRaycaster = new THREE.Raycaster()
/** How far ahead (metres) an interactive part counts as "in view" for activation. */
const WALK_REACH = 3
const ZONE_FOOTPRINT_EPSILON = 0.05

/**
 * The baked node under a pointer that a click can land on: the nearest hit
 * whose identity is not a kind that only frames (site, building, level, zone,
 * ceiling) and is not on a hidden floor, with the hit in its level's local XZ.
 */
export function resolveGlbPick(
  hits: readonly HitCandidate[],
  identity: ReadonlyMap<string, THREE.Object3D>,
): (NonNullable<GlbPickEvent['pick']> & { hitObject: THREE.Object3D }) | null {
  for (const hit of hits) {
    const node = findIdentityAncestor(hit.object)
    const extras = node?.userData as PascalExtras | undefined
    if (!(node && extras?.pascalId) || PASS_THROUGH_KINDS.has(extras.kind ?? '')) continue
    const levelId = findAncestorLevelId(node)
    const level = levelId ? identity.get(levelId) : undefined
    if (level && !level.visible) continue
    let point: [number, number] | null = null
    if (level) {
      level.updateWorldMatrix(true, false)
      _local.copy(hit.point)
      level.worldToLocal(_local)
      point = [_local.x, _local.z]
    }
    return { nodeId: extras.pascalId, point, hitObject: hit.object }
  }
  return null
}

function pointInZone(x: number, z: number, zone: GlbZoneEntry): boolean {
  const polygon = [{ outer: zone.polygon, holes: zone.holes }]
  return (
    containsPoint(polygon, [x, z]) || distanceToBoundary(polygon, [x, z]) <= ZONE_FOOTPRINT_EPSILON
  )
}

/**
 * GLB-consuming viewer scene. Loads a baked artifact and drives the viewer's
 * presentation and interaction with no parametric scene graph. A pointer
 * becomes a `GlbPickEvent` the host runs through its selection rules (the
 * same rules as the parametric viewer); the shared `useViewer.selection` and
 * `hoveredId` then drive the outline, and openables play their baked clips
 * when clicked. The host disables the parametric `SelectionManager`
 * (`selectionManager="custom"`).
 */
export function GlbScene({
  url,
  interactiveItems,
  referenceNodes,
  replaceNodes,
  onObjectsChange,
  onPick,
  onWalkthroughChange,
}: {
  url: string
  /** Light / animation effects + controls recovered from the DB scene graph,
   *  joined to the baked nodes by `pascalId` to re-light + re-animate the GLB. */
  interactiveItems?: GlbInteractiveItem[]
  /** Scan / guide nodes from the scene graph, re-added at runtime (they're
   *  stripped from the bake). Already filtered by the privacy flags upstream. */
  referenceNodes?: AnyNode[]
  /** `bake: 'replace'` nodes (e.g. plugin trees): baked static but re-rendered
   *  live here via their `bakeReplaceRenderer`; the baked meshes are hidden. */
  replaceNodes?: AnyNode[]
  /** pascalId → baked object, so the host can place room pills and frame nodes. */
  onObjectsChange?: (objects: ReadonlyMap<string, THREE.Object3D>) => void
  /** Clicks and hovers on the building; without it the scene is look-only. */
  onPick?: (event: GlbPickEvent) => void
  onWalkthroughChange?: (state: GlbWalkthrough) => void
}) {
  const gltf = useGLTFKTX2(url) as unknown as {
    scene: THREE.Group
    animations: THREE.AnimationClip[]
  }
  const rootRef = useRef<THREE.Group>(null!)
  const actions = useClipActions(gltf.animations, rootRef)
  const proceduralPlayback = useMemo(() => {
    const byNode = new Map<
      string,
      {
        motions: EvaluatedMotion[]
        clips: Map<string, { partId: string; kind: 'finite' | 'spin'; groupId: string }>
      }
    >()
    gltf.scene.traverse((object) => {
      const extras = object.userData as PascalExtras
      if (extras.kind === 'procedural-item' && extras.pascalId && !byNode.has(extras.pascalId))
        byNode.set(extras.pascalId, { motions: [], clips: new Map() })
      const motion = extras.proceduralMotion
      if (!motion?.clip) return
      const clip = gltf.animations.find((entry) => entry.name === motion.clip)
      if (!clip) return
      const entry: {
        motions: EvaluatedMotion[]
        clips: Map<string, { partId: string; kind: 'finite' | 'spin'; groupId: string }>
      } = byNode.get(motion.nodeId) ?? { motions: [], clips: new Map() }
      if (motion.kind === 'spin') {
        entry.motions.push({
          id: motion.groupId,
          partId: motion.partId,
          kind: 'spin',
          axis: 'y',
          pivot: [0, 0, 0],
          amount: (2 * Math.PI) / clip.duration,
          delay: 0,
          duration: 0,
          easing: 'linear',
        })
        entry.clips.set(motion.clip, {
          partId: motion.partId,
          kind: 'spin',
          groupId: entry.clips.get(motion.clip)?.groupId ?? motion.groupId,
        })
      } else if (
        motion.activeWindow &&
        !entry.motions.some((item) => item.partId === motion.partId)
      ) {
        entry.motions.push({
          id: motion.groupId,
          partId: motion.partId,
          kind: 'hinge',
          axis: 'y',
          pivot: [0, 0, 0],
          amount: 1,
          delay: motion.activeWindow[0],
          duration: motion.activeWindow[1] - motion.activeWindow[0],
          easing: 'linear',
        })
        entry.clips.set(motion.clip, {
          partId: motion.partId,
          kind: 'finite',
          groupId: motion.groupId,
        })
      }
      byNode.set(motion.nodeId, entry)
    })
    // Procedural actions need a separate mixer so drei cannot advance their assigned times.
    const mixer = new THREE.AnimationMixer(gltf.scene)
    const entries = new Map<
      string,
      {
        controller: ProceduralMotionController
        clips: Map<string, { partId: string; kind: 'finite' | 'spin'; groupId: string }>
        spinParts: string[]
        sequence: number
      }
    >(
      [...byNode].map(([nodeId, entry]) => {
        const spinParts = [
          ...new Set(
            entry.motions.filter((motion) => motion.kind === 'spin').map((motion) => motion.partId),
          ),
        ]
        const initial = Object.fromEntries(spinParts.map((partId) => [partId, true]))
        return [
          nodeId,
          {
            controller: new ProceduralMotionController(entry.motions, initial),
            clips: entry.clips,
            spinParts,
            sequence: 0,
          },
        ]
      }),
    )
    const proceduralActions = new Map(
      gltf.animations
        .filter((clip) => [...entries.values()].some((entry) => entry.clips.has(clip.name)))
        .map((clip) => {
          const action = mixer.clipAction(clip)
          action.enabled = true
          action.paused = true
          action.loop = clip.name.endsWith(': loop') ? THREE.LoopRepeat : THREE.LoopOnce
          action.clampWhenFinished = true
          action.setEffectiveWeight(1)
          action.play()
          return [clip.name, action] as const
        }),
    )
    return { entries, mixer, actions: proceduralActions }
  }, [gltf.scene, gltf.animations])
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as LookAtControls | null
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const textures = useViewer((s) => s.textures)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  // Monochrome: strip the baked textures and recolor every building mesh with a
  // flat themed-clay material by surface role — mirrors the parametric viewer's
  // textures-off path. The original baked material is stashed on the mesh
  // (`userData.__bakedMaterial`) so it survives the cached GLTF across remounts.
  useEffect(() => {
    gltf.scene.traverse((object) => {
      const role = ROLE_BY_KIND[(object.userData as PascalExtras).kind ?? '']
      if (!role) return
      object.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        const ud = mesh.userData as { __bakedMaterial?: THREE.Material | THREE.Material[] }
        if (!ud.__bakedMaterial) ud.__bakedMaterial = mesh.material
        mesh.material = textures
          ? ud.__bakedMaterial
          : createSurfaceRoleMaterial(role, 'clay', THREE.DoubleSide, sceneTheme)
      })
    })
  }, [gltf.scene, textures, sceneTheme])

  // The baked scene isn't wrapped in <SceneBvh> (the community viewer runs with
  // useBvh={false}), so hover/pick raycasts against the baked building were
  // brute-force triangle tests — dozens of ms per pointer move on a dense scene,
  // and far worse once a `replace` forest is portaled in. Give each baked mesh a
  // BVH so those raycasts are accelerated. `replace` instances are NO_RAYCAST, so
  // the `raycast === Mesh.prototype.raycast` guard skips them (mirrors SceneBvh).
  useEffect(() => {
    const accelerated = new Set<THREE.Mesh>()
    const computed = new Set<THREE.BufferGeometry>()
    gltf.scene.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || mesh.raycast !== THREE.Mesh.prototype.raycast) return
      mesh.raycast = acceleratedRaycast
      accelerated.add(mesh)
      const geometry = mesh.geometry
      if (geometry.boundsTree || !geometry.getAttribute('position')) return
      try {
        // three-mesh-bvh + @types/three disagree on the helper signatures; cast
        // through unknown like SceneBvh does — the runtime call is correct.
        ;(geometry as { computeBoundsTree?: unknown }).computeBoundsTree =
          computeBoundsTree as unknown as typeof geometry.computeBoundsTree
        ;(geometry as { disposeBoundsTree?: unknown }).disposeBoundsTree =
          disposeBoundsTree as unknown as typeof geometry.disposeBoundsTree
        geometry.computeBoundsTree()
        computed.add(geometry)
      } catch (error) {
        console.warn('[viewer] skipping BVH for baked mesh geometry', error)
      }
    })
    return () => {
      for (const geometry of computed) {
        if (geometry.boundsTree) geometry.disposeBoundsTree()
      }
      for (const mesh of accelerated) {
        if (mesh.raycast === acceleratedRaycast) mesh.raycast = THREE.Mesh.prototype.raycast
      }
    }
  }, [gltf.scene])

  // One pass over the artifact: identity objects (id → Object3D), ordered floors,
  // and zone polygons. Levels stay out of `sceneRegistry` so the parametric
  // LevelSystem never re-stacks them.
  const { levels, identity, zoneEntries, occluders, rootNode, levelsWithZones } = useMemo(() => {
    const objects = new Map<string, THREE.Object3D>()
    const floors: GlbLevelEntry[] = []
    const zoneList: GlbZoneEntry[] = []
    // Ceilings + roof are hidden when a floor is focused (dollhouse view) so the
    // camera sees the rooms and the pointer ray reaches their contents.
    const occluderNodes: THREE.Object3D[] = []
    // The building (or site) node anchors the building-view camera bookmark/fit.
    let buildingNode: THREE.Object3D | null = null
    let siteNode: THREE.Object3D | null = null
    gltf.scene.traverse((object) => {
      const extras = object.userData as PascalExtras
      // The spawn marker is an authoring-only node (walkthrough start pose); it
      // should never render in the viewer. Its transform still feeds the
      // walkthrough controller — visibility doesn't affect that.
      if (extras.kind === 'spawn') {
        object.visible = false
        return
      }
      if (!extras.pascalId) return
      objects.set(extras.pascalId, object)
      // `bake: 'replace'` kinds are baked as static geometry (portable), but a
      // loaded plugin re-renders them live from the scene graph — hide the frozen
      // baked mesh so only the live one shows. Gated on the registry, so with no
      // plugin loaded the policy is `'static'` and the baked mesh stays.
      if (bakePolicyOf(extras.kind ?? '') === 'replace') object.visible = false
      if (extras.kind === 'building') buildingNode = object
      else if (extras.kind === 'site') siteNode = object
      if (extras.kind === 'ceiling' || extras.kind === 'roof') occluderNodes.push(object)
      if (extras.kind === 'level') {
        floors.push({
          id: extras.pascalId,
          node: object,
          baseY: object.position.y,
        })
      }
      if (extras.kind === 'zone' && extras.polygon && extras.polygon.length >= 3) {
        const polygon = extras.polygon
        const holes = extras.holes ?? []
        const centroid = polygonInteriorPoint({ polygon, holes })
        zoneList.push({
          id: extras.pascalId,
          node: object,
          levelId: findAncestorLevelId(object),
          polygon,
          holes,
          label: extras.label ?? extras.pascalId,
          color: extras.color ?? '#3b82f6',
          centroid,
        })
      }
    })
    floors.sort((a, b) => a.baseY - b.baseY)
    return {
      levels: floors,
      identity: objects,
      zoneEntries: zoneList,
      occluders: occluderNodes,
      rootNode: (buildingNode ?? siteNode) as THREE.Object3D | null,
      // Levels that have rooms — only these trigger the dollhouse occluder strip.
      levelsWithZones: new Set(zoneList.map((zone) => zone.levelId)),
    }
  }, [gltf.scene])
  // Level pascalIds bottom-to-top, for the interactive light pool's level factor.
  const levelOrder = useMemo(() => levels.map((entry) => entry.id), [levels])
  // Loop clips no other controller plays (a plugin kind's mechanism) run on
  // click and E. As in the editor they start stopped and never persist.
  const loopMechanisms = useMemo(
    () =>
      bakedLoopMechanisms(
        identity,
        new Set([
          ...proceduralPlayback.entries.keys(),
          ...(interactiveItems ?? []).map((item) => item.pascalId),
        ]),
      ),
    [identity, proceduralPlayback, interactiveItems],
  )

  // The dollhouse hides ceilings/roof — but only their OWN geometry. Items hosted
  // on a ceiling (lamps, fans, recessed lights) are child identity nodes; hiding
  // the whole occluder node would hide them too, so collect just the occluder's
  // own meshes (stop descending at any nested identity node) and toggle those.
  const occluderOwnMeshes = useMemo(() => {
    const meshes: THREE.Mesh[] = []
    const walk = (node: THREE.Object3D) => {
      for (const child of node.children) {
        if ((child.userData as PascalExtras).pascalId) continue // hosted item — keep visible
        if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh)
        walk(child)
      }
    }
    for (const occluder of occluders) {
      if ((occluder as THREE.Mesh).isMesh) meshes.push(occluder as THREE.Mesh)
      walk(occluder)
    }
    return meshes
  }, [occluders])

  // Open on the building: its saved view, else a fit of its bounds. Later moves
  // belong to the host's navigation (`camera-controls:frame`), never to a click.
  useEffect(() => {
    if (!controls) return
    const bookmark = (rootNode?.userData as PascalExtras | undefined)?.camera
    if (bookmark) {
      const { position: p, target: t } = bookmark
      controls.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], true)
      controls.normalizeRotations?.()
      return
    }
    _camBox.makeEmpty()
    _camBox.setFromObject(rootNode ?? gltf.scene)
    if (_camBox.isEmpty()) return
    _camBox.getCenter(_camCenter)
    _camBox.getSize(_camSize)
    const distance = Math.max(Math.max(_camSize.x, _camSize.y, _camSize.z) * 2, 15)
    controls.setLookAt(
      _camCenter.x + distance * 0.7,
      _camCenter.y + distance * 0.5,
      _camCenter.z + distance * 0.7,
      _camCenter.x,
      _camCenter.y,
      _camCenter.z,
      true,
    )
    controls.normalizeRotations?.()
  }, [controls, rootNode, gltf.scene])

  useEffect(() => {
    onObjectsChange?.(identity)
    return () => onObjectsChange?.(new Map())
  }, [identity, onObjectsChange])

  // Apply the viewer's level display to the baked floors each frame, by the
  // parametric LevelSystem's rule (solo, and the levels above the current one
  // hidden when the host asks). Walkthrough always shows the full stacked
  // building (you're standing inside it) — and the first-person collider is
  // built from the visible meshes, so a hidden floor would otherwise drop the
  // player through the world.
  useFrame((_, delta) => {
    if (levels.length === 0) return
    const { levelMode, hideLevelsAboveSelection, selection, walkthroughMode } = useViewer.getState()
    const selectedLevel = selection.levelId
    const selectedIdx = selectedLevel ? levels.findIndex((l) => l.id === selectedLevel) : -1
    levels.forEach(({ id, node, baseY }, index) => {
      const exploded = !walkthroughMode && levelMode === 'exploded'
      const targetY = baseY + (exploded ? index * EXPLODED_GAP : 0)
      // Snap (not lerp) in walkthrough so the first-person collider, built from
      // these world positions, matches the stacked building immediately.
      node.position.y = walkthroughMode
        ? targetY
        : lerp(node.position.y, targetY, Math.min(1, delta * 12))
      const { visible, shadowOnly } = walkthroughMode
        ? { visible: true, shadowOnly: false }
        : resolveLevelVisibility({
            levelMode,
            hideAbove: hideLevelsAboveSelection,
            hasSelectedLevel: selectedIdx >= 0,
            isSelected: id === selectedLevel,
            index,
            selectedIndex: selectedIdx >= 0 ? selectedIdx : undefined,
            nodeVisible: true,
          })
      if (shadowOnly) applyShadowOnly(node)
      else clearShadowOnly(node)
      node.visible = visible
    })
  }, 5)

  useEffect(() => {
    for (const [nodeId, entry] of proceduralPlayback.entries)
      useInteractive
        .getState()
        .initProcedural(
          nodeId as AnyNodeId,
          [...new Set(entry.controller.motions.map((motion) => motion.partId))],
          entry.spinParts,
        )
    return () => {
      for (const nodeId of proceduralPlayback.entries.keys())
        useInteractive.getState().removeProcedural(nodeId as AnyNodeId)
      proceduralPlayback.mixer.stopAllAction()
    }
  }, [proceduralPlayback])

  useFrame((_, delta) => {
    for (const [nodeId, entry] of proceduralPlayback.entries) {
      const command = useInteractive.getState().procedural[nodeId as AnyNodeId]?.motionCommand
      if (command && command.sequence > entry.sequence) {
        entry.controller.command(command)
        entry.sequence = command.sequence
      }
      const frame = entry.controller.tick(delta)
      for (const [clipName, binding] of entry.clips) {
        const action = proceduralPlayback.actions.get(clipName)
        if (!action) continue
        if (binding.kind === 'finite') action.time = frame.times[binding.partId] ?? 0
        else {
          const motion = entry.controller.motions.find((item) => item.id === binding.groupId)
          if (motion)
            action.time =
              ((frame.spins[motion.id]?.phase ?? 0) / (2 * Math.PI)) * action.getClip().duration
        }
      }
    }
    proceduralPlayback.mixer.update(0)
  }, -1)

  useEffect(() => {
    const scriptedPrefixes = (interactiveItems ?? [])
      .filter((item) => item.scripted)
      .map((item) => `${item.pascalId}: `)
    for (const [name, action] of Object.entries(actions)) {
      if (!action) continue
      if (proceduralPlayback.actions.has(name)) continue
      // ScriptedClips owns each authored clip's playback mode.
      if (scriptedPrefixes.some((prefix) => name.startsWith(prefix))) continue
      if (name.endsWith(': loop')) {
        action.loop = THREE.LoopRepeat
        action.clampWhenFinished = false
      } else {
        action.loop = THREE.LoopOnce
        action.clampWhenFinished = true
      }
    }
  }, [actions, proceduralPlayback, interactiveItems])

  useEffect(() => {
    if (loopMechanisms.size === 0) return
    const apply = (running: Record<string, boolean>) => {
      for (const [id, clips] of loopMechanisms) {
        for (const name of clips) {
          const action = actions[name]
          if (!action) continue
          if (running[id]) {
            action.enabled = true
            action.paused = false
            if (!action.isRunning()) action.play()
          } else {
            action.stop()
          }
        }
      }
    }
    apply(useInteractive.getState().mechanisms)
    const unsubscribe = useInteractive.subscribe((state, previous) => {
      if (state.mechanisms !== previous.mechanisms) apply(state.mechanisms)
    })
    return () => {
      unsubscribe()
      for (const id of loopMechanisms.keys())
        useInteractive.getState().removeMechanism(id as AnyNodeId)
    }
  }, [actions, loopMechanisms])
  // Items the walkthrough operates through their toggles; others fall through to loop clips.
  const toggleableItem = useCallback(
    (pascalId: string | undefined) =>
      interactiveItems?.find(
        (item) =>
          item.pascalId === pascalId &&
          item.interactive.controls.some((control) => control.kind === 'toggle'),
      ),
    [interactiveItems],
  )
  // A click opens and closes an item with an `open` clip (an authored object,
  // a scripted window or door), like a door.
  const toggleOpenControl = useCallback(
    (identityNode: THREE.Object3D) => {
      const item = toggleableItem((identityNode.userData as PascalExtras).pascalId)
      if (!item || itemInteraction(item.interactive).kind !== 'open') return false
      operateItem(item.pascalId, item.interactive)
      return true
    },
    [toggleableItem],
  )
  const toggleLoopMechanism = useCallback(
    (identityNode: THREE.Object3D) => {
      const id = (identityNode.userData as PascalExtras).pascalId as AnyNodeId | undefined
      if (!(id && loopMechanisms.has(id))) return false
      const state = useInteractive.getState()
      state.setMechanism(id, !state.mechanisms[id])
      return true
    },
    [loopMechanisms],
  )

  const openIds = useRef(new Set<string>())
  const toggleProcedural = useCallback(
    (hit: THREE.Object3D, identityNode: THREE.Object3D) => {
      const extras = identityNode.userData as PascalExtras
      if (extras.kind !== 'procedural-item') return false
      const part = findProceduralMotionAncestor(hit)
      if (part?.clip) {
        useInteractive.getState().toggleProceduralPart(part.nodeId as AnyNodeId, part.partId)
        return true
      }
      const nodeId = extras.pascalId as string
      const entry = proceduralPlayback.entries.get(nodeId)
      if (!entry) return false
      const parts = [...new Set(entry.controller.motions.map((motion) => motion.partId))]
      if (parts.length === 0) {
        useInteractive.getState().toggleProceduralLights(nodeId as AnyNodeId)
        return true
      }
      const active = useInteractive.getState().procedural[nodeId as AnyNodeId]?.parts
      useInteractive
        .getState()
        .setProceduralParts(nodeId as AnyNodeId, parts, !parts.some((partId) => active?.[partId]))
      return true
    },
    [proceduralPlayback],
  )
  const toggleOpenable = useCallback(
    (node: THREE.Object3D) => {
      const extras = node.userData as PascalExtras
      const clipName = extras.clips?.find((name) => name.endsWith(': open'))
      if (!extras.openable || !clipName) return
      const action = actions[clipName]
      if (!action) return
      const id = extras.pascalId as string
      const willOpen = !openIds.current.has(id)
      action.enabled = true
      action.paused = false
      action.loop = THREE.LoopOnce
      action.clampWhenFinished = true
      action.timeScale = willOpen ? 1 : -1
      action.play()
      if (willOpen) openIds.current.add(id)
      else openIds.current.delete(id)
    },
    [actions],
  )

  // The room whose polygon contains a world point. Resolving by the raycast hit
  // point (rather than a node origin) means any surface inside a room footprint —
  // floor, slab, or furniture — maps to that room.
  const zoneAtPoint = useCallback(
    (worldPoint: THREE.Vector3, levelId: string): GlbZoneEntry | null => {
      for (const entry of zoneEntries) {
        if (entry.levelId !== levelId) continue
        _local.copy(worldPoint)
        entry.node.worldToLocal(_local)
        if (pointInZone(_local.x, _local.z, entry)) return entry
      }
      return null
    },
    [zoneEntries],
  )

  // Per-frame: hide the focused floor's ceilings and roof when it has rooms
  // (dollhouse), and sync the outline post-FX from the shared selection and
  // hover. Rooms highlight through the host's room layer, not the outline.
  useFrame(() => {
    const state = useViewer.getState()
    const { selection, outliner } = state

    // Walkthrough is a first-person tour: no dollhouse cutaway, no selection
    // outline — you're standing inside the real building.
    const walk = state.walkthroughMode

    // Dollhouse: hide ceilings + roof so the rooms are visible from above and
    // the ray reaches their contents — but only when the focused level actually
    // has rooms. Focusing a zone-less floor keeps the building intact
    // (otherwise its roof would just vanish with nothing to show).
    const revealing = !walk && selection.levelId != null && levelsWithZones.has(selection.levelId)
    // Shadow-caster-only: hidden roof/ceiling meshes keep casting sun shadows
    // so interiors show window light patches instead of uniform sun flood.
    for (const mesh of occluderOwnMeshes) {
      if (revealing) applyShadowOnly(mesh)
      else clearShadowOnly(mesh)
    }

    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0
    if (walk) return

    for (const id of selection.selectedIds) {
      const object = identity.get(id)
      if (object) outliner.selectedObjects.push(object)
    }
    const hovered = state.hoveredId ? identity.get(state.hoveredId) : undefined
    if (
      hovered &&
      (hovered.userData as PascalExtras).kind !== 'zone' &&
      !outliner.selectedObjects.includes(hovered)
    ) {
      outliner.hoveredObjects.push(hovered)
    }
  })

  // ── Walkthrough: first-person HUD + interaction ────────────────────────────
  const walkDoorRef = useRef<{ hit: THREE.Object3D; node: THREE.Object3D } | null>(null)
  const lastWalkKey = useRef<string | null>(null)

  // Each frame in walkthrough, report the floor + room the camera stands in and
  // the openable directly ahead (a forward ray from screen centre) so the host
  // can draw the reticle prompt. Fires the callback only when the state changes.
  useFrame(() => {
    if (!walkthroughMode) return
    camera.getWorldPosition(_walkPos)

    let floor: GlbLevelEntry | null = levels[0] ?? null
    for (const level of levels) {
      if (_walkPos.y >= level.baseY - 0.5) floor = level
      else break
    }
    const floorLabel = floor ? ((floor.node.userData as PascalExtras).label ?? floor.id) : null
    const zone = floor ? zoneAtPoint(_walkPos, floor.id) : null

    _reticleRaycaster.far = WALK_REACH
    _reticleRaycaster.setFromCamera(_reticleNdc, camera)
    const hit = _reticleRaycaster.intersectObject(gltf.scene, true)[0]
    let doorNode: { hit: THREE.Object3D; node: THREE.Object3D } | null = null
    let doorId = ''
    let door: { label: string; isOpen: boolean; verb?: string } | null = null
    if (hit) {
      const node = findIdentityAncestor(hit.object)
      const extras = node?.userData as PascalExtras | undefined
      const lightOnly =
        extras?.pascalId &&
        interactiveItems?.some(
          (item) =>
            item.pascalId === extras.pascalId &&
            item.procedural?.lights.length &&
            operableParts(item.procedural.recipe ?? { parts: item.procedural.parts }).length === 0,
        )
      const item = toggleableItem(extras?.pascalId)
      if (node && extras?.kind === 'procedural-item' && (extras.clips?.length || lightOnly)) {
        doorNode = { hit: hit.object, node }
        const part = findProceduralMotionAncestor(hit.object)
        const state = useInteractive.getState().procedural[extras.pascalId as AnyNodeId]
        const isOpen = lightOnly
          ? (state?.lightsOn ?? useInteractive.getState().lampDefault)
          : part
            ? Boolean(state?.parts[part.partId])
            : Object.values(state?.parts ?? {}).some(Boolean)
        const clips = part?.clip ? [part.clip] : extras.clips
        const isSpin = part
          ? part.kind === 'spin'
          : (clips?.every((clip) => clip.endsWith(': loop')) ?? false)
        const label = lightOnly
          ? (extras.label ?? 'Lights')
          : (part?.partId.replaceAll('_', ' ') ?? extras.label ?? 'Item')
        door = {
          label,
          isOpen,
          verb: lightOnly || isSpin ? (isOpen ? 'turn off' : 'turn on') : isOpen ? 'close' : 'open',
        }
        doorId = `${extras.pascalId}:${part?.partId ?? 'all'}`
      } else if (node && item) {
        doorNode = { hit: hit.object, node }
        doorId = item.pascalId
        const prompt = itemPrompt(item.pascalId, item.label, item.interactive)
        door = { label: prompt.label, isOpen: prompt.isOn, verb: prompt.verb }
      } else if (node && extras?.openable && extras.clips?.length) {
        doorNode = { hit: hit.object, node }
        doorId = extras.pascalId as string
        door = { label: extras.label ?? 'Door', isOpen: openIds.current.has(doorId) }
      } else if (node && extras?.pascalId && loopMechanisms.has(extras.pascalId)) {
        doorNode = { hit: hit.object, node }
        doorId = extras.pascalId
        const isOpen = Boolean(useInteractive.getState().mechanisms[doorId as AnyNodeId])
        door = { label: extras.label ?? 'Item', isOpen, verb: isOpen ? 'turn off' : 'turn on' }
      }
    }
    walkDoorRef.current = doorNode

    const key = `${floor?.id ?? ''}|${zone?.id ?? ''}|${door ? `${doorId}:${door.isOpen}` : ''}`
    if (key !== lastWalkKey.current) {
      lastWalkKey.current = key
      onWalkthroughChange?.({ zoneLabel: zone?.label ?? null, floorLabel, door })
    }
  })

  // E or click activates the openable in view. The click also re-locks the
  // pointer through the walkthrough controller; no selection happens.
  const activateWalkDoor = useCallback(() => {
    const target = walkDoorRef.current
    if (!target) return
    const item = toggleableItem((target.node.userData as PascalExtras).pascalId)
    if (item) {
      operateItem(item.pascalId, item.interactive)
      return
    }
    if (!(toggleProcedural(target.hit, target.node) || toggleLoopMechanism(target.node)))
      toggleOpenable(target.node)
  }, [toggleableItem, toggleLoopMechanism, toggleOpenable, toggleProcedural])
  useEffect(() => {
    if (!walkthroughMode) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'e') activateWalkDoor()
    }
    const canvas = document.querySelector('canvas')
    window.addEventListener('keydown', onKey)
    canvas?.addEventListener('click', activateWalkDoor)
    return () => {
      window.removeEventListener('keydown', onKey)
      canvas?.removeEventListener('click', activateWalkDoor)
    }
  }, [walkthroughMode, activateWalkDoor])

  // Clear the HUD (and stale targeting) whenever walkthrough turns off.
  useEffect(() => {
    if (walkthroughMode) return
    walkDoorRef.current = null
    lastWalkKey.current = null
    onWalkthroughChange?.(null)
  }, [walkthroughMode, onWalkthroughChange])

  const lastHover = useRef<string | null>(null)
  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      if (walkthroughMode || !onPick) return
      const pick = resolveGlbPick(event.intersections, identity)
      document.body.style.cursor = pick ? 'pointer' : 'auto'
      const key = pick ? `${pick.nodeId}:${pick.point?.join(',') ?? ''}` : null
      if (key === lastHover.current) return
      lastHover.current = key
      onPick({ type: 'hover', pick, modifiers: modifiersOf(event.nativeEvent) })
    },
    [identity, onPick, walkthroughMode],
  )

  const handlePointerOut = useCallback(() => {
    document.body.style.cursor = 'auto'
    if (lastHover.current === null) return
    lastHover.current = null
    onPick?.({ type: 'hover', pick: null, modifiers: NO_MODIFIERS })
  }, [onPick])

  // The host's rules decide the selection; an openable the click selects (a
  // door, a window, an item with an `open` clip, a mechanism) also plays.
  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      // Walkthrough handles its own door activation (E / canvas click) and never
      // selects.
      if (walkthroughMode || !onPick) return
      const pick = resolveGlbPick(event.intersections, identity)
      onPick({ type: 'click', pick, modifiers: modifiersOf(event.nativeEvent) })
      if (!pick || !useViewer.getState().selection.selectedIds.includes(pick.nodeId)) return
      const object = identity.get(pick.nodeId)
      if (!object) return
      if (
        !(
          toggleOpenControl(object) ||
          toggleProcedural(pick.hitObject, object) ||
          toggleLoopMechanism(object)
        )
      )
        toggleOpenable(object)
    },
    [
      identity,
      onPick,
      toggleLoopMechanism,
      toggleOpenControl,
      toggleOpenable,
      toggleProcedural,
      walkthroughMode,
    ],
  )

  // A click on empty space clears the room and the element (the floor stays).
  const handlePointerMissed = useCallback(
    (event: MouseEvent) => {
      if (useViewer.getState().walkthroughMode || !onPick) return
      onPick({ type: 'click', pick: null, modifiers: modifiersOf(event) })
    },
    [onPick],
  )

  useEffect(
    () => () => {
      const { outliner } = useViewer.getState()
      outliner.selectedObjects.length = 0
      outliner.hoveredObjects.length = 0
      document.body.style.cursor = 'auto'
      // Restore ceilings/roof — the GLB scene is cached by drei and may be reused.
      for (const mesh of occluderOwnMeshes) clearShadowOnly(mesh)
    },
    [occluderOwnMeshes],
  )

  return (
    <group ref={rootRef}>
      <primitive
        object={gltf.scene}
        onClick={handleClick}
        onPointerMissed={handlePointerMissed}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
      />
      {/* Re-light + re-animate the baked artifact from the DB scene graph,
          joined to the baked nodes by pascalId. */}
      {interactiveItems?.length ? (
        <GlbInteractive
          actions={actions}
          identity={identity}
          items={interactiveItems}
          levelOrder={levelOrder}
          zones={zoneEntries}
        />
      ) : null}
      {/* Scans + guides, stripped from the bake and re-added from scene data,
          anchored to their parent level's baked node. */}
      {referenceNodes?.length ? (
        <GlbReferenceNodes identity={identity} nodes={referenceNodes} />
      ) : null}
      {/* `bake: 'replace'` nodes (plugin trees): baked meshes hidden above, the
          live instanced render portaled per level via each kind's bakeReplaceRenderer. */}
      {replaceNodes?.length ? (
        <GlbReplaceInstances identity={identity} nodes={replaceNodes} />
      ) : null}
    </group>
  )
}

const NO_MODIFIERS: GlbPickEvent['modifiers'] = {
  alt: false,
  ctrl: false,
  meta: false,
  shift: false,
}

function modifiersOf(event: MouseEvent): GlbPickEvent['modifiers'] {
  return { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey }
}
