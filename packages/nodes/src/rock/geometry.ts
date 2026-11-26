import {
  type AnyNodeId,
  buildRock,
  FLAT_GROUND_Y,
  type GeometryContext,
  persistedTerrainFieldOf,
  planRock,
  type RockMesh,
  type RockNode,
  rockCentre,
  rockSpan,
  terrainFieldOf,
} from '@pascal-app/core'
import { markPureRaycast } from '@pascal-app/viewer'
import { BufferAttribute, BufferGeometry, Group, LOD, Mesh, MeshStandardMaterial } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { ROCK_BASE_COLORS, rockMaterial } from './geology'

export function buildRockMesh(rock: RockNode, footY: number, topY: number): BufferGeometry {
  const plan = planRock(rock, { footY, topY })
  const mesh = plan.withinBudget ? plan.form.build(plan.input, 'near') : null
  return mesh ? geometryOf(mesh) : new BufferGeometry()
}

function geometryOf(mesh: RockMesh): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.position, 3))
  geometry.setIndex(new BufferAttribute(mesh.index, 1))
  geometry.computeVertexNormals()
  return geometry
}

/** `def.geometry` for a rock: the mesh in the Site's frame, on the ground its Site has now. */
export function buildRockGeometry(
  rock: RockNode,
  ctx?: Partial<GeometryContext>,
  _shading?: unknown,
  textures = true,
): Group {
  const group = new Group()
  group.name = 'rock-geometry'
  const parent =
    ctx?.parent ??
    (rock.parentId
      ? (ctx?.sceneNodes?.[rock.parentId as AnyNodeId] ??
        ctx?.resolve?.(rock.parentId as AnyNodeId))
      : null)
  const site = parent?.type === 'site' ? parent : null
  // Captured builds must not see an unrelated live sculpt stroke. Ordinary viewport
  // builds still follow the stroke; neither path elects a slab that this rock cuts.
  const field = ctx?.sceneNodes ? persistedTerrainFieldOf(site) : terrainFieldOf(site)
  const { footY, topY } = rockSpan(rock, field, site ? FLAT_GROUND_Y : 0)
  const built = buildRock(rock, { footY, topY })
  if (!(built.near && built.far)) return group
  const [cx, cz] = rockCentre(rock.polygon)
  const cy = (footY + topY) / 2
  const lod = new LOD()
  lod.name = 'rock-lod'
  lod.position.set(cx, cy, cz)
  const xs = rock.polygon.map(([x]) => x)
  const zs = rock.polygon.map(([, z]) => z)
  const distance = Math.max(
    12,
    6 * Math.max(rock.height, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)),
  )
  for (const level of ['near', 'far'] as const) {
    const data = built[level]!
    const material = textures
      ? rockMaterial(rock, { footY, topY }, level)
      : new MeshStandardNodeMaterial({ color: ROCK_BASE_COLORS[rock.rockType], roughness: 0.9 })
    const mesh = new Mesh(geometryOf(data), material)
    mesh.name = `rock-body-${level}`
    // Core vertices remain in Site space for sections, material coordinates and export.
    // Compensate the centered LOD's placement instead of translating/rounding the buffers.
    mesh.position.set(-cx, -cy, -cz)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.visible = level === 'near'
    lod.addLevel(mesh, level === 'near' ? 0 : distance, 0.12)
  }
  lod.raycast = markPureRaycast((raycaster, intersects) => {
    // Use the renderer's visible level, including camera zoom and hysteresis.
    // Keep its ordinary/BVH raycast; block recursion into the inactive mesh.
    const visible = lod.levels.find(({ object }) => object.visible)?.object
    visible?.raycast(raycaster, intersects)
    return false
  })
  // Three r187's common StandardDrawingPipeline updates isLOD on WebGPU AND WebGL2.
  // Geometries and uncached materials belong to this tree and its existing disposal path.
  group.add(lod)
  return group
}

/**
 * Portable export takes ONE near mesh, never a cloned LOD pair. Procedural per-pixel
 * geology is not a texture bake: export deliberately keeps the type's base stone colour.
 */
export function buildRockBakeGeometry(rock: RockNode, ctx: GeometryContext): Group {
  const parent =
    ctx.parent ??
    (rock.parentId
      ? (ctx.sceneNodes?.[rock.parentId as AnyNodeId] ?? ctx.resolve(rock.parentId as AnyNodeId))
      : null)
  const site = parent?.type === 'site' ? parent : null
  const { footY, topY } = rockSpan(rock, persistedTerrainFieldOf(site), site ? FLAT_GROUND_Y : 0)
  const group = new Group()
  group.name = 'rock-geometry'
  const material = new MeshStandardMaterial({
    color: ROCK_BASE_COLORS[rock.rockType],
    roughness: rock.rockType === 'river' ? 0.56 : 0.9,
    metalness: 0,
  })
  const mesh = new Mesh(buildRockMesh(rock, footY, topY), material)
  mesh.name = 'rock-body'
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return group
}
