import {
  DEFAULT_STAIR_MATERIAL,
  generateFenceGeometry,
  type RenderShading,
} from '@pascal-app/viewer'
import { Group, Mesh } from 'three'
import type { FenceNode } from './schema'

/**
 * Stage B builder for fence. Reuses the legacy `generateFenceGeometry`
 * (pure function from viewer that returns a merged BufferGeometry of
 * posts + base + top rail + curve spans) and wraps it in a Mesh-in-Group
 * shape the generic `<GeometrySystem>` expects.
 *
 * Material is a single shared reference — fences look the same regardless
 * of instance, so we don't clone per node. If per-fence material
 * customization lands later (color picker on the panel maps to a real
 * material), this becomes a per-node lookup.
 *
 * Phase 6 cleanup moves the 280 lines of geometry math out of the
 * legacy `viewer/src/systems/fence/fence-system.tsx` into this folder
 * once the legacy system file is deleted. Until then `generateFenceGeometry`
 * is publicly re-exported from viewer.
 */
export function buildFenceGeometry(
  node: FenceNode,
  _ctx?: unknown,
  shading: RenderShading = 'rendered',
): Group {
  const group = new Group()
  const geometry = generateFenceGeometry(node)
  const mesh = new Mesh(geometry, DEFAULT_STAIR_MATERIAL(shading))
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return group
}
