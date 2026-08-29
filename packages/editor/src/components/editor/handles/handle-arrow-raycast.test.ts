import { expect, test } from 'bun:test'
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { hitAreaRaycast } from './handle-arrow'

test('an occluded handle does not sort ahead of a nearer scene body', () => {
  const geometry = new BoxGeometry(0.5, 0.5, 0.5)
  const material = new MeshBasicMaterial()
  const body = new Mesh(geometry, material)
  body.position.z = 1
  body.updateMatrixWorld()
  const handle = new Mesh(geometry, material)
  handle.position.z = 2
  handle.raycast = hitAreaRaycast
  handle.updateMatrixWorld()

  const raycaster = new Raycaster(new Vector3(0, 0, 0), new Vector3(0, 0, 1))
  const hits = raycaster.intersectObjects([body, handle], false)

  expect(hits[0]?.object).toBe(body)
  expect(hits.find((hit) => hit.object === handle)?.distance).toBeGreaterThan(
    hits.find((hit) => hit.object === body)?.distance ?? Number.POSITIVE_INFINITY,
  )

  geometry.dispose()
  material.dispose()
})
