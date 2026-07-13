/**
 * Cabinet-specific quick-action glyphs, lazy-loaded into the editor's
 * floating action menus via `IconRef` (`kind: 'component'`) on each quick
 * action — the menus render whatever mark the kind ships instead of
 * hardcoding cabinet SVG. Stroke-based marks, so they can't collapse into
 * the fill-only `svg`-kind IconRef.
 */

function CabinetGlyph({ kind }: { kind: 'base' | 'tall' | 'wall' }) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {kind === 'base' ? (
        <>
          <rect x="5" y="8" width="14" height="10" rx="1.75" />
          <path d="M12 8v10" />
        </>
      ) : null}
      {kind === 'tall' ? (
        <>
          <rect x="7" y="4" width="10" height="16" rx="1.75" />
          <path d="M12 4v16" />
        </>
      ) : null}
      {kind === 'wall' ? (
        <>
          <rect x="5" y="5" width="14" height="9" rx="1.75" />
          <path d="M12 5v9" />
          <path d="M3.5 18.5h17" />
        </>
      ) : null}
    </svg>
  )
}

function CornerTurnGlyph({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {direction === 'left' ? (
        <>
          <path d="M18.5 6.5H10a4 4 0 0 0-4 4V18" />
          <path d="m4.5 14.5-.5 4 4-.5" />
          <path d="M8.5 18H18" />
        </>
      ) : (
        <>
          <path d="M5.5 6.5H14a4 4 0 0 1 4 4V18" />
          <path d="m19.5 14.5.5 4-4-.5" />
          <path d="M6 18h9.5" />
        </>
      )}
    </svg>
  )
}

export function CabinetBaseGlyph() {
  return <CabinetGlyph kind="base" />
}

export function CabinetTallGlyph() {
  return <CabinetGlyph kind="tall" />
}

export function CabinetWallGlyph() {
  return <CabinetGlyph kind="wall" />
}

export function CornerTurnLeftGlyph() {
  return <CornerTurnGlyph direction="left" />
}

export function CornerTurnRightGlyph() {
  return <CornerTurnGlyph direction="right" />
}
