import type { BeamNode, ParametricDescriptor } from '@pascal-app/core'

export const beamParametrics: ParametricDescriptor<BeamNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
