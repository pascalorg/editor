import { AlertTriangle, Printer } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../../components/ui/primitives/button'
import {
  isPrintLevelBundleReport,
  type PrintLevelBundleReport,
} from '../../../../../lib/level-print-export'
import type { ModelExport, ModelExportArtifact } from '../../../../../lib/model-export'
import {
  isPrintExportReport,
  type PrintExportReport,
} from '../../../../../lib/print-export'
import useEditor from '../../../../../store/use-editor'

type PreparedPrintExport = {
  artifact: ModelExportArtifact
  report: PrintExportReport | PrintLevelBundleReport
}

function downloadArtifact(artifact: ModelExportArtifact) {
  const url = URL.createObjectURL(artifact.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = artifact.filename
  link.click()
  URL.revokeObjectURL(url)
}

function firstBlockingMessage(report: PrintExportReport | PrintLevelBundleReport) {
  const bundleDiagnostic = report.diagnostics.find((item) => item.severity === 'error')
  if (bundleDiagnostic || !isPrintLevelBundleReport(report)) return bundleDiagnostic?.message

  for (const part of report.parts) {
    const partDiagnostic = part.report.diagnostics.find((item) => item.severity === 'error')
    if (partDiagnostic) return partDiagnostic.message
  }
}

export async function preparePrintExport(
  modelExport: ModelExport,
  onlyVisible: boolean,
): Promise<PreparedPrintExport> {
  const artifact = await modelExport('print-3mf', {
    onlyVisible,
    download: false,
    printScale: 100,
    printScope: 'levels',
    printContent: 'structure',
    printBase: 'none',
  })

  if (
    !artifact ||
    (!isPrintExportReport(artifact.metadata) && !isPrintLevelBundleReport(artifact.metadata))
  ) {
    throw new Error('The 3D print exporter did not return a valid file.')
  }

  if (artifact.metadata.status === 'blocked') {
    throw new Error(
      firstBlockingMessage(artifact.metadata) ??
        'This project cannot be exported as printable parts.',
    )
  }

  return { artifact, report: artifact.metadata }
}

export function PrintExportButton({ onlyVisible }: { onlyVisible: boolean }) {
  const modelExport = useEditor((state) => state.modelExport)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    if (!modelExport) return

    setIsExporting(true)
    setError(null)
    try {
      const prepared = await preparePrintExport(modelExport, onlyVisible)
      downloadArtifact(prepared.artifact)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '3D print export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <>
      <Button
        aria-busy={isExporting}
        className="w-full justify-start gap-2"
        disabled={isExporting || !modelExport}
        onClick={handleExport}
        variant="outline"
      >
        <Printer className="size-4" />
        Export 3D print files
      </Button>
      {error && (
        <div className="flex gap-2 text-destructive text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </>
  )
}
