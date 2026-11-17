import {
  buildHedge,
  type GeometryContext,
  type HedgeMesh,
  type HedgeNode,
  resolveSiteGround,
} from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { siteContextNodes } from '../shared/site-context'
import { hedgeMaterial } from './material'

/** A generator's arrays as a geometry: position, normal and colour, nothing else. */
export function hedgeBufferGeometry(data: HedgeMesh): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(data.normal, 3))
  geometry.setAttribute('color', new BufferAttribute(data.color, 3))
  geometry.setIndex(new BufferAttribute(data.index, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

let plain: MeshStandardNodeMaterial | undefined

/**
 * `def.geometry` for a hedge: its meshes in the Site's frame, standing on the ground its Site has
 * now. One mesh a chunk of a run, all with the one hedge material.
 */
export function buildHedgeGeometry(
  hedge: HedgeNode,
  ctx?: Partial<GeometryContext>,
  _shading?: unknown,
  textures = true,
): Group {
  const group = new Group()
  group.name = 'hedge-geometry'
  const ground = resolveSiteGround(hedge.parentId, siteContextNodes(hedge, ctx))
  const { plan, meshes } = buildHedge(hedge, ground)
  if (!textures)
    plain ??= new MeshStandardNodeMaterial({ color: '#b9c4ae', roughness: 0.95, side: DoubleSide })
  const material = textures ? hedgeMaterial() : (plain as MeshStandardNodeMaterial)
  meshes.forEach((data, index) => {
    const mesh = new Mesh(hedgeBufferGeometry(data), material)
    mesh.name = `hedge-body-${index}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.hedgeBodyIndexCount = data.bodyIndexCount
    group.add(mesh)
  })
  group.userData.hedge = { triangles: plan.estimate.triangles, gen: plan.form.gen }
  return group
}
