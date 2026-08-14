import { describe, expect, test } from 'bun:test'
import { stickyParamsFromSchema } from './registry'

describe('stickyParamsFromSchema', () => {
  const shape = {
    id: 1,
    type: 1,
    name: 1,
    position: 1,
    rotation: 1,
    parentId: 1,
    children: 1,
    thickness: 1,
    height: 1,
    style: 1,
  }

  test('drops identity and placement fields without being asked', () => {
    expect(stickyParamsFromSchema(shape)).toEqual(['thickness', 'height', 'style'])
  })

  test('drops the kind-specific exclusions too', () => {
    expect(stickyParamsFromSchema(shape, ['style'])).toEqual(['thickness', 'height'])
  })

  test('an exclusion for a key that is already universal is harmless', () => {
    expect(stickyParamsFromSchema(shape, ['position'])).toEqual(['thickness', 'height', 'style'])
  })

  test('a kind whose every field is excluded contributes nothing', () => {
    expect(stickyParamsFromSchema({ id: 1, position: 1 })).toEqual([])
  })
})
