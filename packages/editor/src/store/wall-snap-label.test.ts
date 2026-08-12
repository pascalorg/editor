import { describe, expect, test } from 'bun:test'
import { wallSnapLabel } from './use-wall-snap-indicator'

describe('wallSnapLabel', () => {
  test('names each kind of built geometry', () => {
    expect(wallSnapLabel({ kind: 'endpoint' })).toBe('Endpoint')
    expect(wallSnapLabel({ kind: 'midpoint' })).toBe('Midpoint')
    expect(wallSnapLabel({ kind: 'intersection' })).toBe('Intersection')
    expect(wallSnapLabel({ kind: 'wall' })).toBe('On wall')
  })

  test('an imported drawing is never conflated with built geometry', () => {
    expect(wallSnapLabel({ kind: 'endpoint', source: 'cad' })).toBe('Drawing endpoint')
    expect(wallSnapLabel({ kind: 'midpoint', source: 'cad' })).toBe('Drawing midpoint')
    expect(wallSnapLabel({ kind: 'wall', source: 'cad' })).toBe('On drawing')
  })

  test('an explicit wall source reads as built geometry', () => {
    expect(wallSnapLabel({ kind: 'endpoint', source: 'wall' })).toBe('Endpoint')
  })
})
