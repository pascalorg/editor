'use client'

import type { AnyNode, SurfaceRole } from '@pascal-app/core'
import { Html, useAnimations } from '@react-three/drei'
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { lerp } from 'three/src/math/MathUtils.js'
import { color, float, uniform, uv } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useGLTFKTX2 } from '../../hooks/use-gltf-ktx2'
import { ZONE_LAYER } from '../../lib/layers'
import { createSurfaceRoleMaterial } from '../../lib/materials'
import useViewer from '../../store/use-viewer'
import { GlbInteractive, type GlbInteractiveItem } from './glb-interactive'
import { GlbReferenceNodes } from './glb-reference-nodes'

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

/** A building floor discovered in the baked GLB, ordered bottom-to-top. */
export type GlbLevel = { id: `level_${string}`; label: string }

/** pascalId → display info, reported so a host can label the breadcrumb. */
export type GlbIdentity = Record<string, { kind: string; label: string }>

/** What the cursor would act on at the current drill depth (for a hover label). */
export type GlbHover = { kind: string; label: string } | null

/** Walkthrough HUD state, reported each frame: the floor/room the camera is in
 *  and the openable door/window directly in view (for the reticle prompt). */
export type GlbWalkthrough = {
  zoneLabel: string | null
  floorLabel: string | null
  door: { label: string; isOpen: boolean } | null
} | null

type GlbLevelEntry = { id: GlbLevel['id']; node: THREE.Object3D; baseY: number }
type GlbZoneEntry = {
  id: string
  node: THREE.Object3D
  levelId: string | null
  polygon: [number, number][]
  label: string
  color: string
  /** Polygon centroid (zone-local x, z) for placing the room label. */
  centroid: [number, number]
}

type PascalExtras = {
  pascalId?: string
  kind?: string
  label?: string
  openable?: boolean
  clips?: string[]
  polygon?: [number, number][]
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

/** The resolved drill target for a raycast hit, given the current selection. */
type Target = { object: THREE.Object3D; id: string; kind: string; label: string }
type HitCandidate = { object: THREE.Object3D; point?: THREE.Vector3 }

function findIdentityAncestor(object: THREE.Object3D): THREE.Object3D | null {
  let current: THREE.Object3D | null = object
  while (current) {
    if ((current.userData as PascalExtras).pascalId) return current
    current = current.parent
  }
  return null
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
const _floorHit = new THREE.Vector3()
const _floorPlanePoint = new THREE.Vector3()
const _floorPlane = new THREE.Plane()
const _up = new THREE.Vector3(0, 1, 0)
const _bounds = new THREE.Box3()
const _boundsCenter = new THREE.Vector3()
const _sample = new THREE.Vector3()
const _camBox = new THREE.Box3()
const _camCenter = new THREE.Vector3()
const _camSize = new THREE.Vector3()
const _camPoint = new THREE.Vector3()
const _walkPos = new THREE.Vector3()
const _reticleNdc = new THREE.Vector2(0, 0)
const _reticleRaycaster = new THREE.Raycaster()
/** How far ahead (metres) a door/window counts as "in view" for activation. */
const WALK_REACH = 3
const ZONE_FOOTPRINT_EPSILON = 0.05

const NO_RAYCAST: THREE.Mesh['raycast'] = () => {}

/** Ray-cast point-in-polygon (polygon is a list of [x, z] in the test frame). */
function pointInPolygon(x: number, z: number, polygon: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function pointOnSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  if (lengthSq === 0) return Math.hypot(x - ax, z - az) <= ZONE_FOOTPRINT_EPSILON
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq))
  const px = ax + t * dx
  const pz = az + t * dz
  return Math.hypot(x - px, z - pz) <= ZONE_FOOTPRINT_EPSILON
}

function pointInPolygonInclusive(x: number, z: number, polygon: [number, number][]): boolean {
  if (pointInPolygon(x, z, polygon)) return true
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (pointOnSegment(x, z, xi, zi, xj, zj)) return true
  }
  return false
}

function worldPointInZoneFootprint(worldPoint: THREE.Vector3, zone: GlbZoneEntry): boolean {
  _local.copy(worldPoint)
  zone.node.worldToLocal(_local)
  return pointInPolygonInclusive(_local.x, _local.z, zone.polygon)
}

function objectFootprintTouchesZone(object: THREE.Object3D, zone: GlbZoneEntry): boolean {
  _bounds.setFromObject(object)
  if (_bounds.isEmpty()) {
    object.getWorldPosition(_sample)
    return worldPointInZoneFootprint(_sample, zone)
  }

  _bounds.getCenter(_boundsCenter)
  const y = _bounds.min.y
  const samples: Array<[number, number]> = [
    [_boundsCenter.x, _boundsCenter.z],
    [_bounds.min.x, _bounds.min.z],
    [_bounds.min.x, _bounds.max.z],
    [_bounds.max.x, _bounds.min.z],
    [_bounds.max.x, _bounds.max.z],
  ]

  for (const [x, z] of samples) {
    _sample.set(x, y, z)
    if (worldPointInZoneFootprint(_sample, zone)) return true
  }
  return false
}

const Y_OFFSET = 0.01
const ZONE_WALL_HEIGHT = 2.3

/** Floor fill — flat 0.25 tint scaled by the fade uniform (matches the editor). */
function createZoneFloorMaterial(zoneColor: string) {
  const o = uniform(0)
  const material = new MeshBasicNodeMaterial({
    colorNode: color(new THREE.Color(zoneColor)),
    depthTest: false,
    depthWrite: false,
    opacityNode: float(0.25).mul(o),
    side: THREE.DoubleSide,
    transparent: true,
  })
  material.userData.uOpacity = o
  return material
}

/** Vertical border — color at the base fading to transparent at the top. */
function createZoneWallMaterial(zoneColor: string) {
  const o = uniform(0)
  const material = new MeshBasicNodeMaterial({
    colorNode: color(new THREE.Color(zoneColor)),
    depthTest: false,
    depthWrite: false,
    opacityNode: float(0.6).mul(float(1).sub(uv().y)).mul(o),
    side: THREE.DoubleSide,
    transparent: true,
  })
  material.userData.uOpacity = o
  return material
}

/** Vertical quads along each polygon edge (UV.y 0 at the floor, 1 at the top). */
function createZoneWallGeometry(polygon: [number, number][]): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i < polygon.length; i++) {
    const [cx, cz] = polygon[i]!
    const [nx, nz] = polygon[(i + 1) % polygon.length]!
    const base = i * 4
    positions.push(
      cx,
      Y_OFFSET,
      cz,
      nx,
      Y_OFFSET,
      nz,
      nx,
      Y_OFFSET + ZONE_WALL_HEIGHT,
      nz,
      cx,
      Y_OFFSET + ZONE_WALL_HEIGHT,
      cz,
    )
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * GLB-consuming viewer scene (plan phase 2). Loads a baked artifact and drives
 * the editor's presentation/interaction with no parametric scene graph. Hover
 * and click resolve through the drill hierarchy (building → level → zone →
 * object): the cursor targets the floor in the building view, the room or
 * structure in a level, and items/structure inside a room. Selection feeds the
 * existing outline post-FX, openables play their baked clips, and the shared
 * `useViewer.selection` (with its hierarchy guard) holds the drill state. The
 * host disables the parametric `SelectionManager` (`selectionManager="custom"`).
 */
export function GlbScene({
  url,
  interactiveItems,
  referenceNodes,
  onLevelsChange,
  onIdentityChange,
  onHoverChange,
  onWalkthroughChange,
}: {
  url: string
  /** Light / animation effects + controls recovered from the DB scene graph,
   *  joined to the baked nodes by `pascalId` to re-light + re-animate the GLB. */
  interactiveItems?: GlbInteractiveItem[]
  /** Scan / guide nodes from the scene graph, re-added at runtime (they're
   *  stripped from the bake). Already filtered by the privacy flags upstream. */
  referenceNodes?: AnyNode[]
  onLevelsChange?: (levels: GlbLevel[]) => void
  onIdentityChange?: (identity: GlbIdentity) => void
  onHoverChange?: (hover: GlbHover) => void
  onWalkthroughChange?: (state: GlbWalkthrough) => void
}) {
  const gltf = useGLTFKTX2(url) as unknown as {
    scene: THREE.Group
    animations: THREE.AnimationClip[]
  }
  const rootRef = useRef<THREE.Group>(null!)
  const { actions } = useAnimations(gltf.animations, rootRef)
  const camera = useThree((state) => state.camera)
  const raycaster = useThree((state) => state.raycaster)
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
        if (!mesh.isMesh || mesh.layers.isEnabled(ZONE_LAYER)) return
        const ud = mesh.userData as { __bakedMaterial?: THREE.Material | THREE.Material[] }
        if (!ud.__bakedMaterial) ud.__bakedMaterial = mesh.material
        mesh.material = textures
          ? ud.__bakedMaterial
          : createSurfaceRoleMaterial(role, 'clay', THREE.DoubleSide, sceneTheme)
      })
    })
  }, [gltf.scene, textures, sceneTheme])

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
      if (extras.kind === 'building') buildingNode = object
      else if (extras.kind === 'site') siteNode = object
      if (extras.kind === 'ceiling' || extras.kind === 'roof') occluderNodes.push(object)
      if (extras.kind === 'level') {
        floors.push({
          id: extras.pascalId as GlbLevel['id'],
          node: object,
          baseY: object.position.y,
        })
      }
      if (extras.kind === 'zone' && extras.polygon && extras.polygon.length >= 3) {
        const polygon = extras.polygon
        const centroid: [number, number] = [
          polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length,
          polygon.reduce((sum, [, z]) => sum + z, 0) / polygon.length,
        ]
        zoneList.push({
          id: extras.pascalId,
          node: object,
          levelId: findAncestorLevelId(object),
          polygon,
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
  const zoneById = useMemo(() => new Map(zoneEntries.map((zone) => [zone.id, zone])), [zoneEntries])
  // Level pascalIds bottom-to-top, for the interactive light pool's level factor.
  const levelOrder = useMemo(() => levels.map((entry) => entry.id), [levels])

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

  // Move the camera to match the drill depth: a saved bookmark (extras.camera)
  // wins; otherwise fit to the target's bounds (the object, the room's polygon
  // footprint for empty zone nodes, the level, or the whole building). Mirrors
  // the parametric viewer's selection framing so the GLB path feels identical.
  const focusLevelId = useViewer((s) => s.selection.levelId)
  const focusZoneId = useViewer((s) => s.selection.zoneId)
  const focusSelectedId = useViewer((s) => s.selection.selectedIds[0] ?? null)
  useEffect(() => {
    if (!controls) return
    const flyToBookmark = (bookmark: NonNullable<PascalExtras['camera']>) => {
      const { position: p, target: t } = bookmark
      controls.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], true)
      controls.normalizeRotations?.()
    }

    // Item selection happens inside a room, where we're already at a good angle:
    // fly to the item's own bookmark if it has one, otherwise just pan to it
    // (keep the current orbit angle + distance) rather than reframing the camera.
    if (focusSelectedId) {
      const object = identity.get(focusSelectedId)
      if (!object) return
      const itemBookmark = (object.userData as PascalExtras).camera
      if (itemBookmark) {
        flyToBookmark(itemBookmark)
        return
      }
      _camBox.makeEmpty()
      _camBox.setFromObject(object)
      if (_camBox.isEmpty()) return
      _camBox.getCenter(_camCenter)
      controls.moveTo?.(_camCenter.x, _camCenter.y, _camCenter.z, true)
      return
    }

    let bookmarkNode: THREE.Object3D | null = null
    _camBox.makeEmpty()
    if (focusZoneId) {
      const zone = zoneById.get(focusZoneId)
      if (!zone) return
      bookmarkNode = zone.node
      // Zone identity nodes carry no mesh — bound the room from its polygon.
      zone.node.updateWorldMatrix(true, false)
      for (const [x, z] of zone.polygon) {
        _camBox.expandByPoint(_camPoint.set(x, 0, z).applyMatrix4(zone.node.matrixWorld))
        _camBox.expandByPoint(
          _camPoint.set(x, ZONE_WALL_HEIGHT, z).applyMatrix4(zone.node.matrixWorld),
        )
      }
    } else if (focusLevelId) {
      const object = identity.get(focusLevelId)
      if (!object) return
      bookmarkNode = object
      _camBox.setFromObject(object)
    } else {
      bookmarkNode = rootNode
      _camBox.setFromObject(gltf.scene)
    }

    const bookmark = (bookmarkNode?.userData as PascalExtras | undefined)?.camera
    if (bookmark) {
      flyToBookmark(bookmark)
      return
    }
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
  }, [
    controls,
    focusSelectedId,
    focusZoneId,
    focusLevelId,
    identity,
    zoneById,
    rootNode,
    gltf.scene,
  ])

  useEffect(() => {
    const cameraMask = camera.layers.mask
    const raycasterMask = raycaster.layers.mask
    camera.layers.enable(ZONE_LAYER)
    raycaster.layers.disable(ZONE_LAYER)
    return () => {
      camera.layers.mask = cameraMask
      raycaster.layers.mask = raycasterMask
    }
  }, [camera, raycaster])

  useEffect(() => {
    onLevelsChange?.(
      levels.map(({ id, node }) => ({ id, label: (node.userData as PascalExtras).label ?? id })),
    )
    const labels: GlbIdentity = {}
    identity.forEach((object, id) => {
      const extras = object.userData as PascalExtras
      labels[id] = { kind: extras.kind ?? 'node', label: extras.label ?? id }
    })
    onIdentityChange?.(labels)
    return () => {
      onLevelsChange?.([])
      onIdentityChange?.({})
    }
  }, [levels, identity, onLevelsChange, onIdentityChange])

  // Apply the editor's level modes to the baked floors each frame. Walkthrough
  // always shows the full stacked building (you're standing inside it) — and the
  // first-person collider is built from the visible meshes, so a hidden solo
  // floor would otherwise drop the player through the world.
  useFrame((_, delta) => {
    if (levels.length === 0) return
    const { levelMode, selection, walkthroughMode } = useViewer.getState()
    const selectedLevel = selection.levelId
    levels.forEach(({ id, node, baseY }, index) => {
      const exploded = !walkthroughMode && levelMode === 'exploded'
      const targetY = baseY + (exploded ? index * EXPLODED_GAP : 0)
      // Snap (not lerp) in walkthrough so the first-person collider, built from
      // these world positions, matches the stacked building immediately.
      node.position.y = walkthroughMode ? targetY : lerp(node.position.y, targetY, delta * 12)
      node.visible =
        walkthroughMode || levelMode !== 'solo' || !selectedLevel || id === selectedLevel
    })
  }, 5)

  // Reconstruct each room from `extras.polygon` as the editor renders it: a flat
  // floor fill plus vertical gradient borders (color at the base fading up). The
  // geometry isn't baked (engine-agnostic GLB); /viewer rebuilds it, parented to
  // the zone node so it rides level stacking. Both meshes live on ZONE_LAYER so
  // the post-FX zone pass composites them (the default scene pass skips them).
  type ZoneFill = {
    id: string
    levelId: string | null
    meshes: THREE.Mesh[]
    uniforms: { value: number }[]
  }
  const zoneFills = useRef<ZoneFill[]>([])
  useEffect(() => {
    const built: ZoneFill[] = []
    for (const entry of zoneEntries) {
      const shape = new THREE.Shape()
      entry.polygon.forEach(([x, z], i) => {
        if (i === 0) shape.moveTo(x, -z)
        else shape.lineTo(x, -z)
      })
      shape.closePath()

      const floorMaterial = createZoneFloorMaterial(entry.color)
      const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial)
      floor.rotation.x = -Math.PI / 2
      floor.position.y = 0.02

      const wallMaterial = createZoneWallMaterial(entry.color)
      const walls = new THREE.Mesh(createZoneWallGeometry(entry.polygon), wallMaterial)

      const meshes = [floor, walls]
      for (const mesh of meshes) {
        mesh.visible = false
        mesh.layers.set(ZONE_LAYER)
        // Visual helpers only — never participate in picking. Hover/selection
        // resolves against the real building geometry + point-in-polygon, so the
        // tall wall helpers can't occlude items or fight at shared boundaries.
        mesh.raycast = NO_RAYCAST
        entry.node.add(mesh)
      }
      built.push({
        id: entry.id,
        levelId: entry.levelId,
        meshes,
        uniforms: [
          floorMaterial.userData.uOpacity as { value: number },
          wallMaterial.userData.uOpacity as { value: number },
        ],
      })
    }
    zoneFills.current = built
    return () => {
      for (const { meshes } of built) {
        for (const mesh of meshes) {
          mesh.removeFromParent()
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose()
        }
      }
      zoneFills.current = []
    }
  }, [zoneEntries])

  useEffect(() => {
    for (const [name, action] of Object.entries(actions)) {
      if (!action) continue
      // Ambient item loops (a fan's spin, `<id>: loop`) repeat; door/window
      // open clips play once and hold their end pose. GlbInteractive plays the
      // loops, gated on the item's toggle.
      if (name.endsWith(': loop')) {
        action.loop = THREE.LoopRepeat
        action.clampWhenFinished = false
      } else {
        action.loop = THREE.LoopOnce
        action.clampWhenFinished = true
      }
    }
  }, [actions])

  const openIds = useRef(new Set<string>())
  const toggleOpenable = useCallback(
    (node: THREE.Object3D) => {
      const extras = node.userData as PascalExtras
      const clipName = extras.clips?.[0]
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
        if (pointInPolygonInclusive(_local.x, _local.z, entry.polygon)) return entry
      }
      return null
    },
    [zoneEntries],
  )

  // The room the cursor points at, found by intersecting the pointer ray with the
  // level's floor plane — independent of what 3D object the ray actually hits.
  // This is the editor's model: zone helpers and walls are ignored, so adjacent
  // rooms never fight and an item against a wall still maps to its own room.
  const zoneAtRay = useCallback(
    (ray: THREE.Ray, levelId: string): GlbZoneEntry | null => {
      const levelNode = identity.get(levelId)
      const floorY = levelNode ? levelNode.getWorldPosition(_floorPlanePoint).y : 0
      _floorPlane.setFromNormalAndCoplanarPoint(_up, _floorPlanePoint.set(0, floorY, 0))
      if (!ray.intersectPlane(_floorPlane, _floorHit)) return null
      return zoneAtPoint(_floorHit, levelId)
    },
    [identity, zoneAtPoint],
  )

  // Resolve a pointer ray to the unit the current drill depth acts on:
  //  - building view → the floor the hit object belongs to
  //  - level view    → the room the cursor points at on the floor
  //  - zone view     → the first hit node whose hit/footprint is inside the room
  const resolveTarget = useCallback(
    (hits: HitCandidate[], ray: THREE.Ray): Target | null => {
      const firstNode = hits.length > 0 ? findIdentityAncestor(hits[0]!.object) : null
      const toTarget = (object: THREE.Object3D, tid: string): Target => {
        const e = object.userData as PascalExtras
        return { object, id: tid, kind: e.kind ?? 'node', label: e.label ?? tid }
      }
      const { selection } = useViewer.getState()

      // Building view → drill to the floor the hit object belongs to.
      if (!selection.levelId) {
        if (!firstNode) return null
        const extras = firstNode.userData as PascalExtras
        const levelId = extras.kind === 'level' ? extras.pascalId : findAncestorLevelId(firstNode)
        const levelObject = levelId ? identity.get(levelId) : undefined
        return levelObject && levelId ? toTarget(levelObject, levelId) : null
      }

      // Level view → the room the cursor is over (floor-plane intersection).
      if (!selection.zoneId) {
        const zone = zoneAtRay(ray, selection.levelId)
        return zone ? toTarget(zone.node, zone.id) : null
      }

      // Zone view → scan through all R3F intersections so room helpers or slabs
      // can't hide a selectable item/structure behind the first hit.
      const activeZone = zoneById.get(selection.zoneId)
      if (!activeZone) return null
      const seen = new Set<string>()
      for (const hit of hits) {
        const node = findIdentityAncestor(hit.object)
        if (!node) continue
        const extras = node.userData as PascalExtras
        const id = extras.pascalId
        if (!id || seen.has(id)) continue
        seen.add(id)

        const kind = extras.kind ?? 'node'
        if (kind === 'site' || kind === 'building' || kind === 'level' || kind === 'zone') {
          continue
        }
        const hitLevel = findAncestorLevelId(node)
        if (hitLevel !== selection.levelId) continue
        if (hit.point && worldPointInZoneFootprint(hit.point, activeZone)) {
          return toTarget(node, id)
        }
        if (objectFootprintTouchesZone(node, activeZone)) {
          return toTarget(node, id)
        }
      }
      return null
    },
    [identity, zoneAtRay, zoneById],
  )

  // DOM nodes for each zone's floating room label, plus a group whose transform
  // tracks the zone node so the label rides level stacking.
  const labelGroups = useRef(new Map<string, THREE.Group>())
  const labelDivs = useRef(new Map<string, HTMLDivElement>())

  // Per-frame: fade a level's rooms in/out (hidden once a zone is entered, like
  // the editor) with a brightness bump on the hovered room, keep room labels
  // positioned + faded with them, and sync the outline post-FX from the shared
  // selection + local hover.
  const hoveredTarget = useRef<Target | null>(null)
  useFrame((_, delta) => {
    const state = useViewer.getState()
    const { selection, outliner } = state
    const t = Math.min(1, delta * 8)
    const hoveredZoneId = hoveredTarget.current?.kind === 'zone' ? hoveredTarget.current.id : null

    // Walkthrough is a first-person tour: no zone tints, no dollhouse cutaway,
    // no selection outline — you're standing inside the real building.
    const walk = state.walkthroughMode

    // Dollhouse: hide ceilings + roof so the rooms (and their zone tint) are
    // visible from above and the ray reaches their contents — but only when the
    // focused level actually has rooms. Focusing a zone-less floor keeps the
    // building intact (otherwise its roof would just vanish with nothing to show).
    const revealing = !walk && selection.levelId != null && levelsWithZones.has(selection.levelId)
    for (const mesh of occluderOwnMeshes) mesh.visible = !revealing

    for (const { id, levelId, meshes, uniforms } of zoneFills.current) {
      const show =
        !walk && selection.levelId != null && levelId === selection.levelId && !selection.zoneId
      const target = !show ? 0 : id === hoveredZoneId ? 1 : 0.65
      let visible = false
      for (const u of uniforms) {
        u.value = lerp(u.value, target, t)
        if (u.value > 0.01) visible = true
      }
      for (const mesh of meshes) mesh.visible = visible

      const group = labelGroups.current.get(id)
      const zoneNode = identity.get(id)
      if (group && zoneNode) {
        group.matrixAutoUpdate = false
        group.matrix.copy(zoneNode.matrixWorld)
        group.visible = visible
      }
      const div = labelDivs.current.get(id)
      if (div) {
        div.style.opacity = show ? '1' : '0'
        // Small by default, smoothly zooming up when its room is hovered.
        div.style.transform = `scale(${id === hoveredZoneId ? 1 : 0.82})`
      }
    }

    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0
    if (walk) return

    const selectedObject = selection.selectedIds[0]
      ? (identity.get(selection.selectedIds[0]) ?? null)
      : null
    if (selectedObject) outliner.selectedObjects.push(selectedObject)
    // Rooms show hover via the fill brightness; everything else uses the outline.
    const hover = hoveredTarget.current
    if (hover && hover.kind !== 'zone' && hover.object !== selectedObject) {
      outliner.hoveredObjects.push(hover.object)
    }
  })

  // ── Walkthrough: first-person HUD + door/window interaction ────────────────
  const walkDoorRef = useRef<THREE.Object3D | null>(null)
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
    let doorNode: THREE.Object3D | null = null
    let doorId = ''
    let door: { label: string; isOpen: boolean } | null = null
    if (hit) {
      const node = findIdentityAncestor(hit.object)
      const extras = node?.userData as PascalExtras | undefined
      if (node && extras?.openable && extras.clips?.length) {
        doorNode = node
        doorId = extras.pascalId as string
        door = { label: extras.label ?? 'Door', isOpen: openIds.current.has(doorId) }
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
  // pointer via WalkthroughControls — harmless overlap; no selection happens.
  const activateWalkDoor = useCallback(() => {
    if (walkDoorRef.current) toggleOpenable(walkDoorRef.current)
  }, [toggleOpenable])
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
      if (walkthroughMode) return
      const target = resolveTarget(
        event.intersections.map((hit) => ({ object: hit.object, point: hit.point })),
        event.ray,
      )
      hoveredTarget.current = target
      document.body.style.cursor = target ? 'pointer' : 'auto'
      const key = target ? `${target.kind}:${target.id}` : null
      if (key !== lastHover.current) {
        lastHover.current = key
        onHoverChange?.(target ? { kind: target.kind, label: target.label } : null)
      }
    },
    [resolveTarget, onHoverChange, walkthroughMode],
  )

  const handlePointerOut = useCallback(() => {
    hoveredTarget.current = null
    document.body.style.cursor = 'auto'
    if (lastHover.current !== null) {
      lastHover.current = null
      onHoverChange?.(null)
    }
  }, [onHoverChange])

  // Drill the building → level → zone → object hierarchy, deselecting back up
  // when the click lands outside the current scope. setSelection's hierarchy
  // guard clears deeper selections automatically when a parent changes.
  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      // Walkthrough handles its own door activation (E / canvas click) and never
      // selects — leave the drill hierarchy untouched.
      if (walkthroughMode) return
      const target = resolveTarget(
        event.intersections.map((hit) => ({ object: hit.object, point: hit.point })),
        event.ray,
      )
      const { selection, setSelection, setLevelMode } = useViewer.getState()

      // Building view → drill into the clicked floor.
      if (!selection.levelId) {
        if (target) {
          setLevelMode('solo')
          setSelection({ levelId: target.id as `level_${string}` })
        }
        return
      }

      // Level view → enter the clicked room; clicking outside any room exits to
      // the building.
      if (!selection.zoneId) {
        if (target) {
          setSelection({ zoneId: target.id as `zone_${string}` })
        } else {
          setLevelMode('stacked')
          setSelection({ levelId: null })
        }
        return
      }

      // Zone view → select the clicked node; clicking outside the room exits to
      // the level.
      if (target) {
        setSelection({ selectedIds: [target.id] })
        toggleOpenable(target.object)
      } else {
        setSelection({ zoneId: null })
      }
    },
    [resolveTarget, toggleOpenable, walkthroughMode],
  )

  // A click that hits nothing (empty space) steps one level back up the drill
  // hierarchy, like the legacy viewer.
  const handlePointerMissed = useCallback(() => {
    if (useViewer.getState().walkthroughMode) return
    const { selection, setSelection, setLevelMode } = useViewer.getState()
    if (selection.selectedIds.length > 0) {
      setSelection({ selectedIds: [] })
    } else if (selection.zoneId) {
      setSelection({ zoneId: null })
    } else if (selection.levelId) {
      setLevelMode('stacked')
      setSelection({ levelId: null })
    }
  }, [])

  useEffect(
    () => () => {
      const { outliner } = useViewer.getState()
      outliner.selectedObjects.length = 0
      outliner.hoveredObjects.length = 0
      document.body.style.cursor = 'auto'
      // Restore ceilings/roof — the GLB scene is cached by drei and may be reused.
      for (const mesh of occluderOwnMeshes) mesh.visible = true
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
      {/* Floating room labels. Each group's matrix is synced to its zone node
          every frame (above) so the label rides level stacking; the div fades
          with the room fill via a CSS transition. */}
      {zoneEntries.map((zone) => (
        <group
          key={zone.id}
          ref={(group) => {
            if (group) labelGroups.current.set(zone.id, group)
            else labelGroups.current.delete(zone.id)
          }}
        >
          <Html
            center
            position={[zone.centroid[0], 1, zone.centroid[1]]}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
            zIndexRange={[10, 0]}
          >
            <div
              ref={(div) => {
                if (div) labelDivs.current.set(zone.id, div)
                else labelDivs.current.delete(zone.id)
              }}
              style={{
                color: 'white',
                opacity: 0,
                textShadow: `-1px -1px 0 ${zone.color}, 1px -1px 0 ${zone.color}, -1px 1px 0 ${zone.color}, 1px 1px 0 ${zone.color}`,
                transform: 'scale(0.82)',
                transformOrigin: 'center',
                transition: 'opacity 0.3s ease-in-out, transform 0.2s ease-out',
                whiteSpace: 'nowrap',
              }}
            >
              {zone.label}
            </div>
          </Html>
        </group>
      ))}
    </group>
  )
}
