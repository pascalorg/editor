import { expect, test } from 'bun:test'
import { type AnyNode, resolveSiteGround, SiteNode, SlabNode } from '@pascal-app/core'
import { PerspectiveCamera, Vector3 } from 'three'
import { sitePointerGround } from './site-pointer-ground'

// Where a garden tool works: the Site ground under the pointer's own ray, whatever plane the
// editor's grid is measuring on (an upper level, a house seated above its garden).

const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }) }

function camera(position: [number, number, number], target: [number, number, number]) {
  const view = new PerspectiveCamera(50, 400 / 300, 0.1, 1000)
  view.position.set(...position)
  view.lookAt(...target)
  view.updateMatrixWorld(true)
  return view
}

/** A 15 % slope rising along x: 0 m at x = -20, one sample per metre, 1 cm steps. */
function slope() {
  const side = 41
  const samples = new Int16Array(side * side)
  for (let row = 0; row < side; row++)
    for (let col = 0; col < side; col++) samples[row * side + col] = col * 15
  return {
    type: 'heightfield' as const,
    origin: [-20, -20] as [number, number],
    spacing: 1,
    cols: side,
    rows: side,
    step: 0.01,
    heights: Buffer.from(samples.buffer).toString('base64'),
  }
}

function grounds() {
  const flat = SiteNode.parse({ id: 'site_flat' })
  const hill = SiteNode.parse({ id: 'site_hill', terrain: slope() })
  const paved = SiteNode.parse({ id: 'site_paved', children: ['slab_paved'] })
  const slab = SlabNode.parse({
    id: 'slab_paved',
    parentId: paved.id,
    elevation: 0.7,
    thickness: 0.2,
    polygon: [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ],
  })
  const nodes = { [flat.id]: flat, [hill.id]: hill, [paved.id]: paved, [slab.id]: slab } as Record<
    string,
    AnyNode
  >
  return [
    { name: 'flat ground', site: flat, nodes },
    { name: 'a 15 % slope', site: hill, nodes },
    { name: 'a slab on the Site', site: paved, nodes },
  ]
}

for (const { name, site, nodes } of grounds()) {
  for (const [view, position] of [
    ['an ordinary camera angle', [9, 8, 12]],
    ['a low camera angle', [12, 5.2, 13]],
  ] as const) {
    test(`on ${name}, at ${view}, the ground point is the one the pointer's ray meets`, () => {
      const ground = resolveSiteGround(site.id, nodes)
      const eye = camera([...position], [1, 3, 1])
      for (const [x, z] of [
        [1, 1],
        [2.5, -1.5],
        [-2, 3],
      ] as const) {
        const onGround = new Vector3(x, ground.heightAt(x, z), z)
        const ndc = onGround.clone().project(eye)
        const pointer = {
          clientX: 10 + ((ndc.x + 1) / 2) * 400,
          clientY: 20 + ((1 - ndc.y) / 2) * 300,
        }
        const found = sitePointerGround(pointer, eye, canvas, site, ground)
        expect(found?.[0]).toBeCloseTo(x, 3)
        expect(found?.[1]).toBeCloseTo(z, 3)
      }
    })
  }
}

test('without a pointer position there is no ground point to give', () => {
  const [{ site, nodes }] = grounds()
  const ground = resolveSiteGround(site.id, nodes)
  const eye = camera([9, 8, 12], [1, 0, 1])
  expect(sitePointerGround(undefined, eye, canvas, site, ground)).toBeNull()
  expect(sitePointerGround({}, eye, canvas, site, ground)).toBeNull()
  // A ray that leaves upwards meets no ground.
  expect(
    sitePointerGround(
      { clientX: 210, clientY: 21 },
      camera([0, 2, 0], [0, 50, -1]),
      canvas,
      site,
      ground,
    ),
  ).toBeNull()
})
