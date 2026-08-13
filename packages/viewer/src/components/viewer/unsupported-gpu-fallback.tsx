export function UnsupportedGpuViewerFallback() {
  return (
    <div className="flex h-full min-h-64 w-full items-center justify-center bg-background p-6 text-center text-foreground">
      <div className="max-w-md rounded-2xl border border-border bg-background p-6 shadow-sm">
        <h2 className="font-semibold text-lg">3D viewer unavailable</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          This browser or environment could not initialize WebGPU or WebGL, so Pascal cannot render
          the 3D scene here. Try opening the editor in a browser with hardware acceleration enabled.
        </p>
      </div>
    </div>
  )
}
