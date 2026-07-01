import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const DataChartKind = z.enum(['bar', 'line'])

export const DataChartNode = BaseNode.extend({
  id: objectId('data-chart'),
  type: nodeType('data-chart'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 2, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  chartType: DataChartKind.default('bar'),
  title: z.string().default('Trend'),
  dataKeys: z
    .array(z.string())
    .min(1)
    .max(8)
    .default(['machine.temperature', 'fan.speed', 'alarm.count']),
  foreground: z.string().default('#ffffff'),
  background: z.string().default('#111827'),
  backgroundOpacity: z.number().min(0).max(1).default(1),
  accent: z.string().default('#38bdf8'),
  fontSize: z.number().min(10).max(32).default(13),
}).describe('Data chart widget - bar or line chart backed by static/live data.')

export type DataChartKind = z.infer<typeof DataChartKind>
export type DataChartNode = z.infer<typeof DataChartNode>
