import { useScene } from '@pascal-app/core'
import {
  type SceneExport,
  type SceneExportArtifact,
  useViewer,
} from '@pascal-app/viewer'
import { AlertTriangle, CheckCircle2, Download, Printer, XCircle } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button } from '../../../../../components/ui/primitives/button'
import {
  isPrintExportReport,
  type PrintExportReport,
} from '../../../../../lib/print-export'

export type PreparedPrintExport = {
  artifact: SceneExportArtifact
  report: PrintExportReport
}

function formatMillimeters(value: number): string {
  if (value >= 100) return value.toFixed(1)
  if (value >= 10) return value.toFixed(2)
  return value.toFixed(3)
}

function downloadArtifact(artifact: SceneExportArtifact) {
  const url = URL.createObjectURL(artifact.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = artifact.filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function preparePrintExport(
  exportScene: SceneExport,
  onlyVisible: boolean,
  scaleInput: string,
): Promise<PreparedPrintExport> {
  const scale = Number(scaleInput)
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('Enter a positive scale denominator, such as 25, 50, or 100.')
  }

  const artifact = await exportScene('print-stl', {
    onlyVisible,
    download: false,
    printScale: scale,
  })
  if (!artifact || !isPrintExportReport(artifact.metadata)) {
    throw new Error('The print exporter did not return a preflight report.')
  }
  return { artifact, report: artifact.metadata }
}

export function PrintExportCard({ onlyVisible }: { onlyVisible: boolean }) {
  const scaleInputId = useId()
  const nodes = useScene((state) => state.nodes)
  const exportScene = useViewer((state) => state.exportScene)
  const [printScale, setPrintScale] = useState('100')
  const [isPreparing, setIsPreparing] = useState(false)
  const [prepared, setPrepared] = useState<PreparedPrintExport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPrepared(null)
    setError(null)
  }, [nodes, onlyVisible, printScale])

  const handlePrepare = async () => {
    if (!exportScene) {
      setError('The 3D exporter is still loading.')
      return
    }

    setIsPreparing(true)
    setPrepared(null)
    setError(null)
    try {
      setPrepared(await preparePrintExport(exportScene, onlyVisible, printScale))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Print export failed.')
    } finally {
      setIsPreparing(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <Printer className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium text-sm">Print STL</div>
          <div className="text-muted-foreground text-xs">
            Experimental millimeter, Z-up export centered on the print bed
          </div>
        </div>
      </div>

      <label className="block space-y-1 text-xs" htmlFor={scaleInputId}>
        <span className="font-medium">Model scale (1:n)</span>
        <input
          className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id={scaleInputId}
          min="1"
          onChange={(event) => setPrintScale(event.target.value)}
          step="1"
          type="number"
          value={printScale}
        />
        <span className="block text-muted-foreground">
          Common architectural scales are 1:25, 1:50, and 1:100.
        </span>
      </label>

      <Button
        className="w-full justify-start gap-2"
        disabled={isPreparing || !exportScene}
        onClick={handlePrepare}
        variant="outline"
      >
        <Printer className="size-4" />
        {isPreparing ? 'Preparing print STL...' : 'Prepare print STL'}
      </Button>

      {error && (
        <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-red-800 text-xs">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {prepared && (
        <div className="space-y-3">
          <div
            className={`flex gap-2 rounded-md border p-2 text-xs ${
              prepared.report.status === 'blocked'
                ? 'border-red-200 bg-red-50 text-red-800'
                : prepared.report.status === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {prepared.report.status === 'blocked' ? (
              <XCircle className="mt-0.5 size-4 shrink-0" />
            ) : prepared.report.status === 'warning' ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {prepared.report.status === 'blocked'
                ? 'Basic preflight blocked this download.'
                : prepared.report.status === 'warning'
                  ? 'Prepared with printability warnings.'
                  : 'Basic surface checks passed.'}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Physical size</dt>
            <dd className="text-right font-medium">
              {prepared.report.bounds
                ? `${formatMillimeters(prepared.report.bounds.width)} × ${formatMillimeters(
                    prepared.report.bounds.depth,
                  )} × ${formatMillimeters(prepared.report.bounds.height)} mm`
                : '—'}
            </dd>
            <dt className="text-muted-foreground">Triangles</dt>
            <dd className="text-right font-medium">
              {prepared.report.triangleCount.toLocaleString()}
            </dd>
            <dt className="text-muted-foreground">Boundary edges</dt>
            <dd className="text-right font-medium">
              {prepared.report.boundaryEdgeCount?.toLocaleString() ?? 'Not checked'}
            </dd>
            <dt className="text-muted-foreground">Non-manifold edges</dt>
            <dd className="text-right font-medium">
              {prepared.report.nonManifoldEdgeCount?.toLocaleString() ?? 'Not checked'}
            </dd>
          </dl>

          <ul className="space-y-1 text-muted-foreground text-xs">
            {prepared.report.diagnostics.map((diagnostic) => (
              <li key={diagnostic.code}>· {diagnostic.message}</li>
            ))}
          </ul>

          <Button
            className="w-full justify-start gap-2"
            disabled={prepared.report.status === 'blocked'}
            onClick={() => downloadArtifact(prepared.artifact)}
          >
            <Download className="size-4" />
            Download print STL
          </Button>
        </div>
      )}
    </div>
  )
}
