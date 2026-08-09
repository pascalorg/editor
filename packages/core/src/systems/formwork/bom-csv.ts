import type { BomLine } from './parts'
import type { BomSupply, SupplyLine } from './supply'

/**
 * A bill of materials as a file somebody can open.
 *
 * The last step between a bill on a screen and a bill a yard acts on, and it is a
 * serialiser rather than engine work: `bomLines` already produced the rows, and
 * everything here is about not corrupting them on the way out.
 *
 * Two things this deliberately does *not* do. It does not re-derive a quantity, a
 * weight or a total — every figure is carried from the lines it was given, so a CSV
 * and the panel above it cannot disagree. And it does not silently fill an unknown
 * weight with 0: a line whose parts have no published weight leaves the cell empty
 * and the total row says so, because a spreadsheet that sums a fabricated zero
 * produces a lifting weight nobody can check and everybody trusts.
 */

/** What a bill covers, so the file says what it is a bill *of*. */
export interface BomCsvScope {
  /** How the takeoff was scoped, e.g. "Wall wall_1" or "Project". */
  subject: string
  /** Elements the takeoff covers, where it covers more than one. */
  elementCount?: number
  /** Shutters the takeoff covers — a pour count, not an element count. */
  shutterCount?: number
  /**
   * Anything that makes the figures below incomplete, verbatim. An element formed
   * for fewer pours than it is cast in bills short, and every line in the file still
   * looks correct on its own, so the warning travels *inside* the file rather than
   * only in the UI that produced it.
   */
  caveats?: readonly string[]
  /**
   * Where the parts come from, where the project has said what it owns.
   *
   * Absent leaves the three columns off the file entirely rather than emptying them.
   * A blank cell in a spreadsheet is read as nothing to hire, and a column of blanks
   * under "Hire" is the most confident wrong answer this file could give — so the
   * question is not asked in the header unless there is an answer to it.
   */
  supply?: BomSupply
}

/**
 * Escapes one cell.
 *
 * Quoted whenever the value contains a comma, a quote, a newline or leading and
 * trailing space, which is the RFC 4180 rule. Marks and catalog ids do not need it
 * and descriptions do — "Board, 2400 × 200 cut on site" is one cell and four
 * columns if this is skipped.
 */
function cell(value: string | number | undefined): string {
  if (value === undefined) return ''
  const text = String(value)
  if (text === '') return ''
  return /[",\n\r]/.test(text) || text.trim() !== text ? `"${text.replaceAll('"', '""')}"` : text
}

const HEADER = [
  'Mark count',
  'Kind',
  'Description',
  'Catalog id',
  'Condition',
  'Quantity',
  'Unit',
  'Weight kg',
  'Marks',
] as const

/**
 * Where the quantity comes from, following the quantity when the project has a rack.
 *
 * Three columns rather than one label because a line is normally split — 26 needed
 * against 20 owned is two numbers, and the row a yard acts on says both.
 */
const SUPPLY_HEADER = ['From own stock', 'To hire', 'Consumed'] as const

/**
 * Why a line's parts are what they are, in the yard's terms rather than the type's.
 *
 * `modified` is the one worth spelling out: a panel drilled for this pour is the
 * catalog item on the delivery note and no longer the catalog item in the yard, and
 * a bill that reads "standard" against it is how a drilled panel goes back on the
 * rack.
 */
const CONDITION_LABELS = {
  standard: 'stock, as supplied',
  modified: 'stock, altered for this pour',
  bespoke: 'made for this pour',
} as const

const round2 = (value: number): number => Math.round(value * 100) / 100

/**
 * The bill as CSV: a preamble naming the scope, the lines, and a total row.
 *
 * The marks travel in the last column, space-separated, because a quantity nobody
 * can trace back to a position on a drawing is a number to argue about on site. They
 * are last so a reader can ignore the column without scrolling past it.
 */
export function bomCsv(lines: readonly BomLine[], scope: BomCsvScope): string {
  const rows: string[] = []

  rows.push(['Formwork bill of materials', cell(scope.subject)].join(','))
  if (scope.elementCount !== undefined) {
    rows.push(['Elements', scope.elementCount].join(','))
  }
  if (scope.shutterCount !== undefined) {
    // Named as pours rather than shutters because it is the count of times a
    // shutter is erected and struck, which is what the number is useful for.
    rows.push(['Pours', scope.shutterCount].join(','))
  }
  for (const caveat of scope.caveats ?? []) {
    rows.push(['INCOMPLETE', cell(caveat)].join(','))
  }
  const supply = scope.supply
  if (supply && supply.hiredModifiedQuantity > 0) {
    // A cell rather than only the prose caveat, because this is the figure a quantity
    // surveyor prices and prose is not something a spreadsheet can multiply.
    rows.push(
      ['Hired parts altered here — recharged at list', supply.hiredModifiedQuantity].join(','),
    )
  }
  if (supply && supply.hiredWeightKg !== undefined) {
    // A hire is charged against what is held, so the tonnage on hire is a different
    // figure from the tonnage on site and it is the one a hire desk quotes from.
    rows.push(['On hire kg', round2(supply.hiredWeightKg)].join(','))
  }
  if (supply && supply.unusedOwnedIds.length > 0) {
    // Plant the project owns and this scope never asks for. Nothing in the lines below
    // can say so, because a line the bill does not contain has no row.
    rows.push(['Owned, not used here', cell(supply.unusedOwnedIds.join(' '))].join(','))
  }
  rows.push('')

  const bySupply = new Map<BomLine, SupplyLine>(
    (supply?.lines ?? []).map((entry) => [entry.line, entry]),
  )
  const supplyCells = (line: BomLine): Array<string | number> => {
    if (!supply) return []
    const entry = bySupply.get(line)
    return entry === undefined
      ? ['', '', '']
      : [entry.ownedQuantity, entry.hiredQuantity, entry.consumedQuantity]
  }

  rows.push(
    supply
      ? [...HEADER.slice(0, 6), ...SUPPLY_HEADER, ...HEADER.slice(6)].join(',')
      : HEADER.join(','),
  )
  let totalKg = 0
  let everyLineWeighed = lines.length > 0
  for (const line of lines) {
    if (line.totalWeightKg === undefined) everyLineWeighed = false
    else totalKg += line.totalWeightKg
    rows.push(
      [
        line.marks.length,
        cell(line.kind),
        cell(line.description),
        cell(line.catalogId),
        cell(CONDITION_LABELS[line.provenance]),
        line.quantity,
        ...supplyCells(line),
        cell(line.unit),
        line.totalWeightKg === undefined ? '' : round2(line.totalWeightKg),
        cell(line.marks.join(' ')),
      ].join(','),
    )
  }

  // Blank rather than zero where a weight is unknown, and the label says which it
  // is. A total that silently omits three unweighed lines is the number somebody
  // books a crane against.
  rows.push('')
  rows.push(
    [
      '',
      'TOTAL',
      cell(
        everyLineWeighed
          ? 'every line weighed'
          : 'incomplete — some parts have no published weight',
      ),
      '',
      '',
      lines.reduce((sum, line) => sum + line.quantity, 0),
      ...(supply ? [supply.ownedQuantity, supply.hiredQuantity, supply.consumedQuantity] : []),
      '',
      lines.length === 0 ? '' : round2(totalKg),
      '',
    ].join(','),
  )

  return `${rows.join('\n')}\n`
}

/**
 * A filename that says what it is without being opened.
 *
 * Sanitised because a subject carries a user-typed element name, and a slash in a
 * filename is a directory on one platform and an error on another.
 */
export function bomCsvFilename(subject: string, isoDate: string): string {
  const slug =
    subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'formwork'
  return `formwork-bom-${slug}-${isoDate}.csv`
}
