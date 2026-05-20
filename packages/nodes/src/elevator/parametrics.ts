import type { ElevatorNode, ParametricDescriptor } from '@pascal-app/core'

export const elevatorParametrics: ParametricDescriptor<ElevatorNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
