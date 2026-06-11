import type { ParametricDescriptor } from '@pascal-app/core'
import type { PlumbingFixtureNode } from './schema'

export const plumbingFixtureParametrics: ParametricDescriptor<PlumbingFixtureNode> = {
  groups: [
    {
      label: 'Fixture',
      fields: [
        {
          key: 'fixtureType',
          kind: 'enum',
          options: ['toilet', 'lavatory', 'kitchen-sink', 'tub', 'washer'],
        },
      ],
    },
    {
      label: 'Placement',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}
