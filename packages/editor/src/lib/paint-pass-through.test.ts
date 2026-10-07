import { describe, expect, it } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { setSurfaceRaycastLayers } from '@pascal-app/viewer'
import {
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  type Intersection,
  Mesh,
  Path,
  Ray,
  Shape,
  Vector3,
} from 'three'
import { openingPartHidden, paintPassesThrough, wallHitInOpening } from './paint-pass-through'

describe('paint passes through an empty opening', () => {
  const door = { id: 'door_g', type: 'door' } as unknown as AnyNode
  const win = { id: 'window_g', type: 'window' } as unknown as AnyNode
  const wall = { id: 'wall_g', type: 'wall' } as unknown as AnyNode

  it('a door or window with no part under the cursor lets the pointer through', () => {
    expect(paintPassesThrough(door, null)).toBe(true)
    expect(paintPassesThrough(win, null)).toBe(true)
  })

  it('its parts still paint, and other kinds keep the hover', () => {
    expect(paintPassesThrough(door, 'frame')).toBe(false)
    expect(paintPassesThrough(win, 'glass')).toBe(false)
    expect(paintPassesThrough(wall, null)).toBe(false)
  })

  // A 4 m × 3 m wall, 0.2 m thick, with a 2 m × 2.4 m opening down to the floor.
  const outline = new Shape()
  outline.moveTo(0, 0)
  outline.lineTo(4, 0)
  outline.lineTo(4, 3)
  outline.lineTo(0, 3)
  outline.lineTo(0, 0)
  const opening = new Path()
  opening.moveTo(1, 0.001)
  opening.lineTo(1, 2.4)
  opening.lineTo(3, 2.4)
  opening.lineTo(3, 0.001)
  opening.lineTo(1, 0.001)
  outline.holes.push(opening)
  const drawn = new Mesh(new ExtrudeGeometry(outline, { depth: 0.2, bevelEnabled: false }))
  drawn.updateMatrixWorld(true)
  // The uncut collision mesh's front face sits at z = 0.2.
  const at = (x: number, y: number) => {
    const ray = new Ray(new Vector3(x, y, 5), new Vector3(0, 0, -1))
    return wallHitInOpening(drawn, ray, 5 - 0.2)
  }

  it("a wall's collision hit in its opening passes through", () => {
    expect(at(2, 1)).toBe(true)
    expect(at(2, 0.05)).toBe(true)
  })

  it('a hit on the wall itself, beside or above the opening, stays on the wall', () => {
    expect(at(0.5, 1)).toBe(false)
    expect(at(2, 2.7)).toBe(false)
  })

  it('a grazing ray that meets the reveal inside the opening is the wall', () => {
    // Enters the opening 2 cm from its left jamb, heading left: it meets the jamb.
    const ray = new Ray(new Vector3(1.02 + 0.3 * 4.8, 1, 5), new Vector3(-0.3, 0, -1).normalize())
    expect(wallHitInOpening(drawn, ray, 4.8 * Math.hypot(0.3, 1))).toBe(false)
    // The same angle through the middle of the opening passes.
    const middle = new Ray(new Vector3(2 + 0.3 * 4.8, 1, 5), new Vector3(-0.3, 0, -1).normalize())
    expect(wallHitInOpening(drawn, middle, 4.8 * Math.hypot(0.3, 1))).toBe(true)
  })

  it('without a drawn mesh the hit is the wall', () => {
    expect(wallHitInOpening(null, new Ray(), 1)).toBe(false)
  })
})

describe('a door part found behind the floor seen through its opening', () => {
  // A door root with its invisible opening proxy and one tagged jamb at x = 1,
  // standing in a wall along z = 0; the floor in front of it at y = 0.
  const door = new Group()
  const cutout = new Mesh(new BoxGeometry(2, 2.4, 0.3))
  cutout.name = 'cutout'
  cutout.position.set(0, 1.2, 0)
  const jamb = new Mesh(new BoxGeometry(0.1, 2.4, 0.2))
  jamb.userData.slotId = 'frame'
  jamb.position.set(0.95, 1.2, 0)
  door.add(cutout, jamb)
  for (const mesh of [cutout, jamb]) setSurfaceRaycastLayers(mesh.layers)
  door.updateMatrixWorld(true)
  const floor = { distance: 3, object: new Mesh() } as unknown as Intersection
  const collision = { distance: 2.5, object: Object.assign(new Mesh(), { name: 'collision-mesh' }) }

  it('the floor in front of the part is what the pointer is on', () => {
    // Down through the opening toward the jamb's foot, ~3.8 m away; the floor is at 3 m.
    const ray = new Ray(new Vector3(0.2, 3.5, 2), new Vector3(0.75, -3.2, -2).normalize())
    expect(openingPartHidden(door, ray, [])).toBe(false)
    expect(openingPartHidden(door, ray, [floor])).toBe(true)
  })

  it('a part nearer than anything else stays the door (the host wall does not count)', () => {
    const ray = new Ray(new Vector3(0.95, 1, 5), new Vector3(0, 0, -1))
    expect(openingPartHidden(door, ray, [collision as unknown as Intersection])).toBe(false)
  })

  it('an opening with no part along the ray passes through', () => {
    const ray = new Ray(new Vector3(0, 1, 5), new Vector3(0, 0, -1))
    expect(openingPartHidden(door, ray, [])).toBe(true)
  })
})
