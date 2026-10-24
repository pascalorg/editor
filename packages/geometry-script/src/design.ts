// Runs a whole design written as free three.js (a house: walls, windows, rooms, a roof, the
// furniture it delegates with `piece()`), where every other three.js module runs: in the isolated
// compiler, never in a host process. `runDesign` answers what a host needs before the design is
// converted (the pieces it delegated, how big it is); `runAdapter` (`adapter.ts`) runs it again for
// the program that converts it. Nothing is compiled to a GLB here.
import * as THREE from 'three'
import { LIB, MODULES, SOURCE_GUARD } from './compile'
import { transformModule } from './transform'

/** A design module is a whole building, so it is allowed far more than an object's 48 KB. */
export const DESIGN_MODULE_MAX_BYTES = 400 * 1024

export type DesignPiece = {
  description: string
  /** Width, height, depth of its bounds in its own frame, front toward +Z. */
  size: [number, number, number]
  mount: 'floor' | 'wall-side' | 'ceiling'
}

/** A design built: its scene, and the empty group each `piece()` call returned, in call order. */
export type BuiltDesign = {
  scene: THREE.Scene
  pieces: Array<DesignPiece & { object: THREE.Group }>
  /** `addons.<name>` the design asked for that Pascal's compiler does not carry. */
  missingAddons: string[]
}

export type DesignSummary = {
  pieces: DesignPiece[]
  /** What the design held that Pascal does not keep, by kind: lines, points, hidden objects. */
  skipped: Record<string, number>
  stats: { meshes: number; triangles: number }
}

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

/** A model's module, with its imports bound to what the compiler carries; `what` names it in errors. */
export function loadModule(code: string, what: string) {
  if (code.length > DESIGN_MODULE_MAX_BYTES)
    throw new Error(`The ${what} module exceeds ${DESIGN_MODULE_MAX_BYTES / 1024} KB`)
  if (SOURCE_GUARD.test(code))
    throw new Error(
      `The ${what} module cannot use dynamic import, eval, Function constructors, process or require`,
    )
  // Evaluating the model's module is this function's job; callers run it in a locked-down process.
  const factory = new Function('__modules', 'THREE', 'lib', transformModule(code, MODULES)) as (
    modules: typeof MODULES,
    three: typeof THREE,
    lib: typeof LIB,
  ) => { build?: unknown }
  const exported = factory(MODULES, THREE, LIB)
  if (typeof exported.build !== 'function')
    throw new Error(`The ${what} module must export its function as default (or named build)`)
  return exported.build as (ctx: unknown) => unknown
}

/**
 * Builds the design as Pascal runs it: its `build`, by name or as its default, is called with
 * `{ THREE, scene, addons, piece }`; it adds to the scene, or returns a group, which is added.
 * `piece(description, { position, rotation, size, mount })` returns an empty group where the
 * delegated piece will stand; one never added to the graph stands in the scene where its options
 * put it.
 */
export async function buildDesign(code: string): Promise<BuiltDesign> {
  const build = loadModule(code, 'design')
  const pieces: BuiltDesign['pieces'] = []
  const piece = (description: unknown, options: unknown) => {
    if (typeof description !== 'string' || !description.trim())
      throw new Error('piece(description, { position, rotation, size }) needs a description')
    const o = (options ?? {}) as Record<string, unknown>
    const size = vec3(o.size, 'size')
    if (!size.every((n) => n > 0)) throw new Error('piece(): every size must be above 0')
    const mount = o.mount === 'wall-side' || o.mount === 'ceiling' ? o.mount : 'floor'
    const object = new THREE.Group()
    object.name = `piece:${pieces.length}`
    if (o.position !== undefined) object.position.set(...vec3(o.position, 'position'))
    if (typeof o.rotation === 'number' && Number.isFinite(o.rotation))
      object.rotation.y = o.rotation
    pieces.push({ description: description.trim().slice(0, 1200), size, mount, object })
    return object
  }
  const missing = new Set<string>()
  const addons = new Proxy(ADDONS, {
    get(target, name) {
      if (typeof name === 'string' && name !== 'then' && !(name in target)) missing.add(name)
      return typeof name === 'string' ? target[name] : undefined
    },
  })
  const scene = new THREE.Scene()
  const built = await build({ THREE, scene, addons, piece, lib: LIB, params: {} })
  if (built instanceof THREE.Object3D && built !== scene && !built.parent) scene.add(built)
  for (const { object } of pieces) if (!object.parent) scene.add(object)
  if (!scene.children.length)
    throw new Error('build() added nothing to the scene and returned nothing')
  scene.updateMatrixWorld(true)
  return { scene, pieces, missingAddons: [...missing] }
}

/** Runs the design and answers the pieces it delegated and its size. */
export async function runDesign(input: { code: string }): Promise<DesignSummary> {
  const { scene, pieces, missingAddons } = await buildDesign(input.code)
  const summary: DesignSummary = {
    pieces: pieces.map(({ description, size, mount }) => ({ description, size, mount })),
    skipped: {},
    stats: { meshes: 0, triangles: 0 },
  }
  const skip = (kind: string) => {
    summary.skipped[kind] = (summary.skipped[kind] ?? 0) + 1
  }
  for (const name of missingAddons)
    skip(`uses of addons.${name}, which Pascal's compiler does not carry`)
  const visit = (object: THREE.Object3D) => {
    if (!object.visible) return skip('hidden objects')
    const o = object as unknown as Record<string, boolean>
    if (o.isLine || o.isPoints || o.isSprite) return skip('lines and points')
    if ((object as THREE.Mesh).isMesh) {
      const mesh = object as THREE.Mesh
      const index = mesh.geometry.getIndex()
      const count = index ? index.count : (mesh.geometry.getAttribute('position')?.count ?? 0)
      const instances = (object as THREE.InstancedMesh).isInstancedMesh
        ? (object as THREE.InstancedMesh).count
        : 1
      summary.stats.meshes += instances
      summary.stats.triangles += Math.floor(count / 3) * instances
    }
    for (const child of object.children) visit(child)
  }
  visit(scene)
  return summary
}
