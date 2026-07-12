import type { MeasurementNode, ParametricDescriptor } from '@pascal-app/core'

export const measurementParametrics: ParametricDescriptor<MeasurementNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
