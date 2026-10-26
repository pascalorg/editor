// Runs a design's adapter: the program its author writes to turn the design (free three.js) into
// an `author_scene` payload, the way an agent converts its own module. The adapter is the model's
// code: it runs where every three.js module runs (the isolated compiler), with the design to run
// and a helper that writes any part of the built scene as its own module. Pure data comes back.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { LIB } from './compile'
import { buildDesign, loadModule } from './design'

/** `author_scene` takes a module of at most 48 000 characters. */
export const MODULE_MAX_CHARS = 48_000

export type AdapterResult = {
  /** The `author_scene` payload; an item may name a piece (an add_object piece's id) instead of code. */
  payload: Record<string, unknown>
}

export type ToModuleOptions = {
  /** Its placement point in world metres (default: the bottom centre of its world bounds; a ceiling mount's top centre). */
  origin?: [number, number, number]
  /** Its turn about Y in degrees, as an item's rotation: the module is written unturned by it. */
  rotation?: number
  /** `export const mount`: 'floor', 'wall', 'wall-side' or 'ceiling'; none for a finish module. */
  mount?: 'floor' | 'wall' | 'wall-side' | 'ceiling'
  /** Clips on the module's root (default: the object's own `animations`); tracks name its objects. */
  animations?: THREE.AnimationClip[]
}

export type WrittenModule = {
  code: string
  /** The placement point, world metres. */
  position: [number, number, number]
  /** Its bounds in its own frame: width, height, depth. */
  size: [number, number, number]
  triangles: number
}

const round = (value: number, digits = 5) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale || 0
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

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
}

/** The constructor arguments a geometry was made with, when rebuilding from them gives it back. */
function constructorArgs(geometry: THREE.BufferGeometry): unknown[] | null {
  const parameters = (geometry as { parameters?: Record<string, unknown> }).parameters
  if (!parameters || geometry.getAttribute('color')) return null
  const type = geometry instanceof RoundedBoxGeometry ? 'RoundedBoxGeometry' : geometry.type
  if (!(type in REBUILT)) return null
  const args = Object.values(parameters)
  if (!args.every((a) => typeof a === 'number' || typeof a === 'boolean')) return null
  const rebuilt = REBUILT[type]!(...(args as never[]))
  const a = geometry.getAttribute('position')
  const b = rebuilt.getAttribute('position')
  rebuilt.dispose()
  if (!a || !b || a.count !== b.count) return null
  for (let i = 0; i < a.count; i++)
    if (
      Math.abs(a.getX(i) - b.getX(i)) > 1e-5 ||
      Math.abs(a.getY(i) - b.getY(i)) > 1e-5 ||
      Math.abs(a.getZ(i) - b.getZ(i)) > 1e-5
    )
      return null
  return [type, ...args.map((v) => (typeof v === 'number' ? round(v, 6) : v))]
}

function geometryData(geometry: THREE.BufferGeometry): unknown {
  const made = constructorArgs(geometry)
  if (made) return made
  const position = geometry.getAttribute('position')
  const xyz = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    xyz[i * 3] = position.getX(i)
    xyz[i * 3 + 1] = position.getY(i)
    xyz[i * 3 + 2] = position.getZ(i)
  }
  const index = geometry.getIndex()
  const wide = index ? Array.from(index.array as ArrayLike<number>).some((i) => i > 0xffff) : false
  return {
    p: toBase64(new Uint8Array(xyz.buffer)),
    ...(index
      ? {
          i: [
            wide ? 32 : 16,
            toBase64(
              new Uint8Array(
                (wide
                  ? Uint32Array.from(index.array as ArrayLike<number>)
                  : Uint16Array.from(index.array as ArrayLike<number>)
                ).buffer,
              ),
            ),
          ],
        }
      : {}),
    ...(geometry.groups.length
      ? { g: geometry.groups.map((g) => [g.start, g.count, g.materialIndex ?? 0]) }
      : {}),
  }
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)

/** A material as constructor options, named as Pascal reads it: `glass` and `slot_*` kept, else a slot. */
function materialData(material: THREE.Material, tint?: THREE.Color) {
  const m = material as THREE.MeshStandardMaterial & Partial<THREE.MeshPhysicalMaterial>
  const color = (m.color ?? new THREE.Color('#bbbbbb')).clone()
  if (tint) color.multiply(tint)
  const hex = `#${color.getHexString()}`
  const name =
    material.name === 'glass' || material.name.startsWith('slot_')
      ? material.name
      : `slot_${slug(material.name) || hex.slice(1)}`
  return {
    t: m.isMeshPhysicalMaterial ? 'MeshPhysicalMaterial' : 'MeshStandardMaterial',
    name,
    color: hex,
    roughness: round(typeof m.roughness === 'number' ? m.roughness : 0.6, 3),
    metalness: round(m.metalness ?? 0, 3),
    ...(m.emissive && m.emissive.getHex() !== 0
      ? { emissive: `#${m.emissive.getHexString()}`, emissiveIntensity: m.emissiveIntensity ?? 1 }
      : {}),
    ...(material.transparent ? { transparent: true, opacity: round(material.opacity, 3) } : {}),
    ...(material.depthWrite === false ? { depthWrite: false } : {}),
    ...(m.transmission ? { transmission: m.transmission } : {}),
    ...(material.side === THREE.DoubleSide ? { side: 2 } : {}),
    ...(material.vertexColors ? { vertexColors: true } : {}),
  }
}

const RUNTIME = `const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
function geometry(THREE, d) {
  if (!Array.isArray(d)) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bytes(d.p).buffer), 3))
    if (d.i) g.setIndex(new THREE.BufferAttribute(d.i[0] === 32 ? new Uint32Array(bytes(d.i[1]).buffer) : new Uint16Array(bytes(d.i[1]).buffer), 1))
    for (const [start, count, m] of d.g ?? []) g.addGroup(start, count, m)
    g.computeVertexNormals()
    return g
  }
  const [type, ...args] = d
  return type === 'RoundedBoxGeometry' ? new RoundedBoxGeometry(...args) : new THREE[type](...args)
}
function place(THREE, o, t) {
  if (t.length === 3) return o.position.fromArray(t)
  new THREE.Matrix4().fromArray([t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0, t[9], t[10], t[11], 1]).decompose(o.position, o.quaternion, o.scale)
}`

/** The 12 affine numbers of a matrix, or its translation alone when it has no turn or scale. */
function transform(matrix: THREE.Matrix4): number[] {
  const e = matrix.elements
  const plain =
    Math.abs(e[0]! - 1) < 1e-6 &&
    Math.abs(e[5]! - 1) < 1e-6 &&
    Math.abs(e[10]! - 1) < 1e-6 &&
    [1, 2, 4, 6, 8, 9].every((i) => Math.abs(e[i]!) < 1e-6)
  const t = [round(e[12]!), round(e[13]!), round(e[14]!)]
  if (plain) return t
  return [e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!]
    .map((v) => round(v))
    .concat(t)
}

/**
 * Writes an object of the built scene, and everything under it, as one three.js module: its
 * meshes (each geometry rebuilt from its constructor arguments when unchanged since, else from its
 * buffers) and the groups between them, by name, so clips keep their targets.
 */
export function toModule(object: THREE.Object3D, options: ToModuleOptions = {}): WrittenModule {
  object.updateWorldMatrix(true, true)
  const world = new THREE.Box3().setFromObject(object)
  if (world.isEmpty()) throw new Error(`toModule: "${object.name || object.type}" holds no mesh`)
  const origin =
    options.origin ??
    ([
      (world.min.x + world.max.x) / 2,
      options.mount === 'ceiling' ? world.max.y : world.min.y,
      (world.min.z + world.max.z) / 2,
    ] as [number, number, number])
  const frame = new THREE.Matrix4()
    .compose(
      new THREE.Vector3(...origin),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.degToRad(options.rotation ?? 0),
      ),
      new THREE.Vector3(1, 1, 1),
    )
    .invert()

  const materials: unknown[] = []
  const materialIds = new Map<string, number>()
  const materialId = (material: THREE.Material, tint?: THREE.Color) => {
    const data = materialData(material, tint)
    const key = JSON.stringify(data)
    let id = materialIds.get(key)
    if (id === undefined) {
      id = materials.push(data) - 1
      materialIds.set(key, id)
    }
    return id
  }
  const geometries: unknown[] = []
  const geometryIds = new Map<THREE.BufferGeometry, number>()
  const geometryId = (geometry: THREE.BufferGeometry) => {
    let id = geometryIds.get(geometry)
    if (id === undefined) {
      id = geometries.push(geometryData(geometry)) - 1
      geometryIds.set(geometry, id)
    }
    return id
  }
  const nodes: unknown[][] = []
  let triangles = 0
  const local = new THREE.Matrix4()
  const parentInverse = new THREE.Matrix4()
  const add = (
    o: THREE.Object3D,
    parent: number,
    parentWorld: THREE.Matrix4 | null,
    matrixWorld: THREE.Matrix4,
    mesh?: { geometry: THREE.BufferGeometry; material: number | number[] },
  ) => {
    if (parentWorld) local.multiplyMatrices(parentInverse.copy(parentWorld).invert(), matrixWorld)
    else local.multiplyMatrices(frame, matrixWorld)
    nodes.push([
      parent,
      o.name,
      mesh ? geometryId(mesh.geometry) : -1,
      mesh ? mesh.material : -1,
      transform(local),
    ])
    return nodes.length - 1
  }
  const visit = (o: THREE.Object3D, parent: number, parentWorld: THREE.Matrix4 | null) => {
    if (!o.visible) return
    const flags = o as unknown as Record<string, boolean>
    if (flags.isLine || flags.isPoints || flags.isSprite || flags.isLight) return
    let self: number
    if ((o as THREE.InstancedMesh).isInstancedMesh) {
      const source = o as THREE.InstancedMesh
      self = add(o, parent, parentWorld, o.matrixWorld)
      const matrix = new THREE.Matrix4()
      const tint = new THREE.Color()
      const material = Array.isArray(source.material) ? source.material[0]! : source.material
      for (let i = 0; i < source.count; i++) {
        source.getMatrixAt(i, matrix)
        if (source.instanceColor) source.getColorAt(i, tint)
        nodes.push([
          self,
          '',
          geometryId(source.geometry),
          materialId(material, source.instanceColor ? tint : undefined),
          transform(matrix),
        ])
        triangles += Math.floor(
          (source.geometry.index?.count ?? source.geometry.attributes.position!.count) / 3,
        )
      }
    } else if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh
      if (!mesh.geometry.getAttribute('position')) return
      const material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => materialId(m))
        : materialId(mesh.material)
      self = add(o, parent, parentWorld, o.matrixWorld, { geometry: mesh.geometry, material })
      triangles += Math.floor(
        (mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3,
      )
    } else self = add(o, parent, parentWorld, o.matrixWorld)
    for (const child of o.children) visit(child, self, o.matrixWorld)
  }
  visit(object, -1, null)

  const clips = options.animations ?? object.animations
  const code = `import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
${options.mount ? `export const mount = '${options.mount}'\n` : ''}const M = ${JSON.stringify(materials)}
const G = ${JSON.stringify(geometries)}
const N = ${JSON.stringify(nodes)}
${RUNTIME}
export default function build() {
  const materials = M.map(({ t, ...p }) => new THREE[t](p))
  const geometries = G.map((d) => geometry(THREE, d))
  const made = []
  for (const [parent, name, g, m, t] of N) {
    const o = g < 0 ? new THREE.Group() : new THREE.Mesh(geometries[g], Array.isArray(m) ? m.map((i) => materials[i]) : materials[m])
    o.name = name
    place(THREE, o, t)
    if (parent >= 0) made[parent].add(o)
    made.push(o)
  }
  const wrap = new THREE.Group()
  wrap.add(made[0])
${clips.length ? `  wrap.animations = ${JSON.stringify(clips.map((clip) => THREE.AnimationClip.toJSON(clip)))}.map((clip) => THREE.AnimationClip.parse(clip))\n` : ''}  return wrap
}
`
  if (code.length > MODULE_MAX_CHARS)
    throw new Error(
      `toModule: "${object.name || object.type}" writes a module of ${code.length} characters; author_scene takes ${MODULE_MAX_CHARS}. Write it as several objects, or with fewer meshes.`,
    )
  const box = new THREE.Box3()
  const inFrame = new THREE.Matrix4()
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !o.visible) return
    mesh.geometry.computeBoundingBox()
    box.union(
      mesh.geometry
        .boundingBox!.clone()
        .applyMatrix4(inFrame.multiplyMatrices(frame, o.matrixWorld)),
    )
  })
  const size = box.getSize(new THREE.Vector3())
  return {
    code,
    position: origin.map((v) => round(v, 4)) as [number, number, number],
    size: [round(size.x, 4), round(size.y, 4), round(size.z, 4)],
    triangles,
  }
}

/**
 * Runs the adapter: `export default async function adapt({ THREE, addons, source, run, toModule })`
 * returns the payload. `run(code = source)` builds a design module (the design, or a copy the
 * adapter changed to mark what it needs) and answers `{ scene }`.
 */
export async function runAdapter(input: {
  adapter: string
  design: string
}): Promise<AdapterResult> {
  const adapt = loadModule(input.adapter, 'adapter')
  const run = async (code: unknown = input.design) => {
    if (typeof code !== 'string') throw new Error('run(code): code is a design module, as text')
    const { scene } = await buildDesign(code)
    return { scene }
  }
  const payload = (await adapt({
    THREE,
    addons: LIB,
    source: input.design,
    run,
    toModule,
  })) as Record<string, unknown> | undefined
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.levels))
    throw new Error(
      'adapt() must return the author_scene payload: { levels: [...], roof?, notes? }',
    )
  // JSON round trip: the payload crosses a process boundary, and nothing of three.js may ride along.
  return { payload: JSON.parse(JSON.stringify(payload)) }
}
