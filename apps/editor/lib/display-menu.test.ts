import { describe, expect, test } from 'bun:test'
import { displayMenuLayout } from './display-menu'

describe('Display menu layout', () => {
  test('the plan alone shows the Plan group and other levels, not the Scene group', () => {
    expect(displayMenuLayout('2d')).toEqual({
      scope: '2d',
      otherLevels: true,
      plan: true,
      scene: false,
      viewTags: false,
    })
  })

  test('the 3D view alone shows the Scene group, without other levels', () => {
    expect(displayMenuLayout('3d')).toEqual({
      scope: '3d',
      otherLevels: false,
      plan: false,
      scene: true,
      viewTags: false,
    })
  })

  test('split shows every group, shared, with the view-only groups tagged', () => {
    expect(displayMenuLayout('split')).toEqual({
      scope: 'shared',
      otherLevels: true,
      plan: true,
      scene: true,
      viewTags: true,
    })
  })
})
