import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { hideFromScene, showInScene } from './scene-visibility'

/**
 * Static merge for baked artifacts (the enhanced viewer's `mergeStatic`): a big baked house is
 * thousands of meshes, each drawn once per pass, and on WebGPU every draw costs CPU to encode.
 * Static meshes are merged per level, ~24 m cell, material and surface role into one mesh
 * parented to their level, so level visibility, explode and solo still apply; a moving part's
 * meshes (a sash, a door leaf) merge under that part and swing with it.
 *
 * The originals stay in the graph on the batched layer (`hideFromScene(…, 'batched')`): never
 * drawn or shadowed, still hit by pointer, reticle and room rays (which opt into that layer), and
 * still outlined when selected. What can change material or be hidden on its own stays out:
 * interactive items (lamps, fans), glass outside a moving part, ceilings and roofs (the
 * dollhouse hides them), the site, zones and plugin kinds.
 */

type Extras = {
  kind?: string
  pascalId?: string
  clips?: unknown[]
  proceduralMotion?: unknown
  slotId?: string
}

export type GlbMergeOptions = {
  /** pascalIds whose meshes must stay individual (lit lamps, animated fixtures). */
  keepIds: ReadonlySet<string>
  /** Nodes driven by animation tracks (their subtrees move). */
  animated: ReadonlySet<THREE.Object3D>
}

export type GlbBatch = THREE.Mesh & {
  userData: { glbBatch: true; role?: string; bakedMaterial: THREE.Material }
}

export type GlbMerge = {
  batches: GlbBatch[]
  merged: number
  /** Changes when any merged original is shown or hidden on its own (the merge is then stale). */
  visibilitySignature(): number
  dispose(): void
}

const KEPT_KINDS = new Set(['ceiling', 'roof', 'roof-segment', 'site', 'zone', 'spawn', 'level'])
const ATTRIBUTES = ['position', 'normal', 'uv', 'uv1', 'color'] as const
/** Cell size (m) batches are split by, so frustum culling still drops what's behind the eye. */
const CELL = 24
const NO_RAYCAST = () => {}

export function mergeBakedStatic(
  root: THREE.Object3D,
  roleOf: (kind: string | undefined) => string | undefined,
  options: GlbMergeOptions,
): GlbMerge {
  root.updateWorldMatrix(true, true)
  const groups = new Map<
    string,
    { anchor: THREE.Object3D; material: THREE.Material; role?: string; meshes: THREE.Mesh[] }
  >()
  const center = new THREE.Vector3()

  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || mesh.userData.glbBatch) return
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh)
      return
    const material = ((mesh.userData.__bakedMaterial as THREE.Material | undefined) ??
      mesh.material) as THREE.Material | THREE.Material[]
    if (Array.isArray(material) || !material) return
    const glass =
      material.transparent || material.userData.isGlass || mesh.userData.slotId === 'glass'
    if (mesh.geometry.morphAttributes.position) return
    const geometry = mesh.geometry
    if (!geometry.getAttribute('position') || !geometry.getAttribute('normal')) return

    // Walk up once: the level, the nearest moving pivot (a sash, a door leaf: its parts merge
    // under it and swing with it), the owner's kind, and anything that disqualifies.
    let level: THREE.Object3D | null = null
    let pivot: THREE.Object3D | null = null
    let ownerKind: string | undefined
    let inGlassSlot = false
    for (let x: THREE.Object3D | null = mesh; x; x = x.parent) {
      if (!x.visible) return
      const extras = x.userData as Extras
      if (!pivot && x !== mesh && (options.animated.has(x) || extras.proceduralMotion)) pivot = x
      if (extras.slotId === 'glass') inGlassSlot = true
      if (extras.pascalId) {
        if (options.keepIds.has(extras.pascalId)) return
        if (ownerKind === undefined && extras.kind !== 'level') ownerKind = extras.kind ?? ''
      }
      const kind = extras.kind
      if (kind === 'level') {
        level = x
        break
      }
      if (kind && (KEPT_KINDS.has(kind) || kind.includes(':'))) return
    }
    if (!level || options.animated.has(mesh)) return
    // Glass sorts per mesh: merge it only within one moving part (one sash's panes together).
    if ((glass || inGlassSlot) && !pivot) return
    const anchor = pivot ?? level

    const role = roleOf(ownerKind)
    const signature = ATTRIBUTES.filter((name) => geometry.getAttribute(name)).join(',')
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    geometry.boundingBox!.getCenter(center).applyMatrix4(mesh.matrixWorld)
    const cell = pivot ? '' : `${Math.floor(center.x / CELL)},${Math.floor(center.z / CELL)}`
    const key = [
      anchor.uuid,
      cell,
      material.uuid,
      role ?? '',
      signature,
      mesh.castShadow,
      mesh.receiveShadow,
    ].join('|')
    let group = groups.get(key)
    if (!group) {
      group = { anchor, material, role, meshes: [] }
      groups.set(key, group)
    }
    group.meshes.push(mesh)
  })

  const batches: GlbBatch[] = []
  const originals: THREE.Mesh[] = []
  const toAnchor = new THREE.Matrix4()
  const local = new THREE.Matrix4()
  for (const group of groups.values()) {
    if (group.meshes.length < 2) continue
    toAnchor.copy(group.anchor.matrixWorld).invert()
    const names = ATTRIBUTES.filter((name) => group.meshes[0]!.geometry.getAttribute(name))
    const parts: THREE.BufferGeometry[] = []
    for (const mesh of group.meshes) {
      const source = mesh.geometry
      const part = new THREE.BufferGeometry()
      for (const name of names) part.setAttribute(name, toFloat(source.getAttribute(name)))
      const count = part.getAttribute('position').count
      part.setIndex(
        source.index
          ? Array.from(source.index.array as ArrayLike<number>)
          : Array.from({ length: count }, (_, i) => i),
      )
      local.multiplyMatrices(toAnchor, mesh.matrixWorld)
      part.applyMatrix4(local)
      if (local.determinant() < 0) flipWinding(part) // mirrored transforms flip winding
      parts.push(part)
    }
    const geometry = mergeGeometries(parts, false)
    for (const part of parts) part.dispose()
    if (!geometry) continue
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const batch = new THREE.Mesh(geometry, group.material) as unknown as GlbBatch
    batch.name = `glb-batch:${group.material.name || group.material.type}`
    batch.castShadow = group.meshes[0]!.castShadow
    batch.receiveShadow = group.meshes[0]!.receiveShadow
    batch.userData = { glbBatch: true, role: group.role, bakedMaterial: group.material }
    batch.raycast = NO_RAYCAST
    group.anchor.add(batch)
    batches.push(batch)
    for (const mesh of group.meshes) {
      hideFromScene(mesh, 'batched')
      originals.push(mesh)
    }
  }

  return {
    batches,
    merged: originals.length,
    visibilitySignature() {
      let h = 0
      for (let i = 0; i < originals.length; i++) {
        const mesh = originals[i]!
        // Its own visibility up to the level: level-wide hiding is the batch's parent's job.
        let shown = true
        for (let x: THREE.Object3D | null = mesh; x && shown; x = x.parent) {
          if ((x.userData as Extras).kind === 'level') break
          shown = x.visible
        }
        if (shown) h += (i % 97) + 1
      }
      return h
    },
    dispose() {
      for (const batch of batches) {
        batch.removeFromParent()
        batch.geometry.dispose()
      }
      for (const mesh of originals) showInScene(mesh, 'batched')
      batches.length = 0
      originals.length = 0
    },
  }
}

function toFloat(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const count = attribute.count
  const size = attribute.itemSize
  const out = new Float32Array(count * size)
  for (let i = 0; i < count; i++) {
    out[i * size] = attribute.getX(i)
    if (size > 1) out[i * size + 1] = attribute.getY(i)
    if (size > 2) out[i * size + 2] = attribute.getZ(i)
    if (size > 3) out[i * size + 3] = attribute.getW(i)
  }
  return new THREE.BufferAttribute(out, size)
}

function flipWinding(geometry: THREE.BufferGeometry) {
  const index = geometry.index!.array as Uint32Array | Uint16Array | number[]
  for (let i = 0; i < index.length; i += 3) {
    const t = index[i + 1]!
    index[i + 1] = index[i + 2]!
    index[i + 2] = t
  }
  geometry.index!.needsUpdate = true
}
