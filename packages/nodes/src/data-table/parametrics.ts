import type { DataTableNode, ParametricDescriptor } from '@pascal-app/core'

export const dataTableParametrics: ParametricDescriptor<DataTableNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
