'use client'

import useViewer from '@pascal-app/viewer/store/use-viewer'

/**
 * A pure-SVG north-arrow compass widget.
 * The `bearingDeg` prop is the angle (clockwise degrees from screen-up) that
 * the north arrow should point — 0 means north faces straight up, 90 means
 * north faces right, etc.
 */
function CompassSVG({ bearingDeg }: { bearingDeg: number }) {
  return (
    <div
      aria-label={`North arrow, ${Math.round(bearingDeg)}° clockwise from screen top`}
      className="pointer-events-none select-none"
      role="img"
      style={{ width: 44, height: 44 }}
    >
      <svg
        fill="none"
        height="44"
        viewBox="0 0 44 44"
        width="44"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer ring */}
        <circle cx="22" cy="22" r="20" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />

        {/* Rotating group — north arrow */}
        <g
          style={{
            transformOrigin: '22px 22px',
            transform: `rotate(${bearingDeg}deg)`,
          }}
        >
          {/* North half of needle — red */}
          <path d="M22 6 L25.5 22 L22 20 L18.5 22 Z" fill="#ef4444" opacity="0.95" />
          {/* South half of needle — muted */}
          <path d="M22 38 L18.5 22 L22 24 L25.5 22 Z" fill="currentColor" opacity="0.30" />
          {/* Centre dot */}
          <circle cx="22" cy="22" fill="currentColor" opacity="0.5" r="1.5" />
        </g>

        {/* "N" label — always screen-up, outside the rotating group */}
        <text
          dominantBaseline="middle"
          fill="currentColor"
          fontSize="7"
          fontWeight="600"
          opacity="0.55"
          textAnchor="middle"
          x="22"
          y="5"
        >
          N
        </text>
      </svg>
    </div>
  )
}

/**
 * DOM overlay — renders the compass in the bottom-right of the nearest
 * `relative` positioned ancestor. Must be placed inside the viewport wrapper,
 * not inside the toolbar strip.
 * Reads the bearing from useViewer, written each frame by NorthCompassR3F
 * (which lives inside the Canvas in packages/viewer).
 */
export function NorthCompassWidget() {
  const bearingDeg = useViewer((s) => s.northBearingDeg)
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 text-foreground/70">
      <CompassSVG bearingDeg={bearingDeg} />
    </div>
  )
}
