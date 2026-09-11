import type { GlbExportOptions } from './glb-export'

export type ModelExportFormat = 'glb' | 'usdz' | 'stl' | 'obj' | 'print-stl' | 'print-3mf'

export type ModelExportOptions = Pick<
  GlbExportOptions,
  'onlyVisible' | 'excludedNodeTypes' | 'includedPresentationIds'
> & {
  download?: boolean
  printScale?: number
  printScope?: 'whole' | 'levels'
  printContent?: 'structure' | 'everything'
  printBase?: 'none' | 'plinth'
  printMinimumFeatureMm?: number
  printPlinthMarginMm?: number
  printPlinthThicknessMm?: number
}

export type ModelExportArtifact = {
  blob: Blob
  filename: string
  metadata?: unknown
  warnings?: readonly string[]
}

export type ModelExport = (
  format?: ModelExportFormat,
  options?: ModelExportOptions,
) => Promise<ModelExportArtifact | null>
