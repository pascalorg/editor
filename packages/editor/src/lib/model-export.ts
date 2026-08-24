export type ModelExportFormat = 'glb' | 'stl' | 'obj' | 'print-stl' | 'print-3mf'

export type ModelExportOptions = {
  onlyVisible?: boolean
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
}

export type ModelExport = (
  format?: ModelExportFormat,
  options?: ModelExportOptions,
) => Promise<ModelExportArtifact | null>
