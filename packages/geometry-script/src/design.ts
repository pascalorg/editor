// Runs a whole design written as free three.js (a house: walls, windows, rooms, a roof, the
// furniture it delegates with `piece()`) and reads its final graph as plain data, so a host can
// convert it into a Pascal scene by code. A design is one module, or a shell and a second module
// that adds the interior to the same scene. Called where every other three.js module runs: in the
// isolated compiler, never in a host process. Nothing is compiled to a GLB here.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { LIB, MODULES, SOURCE_GUARD } from './compile'
import { transformModule } from './transform'

/** A design module is a whole building, so it is allowed far more than an object's 48 KB. */
export const DESIGN_MODULE_MAX_BYTES = 400 * 1024

/** What a design's names mean to Pascal: `wall:<id>`, `window:<id>`, `room:<name>`, `roof`… */
export const DESIGN_TAGS = [
  'wall',
  'window',
  'door',
  'room',
  'level',
  'stair',
  'roof',
  'piece',
] as const
export type DesignTagKind = (typeof DESIGN_TAGS)[number]

const TAG = new RegExp(`^(${DESIGN_TAGS.join('|')})(?:\\s*:\\s*(.*))?$`, 'i')

/** The tag an object's name carries, if any: `Wall:north` → { kind: 'wall', id: 'north' }. */
export function designTag(name: string): { kind: DesignTagKind; id: string } | null {
  const match = name.trim().match(TAG)
  if (!match) return null
  return { kind: match[1]!.toLowerCase() as DesignTagKind, id: (match[2] ?? '').trim() }
}

/**
 * Tags whose meshes come with their world vertices: the converter measures them. Any mesh this
 * small does too (a gable's triangle, a box): an unnamed design is measured by its parts.
 */
const MEASURED = new Set<DesignTagKind>(['wall', 'window', 'door'])
const MEASURED_VERTICES_MAX = 20_000
const SMALL_VERTICES = 64

export type DesignGeometry =
  /** A three.js geometry rebuilt from its constructor arguments (JSON: shapes as Shape JSON). */
  | { kind: 'params'; type: string; args: unknown[]; vertices: number }
  /** Anything else, as its buffers (base64): positions, an index, vertex colours, groups. */
  | {
      kind: 'buffer'
      position: string
      index?: { bits: 16 | 32; data: string }
      color?: string
      groups?: Array<{ start: number; count: number; materialIndex: number }>
      vertices: number
    }

export type DesignMaterial = {
  type: 'MeshStandardMaterial' | 'MeshPhysicalMaterial'
  name: string
  color: string
  roughness: number
  metalness: number
  emissive?: string
  emissiveIntensity?: number
  opacity: number
  transparent: boolean
  transmission?: number
  doubleSided: boolean
  vertexColors: boolean
}

export type DesignObject = {
  id: number
  /** -1 at the top. */
  parent: number
  name: string
  type: 'group' | 'mesh' | 'light' | 'piece'
  /** World matrix, column-major (three.js `elements`). */
  matrix: number[]
  geometry?: number
  material?: number | number[]
  triangles?: number
  /** World axis-aligned bounds [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds?: number[]
  /** The geometry's own bounds, before the matrix. */
  local?: number[]
  /** World vertex positions (base64 Float32 xyz): meshes of walls, windows and doors, and small ones. */
  vertices?: string
  light?: { kind: string; color: string; intensity: number; distance?: number }
  piece?: number
  /** `AnimationClip.toJSON` of the clips the object carries. */
  animations?: unknown[]
  /**
   * What made it, read from the module: the helper function it was added in (`tree`, `fenceRun`),
   * else the comment above the line of `build` that added it. An unnamed design's only names.
   */
  made?: string
  /** 1: added by the second module (the interior), 0 or absent: by the first. */
  stage?: number
}

export type DesignPiece = {
  description: string
  /** Width, height, depth of its bounds in its own frame, front toward +Z. */
  size: [number, number, number]
  mount: 'floor' | 'wall-side' | 'ceiling'
  object: number
}

export type DesignGraph = {
  objects: DesignObject[]
  geometries: DesignGeometry[]
  materials: DesignMaterial[]
  pieces: DesignPiece[]
  /** What the design held that Pascal does not keep, by kind: lines, points, hidden objects. */
  skipped: Record<string, number>
  stats: { meshes: number; triangles: number }
}

const round = (value: number, digits = 6) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale || 0
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const floats = (values: ArrayLike<number>) =>
  toBase64(new Uint8Array(Float32Array.from(values).buffer))

const hex = (color: THREE.Color) => `#${color.getHexString()}`

/** Constructors a geometry can be rebuilt with, by `geometry.type`. */
const REBUILT: Record<string, (...args: never[]) => THREE.BufferGeometry> = {
  BoxGeometry: (...a) => new THREE.BoxGeometry(...a),
  SphereGeometry: (...a) => new THREE.SphereGeometry(...a),
  CylinderGeometry: (...a) => new THREE.CylinderGeometry(...a),
  ConeGeometry: (...a) => new THREE.ConeGeometry(...a),
  TorusGeometry: (...a) => new THREE.TorusGeometry(...a),
  TorusKnotGeometry: (...a) => new THREE.TorusKnotGeometry(...a),
  PlaneGeometry: (...a) => new THREE.PlaneGeometry(...a),
  CircleGeometry: (...a) => new THREE.CircleGeometry(...a),
  RingGeometry: (...a) => new THREE.RingGeometry(...a),
  CapsuleGeometry: (...a) => new THREE.CapsuleGeometry(...a),
  DodecahedronGeometry: (...a) => new THREE.DodecahedronGeometry(...a),
  IcosahedronGeometry: (...a) => new THREE.IcosahedronGeometry(...a),
  OctahedronGeometry: (...a) => new THREE.OctahedronGeometry(...a),
  TetrahedronGeometry: (...a) => new THREE.TetrahedronGeometry(...a),
  RoundedBoxGeometry: (...a) => new RoundedBoxGeometry(...a),
  LatheGeometry: (points: never, ...rest: never[]) =>
    new THREE.LatheGeometry(
      (points as [number, number][]).map(([x, y]) => new THREE.Vector2(x, y)),
      ...rest,
    ),
  ExtrudeGeometry: (shapes: never, options: never) =>
    new THREE.ExtrudeGeometry(
      (shapes as object[]).map((json) => new THREE.Shape().fromJSON(json as never)),
      options,
    ),
  ShapeGeometry: (shapes: never, curveSegments: never) =>
    new THREE.ShapeGeometry(
      (shapes as object[]).map((json) => new THREE.Shape().fromJSON(json as never)),
      curveSegments,
    ),
}

const EXTRUDE_OPTIONS = [
  'curveSegments',
  'steps',
  'depth',
  'bevelEnabled',
  'bevelThickness',
  'bevelSize',
  'bevelOffset',
  'bevelSegments',
] as const

/** The constructor arguments a geometry was made with, JSON-safe, or null when they are not. */
function constructorArgs(geometry: THREE.BufferGeometry): { type: string; args: unknown[] } | null {
  const parameters = (geometry as { parameters?: Record<string, unknown> }).parameters
  if (!parameters) return null
  const type = geometry instanceof RoundedBoxGeometry ? 'RoundedBoxGeometry' : geometry.type
  if (!(type in REBUILT)) return null
  if (type === 'LatheGeometry') {
    const { points, ...rest } = parameters as { points: THREE.Vector2[] }
    return { type, args: [points.map((p) => [p.x, p.y]), ...Object.values(rest)] }
  }
  if (type === 'ExtrudeGeometry' || type === 'ShapeGeometry') {
    const shapes = parameters.shapes as THREE.Shape | THREE.Shape[]
    const list = (Array.isArray(shapes) ? shapes : [shapes]).map((shape) => shape.toJSON())
    if (type === 'ShapeGeometry') return { type, args: [list, parameters.curveSegments] }
    const options = (parameters.options ?? {}) as Record<string, unknown>
    if (options.extrudePath || options.UVGenerator) return null
    const kept = Object.fromEntries(
      EXTRUDE_OPTIONS.filter((key) => options[key] !== undefined).map((key) => [key, options[key]]),
    )
    return { type, args: [list, kept] }
  }
  return { type, args: Object.values(parameters) }
}

/**
 * Whether rebuilding from the arguments gives back these very vertices: a geometry translated,
 * rotated or edited after it was made does not, and is kept as its buffers instead.
 */
function rebuildsTheSame(geometry: THREE.BufferGeometry, type: string, args: unknown[]): boolean {
  if (geometry.getAttribute('color')) return false
  let rebuilt: THREE.BufferGeometry
  try {
    rebuilt = REBUILT[type]!(...(structuredClone(args) as never[]))
  } catch {
    return false
  }
  const a = geometry.getAttribute('position')
  const b = rebuilt.getAttribute('position')
  rebuilt.dispose()
  if (!a || !b || a.count !== b.count || a.itemSize !== b.itemSize) return false
  const index = geometry.getIndex()
  if ((index?.count ?? -1) !== (rebuilt.getIndex()?.count ?? -1)) return false
  for (let i = 0; i < a.count; i++)
    if (
      Math.abs(a.getX(i) - b.getX(i)) > 1e-5 ||
      Math.abs(a.getY(i) - b.getY(i)) > 1e-5 ||
      Math.abs(a.getZ(i) - b.getZ(i)) > 1e-5
    )
      return false
  return true
}

/** Vertex colours as 0–255 bytes, three per vertex. */
function colorBytes(color: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const bytes = new Uint8Array(color.count * 3)
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  for (let i = 0; i < color.count; i++) {
    bytes[i * 3] = byte(color.getX(i))
    bytes[i * 3 + 1] = byte(color.getY(i))
    bytes[i * 3 + 2] = byte(color.getZ(i))
  }
  return bytes
}

function describeGeometry(geometry: THREE.BufferGeometry): DesignGeometry {
  const position = geometry.getAttribute('position')
  const vertices = position?.count ?? 0
  const made = constructorArgs(geometry)
  if (made && rebuildsTheSame(geometry, made.type, made.args))
    return { kind: 'params', type: made.type, args: made.args, vertices }
  const xyz = new Float32Array(vertices * 3)
  for (let i = 0; i < vertices; i++) {
    xyz[i * 3] = position!.getX(i)
    xyz[i * 3 + 1] = position!.getY(i)
    xyz[i * 3 + 2] = position!.getZ(i)
  }
  const index = geometry.getIndex()
  const color = geometry.getAttribute('color')
  const wide = index ? Array.from(index.array as ArrayLike<number>).some((i) => i > 0xffff) : false
  return {
    kind: 'buffer',
    position: toBase64(new Uint8Array(xyz.buffer)),
    ...(index
      ? {
          index: {
            bits: wide ? 32 : 16,
            data: toBase64(
              new Uint8Array(
                (wide
                  ? Uint32Array.from(index.array as ArrayLike<number>)
                  : Uint16Array.from(index.array as ArrayLike<number>)
                ).buffer,
              ),
            ),
          },
        }
      : {}),
    ...(color ? { color: toBase64(colorBytes(color)) } : {}),
    ...(geometry.groups.length
      ? {
          groups: geometry.groups.map((g) => ({
            start: g.start,
            count: g.count,
            materialIndex: g.materialIndex ?? 0,
          })),
        }
      : {}),
    vertices,
  }
}

function describeMaterial(material: THREE.Material, tint?: THREE.Color): DesignMaterial {
  const standard = material as THREE.MeshStandardMaterial & Partial<THREE.MeshPhysicalMaterial>
  const color = (standard.color ?? new THREE.Color('#bbbbbb')).clone()
  if (tint) color.multiply(tint)
  const emissive =
    standard.emissive && standard.emissive.getHex() !== 0 ? hex(standard.emissive) : undefined
  return {
    type: standard.isMeshPhysicalMaterial ? 'MeshPhysicalMaterial' : 'MeshStandardMaterial',
    name: material.name ?? '',
    color: hex(color),
    roughness: round(typeof standard.roughness === 'number' ? standard.roughness : 0.5, 3),
    metalness: round(standard.metalness ?? 0, 3),
    ...(emissive ? { emissive, emissiveIntensity: round(standard.emissiveIntensity ?? 1, 3) } : {}),
    opacity: round(material.opacity ?? 1, 3),
    transparent: Boolean(material.transparent),
    ...(standard.transmission ? { transmission: round(standard.transmission, 3) } : {}),
    doubleSided: material.side === THREE.DoubleSide,
    vertexColors: Boolean(material.vertexColors),
  }
}

const LIGHT_KINDS: Array<[string, string]> = [
  ['isPointLight', 'point'],
  ['isSpotLight', 'spot'],
  ['isRectAreaLight', 'rect'],
  ['isAmbientLight', 'ambient'],
  ['isHemisphereLight', 'hemisphere'],
  ['isDirectionalLight', 'directional'],
]

const vec3 = (value: unknown, what: string): [number, number, number] => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
    throw new Error(`piece(): ${what} must be [x, y, z] in metres`)
  return value as [number, number, number]
}

/** What `addons` holds: three's addons Pascal's compiler carries (Arena's contract names them all). */
const ADDONS: Record<string, unknown> = {
  ...(LIB.BufferGeometryUtils as Record<string, unknown>),
  ...(LIB.ParametricFunctions as Record<string, unknown>),
  ConvexGeometry: LIB.ConvexGeometry,
  ParametricGeometry: LIB.ParametricGeometry,
  RoundedBoxGeometry: LIB.RoundedBoxGeometry,
}

/** Helpers that make one shape anywhere (`box`, `cylinder`): they say how, not what. */
const PRIMITIVE =
  /^(box|cube|cyl(inder)?|sphere|ball|cone|torus|beam|rod|bar|post|plank|panel|slab|plate|prism|mesh|part|shape|add|make|create|place|put|mat(erial)?)$/i

const FRAME = /^\s*at (?:(\S+) )?\(?pascal-design-(\d)\.js:(\d+):\d+\)?$/

/** `windowUnit` → `window unit`. */
const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_$]+/g, ' ')
    .trim()
    .toLowerCase()

/**
 * What made an object, from the stack of its `add`: the innermost helper on the way that is not a
 * maker of shapes (`box(…)`), or, when there is none, the comment above the line of `build` that
 * led to it, within 60 lines. The Function header puts a module's line n at stack
 * line n + 2.
 */
function madeBy(stack: string, bodies: readonly string[][]): string | undefined {
  const frames = stack
    .split('\n')
    .map((line) => line.match(FRAME))
    .filter((m): m is RegExpMatchArray => m !== null)
  if (!frames.length) return undefined
  const outer = frames.at(-1)!
  const lines = bodies[Number(outer[2])]!
  // The innermost helper that says what it makes (`windowUnit`, `tree`), past anonymous callbacks
  // and shape makers (`box`).
  const helper = frames
    .slice(0, -1)
    .map((frame) => frame[1])
    .find((name) => name && name !== '<anonymous>' && !PRIMITIVE.test(name))
  if (helper) return words(helper)
  const from = Number(outer[3]) - 3
  for (let i = from; i >= 0 && i > from - 60; i--) {
    const line = lines[i]!.trim()
    if (line.startsWith('//')) {
      const comment = line
        .replace(/^\/\/+\s*/, '')
        .split(/[.;:]\s/)[0]!
        .replace(/[.;:]$/, '')
      if (comment)
        return comment.length <= 60 ? comment : comment.slice(0, 60).replace(/\s+\S*$/, '')
    }
    if (/^(export\s+)?(default\s+)?(async\s+)?function\b|=> \{$/.test(line)) break
  }
  return undefined
}

function loadModule(code: string, stage: number) {
  if (code.length > DESIGN_MODULE_MAX_BYTES)
    throw new Error(`The design module exceeds ${DESIGN_MODULE_MAX_BYTES / 1024} KB`)
  if (SOURCE_GUARD.test(code))
    throw new Error(
      'Design modules cannot use dynamic import, eval, Function constructors, process or require',
    )
  const body = `${transformModule(code, MODULES)}\n//# sourceURL=pascal-design-${stage}.js`
  // Evaluating the model's module is this function's job; callers run it in a locked-down process.
  const factory = new Function('__modules', 'THREE', 'lib', body) as (
    modules: typeof MODULES,
    three: typeof THREE,
    lib: typeof LIB,
  ) => { build?: unknown }
  const exported = factory(MODULES, THREE, LIB)
  if (typeof exported.build !== 'function')
    throw new Error('The module must export a function named build')
  return { build: exported.build as (ctx: unknown) => unknown, lines: body.split('\n') }
}

/**
 * Runs the design and reads its final graph: every object with its world matrix, every mesh's
 * geometry (its constructor arguments when it is unchanged since it was made, else its buffers),
 * its materials, the lights, and each `piece(description, { position, rotation, size, mount })`
 * the design delegated (an empty group where the piece goes). A module exports `build`, by name
 * or as its default, and is called with `{ THREE, scene, addons, piece }`: it adds to the scene, or
 * returns a group, which is added. `interior`, a second module, then builds into that same scene.
 * Instanced meshes come out as one mesh per instance. Hidden objects, lines and points are counted,
 * not kept.
 */
export async function runDesign(input: { code: string; interior?: string }): Promise<DesignGraph> {
  const modules = [loadModule(input.code, 0)]
  if (input.interior !== undefined) modules.push(loadModule(input.interior, 1))

  const placed: Array<{
    group: THREE.Group
    description: string
    size: [number, number, number]
    mount: DesignPiece['mount']
  }> = []
  const piece = (description: unknown, options: unknown) => {
    if (typeof description !== 'string' || !description.trim())
      throw new Error('piece(description, { position, rotation, size }) needs a description')
    const o = (options ?? {}) as Record<string, unknown>
    const size = vec3(o.size, 'size')
    if (!size.every((n) => n > 0)) throw new Error('piece(): every size must be above 0')
    const mount = o.mount === 'wall-side' || o.mount === 'ceiling' ? o.mount : 'floor'
    const group = new THREE.Group()
    group.name = `piece:${placed.length}`
    if (o.position !== undefined) group.position.set(...vec3(o.position, 'position'))
    if (typeof o.rotation === 'number' && Number.isFinite(o.rotation)) group.rotation.y = o.rotation
    placed.push({ group, description: description.trim().slice(0, 1200), size, mount })
    return group
  }
  const missing = new Set<string>()
  const addons = new Proxy(ADDONS, {
    get(target, name) {
      if (typeof name === 'string' && name !== 'then' && !(name in target)) missing.add(name)
      return typeof name === 'string' ? target[name] : undefined
    },
  })

  // Every `add` is heard while the modules run: its stack says what made the object.
  const origin = new WeakMap<THREE.Object3D, { made?: string; stage: number }>()
  const bodies = modules.map((m) => m.lines)
  let stage = 0
  const add = THREE.Object3D.prototype.add
  THREE.Object3D.prototype.add = function (this: THREE.Object3D, ...objects: THREE.Object3D[]) {
    const made = madeBy(new Error().stack ?? '', bodies)
    for (const object of objects) if (!origin.has(object)) origin.set(object, { made, stage })
    return add.apply(this, objects)
  }
  const scene = new THREE.Scene()
  try {
    for (const [index, module] of modules.entries()) {
      stage = index
      const built = await module.build({ THREE, scene, addons, piece, lib: LIB, params: {} })
      if (built instanceof THREE.Object3D && built !== scene && !built.parent) scene.add(built)
    }
  } finally {
    THREE.Object3D.prototype.add = add
  }
  if (!scene.children.length)
    throw new Error('build() added nothing to the scene and returned nothing')
  scene.updateMatrixWorld(true)

  const graph: DesignGraph = {
    objects: [],
    geometries: [],
    materials: [],
    pieces: [],
    skipped: {},
    stats: { meshes: 0, triangles: 0 },
  }
  const skip = (kind: string) => {
    graph.skipped[kind] = (graph.skipped[kind] ?? 0) + 1
  }
  for (const name of missing) skip(`uses of addons.${name}, which Pascal's compiler does not carry`)
  const geometryIds = new Map<THREE.BufferGeometry, number>()
  const materialIds = new Map<string, number>()
  const pieceOf = new Map(placed.map((entry, index) => [entry.group, index]))

  const geometryId = (geometry: THREE.BufferGeometry) => {
    let id = geometryIds.get(geometry)
    if (id === undefined) {
      id = graph.geometries.push(describeGeometry(geometry)) - 1
      geometryIds.set(geometry, id)
    }
    return id
  }
  const materialId = (material: THREE.Material, tint?: THREE.Color) => {
    const described = describeMaterial(material, tint)
    const key = JSON.stringify(described)
    let id = materialIds.get(key)
    if (id === undefined) {
      id = graph.materials.push(described) - 1
      materialIds.set(key, id)
    }
    return id
  }
  const elements = (matrix: THREE.Matrix4) => matrix.elements.map((v) => round(v))
  const box = new THREE.Box3()

  const emitMesh = (
    mesh: THREE.Mesh,
    parent: number,
    world: THREE.Matrix4,
    name: string,
    measured: boolean,
    tint?: THREE.Color,
  ) => {
    const geometry = mesh.geometry
    if (!geometry.getAttribute('position')) return skip('empty meshes')
    geometry.computeBoundingBox()
    const local = geometry.boundingBox!
    if (local.isEmpty()) return skip('empty meshes')
    box.copy(local).applyMatrix4(world)
    const index = geometry.getIndex()
    const triangles = Math.floor(
      (index ? index.count : geometry.getAttribute('position').count) / 3,
    )
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const ids = materials.map((m) => materialId(m, tint))
    const object: DesignObject = {
      id: graph.objects.length,
      parent,
      name,
      type: 'mesh',
      matrix: elements(world),
      geometry: geometryId(geometry),
      material: ids.length === 1 ? ids[0]! : ids,
      triangles,
      bounds: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map((v) =>
        round(v),
      ),
      local: [local.min.x, local.min.y, local.min.z, local.max.x, local.max.y, local.max.z].map(
        (v) => round(v),
      ),
    }
    if (measured || geometry.getAttribute('position').count <= SMALL_VERTICES) {
      const position = geometry.getAttribute('position')
      const step = Math.max(1, Math.ceil(position.count / MEASURED_VERTICES_MAX))
      const v = new THREE.Vector3()
      const out: number[] = []
      for (let i = 0; i < position.count; i += step) {
        v.fromBufferAttribute(position, i).applyMatrix4(world)
        out.push(v.x, v.y, v.z)
      }
      object.vertices = floats(out)
    }
    graph.objects.push(object)
    graph.stats.meshes++
    graph.stats.triangles += triangles
  }

  const visit = (
    object: THREE.Object3D,
    parent: number,
    measured: boolean,
    from: { made?: string; stage: number } = { stage: 0 },
  ) => {
    if (!object.visible) return skip('hidden objects')
    // A stage holds for what an object holds; what made a container says nothing of its parts.
    const own = origin.get(object)
    const made = own ?? { stage: from.stage }
    const first = graph.objects.length
    const anyObject = object as unknown as Record<string, boolean>
    if (anyObject.isLine || anyObject.isPoints || anyObject.isSprite)
      return skip('lines and points')
    const tag = designTag(object.name)
    const measuredHere = tag ? MEASURED.has(tag.kind) : measured
    const light = LIGHT_KINDS.find(([flag]) => anyObject[flag])
    const id = graph.objects.length
    if ((object as THREE.InstancedMesh).isInstancedMesh) {
      const source = object as THREE.InstancedMesh
      graph.objects.push({
        id,
        parent,
        name: object.name,
        type: 'group',
        matrix: elements(object.matrixWorld),
      })
      const matrix = new THREE.Matrix4()
      const world = new THREE.Matrix4()
      const tint = new THREE.Color()
      for (let i = 0; i < source.count; i++) {
        source.getMatrixAt(i, matrix)
        world.multiplyMatrices(source.matrixWorld, matrix)
        if (source.instanceColor) source.getColorAt(i, tint)
        emitMesh(source, id, world, '', measuredHere, source.instanceColor ? tint : undefined)
      }
    } else if ((object as THREE.Mesh).isMesh) {
      emitMesh(object as THREE.Mesh, parent, object.matrixWorld, object.name, measuredHere)
    } else if (light) {
      const lit = object as THREE.Light & { distance?: number }
      graph.objects.push({
        id,
        parent,
        name: object.name,
        type: 'light',
        matrix: elements(object.matrixWorld),
        light: {
          kind: light[1],
          color: hex(lit.color),
          intensity: round(lit.intensity, 4),
          ...(typeof lit.distance === 'number' ? { distance: round(lit.distance, 3) } : {}),
        },
      })
    } else {
      const index = pieceOf.get(object as THREE.Group)
      graph.objects.push({
        id,
        parent,
        name: object.name,
        type: index === undefined ? 'group' : 'piece',
        matrix: elements(object.matrixWorld),
        ...(index === undefined ? {} : { piece: index }),
      })
      if (index !== undefined) {
        const entry = placed[index]!
        graph.pieces.push({
          description: entry.description,
          size: entry.size,
          mount: entry.mount,
          object: id,
        })
      }
    }
    for (const o of graph.objects.slice(first)) {
      if (made.made) o.made = made.made
      if (made.stage) o.stage = made.stage
    }
    const self = graph.objects[id]?.id === id ? id : parent
    if (object.animations.length && graph.objects[id]?.id === id)
      graph.objects[id]!.animations = object.animations.map((clip) =>
        THREE.AnimationClip.toJSON(clip),
      )
    for (const child of object.children) visit(child, self, measuredHere, made)
  }

  for (const child of scene.children) visit(child, -1, false)
  // A piece the design never added to its graph stands where its options put it.
  for (const entry of placed)
    if (!entry.group.parent) {
      entry.group.updateMatrixWorld(true)
      visit(entry.group, -1, false)
    }
  return graph
}
