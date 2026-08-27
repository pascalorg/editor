import { afterEach, describe, expect, test } from 'bun:test'
import {
  editorHostTreeChildrenRegistry,
  registerEditorHostTreeChildren,
} from './host-tree-children'

describe('editorHostTreeChildrenRegistry', () => {
  afterEach(() => editorHostTreeChildrenRegistry.reset())

  test('exposes host children by scene node kind and notifies mounted trees', () => {
    let notifications = 0
    const unsubscribe = editorHostTreeChildrenRegistry.subscribe(() => {
      notifications += 1
    })

    registerEditorHostTreeChildren({
      kind: 'scan',
      component: () => null,
      hasChildren: (node) => node.type === 'scan',
    })

    expect(editorHostTreeChildrenRegistry.childrenForKind('scan')).toBeDefined()
    expect(editorHostTreeChildrenRegistry.childrenForKind('wall')).toBeUndefined()
    expect(notifications).toBe(1)
    unsubscribe()
  })
})
