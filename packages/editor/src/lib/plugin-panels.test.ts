import { afterEach, describe, expect, test } from 'bun:test'
import {
  type EditorHostPanel,
  editorHostPanelRegistry,
  managedPluginIds,
  registerEditorHostPanel,
  showsPluginManager,
} from './plugin-panels'

describe('editorHostPanelRegistry', () => {
  afterEach(() => editorHostPanelRegistry.reset())

  test('maps registered node kinds back to their owning host panel', () => {
    registerEditorHostPanel({
      id: 'pascal:trees:trees',
      label: 'Nature',
      icon: { kind: 'url', src: '/nature.webp' },
      component: async () => ({ default: () => null }),
      kinds: ['trees:tree', 'trees:flower', 'trees:grass'],
    })

    expect(editorHostPanelRegistry.panelForKind('trees:flower')).toBe('pascal:trees:trees')
    expect(editorHostPanelRegistry.panelForKind('wall')).toBeUndefined()
  })
})

const panel = (id: string, pluginId?: string): EditorHostPanel => ({
  component: async () => ({ default: () => null }),
  icon: { kind: 'url', src: '/x.webp' },
  id,
  label: id,
  ...(pluginId ? { pluginId } : {}),
})

describe('managedPluginIds', () => {
  test('counts plugins, not panels — one plugin with two panels is one plugin', () => {
    expect(
      managedPluginIds([
        panel('pascal:boots:game', 'pascal:boots'),
        panel('pascal:boots:keep', 'pascal:boots'),
        panel('pascal:trees:nature', 'pascal:trees'),
      ]),
    ).toEqual(['pascal:boots', 'pascal:trees'])
  })

  test("the editor's own panels are not plugins", () => {
    // No `pluginId` means it came from the host app, not from a plugin, and
    // there is nothing to install or uninstall.
    expect(managedPluginIds([panel('site'), panel('settings')])).toEqual([])
    expect(managedPluginIds([])).toEqual([])
  })
})

/**
 * THE EMPTY LOBBY PANEL (owner report 2026-08-31). `/play/<id>` mounts the
 * editor read-only and registers no host panels, so the plugin *manager* was
 * the only tab in the rail: it opened by default onto a bare "Plugins" heading
 * eating ~40% of a visitor's window. Dropping the last tab makes the v2 layout
 * drop the left column entirely, which is the lobby as designed.
 *
 * The line to hold is that this hides an EMPTY manager and never a populated
 * one — a read-only viewer in the real editor can still see what a project uses.
 */
describe('showsPluginManager', () => {
  test('the open lobby — read-only with nothing registered — gets no rail at all', () => {
    expect(
      showsPluginManager({ managedPluginCount: 0, readOnly: true, workspaceMode: 'edit' }),
    ).toBe(false)
  })

  test('a read-only editor keeps the manager as soon as a plugin is registered', () => {
    // Browsing what a project uses is a read, and the install button is
    // already disabled on its own.
    expect(
      showsPluginManager({ managedPluginCount: 1, readOnly: true, workspaceMode: 'edit' }),
    ).toBe(true)
  })

  test('a writable scene always keeps it, even with zero plugins', () => {
    // The empty state is still useful to an owner: it is where "Create a
    // Pascal plugin" lives.
    expect(
      showsPluginManager({ managedPluginCount: 0, readOnly: false, workspaceMode: 'edit' }),
    ).toBe(true)
    expect(
      showsPluginManager({ managedPluginCount: 3, readOnly: false, workspaceMode: 'edit' }),
    ).toBe(true)
  })

  test('never outside the edit workspace — studio has its own rail', () => {
    for (const readOnly of [false, true]) {
      for (const managedPluginCount of [0, 2]) {
        expect(
          showsPluginManager({ managedPluginCount, readOnly, workspaceMode: 'studio' }),
          `readOnly=${readOnly} count=${managedPluginCount}`,
        ).toBe(false)
      }
    }
  })

  test('the pre-existing behaviour is unchanged for the normal editor', () => {
    // Regression fence: before this gate the rule was `workspaceMode === 'edit'`
    // alone. Every writable edit-workspace case must still answer the same.
    for (const managedPluginCount of [0, 1, 5]) {
      expect(
        showsPluginManager({ managedPluginCount, readOnly: false, workspaceMode: 'edit' }),
      ).toBe(true)
    }
  })
})
