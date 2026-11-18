import {
  buildTree,
  type GeometryContext,
  resolveTreeGround,
  resolveTreeParameters,
  type TreeMesh,
  type TreeNode,
  type TreeParameters,
} from '@pascal-app/core'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three'
import { siteContextNodes } from '../shared/site-context'

import { disposeTreeAtlas, treeAtlas, treeAtlasUV } from './sprig-atlas'

type TreeLevel = 'near' | 'far'
type CachedTree = { near: BufferGeometry; far: BufferGeometry; users: number }
const geometries = new Map<string, CachedTree>()
const ownedMaterials = new WeakMap<Mesh, MeshStandardMaterial>()

function treeGeometryKey(parameters: TreeParameters): string {
  const { form, heightM, spreadM, foliage, density, seed, gen } = parameters
  return JSON.stringify([form, heightM, spreadM, foliage, density, seed, gen])
}

function treeBufferGeometry(mesh: TreeMesh, form: TreeParameters['form']): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(mesh.normal, 3))
  geometry.setAttribute('color', new BufferAttribute(mesh.color, 3))
  const style =
    form === 'conifer'
      ? 'pine'
      : form === 'weeping'
        ? 'willow'
        : form === 'multistem' || form === 'upright'
          ? 'small'
          : 'broad'
  geometry.setAttribute('uv', new BufferAttribute(treeAtlasUV(mesh.barkUV, mesh.sprigs, style), 2))
  geometry.setIndex(new BufferAttribute(mesh.index, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData.shared = true
  return geometry
}

function acquireTree(parameters: TreeParameters) {
  const key = treeGeometryKey(parameters)
  let cached = geometries.get(key)
  if (!cached) {
    const built = buildTree(parameters)
    cached = {
      near: treeBufferGeometry(built.near, parameters.form),
      far: treeBufferGeometry(built.far, parameters.form),
      users: 0,
    }
    geometries.set(key, cached)
  }
  cached.users++
  const entry = cached
  let released = false
  return {
    entry,
    release() {
      if (released) return
      released = true
      if (--entry.users) return
      geometries.delete(key)
      entry.near.dispose()
      entry.far.dispose()
      if (geometries.size === 0) disposeTreeAtlas()
    },
  }
}

function buildTreeLevel(
  node: TreeNode,
  ctx: Partial<GeometryContext> | undefined,
  level: TreeLevel,
): Group {
  const group = new Group()
  group.name = 'tree-geometry'
  const lease = acquireTree(resolveTreeParameters(node))
  // Each subtree owns its ordinary material; its disposal releases one shared geometry lease.
  const material = new MeshStandardMaterial({
    vertexColors: true,
    map: treeAtlas(),
    alphaTest: 0.29,
    alphaToCoverage: true,
    roughness: 0.88,
    metalness: 0,
    side: DoubleSide,
  })
  material.name = 'tree-foliage-and-wood'
  material.addEventListener('dispose', lease.release)
  const mesh = new Mesh(lease.entry[level], material)
  ownedMaterials.set(mesh, material)
  mesh.name = `tree-${level}`
  mesh.position.y = resolveTreeGround(node, siteContextNodes(node, ctx)).heightAt(
    node.position[0],
    node.position[2],
  )
  mesh.castShadow = true
  mesh.receiveShadow = true
  // A selected mesh can temporarily carry a highlight material. Release its original too
  // when actually detached, but not during GeometrySystem's synchronous reparenting.
  mesh.addEventListener('removed', () =>
    queueMicrotask(() => {
      if (!mesh.parent) material.dispose()
    }),
  )
  group.add(mesh)
  return group
}

/** Imperative GeometrySystem children are not React children; their renderer owns unmount. */
export function disposeTreeResources(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Mesh) ownedMaterials.get(object)?.dispose()
  })
}

/** The generic renderer supplies XZ; only the ground-derived Y belongs to this local mesh. */
export function buildTreeGeometry(node: TreeNode, ctx?: Partial<GeometryContext>): Group {
  return buildTreeLevel(node, ctx, 'near')
}

/** Explicit ordinary geometry contract, like near; no automatic distance switching. */
export function buildTreeFarGeometry(node: TreeNode, ctx?: Partial<GeometryContext>): Group {
  return buildTreeLevel(node, ctx, 'far')
}
