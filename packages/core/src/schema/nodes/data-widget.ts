import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const DataWidgetKind = z.enum(['label', 'badge', 'card', 'chart'])

export const DataWidgetNode = BaseNode.extend({
  id: objectId('data-widget'),
  type: nodeType('data-widget'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 2, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  widgetType: DataWidgetKind.default('label'),
  dataKey: z.string().default('machine.temperature'),
  template: z.string().default('{label}: {value}{unit}'),
  title: z.string().default('Live Data'),
  foreground: z.string().default('#ffffff'),
  background: z.string().default('#111827'),
  fontSize: z.number().min(10).max(48).default(14),
}).describe('Data widget — static/live data label, badge, card, or chart placed on the canvas.')

export type DataWidgetKind = z.infer<typeof DataWidgetKind>
export type DataWidgetNode = z.infer<typeof DataWidgetNode>
