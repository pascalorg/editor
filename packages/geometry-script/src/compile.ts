import type {
  CompiledGeometryScript,
  GeometryArtifactManifest,
  GeometryScriptMount,
  GeometryScriptParamSpec,
  GeometryScriptParamValue,
} from '@pascal-app/core'
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

const isHelper = (object: THREE.Object3D) => object.name === 'cutout' || object.name === 'collider'

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
    if (object.name === 'cutout') cutout = true
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
      if (area === 0 || normal.y / (2 * area) < SURFACE_MIN_NORMAL_Y) continue
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
  return [...surfaces.values()]
    .filter((surface) => surface.area >= SURFACE_MIN_AREA)
    .sort((x, y) => y.area - x.area)
    .slice(0, SURFACE_MAX_COUNT)
    .map((surface) => ({
      part: surface.part,
      y: surface.y,
      polygon: convexHull(surface.points).map(
        ([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000] as [number, number],
      ),
    }))
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

async function exportGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  ensureFileReader()
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(root, { binary: true, onlyVisible: false })
  if (!(result instanceof ArrayBuffer))
    throw new Error('GLB export returned JSON instead of binary')
  return result
}

async function digest(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

// A deterrent, not the isolation boundary: hosts run this in a locked-down worker or process.
const SOURCE_GUARD =
  /\bimport\s*\(|\beval\s*\(|\bFunction\s*\(|\.constructor\s*\(|\bprocess\b|\brequire\s*\(/

export async function compileGeometryScript(
  input: GeometryScriptCompileInput,
): Promise<GeometryScriptCompileOutput> {
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

  const surfaces = analyseGeometry(root, conventions.parts)
  const bounds = visibleBounds(root)
  const glb = await exportGlb(root)
  return {
    glb,
    sha256: await digest(glb),
    mount,
    params,
    manifest: {
      bounds: { min: vec(bounds.min), max: vec(bounds.max) },
      params: specs,
      parts: conventions.parts,
      surfaces,
      slots: conventions.slots,
      anchors: conventions.anchors,
      lights: conventions.lights,
      cutout: conventions.cutout,
      collider: conventions.collider,
      triangles: conventions.triangles,
    },
  }
}
