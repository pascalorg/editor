import { ImageResponse } from 'next/og'

export const alt = 'Archly — Collaborative 3D Building Design'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: '80px',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1530 50%, #2d1b4e 100%)',
        }}
      >
        {/* Brand mark */}
        <div
          style={{
            display: 'flex',
            color: 'white',
            fontSize: 48,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          Archly
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            color: 'white',
            fontSize: 96,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -2,
            marginTop: 40,
            maxWidth: 1040,
          }}
        >
          Collaborative 3D Building Design
        </div>

        {/* Subhead */}
        <div
          style={{
            display: 'flex',
            color: '#a1a1aa',
            fontSize: 32,
            marginTop: 24,
            maxWidth: 1000,
          }}
        >
          Where teams build in 3D. WebGPU performance. Real-time collaboration.
        </div>

        {/* Pill badges */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 24,
            marginTop: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              background: '#4f46e5',
              color: 'white',
              padding: '12px 24px',
              borderRadius: 999,
              fontSize: 20,
              fontWeight: 600,
            }}
          >
            WebGPU
          </div>
          <div
            style={{
              display: 'flex',
              background: '#7c3aed',
              color: 'white',
              padding: '12px 24px',
              borderRadius: 999,
              fontSize: 20,
              fontWeight: 600,
            }}
          >
            Real-time
          </div>
          <div
            style={{
              display: 'flex',
              background: '#a78bfa',
              color: 'white',
              padding: '12px 24px',
              borderRadius: 999,
              fontSize: 20,
              fontWeight: 600,
            }}
          >
            Open
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
