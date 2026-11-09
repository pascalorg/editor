import { registerNode } from '../../registry/registry'
import type { AnyNodeDefinition } from '../../registry/types'

export function registerHostingTestNode(definition: AnyNodeDefinition) {
  registerNode({
    ...definition,
    geometry: () => {
      throw new Error('Unit-test host geometry must not be rendered')
    },
  })
}
