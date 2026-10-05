import type {
  CompiledGeometryScript,
  GeometryArtifactManifest,
  GeometryScriptMount,
  GeometryScriptParamSpec,
  GeometryScriptParamValue,
} from '@pascal-app/core'
import { type Ring, union } from '@pascal-app/core/polygon-boolean'
import { GEOMETRY_MANIFEST_MAX_BYTES, GEOMETRY_SCRIPT_MAX_BYTES } from '@pascal-app/core/schema'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { LoftGeometry } from 'three/examples/jsm/geometries/LoftGeometry.js'
import * as ParametricFunctions from 'three/examples/jsm/geometries/ParametricFunctions.js'
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ADDITION, Brush, DIFFERENCE, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg'
import { type ModuleTable, transformModule } from './transform'

export type { GeometryScriptMount }

export type GeometryScriptCompileInput = {
  code: string
  params?: Record<string, GeometryScriptParamValue>
}

export type GeometryScriptCompileOutput = CompiledGeometryScript & { glb: ArrayBuffer }

export const GEOMETRY_SCRIPT_LIMITS = {
  triangles: 300_000,
  materials: 32,
  extent: 60,
} as const

const csg = { ADDITION, Brush, DIFFERENCE, Evaluator, INTERSECTION, SUBTRACTION }

const MODULES: ModuleTable = {
  three: THREE as unknown as Record<string, unknown>,
  'three-bvh-csg': csg,
  BufferGeometryUtils: BufferGeometryUtils as unknown as Record<string, unknown>,
  ConvexGeometry: { ConvexGeometry },
  LoftGeometry: { LoftGeometry },
  ParametricGeometry: { ParametricGeometry },
  ParametricFunctions: ParametricFunctions as unknown as Record<string, unknown>,
  RoundedBoxGeometry: { RoundedBoxGeometry },
}

const LIB = {
  BufferGeometryUtils,
  ConvexGeometry,
  LoftGeometry,
  ParametricGeometry,
  ParametricFunctions,
  RoundedBoxGeometry,
  csg,
}

const MOUNTS = new Set<GeometryScriptMount>(['floor', 'wall', 'wall-side', 'ceiling'])

type RawParam =
  | GeometryScriptParamValue
  | {
      default?: GeometryScriptParamValue
      value?: GeometryScriptParamValue
      min?: number
      max?: number
      step?: number
      unit?: string
      label?: string
      options?: string[]
    }

function readParamSpecs(raw: unknown): GeometryScriptParamSpec[] {
  if (raw == null) return []
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('`params` must be an object of { id: default | { default, min, max, step } }')
  }
  return Object.entries(raw as Record<string, RawParam>).map(([id, spec]) => {
    const described = spec !== null && typeof spec === 'object' && !Array.isArray(spec)
    const value = described ? (spec.default ?? spec.value) : spec
    if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') {
      throw new Error(`Param "${id}" needs a number, boolean or string default`)
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Param "${id}" default is not finite`)
    }
    const kind = typeof value as GeometryScriptParamSpec['kind']
    return described
      ? {
          id,
          kind,
          default: value,
          label: spec.label,
          min: spec.min,
          max: spec.max,
          step: spec.step,
          unit: spec.unit,
          options: spec.options,
        }
      : { id, kind, default: value }
  })
}

function resolveParams(
  specs: GeometryScriptParamSpec[],
  overrides: Record<string, GeometryScriptParamValue>,
): Record<string, GeometryScriptParamValue> {
  const values: Record<string, GeometryScriptParamValue> = {}
  for (const spec of specs) {
    const override = overrides[spec.id]
    let value = typeof override === typeof spec.default ? override! : spec.default
    if (typeof value === 'string' && spec.options && !spec.options.includes(value))
      value = spec.default
    if (typeof value === 'number') {
      if (spec.min !== undefined) value = Math.max(spec.min, value)
      if (spec.max !== undefined) value = Math.min(spec.max, value)
    }
    values[spec.id] = value
  }
  return values
}

const conventionId = (name: string, prefix: string): string | null => {
  if (!name.startsWith(prefix)) return null
  const id = name.slice(prefix.length).trim()
  return id.length > 0 ? id : null
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const isCutter = (name: string) => /^(cutout|cut:(wall|ceiling|slab))$/.test(name)
const isHelper = (object: THREE.Object3D) => isCutter(object.name) || object.name === 'collider'

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex()
  return Math.floor((index ? index.count : (geometry.getAttribute('position')?.count ?? 0)) / 3)
}

function assertFinite(geometry: THREE.BufferGeometry, label: string) {
  const position = geometry.getAttribute('position')
  if (!position) throw new Error(`${label} has no position attribute`)
  const array = position.array as ArrayLike<number>
  for (let i = 0; i < array.length; i++) {
    if (!Number.isFinite(array[i]!)) throw new Error(`${label} has non-finite vertex positions`)
  }
}

/** Bounds of the visible geometry: helpers (cutout, collider) and lights do not count. */
function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  const meshBox = new THREE.Box3()
  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || isHelper(mesh)) return
    let hidden = false
    for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (isHelper(p)) hidden = true
    if (hidden) return
    mesh.geometry.computeBoundingBox()
    meshBox.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
    box.union(meshBox)
  })
  return box
}

function originFor(box: THREE.Box3, mount: GeometryScriptMount): THREE.Vector3 {
  const center = box.getCenter(new THREE.Vector3())
  if (mount === 'wall-side') return new THREE.Vector3(center.x, box.min.y, box.min.z)
  return new THREE.Vector3(center.x, box.min.y, center.z)
}

const round = (v: number) => Math.round(v * 1e6) / 1e6
const vec = (v: THREE.Vector3): [number, number, number] => [round(v.x), round(v.y), round(v.z)]

/**
 * Reads the naming conventions into the manifest and rewrites the output so
 * they survive glTF: GLTFLoader strips ':' from node names, so convention ids
 * move to `userData.pascal`, materials get `slot_<id>` names, and lights
 * become manifest entries the item light system drives.
 */
function readConventions(root: THREE.Object3D) {
  const parts: GeometryArtifactManifest['parts'] = []
  const anchors: GeometryArtifactManifest['anchors'] = []
  const lights: GeometryArtifactManifest['lights'] = []
  const slots = new Map<string, string | undefined>()
  const materialSlot = new Map<THREE.Material, string>()
  const toRemove: THREE.Object3D[] = []
  let cutout = false
  let collider = false
  let triangles = 0
  const world = new THREE.Vector3()

  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    const userData = object.userData as Record<string, unknown>
    const partId = conventionId(object.name, 'part:')
    if (partId) {
      if (parts.some((p) => p.id === partId)) throw new Error(`Duplicate part id "${partId}"`)
      parts.push({
        id: partId,
        label: typeof userData.label === 'string' ? userData.label : undefined,
        type: typeof userData.type === 'string' ? slugify(userData.type) || undefined : undefined,
      })
      userData.pascal = { ...(userData.pascal as object), part: partId }
      object.name = `part_${partId}`
    }
    const anchorId = conventionId(object.name, 'anchor:')
    if (anchorId) {
      const normal = Array.isArray(userData.normal) ? userData.normal : undefined
      anchors.push({
        id: anchorId,
        position: vec(object.getWorldPosition(world)),
        normal: normal?.length === 3 ? (normal as [number, number, number]) : undefined,
      })
      toRemove.push(object)
      return
    }
    const light = object as THREE.PointLight
    const lightId =
      conventionId(object.name, 'light:') ?? (light.isLight ? `light_${lights.length + 1}` : null)
    if (lightId) {
      const color =
        typeof userData.color === 'string'
          ? userData.color
          : light.isLight
            ? `#${light.color.getHexString()}`
            : '#fff4e0'
      const intensity =
        typeof userData.intensity === 'number'
          ? userData.intensity
          : light.isLight
            ? light.intensity
            : 1
      const distance =
        typeof userData.distance === 'number'
          ? userData.distance
          : light.isLight && light.distance > 0
            ? light.distance
            : undefined
      lights.push({
        id: lightId,
        position: vec(object.getWorldPosition(world)),
        color,
        intensity,
        distance,
      })
      toRemove.push(object)
      return
    }
    if (isCutter(object.name)) cutout = true
    if (object.name === 'collider') collider = true

    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    assertFinite(mesh.geometry, mesh.name || 'A mesh')
    if (isHelper(mesh)) return
    triangles += triangleCount(mesh.geometry)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (materialSlot.has(material)) continue
      const authored = material.name ?? ''
      if (authored.toLowerCase() === 'glass') {
        materialSlot.set(material, 'glass')
        continue
      }
      const slotId =
        slugify(conventionId(authored, 'slot_') ?? authored) || `material_${slots.size + 1}`
      material.name = `slot_${slotId}`
      materialSlot.set(material, slotId)
      if (!slots.has(slotId))
        slots.set(slotId, authored.startsWith('slot_') ? undefined : authored || undefined)
    }
  })
  for (const object of toRemove) object.parent?.remove(object)

  return {
    parts,
    anchors,
    lights,
    slots: [...slots].map(([id, label]) => ({ id, label })),
    cutout,
    collider,
    triangles,
    materialCount: materialSlot.size,
  }
}

const SURFACE_MIN_NORMAL_Y = 0.95
/** Faces pointing at least this far down hang ceiling items (a vault plane up to ~70°). */
const UNDERSIDE_MAX_NORMAL_Y = -0.35
const SURFACE_MIN_AREA = 0.04
const SURFACE_MAX_COUNT = 32

function partOf(object: THREE.Object3D): string | undefined {
  for (let p: THREE.Object3D | null = object; p; p = p.parent) {
    const part = (p.userData.pascal as { part?: string } | undefined)?.part
    if (part) return part
  }
  return undefined
}

function convexHull(points: [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: [number, number][] = []
  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop()
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function readCutters(
  root: THREE.Object3D,
  mount: GeometryScriptMount,
): NonNullable<GeometryArtifactManifest['cutters']> {
  const cutters: NonNullable<GeometryArtifactManifest['cutters']> = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !isCutter(mesh.name)) return
    if (
      mesh.name === 'cut:wall' ||
      (mesh.name === 'cutout' && (mount === 'wall' || mount === 'wall-side'))
    )
      return
    const positions = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const points = Array.from({ length: positions.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld),
    )
    const triangles: Ring[] = []
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const triangle = [0, 1, 2].map((j) => points[index ? index.getX(i + j) : i + j]!)
      const [a, b, c] = triangle
      if (Math.abs((b!.x - a!.x) * (c!.z - a!.z) - (b!.z - a!.z) * (c!.x - a!.x)) < 1e-10) continue
      triangles.push(triangle.map((p): [number, number] => [p.x, p.z]))
    }
    const host = (mesh.name === 'cutout' ? 'mounted' : mesh.name.slice(4)) as NonNullable<
      GeometryArtifactManifest['cutters']
    >[number]['host']
    const minY = points.reduce((y, p) => Math.min(y, p.y), Infinity)
    const maxY = points.reduce((y, p) => Math.max(y, p.y), -Infinity)
    for (const region of union(triangles)) cutters.push({ host, polygon: region.outer, minY, maxY })
  })
  return cutters
}

/**
 * Per-part bounds and the upward-facing flat areas things can rest on (a
 * landing, a seat, a step), so a placement tool can drop an object onto real
 * geometry without a raycast. Outlines are convex hulls per mesh and height.
 */
function analyseGeometry(root: THREE.Object3D, parts: GeometryArtifactManifest['parts']) {
  const partBounds = new Map<string, THREE.Box3>()
  const surfaces = new Map<
    string,
    { part?: string; y: number; area: number; points: [number, number][] }
  >()
  const undersides = new Map<
    string,
    { part?: string; normal: THREE.Vector3; d: number; area: number; points: [number, number][] }
  >()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const box = new THREE.Box3()

  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || isHelper(mesh)) return
    const part = partOf(mesh)
    mesh.geometry.computeBoundingBox()
    box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
    if (part) partBounds.set(part, (partBounds.get(part) ?? new THREE.Box3()).union(box))

    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const count = index ? index.count : position.count
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i
      const ib = index ? index.getX(i + 1) : i + 1
      const ic = index ? index.getX(i + 2) : i + 2
      a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld)
      const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a))
      const area = normal.length() / 2
      if (area === 0) continue
      const ny = normal.y / (2 * area)
      if (ny <= UNDERSIDE_MAX_NORMAL_Y) {
        const unit = normal.clone().normalize()
        const key = `${mesh.uuid}|${unit
          .toArray()
          .map((v) => v.toFixed(2))
          .join(',')}`
        const entry = undersides.get(key) ?? {
          part,
          normal: unit,
          d: -unit.dot(a),
          area: 0,
          points: [],
        }
        entry.area += area
        entry.points.push([a.x, a.z], [b.x, b.z], [c.x, c.z])
        undersides.set(key, entry)
        continue
      }
      if (ny < SURFACE_MIN_NORMAL_Y) continue
      const y = Math.round(((a.y + b.y + c.y) / 3) * 100) / 100
      // One outline per mesh and height: a hull across meshes would merge a beam
      // and its returns into one surface covering the whole object.
      const key = `${mesh.uuid}|${y}`
      const entry = surfaces.get(key) ?? { part, y, area: 0, points: [] }
      entry.area += area
      entry.points.push([a.x, a.z], [b.x, b.z], [c.x, c.z])
      surfaces.set(key, entry)
    }
  })

  for (const part of parts) {
    const bounds = partBounds.get(part.id)
    if (bounds && !bounds.isEmpty()) part.bounds = { min: vec(bounds.min), max: vec(bounds.max) }
  }
  const hull = (points: [number, number][]) =>
    convexHull(points).map(
      ([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000] as [number, number],
    )
  return {
    surfaces: [...surfaces.values()]
      .filter((surface) => surface.area >= SURFACE_MIN_AREA)
      .sort((x, y) => y.area - x.area)
      .slice(0, SURFACE_MAX_COUNT)
      .map((surface) => ({ part: surface.part, y: surface.y, polygon: hull(surface.points) })),
    undersides: [...undersides.values()]
      .filter((underside) => underside.area >= SURFACE_MIN_AREA)
      .sort((x, y) => y.area - x.area)
      .slice(0, SURFACE_MAX_COUNT)
      .map((underside) => ({
        part: underside.part,
        polygon: hull(underside.points),
        plane: [
          ...underside.normal.toArray().map((v: number) => Math.round(v * 1e5) / 1e5),
          Math.round(underside.d * 1e5) / 1e5,
        ] as [number, number, number, number],
      })),
  }
}

/**
 * Merges each part's meshes by material, so a porch draws as a few dozen
 * meshes instead of hundreds (draw calls, not triangles, are the cost). Part
 * groups keep their names and extras; helpers (cutout, collider) and
 * multi-material meshes stay as authored.
 */
function mergeByPartAndMaterial(root: THREE.Object3D, animated: Set<THREE.Object3D>) {
  const owner = (mesh: THREE.Object3D): THREE.Object3D => {
    for (let p = mesh.parent; p; p = p.parent) {
      if ((p.userData.pascal as { part?: string } | undefined)?.part || p === root) return p
    }
    return root
  }
  root.updateWorldMatrix(true, true)
  const buckets = new Map<
    string,
    { owner: THREE.Object3D; material: THREE.Material; meshes: THREE.Mesh[] }
  >()
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || isHelper(mesh) || Array.isArray(mesh.material)) return
    const group = owner(mesh)
    // A mesh that moves on its own (or under a moving group) keeps its node.
    for (let p: THREE.Object3D | null = mesh; p && p !== group; p = p.parent) {
      if (animated.has(p)) return
    }
    const attributes = Object.keys(mesh.geometry.attributes).sort().join(',')
    const key = `${group.uuid}|${mesh.material.uuid}|${attributes}`
    const bucket = buckets.get(key) ?? { owner: group, material: mesh.material, meshes: [] }
    bucket.meshes.push(mesh)
    buckets.set(key, bucket)
  })
  const inverse = new THREE.Matrix4()
  for (const { owner: group, material, meshes } of buckets.values()) {
    if (meshes.length < 2) continue
    inverse.copy(group.matrixWorld).invert()
    const geometries = meshes.map((mesh) => {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
      return geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
    })
    const merged = BufferGeometryUtils.mergeGeometries(geometries)
    if (!merged) continue
    for (const mesh of meshes) mesh.parent?.remove(mesh)
    const combined = new THREE.Mesh(merged, material)
    combined.name = `${group.name || 'object'}_${material.name}`
    group.add(combined)
  }
}

const ANIMATION_LIMITS = { clips: 32, duration: 120, values: 200_000 }

/**
 * The module's clips (`group.animations`, as in any three.js project), with
 * every track rebound to its target's uuid: names like `part:door.quaternion`
 * do not survive three's track-name parser, and part objects are renamed for
 * glTF. Returns the clips and the objects they animate.
 */
function readAnimations(built: THREE.Object3D, root: THREE.Object3D) {
  const clips = (built.animations ?? []).filter(Boolean)
  if (clips.length > ANIMATION_LIMITS.clips) {
    throw new Error(`${clips.length} animation clips exceeds the ${ANIMATION_LIMITS.clips} limit`)
  }
  const objects: THREE.Object3D[] = []
  root.traverse((object) => objects.push(object))
  const byLongestName = objects
    .filter((object) => object.name)
    .sort((a, b) => b.name.length - a.name.length)
  const animated = new Set<THREE.Object3D>()
  const names = new Set<string>()
  let values = 0
  for (const clip of clips) {
    if (!(clip instanceof THREE.AnimationClip)) {
      throw new Error('group.animations must hold THREE.AnimationClip instances')
    }
    if (names.has(clip.name)) throw new Error(`Two animation clips are named "${clip.name}"`)
    names.add(clip.name)
    if (!(clip.duration > 0 && clip.duration <= ANIMATION_LIMITS.duration)) {
      throw new Error(
        `Clip "${clip.name}" lasts ${clip.duration} s; clips run 0–${ANIMATION_LIMITS.duration} s`,
      )
    }
    for (const track of clip.tracks) {
      const target =
        objects.find((object) => track.name.startsWith(`${object.uuid}.`)) ??
        byLongestName.find((object) => track.name.startsWith(`${object.name}.`))
      if (!target) {
        throw new Error(
          `Track "${track.name}" in clip "${clip.name}" targets no object: name the target <objectName>.<property> or <object.uuid>.<property>`,
        )
      }
      const property = track.name.slice(
        (track.name.startsWith(`${target.uuid}.`) ? target.uuid : target.name).length + 1,
      )
      track.name = `${target.uuid}.${property}`
      animated.add(target)
      values += track.values.length
      for (const value of track.values) {
        if (!Number.isFinite(value)) throw new Error(`Clip "${clip.name}" has non-finite keyframes`)
      }
    }
  }
  if (values > ANIMATION_LIMITS.values) {
    throw new Error(
      `Animations hold ${values} keyframe values; the limit is ${ANIMATION_LIMITS.values}`,
    )
  }
  return { clips, animated }
}

const SAMPLE_FPS = 30
const MAX_SAMPLES = 900

/**
 * glTF stores only position, quaternion and scale tracks, and the exporter
 * silently drops the rest (an Euler `rotation[y]` track, a `position[x]`
 * one). So each clip is played once in a mixer and the transforms it
 * produces are sampled back as position / quaternion / scale tracks: any
 * track that moves objects survives, however the module wrote it.
 */
function sampleTransformClips(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const mixer = new THREE.AnimationMixer(root)
  const sampled: THREE.AnimationClip[] = []
  for (const clip of clips) {
    const targets = [
      ...new Set(
        clip.tracks
          .map((track) => root.getObjectByProperty('uuid', track.name.split('.')[0]!))
          .filter((object): object is THREE.Object3D => Boolean(object)),
      ),
    ]
    const rest = targets.map((object) => ({
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    }))
    const count = Math.min(MAX_SAMPLES, Math.ceil(clip.duration * SAMPLE_FPS) + 1)
    const times = Array.from({ length: count }, (_, i) => (clip.duration * i) / (count - 1))
    const values = targets.map(() => ({
      position: [] as number[],
      quaternion: [] as number[],
      scale: [] as number[],
    }))
    const action = mixer.clipAction(clip)
    // Played once and held: a looping action wraps to its first frame at the
    // clip's end, so `open` would be stored ending closed.
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
    for (const time of times) {
      mixer.setTime(time)
      targets.forEach((object, k) => {
        values[k]!.position.push(...object.position.toArray())
        values[k]!.quaternion.push(...object.quaternion.toArray())
        values[k]!.scale.push(...object.scale.toArray())
      })
    }
    action.stop()
    mixer.uncacheClip(clip)
    const tracks: THREE.KeyframeTrack[] = []
    targets.forEach((object, k) => {
      const { position, quaternion, scale } = rest[k]!
      object.position.copy(position)
      object.quaternion.copy(quaternion)
      object.scale.copy(scale)
      const moves = (series: number[], base: number[]) =>
        series.some((value, i) => Math.abs(value - base[i % base.length]!) > 1e-6)
      const v = values[k]!
      if (moves(v.position, position.toArray()))
        tracks.push(new THREE.VectorKeyframeTrack(`${object.uuid}.position`, times, v.position))
      if (moves(v.quaternion, quaternion.toArray()))
        tracks.push(
          new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, v.quaternion),
        )
      if (moves(v.scale, scale.toArray()))
        tracks.push(new THREE.VectorKeyframeTrack(`${object.uuid}.scale`, times, v.scale))
    })
    if (tracks.length === 0) {
      throw new Error(
        `Clip "${clip.name}" moves nothing: only position, rotation and scale animate (material or visibility tracks do not)`,
      )
    }
    sampled.push(new THREE.AnimationClip(clip.name, clip.duration, tracks))
  }
  root.updateWorldMatrix(true, true)
  return sampled
}

// GLTFExporter writes binaries through FileReader, which Bun and Node lack.
function ensureFileReader() {
  const g = globalThis as { FileReader?: unknown }
  if (g.FileReader) return
  g.FileReader = class {
    result: ArrayBuffer | string | null = null
    onloadend: (() => void) | null = null
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
        this.onloadend?.()
      })
    }
  }
}

async function exportGlb(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[],
): Promise<ArrayBuffer> {
  ensureFileReader()
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(root, { binary: true, onlyVisible: false, animations })
  if (!(result instanceof ArrayBuffer))
    throw new Error('GLB export returned JSON instead of binary')
  return result
}

/** Outlines keep at most this many corners; a 64-sided circle reads the same with 16. */
const MAX_OUTLINE_POINTS = 16

function thin<T>(points: T[]): T[] {
  if (points.length <= MAX_OUTLINE_POINTS) return points
  const step = points.length / MAX_OUTLINE_POINTS
  return Array.from({ length: MAX_OUTLINE_POINTS }, (_, i) => points[Math.floor(i * step)]!)
}

function outlineArea(polygon: [number, number][]): number {
  let area = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += polygon[j]![0] * polygon[i]![1] - polygon[i]![0] * polygon[j]![1]
  }
  return Math.abs(area) / 2
}

const manifestBytes = (manifest: GeometryArtifactManifest) =>
  new TextEncoder().encode(JSON.stringify(manifest)).byteLength

/**
 * The manifest rides inline in the node, so it stays under
 * GEOMETRY_MANIFEST_MAX_BYTES: outlines are thinned (cutter footprints only
 * when still over, since a coarser footprint changes the hole), then the smallest
 * surfaces and undersides go first (placement falls back to the bounds there),
 * then trailing part entries. The build itself never fails over its size.
 */
function compactManifest(manifest: GeometryArtifactManifest): GeometryArtifactManifest {
  const next = {
    ...manifest,
    surfaces: manifest.surfaces.map((surface) => ({ ...surface, polygon: thin(surface.polygon) })),
    undersides: manifest.undersides.map((underside) => ({
      ...underside,
      polygon: thin(underside.polygon),
    })),
  }
  const bySize = (a: { polygon: [number, number][] }, b: { polygon: [number, number][] }) =>
    outlineArea(b.polygon) - outlineArea(a.polygon)
  next.surfaces.sort(bySize)
  next.undersides.sort(bySize)
  if (manifestBytes(next) > GEOMETRY_MANIFEST_MAX_BYTES) {
    next.cutters = next.cutters?.map((cutter) => ({ ...cutter, polygon: thin(cutter.polygon) }))
  }
  while (manifestBytes(next) > GEOMETRY_MANIFEST_MAX_BYTES) {
    const last = (list: { polygon: [number, number][] }[]) =>
      list.length ? outlineArea(list[list.length - 1]!.polygon) : Number.POSITIVE_INFINITY
    if (next.surfaces.length || next.undersides.length) {
      if (last(next.surfaces) <= last(next.undersides)) next.surfaces.pop()
      else next.undersides.pop()
    } else if (next.parts.length) next.parts.pop()
    else break
  }
  return next
}

async function digest(bytes: BufferSource): Promise<string> {
  // An opaque-origin sandbox has no WebCrypto; its host hashes what it receives.
  if (!globalThis.crypto?.subtle) return ''
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

// A deterrent, not the isolation boundary: hosts run this in a locked-down worker or process.
const SOURCE_GUARD =
  /\bimport\s*\(|\beval\s*\(|\bFunction\s*\(|\.constructor\s*\(|\bprocess\b|\brequire\s*\(/

export async function compileGeometryScript(
  input: GeometryScriptCompileInput,
): Promise<GeometryScriptCompileOutput> {
  if (new TextEncoder().encode(input.code).byteLength > GEOMETRY_SCRIPT_MAX_BYTES) {
    throw new Error(`The script is longer than ${GEOMETRY_SCRIPT_MAX_BYTES / 1024} KiB`)
  }
  if (SOURCE_GUARD.test(input.code)) {
    throw new Error(
      'Geometry scripts cannot use dynamic import, eval, Function constructors, process or require',
    )
  }
  const body = transformModule(input.code, MODULES)
  // Evaluating the model's module is the compiler's job; callers run it in a locked-down worker.
  const factory = new Function('__modules', 'THREE', 'lib', body) as (
    modules: ModuleTable,
    three: typeof THREE,
    lib: typeof LIB,
  ) => { build?: unknown; params?: unknown; mount?: unknown }
  const exported = factory(MODULES, THREE, LIB)
  if (typeof exported.build !== 'function') {
    throw new Error('The script must `export default function build({ params, THREE, lib })`')
  }
  const mount = (exported.mount ?? 'floor') as GeometryScriptMount
  if (!MOUNTS.has(mount)) throw new Error(`\`mount\` must be one of ${[...MOUNTS].join(', ')}`)
  const specs = readParamSpecs(exported.params)
  const params = resolveParams(specs, input.params ?? {})

  const built = await (exported.build as (ctx: unknown) => unknown)({
    params,
    inputs: {},
    THREE,
    lib: LIB,
  })
  if (!(built instanceof THREE.Object3D)) {
    throw new Error('build() must return a THREE.Object3D (usually a THREE.Group)')
  }

  const root = new THREE.Group()
  root.name = 'pascal_script_root'
  root.add(built)
  const box = visibleBounds(root)
  if (box.isEmpty()) throw new Error('build() returned no visible meshes')
  const size = box.getSize(new THREE.Vector3())
  if (Math.max(size.x, size.y, size.z) > GEOMETRY_SCRIPT_LIMITS.extent) {
    throw new Error(
      `The object is ${vec(size).join(' × ')} m; the limit is ${GEOMETRY_SCRIPT_LIMITS.extent} m per side. Units are metres.`,
    )
  }
  built.position.sub(originFor(box, mount))
  root.updateWorldMatrix(true, true)

  const read = readAnimations(built, root)
  const clips = sampleTransformClips(root, read.clips)
  const animated = read.animated
  const conventions = readConventions(root)
  if (conventions.triangles > GEOMETRY_SCRIPT_LIMITS.triangles) {
    throw new Error(
      `${conventions.triangles} triangles exceeds the ${GEOMETRY_SCRIPT_LIMITS.triangles} limit`,
    )
  }
  if (conventions.materialCount > GEOMETRY_SCRIPT_LIMITS.materials) {
    throw new Error(
      `${conventions.materialCount} materials exceeds the ${GEOMETRY_SCRIPT_LIMITS.materials} limit`,
    )
  }

  const { surfaces, undersides } = analyseGeometry(root, conventions.parts)
  mergeByPartAndMaterial(root, animated)
  const bounds = visibleBounds(root)
  const glb = await exportGlb(root, clips)
  return {
    glb,
    sha256: await digest(glb),
    script: await digest(new TextEncoder().encode(input.code)),
    mount,
    params,
    manifest: compactManifest({
      bounds: { min: vec(bounds.min), max: vec(bounds.max) },
      params: specs,
      parts: conventions.parts,
      surfaces,
      undersides,
      slots: conventions.slots,
      anchors: conventions.anchors,
      lights: conventions.lights,
      animations: clips.map((clip) => ({
        name: clip.name,
        duration: Math.round(clip.duration * 1000) / 1000,
      })),
      cutters: readCutters(root, mount),
      cutout: conventions.cutout,
      collider: conventions.collider,
      triangles: conventions.triangles,
    }),
  }
}
