/**
 * Print / PDF — every sheet, one vector PDF, each page at its own paper size.
 * The pages handed to `exportSheetsToPdf` are the very same `ComposedSheet`s
 * the screen draws, so what is on the paper is what prints.
 */
import { exportSheetsToPdf } from '@pascal-app/editor'
import { projectRecord, sceneNodes } from './model'
import { composeAll } from './page'

export type PrintResult = { ok: true; sheets: number } | { ok: false; reason: string }

export function setFilename(): string {
  const nodes = sceneNodes()
  const name = projectRecord(nodes)?.identity?.projectName?.trim() || 'construction-set'
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const date = new Date().toISOString().split('T')[0]
  return `${slug || 'construction-set'}_${date}.pdf`
}

export async function printSet(): Promise<PrintResult> {
  const nodes = sceneNodes()
  const composed = composeAll({ nodes })
  if (composed.length === 0) return { ok: false, reason: 'there are no sheets yet' }
  await exportSheetsToPdf(
    composed.map((c) => ({
      widthIn: c.widthIn,
      heightIn: c.heightIn,
      plate: c.plate,
      windows: c.windows,
      overlay: c.overlay,
    })),
    setFilename(),
  )
  return { ok: true, sheets: composed.length }
}
