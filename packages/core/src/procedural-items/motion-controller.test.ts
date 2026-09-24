import { expect, test } from 'bun:test'
import cabinetJson from './__fixtures__/cabinet_two_doors_drawer.json'
import ceilingJson from './__fixtures__/ceiling_fan.json'
import { ProceduralMotionController } from './motion-controller'
import { evaluateRecipe, parseRecipe } from './recipe'

const cabinet = () =>
  new ProceduralMotionController(evaluateRecipe(parseRecipe(cabinetJson)).motions)

test('collective cursor preserves stagger and reverses from its current time', () => {
  const controller = cabinet()
  controller.command({ sequence: 1, scope: 'all', target: true })
  let frame = controller.tick(0.04)
  expect(frame.fractions.doors).toBeGreaterThan(0)
  expect(frame.fractions['doors~1']).toBe(0)
  expect(frame.fractions.drawer).toBe(0)
  frame = controller.tick(0.3)
  const before = frame.times.doors
  controller.command({ sequence: 2, scope: 'all', target: false })
  expect(controller.tick(0).times.doors).toBe(before)
  frame = controller.tick(0.1)
  expect(frame.times.doors).toBeCloseTo(before! - 0.1)
  expect(frame.times.drawer).toBeCloseTo(frame.times.doors!)
})

test('individual commands skip item padding and a mixed close keeps current poses', () => {
  const controller = cabinet()
  controller.command({ sequence: 1, scope: { partId: 'drawer' }, target: true })
  let frame = controller.tick(0.1)
  expect(frame.times.drawer).toBeCloseTo(0.4)
  expect(frame.fractions.drawer).toBeGreaterThan(0)
  expect(frame.fractions.doors).toBe(0)
  controller.command({ sequence: 2, scope: 'all', target: false })
  expect(controller.tick(0).times.drawer).toBeCloseTo(0.4)
  frame = controller.tick(0.1)
  expect(frame.times.drawer).toBeCloseTo(0.3)
})

test('an individual command detaches from the collective time without a pose jump', () => {
  const controller = cabinet()
  controller.command({ sequence: 1, scope: 'all', target: true })
  const before = controller.tick(0.4)
  controller.command({ sequence: 2, scope: { partId: 'doors' }, target: false })
  const after = controller.tick(0)
  expect(after.fractions.doors).toBeCloseTo(before.fractions.doors!)
  expect(after.fractions.drawer).toBeCloseTo(before.fractions.drawer!)
  expect(controller.tick(0.05).fractions.doors).toBeLessThan(before.fractions.doors!)
})

test('unaffected delayed parts retain their collective schedule after detachment', () => {
  const controller = cabinet()
  controller.command({ sequence: 1, scope: 'all', target: true })
  controller.tick(0.1)
  controller.command({ sequence: 2, scope: { partId: 'doors' }, target: false })
  const frame = controller.tick(0.1)
  expect(frame.times.drawer).toBeCloseTo(0.2)
  expect(frame.fractions.drawer).toBe(0)
  expect(controller.tick(0.15).fractions.drawer).toBeGreaterThan(0)
})

test('a delayed collective transition remains pending before its first pose change', () => {
  const motion = evaluateRecipe(parseRecipe(cabinetJson)).motions.find((entry) => entry.partId === 'drawer')!
  const controller = new ProceduralMotionController([motion])
  controller.command({ sequence: 1, scope: 'all', target: true })
  const frame = controller.tick(0.1)
  expect(frame.pending).toBe(true)
  expect(frame.fractions.drawer).toBe(0)
})

test('spin ramps over 0.35 s and holds phase at rest', () => {
  const motion = evaluateRecipe(parseRecipe(ceilingJson)).motions
  const controller = new ProceduralMotionController(motion)
  const coarse = new ProceduralMotionController(motion)
  controller.command({ sequence: 1, scope: 'all', target: true })
  coarse.command({ sequence: 1, scope: 'all', target: true })
  expect(controller.tick(0.175).spins.rotor!.speed).toBeCloseTo(0.5)
  expect(controller.tick(0.175).spins.rotor!.speed).toBe(1)
  expect(coarse.tick(0.35).spins.rotor!.phase).toBeCloseTo(controller.tick(0).spins.rotor!.phase)
  controller.command({ sequence: 2, scope: 'all', target: false })
  controller.tick(0.35)
  const phase = controller.tick(0).spins.rotor!.phase
  expect(controller.tick(1).spins.rotor!.phase).toBe(phase)
})
