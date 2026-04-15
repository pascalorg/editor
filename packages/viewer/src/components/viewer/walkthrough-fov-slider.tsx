'use client'

import useViewer from '../../store/use-viewer'

/**
 * Standalone DOM overlay slider that controls the walkthrough FOV via
 * `useViewer.walkthroughFov`. Renders nothing when `walkthroughMode` is
 * off so consumers can mount it unconditionally alongside their
 * walkthrough UI. Styled with plain inline CSS + a class name so it
 * works in any host app without needing Tailwind, shadcn, or the
 * editor's design tokens — important because this lives in the viewer
 * package and has to stay editor-agnostic.
 *
 * Range is 50–110° with 1° steps. Below 50° first-person feels like a
 * sniper scope; above 110° the near-wall fisheye distortion becomes
 * intolerable. Both bounds are also enforced by `setWalkthroughFov`.
 *
 * Default position is bottom-right. Override via the `className` prop
 * if the host wants to place it elsewhere — the slider adapts to its
 * container since there's no fixed positioning baked in.
 */
export function WalkthroughFovSlider({ className }: { className?: string }) {
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const walkthroughFov = useViewer((s) => s.walkthroughFov)
  const setWalkthroughFov = useViewer((s) => s.setWalkthroughFov)

  if (!walkthroughMode) return null

  return (
    <div
      className={className}
      style={
        className
          ? undefined
          : {
              position: 'fixed',
              bottom: '1.5rem',
              right: '1.5rem',
              zIndex: 50,
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              padding: '0.625rem 0.875rem',
              borderRadius: '0.75rem',
              background: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(12px)',
              color: 'white',
              fontSize: '0.75rem',
              fontFamily: 'system-ui, sans-serif',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
              pointerEvents: 'auto',
            }
      }
    >
      <span style={{ opacity: 0.7, fontWeight: 500 }}>FOV</span>
      <input
        type="range"
        min={50}
        max={110}
        step={1}
        value={walkthroughFov}
        onChange={(e) => setWalkthroughFov(Number(e.target.value))}
        style={{ width: '8rem', accentColor: '#8b5cf6' }}
      />
      <span
        style={{
          minWidth: '2.5rem',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
        }}
      >
        {walkthroughFov}°
      </span>
    </div>
  )
}
