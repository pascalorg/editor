import { afterEach, describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import {
  clearPlacementSurface,
  getPlacementSurface,
  publishPlacementSurface,
} from './active-placement-surface'

describe('active placement surface', () => {
  afterEach(() => clearPlacementSurface())

  test('marks a frozen construction plane so terrain raycasting can bypass it', () => {
    publishPlacementSurface(new Vector3(1, 0, 2), new Vector3(0, 1, 0), 'fixed-plane')

    expect(getPlacementSurface()?.projection).toBe('fixed-plane')
  })

  test('ordinary surface publishes reset the projection mode', () => {
    publishPlacementSurface(new Vector3(), new Vector3(0, 1, 0), 'fixed-plane')
    publishPlacementSurface(new Vector3(), new Vector3(0, 1, 0))

    expect(getPlacementSurface()?.projection).toBe('surface')
  })
})
