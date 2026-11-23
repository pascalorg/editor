// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import { readbackRows } from './readback-rows'

/** Each pixel's red channel encodes its column, green its row. */
function image(width: number, height: number, stride: number, bottomUp = false): Uint8Array {
  const buffer = new Uint8Array(stride * height)
  for (let row = 0; row < height; row++) {
    const at = (bottomUp ? height - 1 - row : row) * stride
    for (let column = 0; column < width; column++) {
      buffer[at + column * 4] = column % 256
      buffer[at + column * 4 + 1] = row % 256
      buffer[at + column * 4 + 3] = 255
    }
  }
  return buffer
}

function expectUnsheared(rows: Uint8ClampedArray, width: number, height: number) {
  expect(rows).toHaveLength(width * height * 4)
  for (const row of [0, 1, Math.floor(height / 2), height - 1]) {
    const at = row * width * 4
    expect([rows[at], rows[at + 4], rows[at + 8]]).toEqual([0, 1, 2])
    expect(rows[at + 1]).toBe(row % 256)
  }
}

describe('snapshot readback rows', () => {
  // 1440 px is 5760 bytes per row: not 256-aligned, so WebGPU's copy pads it to 5888.
  const width = 1440
  const height = 90
  const padded = Math.ceil((width * 4) / 256) * 256

  test('a padded WebGPU readback (three before r187) is depadded', () => {
    expect(padded).not.toBe(width * 4)
    expectUnsheared(readbackRows(image(width, height, padded), width, height, true), width, height)
  })

  test('a tight WebGPU readback (three r187+) is not depadded again', () => {
    expectUnsheared(
      readbackRows(image(width, height, width * 4), width, height, true),
      width,
      height,
    )
  })

  test('an aligned WebGPU width passes through', () => {
    expectUnsheared(readbackRows(image(256, 4, 1024), 256, 4, true), 256, 4)
  })

  test('a WebGL readback is flipped top-down', () => {
    expectUnsheared(
      readbackRows(image(width, height, width * 4, true), width, height, false),
      width,
      height,
    )
  })
})
