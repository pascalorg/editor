import { afterEach, describe, expect, test } from 'bun:test'
import { editorHostPanelRegistry, registerEditorHostPanel } from './plugin-panels'

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
