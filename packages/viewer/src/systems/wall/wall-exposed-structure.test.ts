import { describe, expect, test } from 'bun:test'
import {
  type Assembly,
  FOUNDATION_CONSTRUCTIONS,
  WallNode,
  wallAssemblyFromLegacy,
} from '@pascal-app/core'
import { getMaterialsForWall, getWallMaterialHash } from './wall-materials'

// A wall with no cladding over a bare masonry or concrete core shows that structure on its
// exterior face. Materials are cached by library ref, so two faces dressed with the same ref are
// the same instance: that is how a face is told from the plain default here.
let serial = 0
function wall(extra: Record<string, unknown> = {}) {
  serial += 1
  return WallNode.parse({
    id: `wall_exposed_${serial}`,
    start: [0, 0],
    end: [6, 0],
    thickness: 0.241,
    frontSide: 'exterior',
    backSide: 'interior',
    ...extra,
  })
}
const palette = (node: ReturnType<typeof wall>) =>
  getMaterialsForWall(node, 'rendered', true, 'clay', undefined, {}).visible
const faceA = (node: ReturnType<typeof wall>) => palette(node)[1]
const faceB = (node: ReturnType<typeof wall>) => palette(node)[2]

const cmu = () => wall({ assembly: FOUNDATION_CONSTRUCTIONS.cmu.assembly })
const concreteWall = () => wall({ assembly: FOUNDATION_CONSTRUCTIONS['cast-concrete'].assembly })
const bare = (kind: string): Assembly =>
  wallAssemblyFromLegacy({
    framing: { kind, depth: 0.25 } as never,
    sheathing: { material: 'none', thickness: 0 },
    exterior: { finish: 'none', thickness: 0 },
    interior: { finish: 'none', thickness: 0 },
  })

describe('the exterior face of a wall with no cladding over a bare core', () => {
  test('a CMU foundation wall shows exposed block outside and keeps its inside face', () => {
    const plain = wall()
    expect(faceA(cmu())).not.toBe(faceA(plain))
    expect(faceB(cmu())).toBe(faceB(plain))
    expect(JSON.parse(JSON.parse(getWallMaterialHash(cmu(), 'rendered', {})).a).structure).toBe(
      'cmu',
    )
    expect(
      JSON.parse(JSON.parse(getWallMaterialHash(cmu(), 'rendered', {})).b).structure,
    ).toBeNull()
  })

  test('a cast concrete foundation wall shows concrete outside, not the block’s look', () => {
    const concrete = wall({ assembly: FOUNDATION_CONSTRUCTIONS['cast-concrete'].assembly })
    expect(faceA(concrete)).not.toBe(faceA(wall()))
    expect(faceA(concrete)).not.toBe(faceA(cmu()))
    expect(faceB(concrete)).toBe(faceB(wall()))
    expect(JSON.parse(JSON.parse(getWallMaterialHash(concrete, 'rendered', {})).a).structure).toBe(
      'concrete',
    )
  })

  test('it follows the exterior side of the wall, whichever face that is', () => {
    const turned = wall({
      assembly: FOUNDATION_CONSTRUCTIONS.cmu.assembly,
      frontSide: 'interior',
      backSide: 'exterior',
    })
    expect(faceB(turned)).not.toBe(faceB(wall()))
    expect(faceA(turned)).toBe(faceA(wall()))
  })

  test('paint on the face still wins, on the exposed face and on the other', () => {
    const slots = { a: 'library:concrete-polished', b: 'library:concrete-plaster' }
    const painted = wall({ assembly: FOUNDATION_CONSTRUCTIONS.cmu.assembly, slots })
    const paintedPlain = wall({ slots })
    expect(faceA(painted)).toBe(faceA(paintedPlain))
    expect(faceB(painted)).toBe(faceB(paintedPlain))
    expect(faceA(painted)).not.toBe(faceA(cmu()))
  })

  test('a wood wall with no cladding is unchanged, and so is a wall with a cladding', () => {
    const plain = wall()
    expect(faceA(wall({ assembly: bare('wood') }))).toBe(faceA(plain))
    expect(faceA(wall({ assembly: bare('icf') }))).toBe(faceA(plain))
    // Block under stucco: the stucco speaks for it, as before.
    const stucco = wall({
      assembly: wallAssemblyFromLegacy({
        framing: { kind: 'cmu', depth: 0.203 },
        sheathing: { material: 'none', thickness: 0 },
        exterior: { finish: 'stucco', thickness: 0.022 },
        interior: { finish: 'drywall', thickness: 0.0127 },
      }),
    })
    expect(JSON.parse(getWallMaterialHash(stucco, 'rendered', {})).a).toContain(
      'library:concrete-stucco',
    )
    expect(faceA(stucco)).not.toBe(faceA(cmu()))
  })

  test('a wall whose exterior side is not resolved, and a wall with no assembly, keep the default', () => {
    const unresolved = wall({
      assembly: FOUNDATION_CONSTRUCTIONS.cmu.assembly,
      frontSide: 'unknown',
      backSide: 'unknown',
    })
    expect(faceA(unresolved)).toBe(faceA(wall()))
    expect(faceB(unresolved)).toBe(faceB(wall()))
  })

  test('the face is made once for every wall, and is a flat colour in solid shading', () => {
    expect(faceA(cmu())).toBe(faceA(cmu()))
    expect(faceA(concreteWall())).toBe(faceA(concreteWall()))
    const solid = getMaterialsForWall(cmu(), 'solid', true, 'clay', undefined, {}).visible[1]
    expect(solid).not.toBe(faceA(cmu()))
  })

  test('the cutaway palette of the exposed face follows its look too', () => {
    const tint = (node: ReturnType<typeof wall>, face: 1 | 2) =>
      (
        getMaterialsForWall(node, 'rendered', true, 'clay', undefined, {}).invisible[face] as {
          color: { getHexString(): string }
        }
      ).color.getHexString()
    const exposed = cmu()
    const plain = wall()
    expect(tint(exposed, 1)).not.toBe(tint(plain, 1))
    expect(tint(exposed, 2)).toBe(tint(plain, 2))
  })
})
