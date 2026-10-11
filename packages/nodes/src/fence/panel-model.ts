import type { FenceNode } from '@pascal-app/core'
import type { NodePanelModel } from '@pascal-app/editor'
import { beginFenceFeaturePlacement } from './features'

export const fencePanelModel: NodePanelModel<FenceNode> = {
  rows() {
    return (['gate', 'opening'] as const).map((kind) => ({
      id: `add-${kind}`,
      kind: 'action',
      section: 'Gates & openings',
      label: kind === 'gate' ? 'Add Gate' : 'Add Opening',
      onSelect: () => beginFenceFeaturePlacement(kind),
    }))
  },
}
