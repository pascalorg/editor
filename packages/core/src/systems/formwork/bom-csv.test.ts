import { describe, expect, test } from 'bun:test'
import { type BomLine, bomCsv, bomCsvFilename } from './index'

/**
 * The bill as a file.
 *
 * Every failure here is silent in the worst possible place: a spreadsheet opens
 * without complaint and the numbers in it are wrong. A description containing a comma
 * splits into extra columns and shifts every figure right of it; an unknown weight
 * written as 0 sums into a total somebody books a crane against; a caveat left in the
 * UI that produced the file does not travel with the file, and the file is what gets
 * emailed to the yard.
 */

function line(overrides: Partial<BomLine> = {}): BomLine {
  return {
    kind: 'panel',
    catalogId: 'framax-2700-900',
    description: 'Framax Xlife 2700 × 900',
    provenance: 'standard',
    quantity: 4,
    unit: 'no',
    totalWeightKg: 268.4,
    marks: ['P-A-1-00000', 'P-A-1-00900', 'P-B-1-00000', 'P-B-1-00900'],
    ...overrides,
  }
}

const rows = (csv: string): string[] => csv.trimEnd().split('\n')
const dataRows = (csv: string): string[] => {
  const all = rows(csv)
  const header = all.findIndex((row) => row.startsWith('Mark count,'))
  return all.slice(header + 1).filter((row) => row !== '' && !row.includes('TOTAL'))
}

describe('bomCsv', () => {
  test('names what the bill is a bill of', async () => {
    const csv = bomCsv([line()], { subject: 'Wall wall_1' })

    expect(rows(csv)[0]).toBe('Formwork bill of materials,Wall wall_1')
  })

  test('one row per line, with the quantity and the unit', () => {
    const csv = bomCsv([line(), line({ kind: 'tie', description: 'Tie rod', quantity: 12 })], {
      subject: 'Project',
    })

    const data = dataRows(csv)
    expect(data).toHaveLength(2)
    expect(data[0]).toContain('4,no')
    expect(data[1]).toContain('12,no')
  })

  test('a description containing a comma stays one cell', () => {
    // Unquoted, this shifts the quantity into the unit column and the weight into
    // the quantity column, and the file still opens.
    const csv = bomCsv([line({ description: 'Board, 2400 × 200, cut on site' })], {
      subject: 'Project',
    })

    const data = dataRows(csv)[0] as string
    expect(data).toContain('"Board, 2400 × 200, cut on site"')
    // Nine columns is the contract; a leaked comma makes eleven.
    expect(data.split(',').length).toBeGreaterThan(9)
    expect(data).toContain(',4,no,')
  })

  test('a quote inside a description is doubled, not left to terminate the cell', () => {
    const csv = bomCsv([line({ description: '18" ply' })], { subject: 'Project' })

    expect(dataRows(csv)[0]).toContain('"18"" ply"')
  })

  test('carries the marks so a quantity can be traced to a drawing', () => {
    // A quantity nobody can trace back to a position is a number to argue about on
    // site rather than one to check.
    const csv = bomCsv([line()], { subject: 'Project' })

    expect(dataRows(csv)[0]).toContain('P-A-1-00000 P-A-1-00900 P-B-1-00000 P-B-1-00900')
  })

  test('an unknown weight is blank, never zero', () => {
    // The whole reason `bomLines` withholds a partial total. A 0 here sums silently
    // into the grand total and the total is what a lift is planned against.
    const csv = bomCsv([line({ totalWeightKg: undefined })], { subject: 'Project' })

    const cells = (dataRows(csv)[0] as string).split(',')
    expect(cells.at(-2)).toBe('')
  })

  test('the total row says when it is incomplete', () => {
    const csv = bomCsv([line(), line({ kind: 'tie', totalWeightKg: undefined })], {
      subject: 'Project',
    })

    const total = rows(csv).find((row) => row.includes('TOTAL')) as string
    expect(total).toContain('incomplete')
  })

  test('the total row says when every line was weighed', () => {
    const csv = bomCsv([line()], { subject: 'Project' })

    const total = rows(csv).find((row) => row.includes('TOTAL')) as string
    expect(total).toContain('every line weighed')
    expect(total).toContain('268.4')
  })

  test('the total is the sum of the lines, not a re-derivation', () => {
    const csv = bomCsv(
      [line({ totalWeightKg: 100 }), line({ kind: 'tie', totalWeightKg: 50.005 })],
      {
        subject: 'Project',
      },
    )

    const total = rows(csv).find((row) => row.includes('TOTAL')) as string
    expect(total).toContain('150.01')
  })

  test('a caveat travels inside the file', () => {
    // The one thing a CSV cannot afford to leave behind in the UI. Every line in a
    // short bill is individually correct, so nothing in the rows reveals it.
    const csv = bomCsv([line()], {
      subject: 'Project',
      caveats: [
        'wall_1 is cast in 3 pours and formed for 1 — this bill is short by the difference.',
        'A caveat with a comma, which has to stay in one cell.',
      ],
    })

    expect(rows(csv)).toContain(
      'INCOMPLETE,wall_1 is cast in 3 pours and formed for 1 — this bill is short by the difference.',
    )
    expect(rows(csv)).toContain(
      'INCOMPLETE,"A caveat with a comma, which has to stay in one cell."',
    )
  })

  test("reports the condition in the yard's terms, so a drilled panel is not filed as stock", () => {
    const csv = bomCsv([line({ provenance: 'modified' })], { subject: 'Project' })

    expect(dataRows(csv)[0]).toContain('altered for this pour')
  })

  test('an empty bill is a file that says so rather than a file with a zero total', () => {
    const csv = bomCsv([], { subject: 'Project' })

    expect(dataRows(csv)).toEqual([])
    const total = rows(csv).find((row) => row.includes('TOTAL')) as string
    expect(total).toContain('incomplete')
  })

  test('the scope counts appear when given', () => {
    const csv = bomCsv([line()], { subject: 'Level 1', elementCount: 12, shutterCount: 20 })

    expect(rows(csv)).toContain('Elements,12')
    expect(rows(csv)).toContain('Pours,20')
  })
})

describe('bomCsvFilename', () => {
  test('slugs the subject so a typed element name cannot become a path', () => {
    expect(bomCsvFilename('Wall / Level 1', '2026-08-08')).toBe(
      'formwork-bom-wall-level-1-2026-08-08.csv',
    )
  })

  test('a subject with nothing usable in it still yields a filename', () => {
    expect(bomCsvFilename('///', '2026-08-08')).toBe('formwork-bom-formwork-2026-08-08.csv')
  })
})
