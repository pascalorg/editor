import { ImageResponse } from 'next/og'

export const alt = 'lingo: Make forms easier, LLM tools safer.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Monochrome card matching the site's quiet, classical brand: wordmark,
// tagline, one canonical example. Self-contained (no font fetch).
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        backgroundColor: '#f7f7f5',
        color: '#111110',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div style={{ display: 'flex', fontSize: 36, letterSpacing: 4 }}>lingo</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', fontSize: 78, fontWeight: 700, lineHeight: 1.1 }}>
          Make forms easier,
        </div>
        <div style={{ display: 'flex', fontSize: 78, fontWeight: 700, lineHeight: 1.1 }}>
          LLM tools safer.
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 26,
          color: '#6b6b66',
        }}
      >
        <div style={{ display: 'flex' }}>{`5'11" -> 1.8034 m`}</div>
        <div style={{ display: 'flex' }}>MIT · zero deps</div>
      </div>
    </div>,
    { ...size },
  )
}
