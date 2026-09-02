/**
 * AC-CONDENSER VISUAL SWAP (user ask 2026-08-22: "we have an object. That's
 * actually a heatpump. called 'AC block' — you could use that for
 * placeholder. keep the label on it.")
 *
 * The hvac engine's outdoor condenser CABINET member keeps rendering as a
 * steel box everywhere it matters (SAT, plans, takeoff, baseline — the
 * member itself is untouched, so its 'AC condenser #N — X tons outdoor
 * unit' label keeps surfacing on the panel and the paper exactly as
 * before). In the 3D X-ray ONLY, the renderer substitutes the host
 * editor's real heat-pump model for the box — a PROGRESSIVE ENHANCEMENT:
 * headless tests, a missing asset or a failed network load all fall back
 * to the box exactly as today, never a hole.
 *
 * ASSET SOURCE — the host item-catalog entry (private-editor
 * packages/editor/src/components/ui/item-catalog/catalog-items.tsx):
 *   id 'ac-block', name "AC block", native bbox ≈ 1.06 × 0.95 × 1.06 m.
 * The catalog is not exported to plugins and the host exposes no
 * imperative asset loader (only the suspense hook `useGLTFKTX2`, which
 * cannot run headless), so the GLB URL is pinned here and loaded directly
 * with three's GLTFLoader. The GLB requires KHR_draco_mesh_compression
 * (no textures), hence the DRACOLoader with the SAME decoder path the
 * host item renderer pins (packages/nodes/src/item/renderer.tsx).
 *
 * SCALE CHOICE: the loaded scene is normalized so its bounding box is a
 * UNIT cube centered at the origin; each rendered instance then takes the
 * EXACT matrix its box instance would (position, rotation, scale = member
 * dims). The asset therefore occupies precisely the volume the box did —
 * the engine's cabinet footprint governs. UNWARP (Julien 2026-08-23: "it's
 * warped — compressed in one dimension… shrink in all dimensions instead
 * of 1"): the fix lives at the TRUTH level — the ENGINE cabinet dims are
 * now 0.95 × 0.85 × 0.95 m (real top-discharge ducted heat-pump class,
 * basis in data/mep-rules.json unitDimsNote), which equals this asset's
 * native bbox aspect within 0.2%, so the per-axis wrapper scale is a
 * UNIFORM ≈ 0.896 shrink — no single-axis compression. Gated below
 * (scale-ratio pin vs AC_BLOCK_NATIVE_BBOX_M, 1% tolerance) so neither
 * side can drift back into a warp silently. Pad, disconnect, whip and
 * line-set are untouched.
 */

import {
  Box3,
  Group,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  Vector3,
} from 'three'
import type { Member } from '../core/types'

/** Host item-catalog id of the substituted asset — "AC block". */
export const AC_BLOCK_ASSET_ID = 'ac-block'

/** The asset's NATIVE bounding box (m), from the host catalog entry — the
 * aspect truth the engine cabinet dims must match for a warp-free render.
 * The wrapper's per-axis scale is memberDims[i] / native[i]; the
 * uniformity gate pins those three ratios equal within 1%. */
export const AC_BLOCK_NATIVE_BBOX_M: readonly [number, number, number] = [1.06, 0.95, 1.06]

/** The "AC block" model GLB, verbatim from the host catalog entry's `src`.
 * If the host ever moves the file, the load fails and every cabinet simply
 * renders as the steel box again (graceful missing-asset path). */
export const AC_BLOCK_GLB_URL =
  'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/ac-block/model.glb'

/** Same Draco decoder the host item renderer uses for catalog GLBs. */
const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/'

/**
 * The one member the swap applies to: the hvac engine emits exactly two
 * `role: 'equipment'` members — the concrete pad and the STEEL cabinet
 * (the air handler is a fixture, not a member) — so the structural triple
 * identifies the cabinet without touching the engine. No label regex (the
 * takeoff doctrine) and no engine-side meta: the Member type carries none,
 * and adding one would break the byte-identical master baseline.
 */
export function isCondenserCabinet(
  member: Pick<Member, 'system' | 'role' | 'material'>,
): boolean {
  return (
    member.system === 'hvac' && member.role === 'equipment' && member.material === 'steel'
  )
}

/**
 * Normalize a loaded asset scene so its bounding box becomes a unit cube
 * centered at the origin. A renderer wrapper composed with the box
 * instance matrix (position, rotation, scale = dims) then bounds the asset
 * to EXACTLY the volume the box occupied — position/rotation/scale parity
 * by construction.
 */
export function normalizeToUnitBox(scene: Object3D): Group {
  const box = new Box3().setFromObject(scene)
  const size = new Vector3()
  const center = new Vector3()
  box.getSize(size)
  box.getCenter(center)
  const inner = new Group()
  inner.scale.set(
    1 / Math.max(size.x, 1e-6),
    1 / Math.max(size.y, 1e-6),
    1 / Math.max(size.z, 1e-6),
  )
  inner.position.set(
    -center.x * inner.scale.x,
    -center.y * inner.scale.y,
    -center.z * inner.scale.z,
  )
  inner.add(scene)
  const root = new Group()
  root.add(inner)
  return root
}

/**
 * X-RAY SCHEMATIC TINT (HP polish item 1 — Julien: "first of all it's red…
 * grayed out normally like the object would be"): the AC-block GLB ships
 * AUTHORED materials (a red-toned cabinet), and the clone used to render
 * them raw — one saturated red object inside an otherwise schematic X-ray.
 * HOST INVESTIGATION (read-only, packages/nodes/src/item/renderer.tsx):
 * the host item renderer shows the AUTHORED materials whenever `textures`
 * is on (the viewer default), and only collapses to a themed 'furnishing'
 * clay (createSurfaceRoleMaterial + colorPreset) in monochrome mode — so
 * "reproduce the host treatment" would KEEP the red by default, and the
 * clay path rides host theme state a plugin can't reach. DECISION:
 * neutralize the clone to the bones equipment-gray schematic family —
 * #8b8f96 is the EXACT steel tone the cabinet member rendered as a box
 * before the asset swap (framing/renderer colorOf 'steel'), roughness 0.82
 * like every bucket material. ONE module-cached material shared by all
 * clones (the night-8 material-identity doctrine: no per-clone shader
 * compiles, census-stable), the CACHED asset's own materials untouched.
 * Geometry, label and tonnage surfaces stay exactly as they were.
 */
export const CONDENSER_SCHEMATIC_TINT = '#8b8f96'

let schematicMaterial: MeshStandardMaterial | null = null
export function condenserSchematicMaterial(): MeshStandardMaterial {
  if (!schematicMaterial) {
    schematicMaterial = new MeshStandardMaterial({
      color: CONDENSER_SCHEMATIC_TINT,
      roughness: 0.82,
    })
  }
  return schematicMaterial
}

/**
 * Per-instance clone of the normalized asset (geometry shared, hierarchy
 * cloned), conformed to the X-ray mesh conventions: every mesh
 * raycast-disabled (`clone` does NOT carry an own raycast override, so
 * this must run per clone — the X-ray never intercepts the host's event
 * raycast, F2), shadow-casting like the solid buckets, and RETINTED to the
 * shared schematic equipment gray (see CONDENSER_SCHEMATIC_TINT above) —
 * the clone never shows the GLB's authored materials. Multi-material
 * meshes collapse to the same tint (the schematic has one equipment tone).
 */
export function prepareCondenserClone(asset: Object3D): Object3D {
  const clone = asset.clone(true)
  const tint = condenserSchematicMaterial()
  clone.traverse((obj) => {
    obj.raycast = () => {}
    if ((obj as Mesh).isMesh) {
      obj.castShadow = true
      obj.receiveShadow = true
      const mesh = obj as Mesh
      mesh.material = Array.isArray(mesh.material)
        ? (mesh.material as Material[]).map(() => tint)
        : tint
    }
  })
  return clone
}

type CondenserAssetLoader = () => Promise<Object3D>

/** Production loader — dynamic DEEP-path imports (never the Addons.js
 * aggregate; its LottieLoader/TTFLoader CDN imports crash bun — same rule
 * as the host's ktx2-loader), evaluated only in the browser: bun tests
 * never call it (they inject a mock via the seam below). */
const defaultLoader: CondenserAssetLoader = async () => {
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
  ])
  const draco = new DRACOLoader()
  draco.setDecoderPath(DRACO_DECODER_PATH)
  const loader = new GLTFLoader()
  loader.setDRACOLoader(draco)
  try {
    const gltf = await loader.loadAsync(AC_BLOCK_GLB_URL)
    return gltf.scene
  } finally {
    draco.dispose()
  }
}

let loadImpl: CondenserAssetLoader = defaultLoader
/** Deduped in-flight load; cleared on failure so a LATER call may retry. */
let inflight: Promise<Object3D | null> | null = null
/** The normalized, module-cached asset — loaded at most once per session. */
let resolvedAsset: Object3D | null = null

/** True when the scene holds at least one renderable mesh. A GLB whose
 * default scene has none would normalize to an INVISIBLE wrapper — the box
 * gone, nothing mounted: exactly the hole the fallback contract forbids. */
function containsMesh(scene: Object3D): boolean {
  let found = false
  scene.traverse((obj) => {
    if ((obj as Mesh).isMesh) found = true
  })
  return found
}

/**
 * Load (once) and normalize the AC block asset. NEVER rejects: any failure
 * resolves `null` and the caller keeps rendering the box — the swap is a
 * progressive enhancement. A failed attempt clears the in-flight slot so
 * the next activation retries (transient network); callers only re-invoke
 * on mode/member changes, so there is no retry storm.
 *
 * RESOLVE-THEN-THROW ARM (round-1 skeptic): loadImpl can RESOLVE with a
 * useless payload — a spec-valid GLB may carry NO default scene
 * (`gltf.scene === undefined` lands here despite the type) or a scene
 * with zero meshes. Normalizing the former used to throw in this
 * onFulfilled arm, REJECTING the cached in-flight promise with no clear —
 * every retry wedged forever; the latter mounted an empty wrapper (a
 * hole). Both are load failures like any other: resolve null, clear the
 * slot for retry. The try/catch keeps the no-rejection contract even for
 * exotic payloads that crash traverse/Box3.
 */
export function loadCondenserAsset(): Promise<Object3D | null> {
  if (resolvedAsset) return Promise.resolve(resolvedAsset)
  if (!inflight) {
    inflight = loadImpl().then(
      (scene) => {
        try {
          if (!scene || !containsMesh(scene)) {
            inflight = null
            return null
          }
          resolvedAsset = normalizeToUnitBox(scene)
          return resolvedAsset
        } catch {
          inflight = null
          return null
        }
      },
      () => {
        inflight = null
        return null
      },
    )
  }
  return inflight
}

/** Synchronous snapshot for render paths — null until a load resolved. */
export function condenserAssetSnapshot(): Object3D | null {
  return resolvedAsset
}

/** Test seam: swap the loader (or `null` to restore the real one) and
 * reset the cache, so headless tests drive BOTH the resolve and the
 * reject path without any network or GL context. */
export function __setCondenserAssetLoaderForTests(
  loader: CondenserAssetLoader | null,
): void {
  loadImpl = loader ?? defaultLoader
  inflight = null
  resolvedAsset = null
}
