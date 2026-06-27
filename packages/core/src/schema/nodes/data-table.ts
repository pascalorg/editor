import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const DataTableRow = z.object({
  label: z.string().default('Metric'),
  dataKey: z.string().default('machine.temperature'),
})

export const DataTableNode = BaseNode.extend({
  id: objectId('data-table'),
  type: nodeType('data-table'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 2, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  title: z.string().default('Live Data'),
  rows: z
    .array(DataTableRow)
    .min(1)
    .max(8)
    .default([
      { label: 'Temperature', dataKey: 'machine.temperature' },
      { label: 'Fan speed', dataKey: 'fan.speed' },
      { label: 'Alarm count', dataKey: 'alarm.count' },
    ]),
  foreground: z.string().default('#ffffff'),
  background: z.string().default('#111827'),
  accent: z.string().default('#38bdf8'),
  fontSize: z.number().min(10).max(24).default(12),
}).describe('Data table widget - compact tabular display for multiple live data values.')

export type DataTableRow = z.infer<typeof DataTableRow>
export type DataTableNode = z.infer<typeof DataTableNode>
