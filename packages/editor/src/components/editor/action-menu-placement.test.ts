import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { getActionMenuAnchor } from './action-menu-placement'

function boxFromSize(width: number, height: number, depth: number) {
  return new THREE.Box3(
    new THREE.Vector3(-width / 2, -height / 2, -depth / 2),
    new THREE.Vector3(width / 2, height / 2, depth / 2),
  )
}

describe('getActionMenuAnchor', () => {
  test('keeps compact data labels close to the label center', () => {
    const anchor = getActionMenuAnchor(
      { type: 'data-widget' },
      boxFromSize(1.6, 0.5, 0.08),
      new THREE.Vector3(),
    )

    expect(anchor.y).toBeCloseTo(0.24)
  })

  test('places data chart menus above the full html panel footprint', () => {
    const anchor = getActionMenuAnchor(
      { type: 'data-chart' },
      boxFromSize(1.65, 0.7, 0.08),
      new THREE.Vector3(),
    )

    expect(anchor.y).toBeCloseTo(0.85)
  })

  test('treats card-style data widgets as html panels', () => {
    const anchor = getActionMenuAnchor(
      { type: 'data-widget', widgetType: 'card' },
      boxFromSize(2.8, 1, 0.08),
      new THREE.Vector3(),
    )

    expect(anchor.y).toBeCloseTo(1)
  })
})
