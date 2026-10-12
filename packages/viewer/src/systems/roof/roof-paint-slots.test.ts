// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { RoofNode, RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { getRoofMaterialArray, ROOF_SLOT_ROLES } from './roof-materials'
import { generateRoofSegmentGeometry } from './roof-system'

const segment = RoofSegmentNode.parse({
  type: 'roof-segment',
  roofType: 'gable',
  width: 8,
  depth: 6,
  wallHeight: 1,
  pitch: 30,
  overhang: 0.5,
  wallThickness: 0.2,
  deckThickness: 0.1,
  shingleThickness: 0.05,
})

/** The slot of the first face a ray meets. */
function slotHit(geometry: THREE.BufferGeometry, from: THREE.Vector3, direction: THREE.Vector3) {
  const mesh = new THREE.Mesh(
    geometry,
    ROOF_SLOT_ROLES.map(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
  )
  const hit = new THREE.Raycaster(from, direction.normalize()).intersectObject(mesh).at(0)
  return hit?.face?.materialIndex
}

describe('roof paint slots', () => {
  const geometry = generateRoofSegmentGeometry(segment)
  const role = (slot: number | undefined) =>
    slot === undefined ? undefined : ROOF_SLOT_ROLES[slot]

  test('the covering, the soffit, the fascia and the gable are each their own surface', () => {
    // from above onto the slope
    expect(
      role(slotHit(geometry, new THREE.Vector3(0, 20, 1.5), new THREE.Vector3(0, -1, 0))),
    ).toBe('top')
    // from below into the overhang, outside the wall
    expect(
      role(slotHit(geometry, new THREE.Vector3(0, -20, 3.3), new THREE.Vector3(0, 1, 0))),
    ).toBe('soffit')
    // level onto the eave end, between the soffit edge and the shingle top
    expect(
      role(slotHit(geometry, new THREE.Vector3(0, 0.75, 10), new THREE.Vector3(0, 0, -1))),
    ).toBe('fascia')
    // from the side onto the gable above the plate
    expect(
      role(slotHit(geometry, new THREE.Vector3(20, 1.6, 0), new THREE.Vector3(-1, 0, 0))),
    ).toBe('edge')
  })

  test('each surface takes its own paint; an unpainted soffit and fascia follow the gable', () => {
    const paint = (color: string) => ({ preset: 'custom' as const, properties: { color } })
    const red = paint('#ff0000')
    const blue = paint('#0000ff')
    const green = paint('#00ff00')
    const roof = RoofNode.parse({
      type: 'roof',
      edgeMaterial: red,
      soffitMaterial: blue,
      fasciaMaterial: green,
    })
    const materials = getRoofMaterialArray(roof, 'rendered', true)!
    const colour = (slotRole: string) =>
      (
        materials[
          ROOF_SLOT_ROLES.indexOf(slotRole as (typeof ROOF_SLOT_ROLES)[number])
        ] as THREE.MeshStandardMaterial
      ).color.getHexString()
    expect(colour('edge')).toBe('ff0000')
    expect(colour('soffit')).toBe('0000ff')
    expect(colour('fascia')).toBe('00ff00')

    const older = getRoofMaterialArray(RoofNode.parse({ type: 'roof', edgeMaterial: red }))!
    for (const slotRole of ['edge', 'soffit', 'fascia'] as const) {
      expect(
        (
          older[ROOF_SLOT_ROLES.indexOf(slotRole)] as THREE.MeshStandardMaterial
        ).color.getHexString(),
      ).toBe('ff0000')
    }
  })
})
