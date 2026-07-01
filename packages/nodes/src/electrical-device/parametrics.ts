import type { ParametricDescriptor } from '@pascal-app/core'
import type { ElectricalDeviceNode } from './schema'

export const electricalDeviceParametrics: ParametricDescriptor<ElectricalDeviceNode> = {
  groups: [
    {
      label: 'Device',
      fields: [
        {
          key: 'deviceType',
          kind: 'enum',
          options: ['outlet', 'switch', 'light', 'junction-box', 'panel'],
          display: 'segmented',
        },
        {
          key: 'mounting',
          kind: 'enum',
          options: ['wall', 'ceiling', 'floor'],
        },
      ],
    },
  ],
}
