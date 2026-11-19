import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { builtinPlugin } from '../index'

// The five garden kinds show their own picture wherever the editor shows a kind's icon (cursor
// bubble, plan badge, card header, Site row, inspector title): one file each, served by the app.
const served = join(import.meta.dir, '../../../../apps/editor/public')

for (const kind of ['tree', 'rock', 'hedge', 'planting', 'lawn'] as const) {
  test(`${kind} is shown with its own garden picture`, () => {
    const icon = builtinPlugin.nodes?.find((entry) => entry.kind === kind)?.presentation?.icon
    expect(icon).toEqual({ kind: 'url', src: `/icons/garden-${kind}.webp` })
    expect(existsSync(join(served, 'icons', `garden-${kind}.webp`))).toBe(true)
  })
}
