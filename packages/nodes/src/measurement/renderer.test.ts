import { describe, expect, test } from 'bun:test'
import { Group } from 'three'
import { areMeasurementAncestorsVisible } from './renderer'

describe('measurement renderer visibility', () => {
  test('follows hidden ancestors used for level visibility', () => {
    const scene = new Group()
    const level = new Group()
    const measurement = new Group()
    scene.add(level)
    level.add(measurement)

    expect(areMeasurementAncestorsVisible(measurement)).toBe(true)

    level.visible = false
    expect(areMeasurementAncestorsVisible(measurement)).toBe(false)

    level.visible = true
    scene.visible = false
    expect(areMeasurementAncestorsVisible(measurement)).toBe(false)
  })
})
