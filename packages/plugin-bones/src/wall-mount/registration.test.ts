import { describe, expect, test } from 'bun:test'
import { deviceDefinition } from '../device/definition'
import { serviceDefinition } from '../service/definition'

/**
 * Registration pins for the wall-node move parity (user ask: select/hover/
 * move devices + service points exactly like doors/windows).
 *
 * The host derives EVERY affordance from these capability fields — no host
 * edit per kind — so this is the contract that keeps the experience alive:
 *  - hover highlight + click-select: `capabilities.selectable` puts the kind
 *    in `getSelectableKinds()`, which the host's SelectionManager subscribes
 *    for `:enter`/`:leave` (hover outline) and `:click` (select);
 *  - the context-toolbar Move cross: `isRegistryMovable` accepts
 *    `capabilities.movable` OR `affordanceTools.move`; Ctrl-drag rides
 *    `hasRegistry3DMoveTool` (same two fields);
 *  - the MOVE tool: the host's MoveTool dispatcher mounts
 *    `affordanceTools.move` FIRST (kind-owned mover wins over the generic
 *    planar mover), which is where the window-parity wall slide lives.
 */

const definitions = [
  ['bones:device', deviceDefinition],
  ['bones:service', serviceDefinition],
] as const

describe('wall-node move parity registration pins', () => {
  for (const [kind, definition] of definitions) {
    const def = definition as unknown as Record<string, unknown>

    test(`${kind}: capabilities keep the hover/select/Move-cross gates`, () => {
      const capabilities = def.capabilities as Record<string, unknown>
      expect(capabilities.selectable).toBeDefined() // hover outline + click-select
      expect(capabilities.movable).toBeDefined() // Move cross + Ctrl-drag + 2D fallback
      expect(capabilities.deletable).toBe(true)
      const movable = capabilities.movable as Record<string, unknown>
      // The legacy parentFrame drag stays declared — the 2D floor-plan and any
      // host without affordance dispatch still get the wall-projected move.
      expect(typeof movable.parentFrame).toBe('object')
      expect(movable.cursorAttached).toBe(true)
    })

    test(`${kind}: exposes the kind-owned move tool (affordanceTools.move)`, async () => {
      const affordanceTools = def.affordanceTools as
        | Record<string, () => Promise<{ default: unknown }>>
        | undefined
      const loader = affordanceTools?.move
      expect(typeof loader).toBe('function')
      if (!loader) throw new Error('affordanceTools.move missing')
      // The loader resolves to a mountable component (the host wraps it in
      // React.lazy — a broken dynamic import would crash move activation).
      const module = await loader()
      expect(typeof module.default).toBe('function')
      // 15s: the first dynamic import of move-tool.tsx transpiles its whole
      // R3F import graph — flaked once at the 5s default under full-suite
      // load (passes in 0.5s isolated).
    }, 15000)
  }

  test('both kinds share ONE move tool module (device ↔ service parity)', async () => {
    type Loaders = Record<string, (() => Promise<{ default: unknown }>) | undefined>
    const deviceLoader = ((deviceDefinition as unknown as Record<string, unknown>)
      .affordanceTools as Loaders).move
    const serviceLoader = ((serviceDefinition as unknown as Record<string, unknown>)
      .affordanceTools as Loaders).move
    if (!(deviceLoader && serviceLoader)) throw new Error('move loaders missing')
    const [deviceModule, serviceModule] = await Promise.all([deviceLoader(), serviceLoader()])
    expect(deviceModule.default).toBe(serviceModule.default)
  })
})
