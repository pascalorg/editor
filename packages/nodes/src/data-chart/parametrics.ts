import type { DataChartNode, ParametricDescriptor } from '@pascal-app/core'

export const dataChartParametrics: ParametricDescriptor<DataChartNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
