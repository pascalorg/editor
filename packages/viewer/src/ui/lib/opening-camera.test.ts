import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { parseOpeningCamera, savedSceneCamera } from './opening-camera'

describe('parseOpeningCamera', () => {
  test('reads a position and a target', () => {
    expect(parseOpeningCamera('12,8.5,-20,0,1.2,3')).toEqual({
      position: [12, 8.5, -20],
      target: [0, 1.2, 3],
    })
  })

  test('reads an optional field of view', () => {
    expect(parseOpeningCamera('12,8,20,0,0,0,35')).toEqual({
      fov: 35,
      position: [12, 8, 20],
      target: [0, 0, 0],
    })
  })

  test('names the saved view', () => {
    expect(parseOpeningCamera('saved')).toBe('saved')
  })

  test.each([
    ['missing', null],
    ['empty', ''],
    ['not numbers', 'abc'],
    ['too few values', '1,2,3'],
    ['too many values', '1,2,3,4,5,6,7,8'],
    ['an empty value', '1,,3,4,5,6'],
    ['not a number', '1,2,NaN,4,5,6'],
    ['infinite', 'Infinity,2,3,4,5,6'],
    ['beyond the scene', '1e9,0,0,0,0,0'],
    ['position on the target', '1,2,3,1,2,3'],
    ['a field of view too narrow', '12,8,20,0,0,0,2'],
    ['a field of view too wide', '12,8,20,0,0,0,500'],
  ])('ignores %s', (_case, raw) => {
    expect(parseOpeningCamera(raw)).toBeNull()
  })
})

describe('savedSceneCamera', () => {
  const camera = (x: number) => ({
    mode: 'perspective' as const,
    position: [x, 10, x] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  })
  const scene = (nodes: object[]) =>
    Object.fromEntries(nodes.map((node) => [(node as { id: string }).id, node])) as Record<
      string,
      AnyNode
    >

  test('prefers the camera saved on the site', () => {
    const nodes = scene([
      { id: 'site_a', type: 'site', camera: camera(20) },
      { id: 'building_a', type: 'building', camera: camera(30) },
    ])
    expect(savedSceneCamera(nodes)).toEqual({ position: [20, 10, 20], target: [0, 0, 0] })
  })

  test('falls back to the camera saved on the building', () => {
    const nodes = scene([
      { id: 'site_a', type: 'site' },
      { id: 'building_a', type: 'building', camera: camera(30) },
    ])
    expect(savedSceneCamera(nodes)).toEqual({ position: [30, 10, 30], target: [0, 0, 0] })
  })

  test('is null when the scene saved no view', () => {
    const nodes = scene([
      { id: 'site_a', type: 'site' },
      { id: 'level_a', type: 'level', camera: camera(5) },
    ])
    expect(savedSceneCamera(nodes)).toBeNull()
  })
})
