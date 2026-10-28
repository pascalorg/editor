import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FoundationDimensionsGroup } from '../../components/editor-2d/floorplan-foundation-layer'
import { foundationDimensionStrings } from './foundation-dimensions'

const meters = (value: number) => value.toFixed(2)
const texts = (strings: ReturnType<typeof foundationDimensionStrings>) =>
  strings.map((string) => string.segments.map((segment) => segment.text))

test('a box: one length a side, its dimension line 0.6 m out, from corner to corner', () => {
  const strings = foundationDimensionStrings(
    [
      [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
    ],
    meters,
  )
  // Round the box: the -z side, +x, +z, -x; a single length needs no overall row.
  expect(texts(strings)).toEqual([['10.00'], ['8.00'], ['10.00'], ['8.00']])
  const [south] = strings
  expect(south?.offsetNormal).toEqual([0, -1])
  expect(south?.segments[0]).toMatchObject({
    start: [0, 0],
    end: [10, 0],
    dimensionStart: [0, -0.6],
    dimensionEnd: [10, -0.6],
  })
})

test('an L: each side chained through its corners, the overall length a row further out', () => {
  // Wound clockwise: the strings come out the same.
  const strings = foundationDimensionStrings(
    [
      [
        [0, 8],
        [6, 8],
        [6, 4],
        [10, 4],
        [10, 0],
        [0, 0],
      ],
    ],
    meters,
  )
  expect(texts(strings)).toEqual([
    ['10.00'],
    ['4.00', '4.00'],
    ['8.00'],
    ['6.00', '4.00'],
    ['10.00'],
    ['8.00'],
  ])
  // The +z side's break at x 6 stands on the corner nearest that side, its overall row 1.2 m out.
  const north = strings.filter((string) => string.offsetNormal[1] === 1)
  expect(north[0]?.segments[0]?.end).toEqual([6, 8])
  expect(north[1]?.segments[0]?.dimensionStart).toEqual([0, 9.2])
})

test('a side split in two reads its two pieces, and the whole', () => {
  const strings = foundationDimensionStrings(
    [
      [
        [0, 0],
        [4, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
    ],
    meters,
  )
  expect(texts(strings).slice(0, 2)).toEqual([['4.00', '6.00'], ['10.00']])
})

test('the plan draws them as dimension strings, out of the way of the pointer', () => {
  const strings = foundationDimensionStrings(
    [
      [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
    ],
    meters,
  )
  const markup = renderToStaticMarkup(<FoundationDimensionsGroup strings={strings} />)
  expect(markup).toContain('data-foundation-dimensions=""')
  expect(markup.match(/data-floorplan-dimension-string=""/g)).toHaveLength(4)
  expect(markup).toContain('10.00')
  expect(renderToStaticMarkup(<FoundationDimensionsGroup strings={[]} />)).toBe('')
})
