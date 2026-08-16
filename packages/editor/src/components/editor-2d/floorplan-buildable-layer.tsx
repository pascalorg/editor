import { memo } from 'react'
import useSetbackEdgeFocus from '../../store/use-setback-edge-focus'

type Point2D = { x: number; y: number }

const BUILDABLE_STROKE = '#22d3ee'
const SETBACK_TINT = '#f59e0b'

function ringPath(ring: readonly Point2D[]): string {
  if (ring.length < 3) return ''
  const [first, ...rest] = ring
  return `M ${first!.x} ${first!.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(' ')} Z`
}

/**
 * The setback strip and the buildable boundary, in the floorplan.
 *
 * The 3D renderer draws the same two things from the same `readSiteBuildable`
 * call, and both derive from the site node alone — so this is a second drawing
 * of one truth rather than a second copy of it, which is what keeps split view
 * consistent without either pane reading the other.
 *
 * The rings arrive already in floorplan-local metres. Offsetting there rather
 * than in world space is safe because the transform between them is a rotation
 * and a translation, which preserve every distance a setback is measured in.
 *
 * Nothing here is gated on `InteractionScope`: drafting tools never open one,
 * so an `isActive` gate would hide the boundary during exactly the gesture it
 * exists to guide.
 */
/**
 * The drawing itself, with the focused edge handed in.
 *
 * Split from the store subscription below so the markup can be rendered and
 * asserted on without a browser — which edge index highlights which segment is
 * exactly the sort of off-by-one that only shows up on screen otherwise.
 */
export const BuildableAreaGeometry = memo(function BuildableAreaGeometry({
  buildableRings,
  dimmed,
  focusedEdge,
  onSelectEdge,
  onHoverEdge,
  sitePolygon,
  unitsPerPixel,
}: {
  buildableRings: readonly Point2D[][] | null
  dimmed: boolean
  focusedEdge: number | null
  onSelectEdge: (edgeIndex: number | null) => void
  onHoverEdge: (edgeIndex: number | null) => void
  sitePolygon: readonly Point2D[] | null
  unitsPerPixel: number
}) {
  const setHoveredEdge = onHoverEdge
  const setSelectedEdge = onSelectEdge

  if (!(sitePolygon && buildableRings && sitePolygon.length >= 3)) return null

  const hatchSpacing = Math.max(unitsPerPixel * 7, 0.08)
  // Even-odd: the parcel with the buildable rings punched out of it is exactly
  // the ground the setbacks put off limits, and one path expresses it whether
  // the setbacks leave one piece, several, or none at all.
  const stripPath = `${ringPath(sitePolygon)} ${buildableRings.map(ringPath).join(' ')}`

  return (
    <g data-site-buildable opacity={dimmed ? 0.25 : undefined}>
      <defs>
        <pattern
          height={hatchSpacing}
          id="site-setback-hatch"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
          width={hatchSpacing}
        >
          <line
            stroke={SETBACK_TINT}
            strokeOpacity={0.5}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            x1={0}
            x2={0}
            y1={0}
            y2={hatchSpacing}
          />
        </pattern>
      </defs>

      <path
        d={stripPath}
        fill="url(#site-setback-hatch)"
        fillRule="evenodd"
        pointerEvents="none"
        stroke="none"
      />

      {buildableRings.map((ring) => (
        <path
          d={ringPath(ring)}
          fill="none"
          key={`${ring[0]?.x ?? 0}:${ring[0]?.y ?? 0}:${ring.length}`}
          pointerEvents="none"
          stroke={BUILDABLE_STROKE}
          strokeDasharray="6 4"
          strokeLinejoin="round"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* Per-edge pickers, under the boundary handles in DOM order so a site
          drag still wins the pointer when those are mounted. */}
      {sitePolygon.map((point, edgeIndex) => {
        const next = sitePolygon[(edgeIndex + 1) % sitePolygon.length]!
        const isFocused = focusedEdge === edgeIndex
        return (
          <g key={`setback-edge-${edgeIndex}-${point.x}:${point.y}`}>
            <line
              onPointerDown={() => setSelectedEdge(focusedEdge === edgeIndex ? null : edgeIndex)}
              onPointerEnter={() => setHoveredEdge(edgeIndex)}
              onPointerLeave={() => setHoveredEdge(null)}
              pointerEvents="stroke"
              stroke="transparent"
              strokeWidth={unitsPerPixel * 10}
              x1={point.x}
              x2={next.x}
              y1={point.y}
              y2={next.y}
            />
            {isFocused && (
              <line
                pointerEvents="none"
                stroke={BUILDABLE_STROKE}
                strokeLinecap="round"
                strokeWidth={3.4}
                vectorEffect="non-scaling-stroke"
                x1={point.x}
                x2={next.x}
                y1={point.y}
                y2={next.y}
              />
            )}
          </g>
        )
      })}
    </g>
  )
})

/**
 * Subscribes to the focus store the panel and the 3D renderer also write.
 *
 * The subscription lives out here, in a leaf, rather than in `FloorplanPanel`:
 * the panel is a ~10k-line component whose render costs over a hundred
 * milliseconds, so a hover that re-rendered it would be felt.
 */
export function FloorplanBuildableLayer(props: {
  buildableRings: readonly Point2D[][] | null
  dimmed: boolean
  sitePolygon: readonly Point2D[] | null
  unitsPerPixel: number
}) {
  const hoveredEdge = useSetbackEdgeFocus((state) => state.hoveredEdge)
  const selectedEdge = useSetbackEdgeFocus((state) => state.selectedEdge)
  const setHoveredEdge = useSetbackEdgeFocus((state) => state.setHoveredEdge)
  const setSelectedEdge = useSetbackEdgeFocus((state) => state.setSelectedEdge)

  return (
    <BuildableAreaGeometry
      {...props}
      focusedEdge={hoveredEdge ?? selectedEdge}
      onHoverEdge={setHoveredEdge}
      onSelectEdge={setSelectedEdge}
    />
  )
}
