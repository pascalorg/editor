import { describe, expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import { resolveWallRole } from './paint'

const baseWall: WallNode = {
  object: 'node',
  id: 'wall_test',
  type: 'wall',
  parentId: null,
  visible: true,
  metadata: {},
  children: [],
  start: [0, 0],
  end: [4, 0],
  height: 2.5,
  thickness: 0.1,
  faceBands: { enabled: true, count: 3, lowerHeight: 0.9, middleHeight: 0.12, upperHeight: 0.61 },
  frontSide: 'interior',
  backSide: 'exterior',
}

describe('resolveWallRole', () => {
  test('maps one wall face to lower, middle, and upper band slots by hit height', () => {
    expect(
      resolveWallRole({
        node: baseWall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.2, 0.05],
      }),
    ).toBe('lowerInterior')

    expect(
      resolveWallRole({
        node: baseWall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.95, 0.05],
      }),
    ).toBe('middleInterior')

    expect(
      resolveWallRole({
        node: baseWall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 1.3, 0.05],
      }),
    ).toBe('upperInterior')
  })

  test('uses adjusted band heights from the wall config', () => {
    const wall = {
      ...baseWall,
      faceBands: {
        enabled: true,
        count: 3,
        lowerHeight: 1.2,
        middleHeight: 0.2,
        upperHeight: 0.61,
      },
    }

    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 2,
        normal: [0, 0, -1],
        localPosition: [1, 1.1, -0.05],
      }),
    ).toBe('lowerExterior')

    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 2,
        normal: [0, 0, -1],
        localPosition: [1, 1.3, -0.05],
      }),
    ).toBe('middleExterior')
  })

  test('falls back to whole-side roles when bands are disabled', () => {
    const wall = {
      ...baseWall,
      faceBands: {
        enabled: false,
        count: 1,
        lowerHeight: 0.9,
        middleHeight: 0.12,
        upperHeight: 0.61,
      },
    }

    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.2, 0.05],
      }),
    ).toBe('interior')
  })

  test('maps four wall bands to lower, middle, upper, and top slots', () => {
    const wall = {
      ...baseWall,
      faceBands: {
        enabled: true,
        count: 4,
        lowerHeight: 0.5,
        middleHeight: 0.5,
        upperHeight: 0.5,
      },
    }

    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.2, 0.05],
      }),
    ).toBe('lowerInterior')
    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.7, 0.05],
      }),
    ).toBe('middleInterior')
    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 1.2, 0.05],
      }),
    ).toBe('upperInterior')
    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 1.8, 0.05],
      }),
    ).toBe('topInterior')
  })

  test('falls back to whole-side roles by default', () => {
    const { faceBands, ...wall } = baseWall
    expect(
      resolveWallRole({
        node: wall,
        materialIndex: 1,
        normal: [0, 0, 1],
        localPosition: [1, 0.2, 0.05],
      }),
    ).toBe('interior')
  })
})
