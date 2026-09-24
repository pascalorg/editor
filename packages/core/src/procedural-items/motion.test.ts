import { describe, expect, test } from 'bun:test'
import cabinetJson from './__fixtures__/cabinet_two_doors_drawer.json'
import ceilingJson from './__fixtures__/ceiling_fan.json'
import deskJson from './__fixtures__/desk_fan.json'
import ballJson from './__fixtures__/soccer_ball.json'
import skullJson from './__fixtures__/stylized_skull.json'
import { evaluateRecipe, parseRecipe, RECIPE_LIMITS, sweepRecipe } from './recipe'

const fixtures = [cabinetJson, ceilingJson, deskJson, ballJson, skullJson]
const cabinet = () => parseRecipe(structuredClone(cabinetJson))

describe('curved procedural shapes and motion', () => {
  test('all example recipes pass the parameter sweep', () => {
    for (const fixture of fixtures) {
      const recipe = parseRecipe(fixture)
      expect(sweepRecipe(recipe).filter((sample) => !sample.valid)).toEqual([])
    }
  })

  test('sin and cos place five blades radially', () => {
    const blades = evaluateRecipe(parseRecipe(ceilingJson)).shapes.filter(
      (shape) => shape.partId === 'rotor',
    )
    expect(blades).toHaveLength(5)
    for (let index = 0; index < 5; index++) {
      const angle = (index * 2 * Math.PI) / 5
      expect(blades[index]!.position[0]).toBeCloseTo(0.53 * Math.cos(angle))
      expect(blades[index]!.position[2]).toBeCloseTo(0.53 * Math.sin(angle))
    }
    const recipe = cabinet()
    recipe.parts[0]!.shapes[0]!.position[0] = { op: 'sin', args: [{ op: 'div', args: [1, 0] }] }
    expect(() => evaluateRecipe(recipe)).toThrow('Invalid expression result')
  })

  test('ellipsoid uses analytic rotated bounds and 720 estimated triangles', () => {
    const recipe = parseRecipe(ballJson)
    recipe.parts[0]!.shapes = [
      {
        id: 'sphere',
        primitive: 'ellipsoid',
        slot: 'white',
        size: [2, 1, 0.5],
        position: [0, 1, 0],
        rotation: [0, 0, Math.PI / 4],
      },
    ]
    const result = evaluateRecipe(recipe)
    const extentX = Math.hypot(Math.SQRT1_2, 0.5 * Math.SQRT1_2)
    expect(result.min[0]).toBeCloseTo(-extentX)
    expect(result.max[0]).toBeCloseTo(extentX)
    expect(result.min[1]).toBeCloseTo(1 - extentX)
    expect(result.triangles).toBe(720)
  })

  test('topScale is cylinder-only, bounded, and cannot carry support when tapered', () => {
    const recipe = parseRecipe(deskJson)
    expect(evaluateRecipe(recipe).shapes[0]!.topScale).toBe(0.55)
    const shape = recipe.parts[0]!.shapes[0]!
    shape.topScale = 1.01
    expect(() => evaluateRecipe(recipe)).toThrow('topScale')
    shape.topScale = 0.5
    shape.support = true
    expect(() => parseRecipe(recipe)).toThrow('Support surface')
    shape.support = false
    shape.primitive = 'box'
    expect(() => parseRecipe(recipe)).toThrow('topScale is only allowed on cylinders')
    shape.primitive = 'ellipsoid'
    delete shape.topScale
    shape.support = true
    expect(() => parseRecipe(recipe)).toThrow('Ellipsoid')
  })

  test('five blades merge into one group; separate door pivots stay separate', () => {
    const fan = evaluateRecipe(parseRecipe(ceilingJson))
    expect(fan.motions).toHaveLength(1)
    expect(
      fan.shapes.filter((shape) => shape.partId === 'rotor').map((shape) => shape.motionGroup),
    ).toEqual(Array(5).fill('rotor'))
    const doors = evaluateRecipe(cabinet())
    expect(doors.motions.map((motion) => motion.id)).toEqual(['doors', 'doors~1', 'drawer'])
    expect(
      doors.shapes.filter((shape) => shape.partId === 'doors').map((shape) => shape.motionGroup),
    ).toEqual(['doors', 'doors', 'doors~1', 'doors~1'])
  })

  test('motion schema and moving surface rules reject invalid recipes', () => {
    const recipe = cabinet()
    const doors = recipe.parts[1]!
    doors.motion = { kind: 'hinge', pivot: [0, 0, 0], axis: 'y', angle: 0 }
    expect(() => evaluateRecipe(recipe)).toThrow('Invalid hinge amount')
    doors.motion.angle = Math.PI + 0.01
    expect(() => evaluateRecipe(recipe)).toThrow('Invalid hinge amount')
    doors.motion.angle = 1
    doors.shapes[0]!.support = true
    expect(() => parseRecipe(recipe)).toThrow('Moving part')
    doors.shapes[0]!.support = false
    recipe.surfaces = [
      { id: 'handle', label: 'Handle', part: 'doors', position: [0, 1, 0], size: [0.2, 0.2] },
    ]
    expect(() => parseRecipe(recipe)).toThrow('Named surface')
    delete recipe.surfaces
    expect(() =>
      parseRecipe({
        ...recipe,
        parts: [
          {
            ...doors,
            motion: { kind: 'spin', pivot: [0, 0, 0], axis: 'bad', radiansPerSecond: 1 },
          },
        ],
      }),
    ).toThrow()
    const fan = parseRecipe(ceilingJson)
    fan.parts[1]!.motion = { kind: 'spin', pivot: [0, 2.1, 0], axis: 'y', radiansPerSecond: 20.01 }
    expect(() => evaluateRecipe(fan)).toThrow('Invalid spin amount')
    const drawer = cabinet()
    drawer.parts[2]!.motion = { kind: 'slide', axis: 'z', distance: 5.01 }
    expect(() => evaluateRecipe(drawer)).toThrow('Invalid slide amount')
  })

  test('motion budgets cap moving parts and evaluated groups', () => {
    const recipe = cabinet()
    const door = recipe.parts[1]!
    recipe.parts = Array.from({ length: RECIPE_LIMITS.motionParts + 1 }, (_, index) => ({
      ...structuredClone(door),
      id: `door_${index}`,
      count: 1,
    }))
    expect(() => parseRecipe(recipe)).toThrow('moving parts')
    recipe.parts = [structuredClone(door)]
    recipe.parts[0]!.count = RECIPE_LIMITS.motionGroups + 1
    recipe.parts[0]!.motion = {
      kind: 'hinge',
      pivot: [{ op: 'mul', args: ['index', 0.01] }, 0.86, 0.36],
      axis: 'y',
      angle: 1,
    }
    expect(() => evaluateRecipe(recipe)).toThrow('motion groups')
  })

  test('envelope catches a door sweeping below the floor', () => {
    const recipe = cabinet()
    recipe.parts[1]!.motion = { kind: 'hinge', pivot: [0, 0, 0], axis: 'x', angle: Math.PI / 2 }
    expect(() => evaluateRecipe(recipe)).toThrow('below the floor')
  })

  test('parameter sweep checks motion envelopes beyond the default pose', () => {
    const recipe = cabinet()
    recipe.parameters.push({
      id: 'swing',
      label: 'Swing',
      default: 0.1,
      min: -Math.PI,
      max: 0.1,
      step: 0.1,
      unit: 'rad',
    })
    recipe.parts[1]!.motion = { kind: 'hinge', pivot: [0, 0, 0], axis: 'x', angle: 'swing' }
    expect(() => parseRecipe(recipe)).not.toThrow()
    expect(
      sweepRecipe(recipe).some(
        (sample) => !sample.valid && sample.error?.includes('below the floor'),
      ),
    ).toBe(true)
  })

  test('envelope catches a wall item opening behind its reference', () => {
    const recipe = cabinet()
    recipe.parts = [recipe.parts[1]!]
    recipe.parts[0]!.count = 1
    recipe.parts[0]!.motion = { kind: 'hinge', pivot: [0, 0.86, 0.36], axis: 'y', angle: -Math.PI }
    recipe.surfaces = [
      {
        id: 'back',
        label: 'Back',
        position: [0, 0.8, 0],
        rotation: [-Math.PI / 2, 0, 0],
        size: [1, 1],
      },
    ]
    recipe.mounting = { attachTo: 'wall-side', reference: 'back' }
    expect(() => evaluateRecipe(recipe)).toThrow('behind the wall')
  })
})
