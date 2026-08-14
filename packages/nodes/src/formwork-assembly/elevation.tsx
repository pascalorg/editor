'use client'

import type { AnyNodeId } from '@pascal-app/core'
import {
  elevationCaveats,
  type ShutterElevation,
  type Verification,
  weakestVerification,
} from '@pascal-app/core/formwork'
import { ActionButton, downloadText } from '@pascal-app/editor'
import { Download } from 'lucide-react'
import { useState } from 'react'
import {
  ELEVATION_COLORS,
  type ElevationPage,
  type ElevationShape,
  elevationShapes,
  elevationSvg,
  pieceColors,
} from './elevation-drawing'
import { FACE_ROLE_LABELS } from './face-labels'
import { useHostShutters } from './parts-summary'
import { Note, Section } from './report-ui'
import { shutterLabel } from './solve'

/**
 * The shutter elevation on screen, and the drawing that gets issued.
 *
 * The layout is `elevation-drawing.ts` and only the layout is: this draws the same shapes the
 * downloaded SVG does, so the sidebar and the sheet on the hoarding cannot disagree about which
 * course a tie is in. What a screen has that the paper does not is one face at a time — a
 * sidebar 26 rem wide showing both skins of three lifts is six drawings nobody can read — and a
 * legend, because on paper a reader has the caveats under the drawing and on screen they have a
 * colour they have to guess at.
 */

/** One entry in the face selector: which pour, which skin. */
export interface ElevationChoice {
  /** "Pour 1, lift 2" — the pour named as the parts table names it. */
  title: string
  elevation: ShutterElevation
  faceIndex: number
}

function shapeElement(shape: ElevationShape, key: string) {
  const c = ELEVATION_COLORS
  if (shape.kind === 'piece') {
    const { fill, edge } = pieceColors(shape.piece)
    return (
      <rect
        fill={fill}
        height={shape.heightMm}
        key={key}
        stroke={edge}
        strokeWidth={6}
        width={shape.widthMm}
        x={shape.xMm}
        y={shape.yMm}
      />
    )
  }
  if (shape.kind === 'opening') {
    return (
      <rect
        fill={c.opening}
        height={shape.heightMm}
        key={key}
        stroke={c.openingEdge}
        strokeDasharray="40 24"
        strokeWidth={5}
        width={shape.widthMm}
        x={shape.xMm}
        y={shape.yMm}
      />
    )
  }
  if (shape.kind === 'tie') {
    // A cross rather than a circle where the grid offered a station this wall cannot use: the
    // reader is holding the engineer's drawing, which has a rod here.
    return shape.dropped ? (
      <g key={key} stroke={c.tieDropped} strokeWidth={7}>
        <line x1={shape.xMm - 26} x2={shape.xMm + 26} y1={shape.yMm - 26} y2={shape.yMm + 26} />
        <line x1={shape.xMm - 26} x2={shape.xMm + 26} y1={shape.yMm + 26} y2={shape.yMm - 26} />
      </g>
    ) : (
      <circle
        cx={shape.xMm}
        cy={shape.yMm}
        fill={c.ground}
        key={key}
        r={26}
        stroke={c.tie}
        strokeWidth={8}
      />
    )
  }
  if (shape.kind === 'course' || shape.kind === 'concrete') {
    const concrete = shape.kind === 'concrete'
    return (
      <line
        key={key}
        stroke={concrete ? c.concrete : c.course}
        strokeDasharray={concrete ? '60 30' : undefined}
        strokeWidth={concrete ? 7 : 5}
        x1={0}
        x2={shape.toXMm}
        y1={shape.yMm}
        y2={shape.yMm}
      />
    )
  }
  const fill = shape.role === 'mark' ? c.mark : shape.role === 'concrete' ? c.concrete : c.dim
  return (
    <text
      dominantBaseline="middle"
      fill={fill}
      fontFamily="monospace"
      fontSize={shape.role === 'mark' ? 70 : 46}
      key={key}
      textAnchor="middle"
      transform={shape.turned ? `rotate(-90 ${shape.xMm} ${shape.yMm})` : undefined}
      x={shape.xMm}
      y={shape.yMm}
    >
      {shape.text}
    </text>
  )
}

const FACE_PAD_MM = 120

/** One face, at its own size — the viewBox is millimetres, so the drawing is the wall. */
export function ElevationDrawing({
  elevation,
  faceIndex,
}: {
  elevation: ShutterElevation
  faceIndex: number
}) {
  const face = elevation.faces[faceIndex]
  if (!face) return null
  const heightMm = Math.max(elevation.formTopMm, elevation.concreteTopMm)
  return (
    <svg
      aria-label={`Shutter elevation, ${FACE_ROLE_LABELS[face.role]}`}
      className="w-full"
      role="img"
      viewBox={`${-FACE_PAD_MM} ${-FACE_PAD_MM} ${elevation.runMm + FACE_PAD_MM * 2} ${heightMm + FACE_PAD_MM * 2}`}
    >
      {elevationShapes(elevation, face).map((shape, index) =>
        shapeElement(shape, `${shape.kind}-${index}`),
      )}
    </svg>
  )
}

/** What each colour on the drawing is, since a screen has no caption under it. */
function Legend({ kinds }: { kinds: readonly ('panel' | 'filler' | 'cut' | 'corner')[] }) {
  const names = { panel: 'panel', filler: 'filler', cut: 'cut piece', corner: 'corner' } as const
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground/80">
      {kinds.map((kind) => (
        <span className="flex items-center gap-1" key={kind}>
          <span
            className="inline-block h-2 w-2.5 rounded-[1px]"
            style={{
              backgroundColor: pieceColors(kind).fill,
              outline: `1px solid ${pieceColors(kind).edge}`,
            }}
          />
          {names[kind]}
        </span>
      ))}
    </div>
  )
}

/**
 * The elevation as a drawing, one face at a time, with the file to issue.
 *
 * Nothing here is a new figure and nothing is a total: the pieces are already bill lines and
 * the ties are already counted, so a count on the drawing would be a second count somebody has
 * to reconcile. What it adds is the arrangement, which no table can carry.
 */
export function FormworkElevation({
  choiceIndex,
  choices,
  onChoiceChange,
  subject,
  verificationNote,
}: {
  choiceIndex: number
  choices: readonly ElevationChoice[]
  onChoiceChange: (index: number) => void
  subject: string
  /** The takeoff's weakest verification level, to state on the issued drawing (8.5). */
  verificationNote?: string
}) {
  if (choices.length === 0) return null
  // A pour deleted out from under the selector — a lift-height edit, a scope change — would
  // otherwise draw nothing and read as a wall that needs no shutter.
  const index = Math.min(choiceIndex, choices.length - 1)
  const choice = choices[index] as ElevationChoice
  const face = choice.elevation.faces[choice.faceIndex]
  const kinds = [...new Set((face?.pieces ?? []).map((piece) => piece.kind))].sort()
  const pages: ElevationPage[] = []
  for (const entry of choices) {
    if (!pages.some((page) => page.elevation === entry.elevation)) {
      pages.push({ title: entry.title, elevation: entry.elevation })
    }
  }

  return (
    <Section title="Shutter elevation">
      {choices.length > 1 && (
        <label className="flex items-center gap-2 text-[11px]" htmlFor="formwork-elevation-pick">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">Face</span>
          <select
            className="h-7 min-w-0 max-w-[70%] rounded-md border border-border/50 bg-[#232325] px-1.5 text-foreground outline-none"
            id="formwork-elevation-pick"
            onChange={(event) => onChoiceChange(Number(event.target.value))}
            value={index}
          >
            {choices.map((entry, at) => (
              <option key={`${entry.title}-${entry.faceIndex}`} value={at}>
                {entry.title} —{' '}
                {FACE_ROLE_LABELS[entry.elevation.faces[entry.faceIndex]?.role ?? 'side-a']}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="overflow-hidden rounded-md border border-border/40 bg-[#0c0c0d] p-1">
        <ElevationDrawing elevation={choice.elevation} faceIndex={choice.faceIndex} />
      </div>
      <div className="text-[10px] text-muted-foreground/80">
        {face?.pieces.length ?? 0} {(face?.pieces.length ?? 0) === 1 ? 'piece' : 'pieces'} ·{' '}
        {Math.round(choice.elevation.runMm)} × {Math.round(choice.elevation.formTopMm)} mm of
        shutter
        {choice.elevation.ties.length > 0 && ` · ${choice.elevation.ties.length} tie holes`}
        {choice.elevation.tiesDropped.length > 0 &&
          ` · ${choice.elevation.tiesDropped.length} blocked`}
      </div>
      {kinds.length > 0 && <Legend kinds={kinds} />}
      {/* The caveats as words rather than as a tooltip, because the frame the drawing is set
          out in is not visible on it: a lift starting at zero looks like the wall starting at
          zero, and a crew that reads it that way sets the second lift on the ground. */}
      <div className="space-y-1 text-[10px] text-muted-foreground/80 leading-snug">
        {elevationCaveats(choice.elevation).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <ActionButton
        icon={<Download className="h-3.5 w-3.5" />}
        label="Download elevation"
        onClick={() =>
          downloadText(
            elevationSvg(pages, subject, verificationNote),
            `shutter-elevation-${subject.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`,
            'image/svg+xml;charset=utf-8',
          )
        }
      />
      <Note>
        Every face of every pour on one sheet, both skins of a lift together — a tie passes through
        both, and a station on one skin and not the other is the error being looked for. The shutter
        face only: walers, rakers and scaffold are in the parts list, and a face carrying them is a
        face whose marks cannot be read.
      </Note>
    </Section>
  )
}

/**
 * Every drawn face of one element, off the solve the parts table reads.
 *
 * The same `useHostShutters` the bill uses, so the panel a mark is drawn on and the line that
 * orders it came out of one pass. Empty on a column or a slab, and that is the shape of the
 * thing: a column is clamped to a schedule and a deck is set out on a plan, and neither is an
 * elevation of a face.
 */
export function FormworkElevationSection({ hostId }: { hostId: AnyNodeId | undefined }) {
  const { shutters } = useHostShutters(hostId)
  const [choiceIndex, setChoiceIndex] = useState(0)

  const choices: ElevationChoice[] = []
  for (const shutter of shutters) {
    const elevation = shutter.elevation
    if (!elevation) continue
    elevation.faces.forEach((_face, faceIndex) => {
      choices.push({ title: shutterLabel(shutter.assembly), elevation, faceIndex })
    })
  }
  if (choices.length === 0) return null

  // The drawing's own fold, at the element scope the drawing is issued for: the weakest
  // level across the parts on this shutter, named on the face the way the takeoff names it
  // (8.5). A site-made part depends on no catalog entry and carries no level, so only the
  // bought parts count — which is the honest fold for figures drawn from the catalog.
  const levels = shutters
    .flatMap((shutter) => shutter.parts)
    .map((part) => part.verification)
    .filter((level) => level !== undefined)
  const weakest = weakestVerification(levels as Verification[])
  const verificationNote =
    weakest === undefined || weakest === 'certified'
      ? undefined
      : `These figures are drawn from catalog values that are ${weakest === 'derived' ? 'derived by a stated method from cited values' : weakest === 'secondary' ? "read off a dealer or secondary listing rather than the manufacturer's own table" : 'unverified — arrived at by stated reasoning with nothing published to check it against'}. The drawing carries that level until the cited document is transcribed.`

  return (
    <FormworkElevation
      choiceIndex={choiceIndex}
      choices={choices}
      onChoiceChange={setChoiceIndex}
      subject={`wall ${hostId ?? ''}`.trim()}
      verificationNote={verificationNote}
    />
  )
}
