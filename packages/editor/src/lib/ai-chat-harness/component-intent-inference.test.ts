import { describe, expect, test } from 'bun:test'
import { inferCreateIntentFromBlueprint } from './component-intent-inference'

describe('component intent inference', () => {
  test('infers single bicycle wheel component intent from legacy blueprint', () => {
    const intent = inferCreateIntentFromBlueprint(
      'compose_parts',
      {},
      {
        route: 'compose_parts',
        category: 'bicycle wheel',
        constraints: { radius: 0.35 },
        parts: [{ id: 'front_wheel', kind: 'wheel_set', semanticRole: 'bicycle_tire' }],
      },
      '生成一个自行车的轮子',
    )

    expect(intent).toMatchObject({
      action: 'create',
      scope: 'component',
      family: 'bicycle',
      component: 'wheel',
      quantity: 1,
      arrangement: 'single',
      constraints: { radius: 0.35 },
    })
  })

  test('infers single vehicle wheel component intent from legacy blueprint', () => {
    const intent = inferCreateIntentFromBlueprint(
      'compose_parts',
      {},
      {
        route: 'compose_parts',
        category: 'vehicle wheel',
        parts: [{ id: 'car_wheel_01', kind: 'wheel_set', semanticRole: 'vehicle_tire' }],
      },
      '生成一个汽车轮子',
    )

    expect(intent).toMatchObject({
      action: 'create',
      family: 'vehicle',
      component: 'wheel',
      quantity: 1,
      arrangement: 'single',
    })
  })

  test('preserves explicit wheel component quantity', () => {
    const intent = inferCreateIntentFromBlueprint(
      'compose_parts',
      {},
      {
        route: 'compose_parts',
        category: 'vehicle wheels',
        parts: [{ id: 'car_wheels', kind: 'wheel_set', semanticRole: 'vehicle_tire', count: 4 }],
      },
      '生成四个汽车轮子',
    )

    expect(intent).toMatchObject({
      family: 'vehicle',
      component: 'wheel',
      quantity: 4,
      arrangement: 'array',
    })
  })

  test.each([
    ['vehicle window', 'generate one car window', 'window', 'vehicle'],
    ['vehicle door', 'generate one car door', 'door', 'vehicle'],
    ['vehicle mirror', 'generate one car mirror', 'mirror', 'vehicle'],
    ['aircraft engine', 'generate one aircraft engine', 'engine', 'aircraft'],
    ['propeller', 'generate one propeller', 'propeller', 'generic'],
    ['airfoil blade', 'generate one airfoil blade', 'blade', 'generic'],
  ])('infers %s component intent', (category, prompt, component, family) => {
    const intent = inferCreateIntentFromBlueprint(
      'compose_parts',
      {},
      {
        route: 'compose_parts',
        category,
        parts: [{ id: component, kind: component, semanticRole: component }],
      },
      prompt,
    )

    expect(intent).toMatchObject({
      action: 'create',
      scope: 'component',
      family,
      component,
      quantity: 1,
      arrangement: 'single',
    })
  })
})
