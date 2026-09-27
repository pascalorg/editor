import { describe, expect, test } from 'bun:test'
import cabinetJson from './__fixtures__/cabinet_two_doors_drawer.json'
import downlightJson from './__fixtures__/recessed_downlight.json'
import { ProceduralMotionController } from './motion-controller'
import { evaluateRecipe, parseRecipe, type Recipe } from './recipe'

type Part = Recipe['parts'][number]
const box = (id: string, size: number[], position: number[], slot = 'front') => ({
  id,
  primitive: 'box' as const,
  slot,
  size: size as [number, number, number],
  position: position as [number, number, number],
})
// A cabinet with two nested chains: a door with a turning knob, and a drawer with a swinging
// bail pull. Joint ids are their child part ids.
const cabinet = (edit: (recipe: Recipe) => void = () => {}): Recipe => {
  const recipe = {
    version: 2,
    name: 'Joint cabinet',
    description: 'Door with a knob, drawer with a pull.',
    parameters: [
      { id: 'swing', label: 'Swing', default: -1.6, min: -2, max: -1, step: 0.1, unit: 'rad' },
    ],
    slots: [
      { id: 'carcass', label: 'Carcass', color: '#d8d0c0' },
      { id: 'front', label: 'Front', color: '#b09070' },
      { id: 'metal', label: 'Metal', color: '#888888' },
    ],
    parts: [
      {
        id: 'body',
        label: 'Body',
        count: 1,
        shapes: [box('shell', [0.8, 1.2, 0.5], [0, 0.6, 0], 'carcass')],
      },
      {
        id: 'door',
        label: 'Door',
        count: 1,
        shapes: [box('leaf', [0.39, 1.1, 0.02], [-0.2, 0.6, 0.26])],
      },
      {
        id: 'knob',
        label: 'Knob',
        count: 1,
        parent: 'door',
        frame: { position: [-0.05, 0.6, 0.28] },
        shapes: [box('grip', [0.03, 0.03, 0.02], [0, 0, 0], 'metal')],
      },
      {
        id: 'drawer',
        label: 'Drawer',
        count: 1,
        shapes: [box('front', [0.39, 0.2, 0.45], [0.2, 0.3, 0.02])],
      },
      {
        id: 'pull',
        label: 'Pull',
        count: 1,
        parent: 'drawer',
        shapes: [box('bail', [0.1, 0.03, 0.01], [0.2, 0.3, 0.255], 'metal')],
      },
    ] as Part[],
    joints: [
      {
        child: 'door',
        kind: 'revolute',
        origin: [-0.395, 0.6, 0.26],
        axis: [0, 1, 0],
        open: 'swing',
      },
      {
        child: 'knob',
        kind: 'revolute',
        origin: [0, 0, 0],
        axis: [0, 0, 1],
        open: 0.8,
        delay: 0.3,
      },
      { child: 'drawer', kind: 'prismatic', origin: [0, 0, 0], axis: [0, 0, 1], open: 0.35 },
      { child: 'pull', kind: 'revolute', origin: [0.2, 0.315, 0.255], axis: [1, 0, 0], open: 0.9 },
    ],
    constraints: [],
  } as Recipe
  edit(recipe)
  return recipe
}

describe('joint tree (recipe version 2)', () => {
  test('nested chains evaluate to nested motion groups keyed by the child part', () => {
    const e = evaluateRecipe(parseRecipe(cabinet()))
    expect(e.motions.map((m) => [m.id, m.kind, m.axis, m.parent ?? null])).toEqual([
      ['door', 'hinge', 'y', null],
      ['knob', 'hinge', 'z', 'door'],
      ['drawer', 'slide', 'z', null],
      ['pull', 'hinge', 'x', 'drawer'],
    ])
    const knob = e.motions.find((m) => m.id === 'knob')!
    expect(knob.pivot).toEqual([-0.05, 0.6, 0.28])
    expect(knob.delay).toBe(0.3)
    expect(e.motions.find((m) => m.id === 'door')!.amount).toBe(-1.6)
    expect(e.motions.find((m) => m.id === 'drawer')!.pivot).toEqual([0, 0, 0])
    const grip = e.shapes.find((s) => s.partId === 'knob')!
    expect(grip.position).toEqual([-0.05, 0.6, 0.28])
    expect(grip.motionGroup).toBe('knob')
    expect(e.shapes.find((s) => s.partId === 'pull')!.motionGroup).toBe('pull')
    expect(e.shapes.find((s) => s.partId === 'body')!.motionGroup).toBeUndefined()
    // The controller runs one timeline per part, exactly as for flat motion.
    const controller = new ProceduralMotionController(e.motions)
    expect(Object.keys(controller.timeline.perPart)).toEqual(['door', 'knob', 'drawer', 'pull'])
  })

  test('a root joint on a principal axis compiles to exactly the flat motion it replaces', () => {
    const flat = parseRecipe(structuredClone(cabinetJson))
    const jointed = structuredClone(flat) as Recipe
    jointed.version = 2
    jointed.joints = []
    for (const part of jointed.parts) {
      const motion = part.motion
      if (!motion || part.count !== 1) continue
      delete part.motion
      jointed.joints.push(
        motion.kind === 'slide'
          ? {
              child: part.id,
              kind: 'prismatic',
              origin: [0, 0, 0],
              axis: [0, 0, 1],
              open: motion.distance,
              delay: motion.delay,
              duration: motion.duration,
              easing: motion.easing,
            }
          : {
              child: part.id,
              kind: 'revolute',
              origin: motion.pivot,
              axis: [0, 1, 0],
              open: (motion as { angle: number }).angle,
              delay: motion.delay,
              duration: motion.duration,
              easing: motion.easing,
            },
      )
    }
    const a = evaluateRecipe(flat)
    const b = evaluateRecipe(parseRecipe(jointed))
    expect(jointed.joints.map((joint) => joint.child)).toEqual(['drawer'])
    expect(b.shapes).toEqual(a.shapes)
    expect(b.motions).toEqual(a.motions)
    expect(b.motions.every((m) => m.parent === undefined && m.direction === undefined)).toBe(true)
  })

  test('an off-axis joint carries its direction; the rest pose is baked into the shapes', () => {
    const tilted = evaluateRecipe(
      parseRecipe(
        cabinet((r) => {
          r.joints![1] = { ...r.joints![1]!, axis: [0, 1, 1] }
        }),
      ),
    )
    const knob = tilted.motions.find((m) => m.id === 'knob')!
    expect(knob.direction![1]).toBeCloseTo(Math.SQRT1_2)
    expect(knob.direction![2]).toBeCloseTo(Math.SQRT1_2)
    const ajar = evaluateRecipe(
      parseRecipe(
        cabinet((r) => {
          r.joints![0] = { ...r.joints![0]!, rest: -0.5 }
        }),
      ),
    )
    const door = ajar.motions.find((m) => m.id === 'door')!
    expect(door.amount).toBeCloseTo(-1.1)
    const leaf = ajar.shapes.find((s) => s.partId === 'door')!
    // Rotated -0.5 rad about +Y through the hinge, so the leaf swings out toward +Z.
    expect(leaf.position[2]).toBeGreaterThan(0.26 + 0.05)
    expect(leaf.rotation[1]).toBeCloseTo(-0.5)
    // The knob rides the ajar door.
    expect(ajar.motions.find((m) => m.id === 'knob')!.pivot[2]).toBeGreaterThan(0.28)
  })

  test('repeated parents bind repeated children by index', () => {
    const e = evaluateRecipe(
      parseRecipe(
        cabinet((r) => {
          r.parts[1]!.count = 2
          r.parts[1]!.shapes[0]!.position = [
            { op: 'sub', args: [{ op: 'mul', args: ['index', 0.4] }, 0.2] },
            0.6,
            0.26,
          ]
          r.parts[2]!.count = 2
          r.joints![0]!.origin = [
            { op: 'sub', args: [{ op: 'mul', args: ['index', 0.4] }, 0.395] },
            0.6,
            0.26,
          ]
          r.parts[2]!.frame = {
            position: [{ op: 'sub', args: [{ op: 'mul', args: ['index', 0.4] }, 0.05] }, 0.6, 0.28],
          }
        }),
      ),
    )
    expect(e.motions.filter((m) => m.partId === 'knob').map((m) => [m.id, m.parent])).toEqual([
      ['knob', 'door'],
      ['knob~1', 'door~1'],
    ])
  })

  test('motion envelopes bound nested chains by per-joint intervals', () => {
    // A flap hinged along its bottom edge swings down through the floor.
    const flap = cabinet((r) => {
      r.joints![3] = {
        child: 'pull',
        kind: 'revolute',
        origin: [0.2, 0.02, 0.255],
        axis: [1, 0, 0],
        open: 3,
      }
      r.parts[4]!.shapes[0]!.position = [0.2, 0.05, 0.255]
      r.parts[4]!.shapes[0]!.size = [0.1, 0.06, 0.01]
    })
    expect(() => parseRecipe(flap)).toThrow('extends below the floor')
    // Stopping at horizontal clears the floor.
    const up = structuredClone(flap)
    up.joints![3]!.open = 1.5
    expect(() => parseRecipe(up)).not.toThrow()
  })

  test('joints and trees are validated and v2-only', () => {
    expect(() => parseRecipe({ ...cabinet(), version: 1 })).toThrow('version 2')
    const bad: ((r: Recipe) => void)[] = [
      (r) => {
        r.parts[1]!.motion = { kind: 'slide', axis: 'z', distance: 0.1 }
      },
      (r) => {
        r.parts[1]!.parent = 'knob'
      },
      (r) => {
        r.parts[2]!.parent = 'missing'
      },
      (r) => {
        r.parts[2]!.count = 2
      },
      (r) => {
        r.joints!.push({ child: 'knob', kind: 'fixed', origin: [0, 0, 0], axis: [0, 0, 1] })
      },
      (r) => {
        r.joints![1] = { child: 'knob', kind: 'fixed', origin: [0, 0, 0], axis: [0, 0, 1], open: 1 }
      },
      (r) => {
        r.joints![1]!.axis = [0, 0, 0]
      },
      (r) => {
        r.joints![1]!.range = [0, 0.5]
      },
      (r) => {
        r.joints![1] = { child: 'knob', kind: 'continuous', origin: [0, 0, 0], axis: [0, 0, 1] }
      },
      (r) => {
        r.parts[0]!.shapes[0]!.support = true
        r.parts[1]!.parent = 'body'
        r.parts[0]!.parent = 'door'
      },
    ]
    for (const edit of bad) expect(() => parseRecipe(cabinet(edit))).toThrow()
    const withSupport = cabinet((r) => {
      r.parts[2]!.shapes[0]!.support = true
    })
    expect(() => parseRecipe(withSupport)).toThrow('support')
  })

  test('a recessed design may move a jointed part inside its ceiling cut', () => {
    const recipe = structuredClone(downlightJson) as Recipe
    const lens = recipe.parts.find((part) => part.id === 'lens')!
    recipe.joints = [
      { child: 'lens', kind: 'revolute', origin: [0, 0.05, 0], axis: [1, 0, 0], open: 0.4 },
    ]
    expect(() => parseRecipe(recipe)).not.toThrow()
    recipe.joints[0]!.origin = [0, 0.05, 0.3]
    expect(() => parseRecipe(recipe)).toThrow('rises above the ceiling reference')
    expect(lens.id).toBe('lens')
  })
})
