import { afterEach, beforeEach, expect, test } from 'bun:test'
import { type AnyNodeDefinition, type IconRef, nodeRegistry, registerNode } from '@pascal-app/core'
import { z } from 'zod'
import { registryToolCursorIcon, wallCursorIcon } from './tool-cursor-icon'
import { getWallDrawVariantInfo, WALL_DRAW_VARIANTS } from './wall-draw-variant'

test('the wall cursor bubble shows the Rooms tile icon of the variant in hand', () => {
  for (const variant of WALL_DRAW_VARIANTS) {
    expect(wallCursorIcon(variant.mode)).toEqual({
      label: getWallDrawVariantInfo(variant.id).title,
      iconSrc: variant.iconSrc,
    })
  }
  expect(
    new Set(WALL_DRAW_VARIANTS.map((variant) => wallCursorIcon(variant.mode).iconSrc)).size,
  ).toBe(3)
  expect(getWallDrawVariantInfo('walls').iconSrc).toBe('/icons/wall.webp')
})

let restoreRegistry: () => void = () => {}
beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
})
afterEach(() => restoreRegistry())

function registerKind(kind: string, label: string, icon: IconRef) {
  registerNode({
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }),
    category: 'site',
    defaults: () => ({}),
    presentation: { label, icon },
    capabilities: {},
  } as unknown as AnyNodeDefinition)
}

const GARDEN_ICONS: [string, string, IconRef][] = [
  ['tree', 'Tree', { kind: 'url', src: '/icons/garden-tree.webp' }],
  ['rock', 'Rock', { kind: 'url', src: '/icons/garden-rock.webp' }],
  ['hedge', 'Hedge', { kind: 'url', src: '/icons/garden-hedge.webp' }],
  ['planting', 'Planting bed', { kind: 'url', src: '/icons/garden-planting.webp' }],
  ['lawn', 'Lawn', { kind: 'url', src: '/icons/garden-lawn.webp' }],
]

test("a garden tool in hand shows its kind's own registry icon and name in the cursor bubble", () => {
  for (const [kind, label, icon] of GARDEN_ICONS) {
    registerKind(kind, label, icon)
    expect(registryToolCursorIcon(kind)).toEqual({
      label: { id: `node.${kind}.label`, message: label },
      icon,
    })
  }
})

test('no other registered tool gains a cursor bubble from its registry icon', () => {
  registerKind('measurement', 'Measurement', { kind: 'iconify', name: 'lucide:ruler' })
  expect(registryToolCursorIcon('measurement')).toBeNull()
  // A garden kind whose plugin is absent shows nothing rather than a blank bubble.
  expect(registryToolCursorIcon('lawn')).toBeNull()
})
