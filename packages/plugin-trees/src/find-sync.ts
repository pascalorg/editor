import { type AnyNode, emitter } from '@pascal-app/core'
import type { FlowerNode } from './flower-schema'
import type { GrassNode } from './grass-schema'
import type { TreeNode } from './schema'
import { type TreesPanelMode, useTreesStore } from './store'

/**
 * "Find in catalog" sync. The editor's node action menu emits
 * `selection:find-node`; the host opens the panel that owns the kind (via
 * `panelRegistry.panelForKind`) — but which *section* of the Nature panel to
 * show is plugin knowledge, so the plugin listens too and points its own store
 * at the found node's section + preset. Module-level (imported by the plugin
 * manifest) so the listener is live from plugin load, even while the panel has
 * never been mounted.
 */

const MODE_BY_KIND: Record<string, TreesPanelMode> = {
  'trees:tree': 'trees',
  'trees:flower': 'flowers',
  'trees:grass': 'grass',
}

emitter.on(
  'selection:find-node' as never,
  ((node: AnyNode) => {
    const mode = MODE_BY_KIND[node.type as string]
    if (!mode) return
    const store = useTreesStore.getState()
    store.setMode(mode)
    if (mode === 'trees') {
      const tree = node as unknown as TreeNode
      store.setPreset(tree.preset ?? 'oak')
      store.setSize(tree.size ?? 'medium')
    } else if (mode === 'flowers') {
      store.setFlowerPreset((node as unknown as FlowerNode).preset ?? 'daisy')
    } else {
      store.setGrassPreset((node as unknown as GrassNode).preset ?? 'meadow')
    }
  }) as never,
)
