import type { GeometryScriptMount, GeometryScriptParamValue } from '@pascal-app/core'
import type * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  assertScriptSize,
  finishBuild,
  type GeometryScriptCompileOutput,
  MOUNTS,
  readParamSpecs,
  resolveParams,
} from './compile'

/** What `bpy/runner.py` reports for a successful run, beside the GLB it exported. */
export type BlenderRun = {
  glb: Uint8Array
  mount: unknown
  /** The module's `PARAMS`, as written. */
  params: unknown
  /** The values `build(params)` ran with. */
  resolved: Record<string, unknown>
  /** The Blender version that ran it, for the artifact's provenance. */
  blender?: string
}

/**
 * The run from the runner's `result.json` and GLB, or the script's error
 * (with its line) thrown as the build failure the agent reads.
 */
export function blenderRun(report: unknown, glb: Uint8Array | null): BlenderRun {
  const result = (report ?? {}) as Record<string, unknown>
  if (result.ok !== true) {
    const error = typeof result.error === 'string' ? result.error : 'Blender did not finish'
    throw new Error(typeof result.line === 'number' ? `${error} (line ${result.line})` : error)
  }
  if (!glb) throw new Error('Blender exported no GLB')
  return {
    glb,
    mount: result.mount,
    params: result.params,
    resolved: (result.resolved ?? {}) as Record<string, unknown>,
    blender: typeof result.blender === 'string' ? result.blender : undefined,
  }
}

/** A light object's brightness when it sets no `intensity` property: a catalog lamp's. */
const DEFAULT_LIGHT_INTENSITY = 2

const sameValues = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([key, value]) => b[key] === value)

/**
 * GLTFLoader cleans node names (`part:seat` becomes `partseat`) and keeps the
 * original in `userData.name`, and its clip tracks address the cleaned names.
 * Tracks are rebound to their objects' uuids first, then the names restored, so
 * the conventions read the names the script gave.
 */
function restoreNames(scene: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const objects: THREE.Object3D[] = []
  scene.traverse((object) => objects.push(object))
  const byLongestName = objects
    .filter((object) => object.name)
    .sort((a, b) => b.name.length - a.name.length)
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const target = byLongestName.find((object) => track.name.startsWith(`${object.name}.`))
      if (target) track.name = `${target.uuid}.${track.name.slice(target.name.length + 1)}`
    }
  }
  for (const object of objects) {
    const userData = object.userData as Record<string, unknown>
    if (typeof userData.name === 'string') object.name = userData.name
    delete userData.name
    if ((object as THREE.Light).isLight && typeof userData.intensity !== 'number') {
      userData.intensity = DEFAULT_LIGHT_INTENSITY
    }
  }
}

/**
 * Reads what a Blender module built (the runner's GLB and report) into the same
 * artifact and manifest as a three.js build. Runs no model code, so any host
 * may call it; running the module itself is the Blender host's job, in its own
 * sandbox. Params are resolved again here and must match what the run used.
 */
export async function compileBlenderBuild(input: {
  code: string
  params?: Record<string, GeometryScriptParamValue>
  run: BlenderRun
}): Promise<GeometryScriptCompileOutput> {
  assertScriptSize(input.code)
  const mount = (input.run.mount ?? 'floor') as GeometryScriptMount
  if (!MOUNTS.has(mount)) throw new Error(`MOUNT must be one of ${[...MOUNTS].join(', ')}`)
  const specs = readParamSpecs(input.run.params)
  const params = resolveParams(specs, input.params ?? {})
  if (!sameValues(params, input.run.resolved)) {
    throw new Error('Blender ran the module with different param values than Pascal resolved')
  }
  const bytes = input.run.glb
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const gltf = await new GLTFLoader().parseAsync(buffer as ArrayBuffer, '')
  restoreNames(gltf.scene, gltf.animations)
  const built = gltf.scene
  built.animations = gltf.animations
  return finishBuild({ built, mount, specs, params, code: input.code, language: 'bpy' })
}
