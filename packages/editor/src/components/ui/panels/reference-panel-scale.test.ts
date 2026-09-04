import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { GuideNode } from '@pascal-app/core'

/**
 * GUARD: the scale field must not clamp away a calibration.
 *
 * "Set Scale" measures a line on the plan image and writes the implied
 * multiplier straight onto the node — a 121.6 m dimension comes out at 20.64.
 * That path never touches this panel. The panel, meanwhile, passed `max={10}`
 * to `SliderControl`, which clamps on drag AND on typed input, so a single
 * nudge on a calibrated guide snapped 20.64 down to 10.
 *
 * Nothing errors. The plan just quietly stops matching the model, at half its
 * correct size, and the only way to notice is to measure something.
 */

const PANEL = path.join(import.meta.dir, 'reference-panel.tsx')

/** The XYZ scale block, from its label to the end of its props. */
function scaleControlSource(): string {
  const source = readFileSync(PANEL, 'utf8')
  const start = source.indexOf('XYZ<sub')
  expect(start).toBeGreaterThan(-1)

  const end = source.indexOf('label="Opacity"', start)
  expect(end).toBeGreaterThan(start)

  return source.slice(start, end)
}

describe('kılavuz ölçek alanı', () => {
  test('üst sınır dayatmıyor', () => {
    expect(/\bmax=\{/.test(scaleControlSource())).toBe(false)
  })

  /**
   * The floor is the half that must survive. Removing it too would let a drag
   * reach zero, which collapses the image to nothing — recoverable, but only
   * by typing a number into a control the user can no longer see.
   */
  test('alt sınırı koruyor', () => {
    expect(scaleControlSource()).toContain('min={0.01}')
  })

  /**
   * Why no ceiling is defensible at all: the schema does not impose one, so any
   * number the panel refuses is a number the rest of the app can still store,
   * load and render.
   */
  test('şema da üst sınır koymuyor', () => {
    const guide = (scale: number) => GuideNode.parse({ url: '/plans/plan.png', scale }).scale

    expect(guide(20.64)).toBe(20.64)
    expect(guide(5000)).toBe(5000)
  })
})
