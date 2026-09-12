import { afterEach, describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import {
  clearPlacementSurface,
  getPlacementSurface,
  publishPlacementSurface,
  usesOrientedPlacementPlane,
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

  test('copies a stable lattice anchor when one is provided', () => {
    publishPlacementSurface(
      new Vector3(4, 2, 3),
      new Vector3(0, 0, 1),
      'surface',
      new Vector3(1, 2, 3),
    )

    expect(getPlacementSurface()?.anchor?.toArray()).toEqual([1, 2, 3])
  })

  test('orients the grid to a sloped placement surface', () => {
    expect(usesOrientedPlacementPlane(new Vector3(0, 0.6, 0.8))).toBe(true)
  })
})
