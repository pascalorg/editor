import type { ParametricDescriptor } from '@pascal-app/core'
import type { DataWidgetNode } from './schema'

export const dataWidgetParametrics: ParametricDescriptor<DataWidgetNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
