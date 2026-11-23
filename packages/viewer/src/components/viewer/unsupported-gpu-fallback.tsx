export function UnsupportedGpuViewerFallback() {
  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 256,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
        padding: 24,
        textAlign: 'center',
        color: '#171717',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 448,
          boxSizing: 'border-box',
          borderRadius: 16,
          border: '1px solid #e5e5e5',
          background: 'white',
          padding: 24,
          boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        }}
      >
        <h2 style={{ margin: 0, fontWeight: 600, fontSize: 18, lineHeight: '28px' }}>
          3D viewer unavailable
        </h2>
        <p style={{ margin: '8px 0 0', color: '#525252', fontSize: 14, lineHeight: '20px' }}>
          This browser or environment could not initialize WebGPU or WebGL, so Pascal cannot render
          the 3D scene here. Try opening the editor in a browser with hardware acceleration enabled.
        </p>
      </div>
    </div>
  )
}
