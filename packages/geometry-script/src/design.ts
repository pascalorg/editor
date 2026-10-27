// Runs a whole design written as free three.js (a house: walls, windows, rooms, a roof) where every
// other three.js module runs: in the isolated compiler, never in a host process, for the adapter
// that converts it (`adapter.ts`). Nothing is compiled to a GLB here.
import * as THREE from 'three'
import { LIB, MODULES, SOURCE_GUARD } from './compile'
import { transformModule } from './transform'

/** A design module is a whole building, so it is allowed far more than an object's 48 KB. */
export const DESIGN_MODULE_MAX_BYTES = 400 * 1024

/** A design built: its scene, world matrices updated. */
export type BuiltDesign = {
  scene: THREE.Scene
  /** `addons.<name>` the design asked for that Pascal's compiler does not carry. */
  missingAddons: string[]
}

/** What `addons` holds: the three.js addons Pascal's compiler carries. */
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
 * `{ THREE, scene, addons }`; it adds to the scene, or returns a group, which is added.
 */
export async function buildDesign(code: string): Promise<BuiltDesign> {
  const build = loadModule(code, 'design')
  const missing = new Set<string>()
  const addons = new Proxy(ADDONS, {
    get(target, name) {
      if (typeof name === 'string' && name !== 'then' && !(name in target)) missing.add(name)
      return typeof name === 'string' ? target[name] : undefined
    },
  })
  const scene = new THREE.Scene()
  const built = await build({ THREE, scene, addons, lib: LIB, params: {} })
  if (built instanceof THREE.Object3D && built !== scene && !built.parent) scene.add(built)
  if (!scene.children.length)
    throw new Error('build() added nothing to the scene and returned nothing')
  scene.updateMatrixWorld(true)
  return { scene, missingAddons: [...missing] }
}
