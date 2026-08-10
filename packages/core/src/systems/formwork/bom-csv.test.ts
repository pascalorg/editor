import { describe, expect, test } from 'bun:test'
import {
  type BomLine,
  bomCost,
  bomCsv,
  bomCsvFilename,
  bomHire,
  bomSupply,
  type FormworkSetCount,
  formworkAcquisition,
  formworkResequence,
  formworkSchedule,
  formworkSequence,
  formworkSetCount,
  type RateTable,
  type StrikeTarget,
  strikingTime,
} from './index'

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

const period = (target: StrikeTarget) => strikingTime('BS_8110', { target, temperatureC: 16 })

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

  describe('the owned/hired split', () => {
    test('is left out of the header entirely where the project has no rack', () => {
      // Not emptied — omitted. A column headed "To hire" full of blank cells is read as
      // nothing to hire, which is the most confident wrong answer this file could give.
      const csv = bomCsv([line()], { subject: 'Project' })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header).not.toContain('To hire')
      expect(header.split(',')).toHaveLength(9)
    })

    test('splits the quantity across three columns after it', () => {
      const lines = [line({ quantity: 26 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        supply: bomSupply(lines, { 'framax-2700-900': 20 }),
      })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header.split(',').slice(5, 9)).toEqual([
        'Quantity',
        'From own stock',
        'To hire',
        'Consumed',
      ])
      expect(dataRows(csv)[0]).toContain(',26,20,6,0,no,')
    })

    test('the total row splits too, in the same columns', () => {
      // The row a spreadsheet sums. Out of step with the header by one column, every
      // figure below the fold is attributed to the wrong question.
      const lines = [line({ quantity: 26 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        supply: bomSupply(lines, { 'framax-2700-900': 20 }),
      })

      const total = rows(csv).find((row) => row.includes('TOTAL')) as string
      expect(total.split(',').slice(5, 9)).toEqual(['26', '20', '6', '0'])
    })

    test('prices the hire against the weight held, not the weight on site', () => {
      const lines = [line({ quantity: 4, totalWeightKg: 268.4 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        supply: bomSupply(lines, { 'framax-2700-900': 2 }),
      })

      expect(rows(csv)).toContain('On hire kg,134.2')
      // And the line's own weight column is still the whole line — the two figures
      // answer different questions and one must not overwrite the other.
      expect(dataRows(csv)[0]).toContain('268.4')
    })

    test('withholds the hire weight where a hired line has no published weight', () => {
      const lines = [line({ totalWeightKg: undefined })]
      const csv = bomCsv(lines, { subject: 'Project', supply: bomSupply(lines, {}) })

      expect(rows(csv).some((row) => row.startsWith('On hire kg'))).toBe(false)
    })

    test('calls out hired parts this pour alters, as a number and not only as prose', () => {
      // What a quantity surveyor prices. A hire charge and a recharge at list for a
      // drilled panel are the same cell to every other figure in the file.
      const lines = [line({ provenance: 'modified', quantity: 4 })]
      const csv = bomCsv(lines, { subject: 'Project', supply: bomSupply(lines, {}) })

      expect(rows(csv)).toContain('Hired parts altered here — recharged at list,4')
    })

    test('names owned stock this scope never draws on', () => {
      // Plant the project is holding and this bill never asks for. No row below can say
      // so, because a line the bill does not contain has no row.
      const lines = [line()]
      const csv = bomCsv(lines, {
        subject: 'Level 1',
        supply: bomSupply(lines, { 'framax-2700-900': 4, 'prop-eurex-20': 300 }),
      })

      expect(rows(csv)).toContain('Owned, not used here,prop-eurex-20')
    })
  })

  describe('how long the line is held', () => {
    test('is left out of the header entirely where the caller solved no periods', () => {
      // An element-scope export has no project settings to read, and two blank columns
      // headed "Days held" read as plant nobody keeps.
      const csv = bomCsv([line()], { subject: 'Project' })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header).not.toContain('Days held')
      expect(header.split(',')).toHaveLength(9)
    })

    test('follows the quantity, in days and with what it is struck as', () => {
      const lines = [line({ quantity: 26 })]
      const hire = bomHire(lines, () => ['slab-props'], 'BS_8110', { temperatureC: 16 })
      const csv = bomCsv(lines, { subject: 'Project', hire })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header.split(',').slice(5, 8)).toEqual(['Quantity', 'Days held', 'Struck as'])
      // 250/(16 + 10) = 9.62 d, and the cell says which row of the table that is.
      expect(dataRows(csv)[0]).toContain(',26,9.62,Props to a slab,no,')
    })

    test('names the standard before any period, so 10 days is not read as the wrong clock', () => {
      // ACI counts only hours above 10 °C. A programme written off the wrong clock
      // strikes early in a cold spring, and nothing in the numbers themselves says so.
      const lines = [line()]
      const csv = bomCsv(lines, {
        subject: 'Project',
        hire: bomHire(lines, () => ['slab-props'], 'ACI_347', {}),
      })

      expect(rows(csv).some((row) => row.startsWith('Striking standard,'))).toBe(true)
      expect(rows(csv).some((row) => row.includes('cumulative time above 10 °C'))).toBe(true)
    })

    test('lists each distinct period with the clause that governs it', () => {
      const lines = [line({ quantity: 26 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        hire: bomHire(lines, () => ['slab-props', 'vertical-form'], 'BS_8110', {
          temperatureC: 16,
        }),
      })

      // `includes` rather than `startsWith`, because the vertical row's own label
      // contains a comma and is therefore a quoted cell.
      const periods = rows(csv).filter((row) => row.includes('Period —'))
      expect(periods).toHaveLength(2)
      expect(periods.some((row) => row.includes('250/(t + 10)'))).toBe(true)
      expect(periods.some((row) => row.includes('300/(t + 10)'))).toBe(true)
    })

    test('an assumed input is an ASSUMED row, not an INCOMPLETE one', () => {
      // The tables print their own conservative column, so an unstated temperature is
      // still an answer. It is a different claim from one the job made, and this row is
      // the only thing that says which.
      const lines = [line()]
      const csv = bomCsv(lines, {
        subject: 'Project',
        hire: bomHire(lines, () => ['slab-props'], 'BS_8110', {}),
      })

      expect(rows(csv).some((row) => row.startsWith('ASSUMED,'))).toBe(true)
      expect(rows(csv).some((row) => row.startsWith('INCOMPLETE,'))).toBe(false)
    })

    test('a part nothing strikes says so rather than reading zero days', () => {
      // A tie is cut off inside the wall and a drum of release agent is gone. A 0 prices
      // spent material as plant returned the same day, and a spreadsheet multiplies it.
      const lines = [line({ kind: 'tie', description: 'Tie rod', quantity: 40 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        hire: bomHire(lines, () => [], 'BS_8110', {}),
      })

      expect(dataRows(csv)[0]).toContain(',40,,not struck,no,')
    })

    test('a line spanning two periods shows the longest and says it is mixed', () => {
      // The case the module is built around: the same catalog id props a slab and rakes
      // a wall, and `bomLines` groups them because a delivery note does.
      const lines = [line({ quantity: 26 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        hire: bomHire(
          lines,
          (mark) => (mark === 'P-A-1-00000' ? ['slab-props'] : ['vertical-form']),
          'BS_8110',
          { temperatureC: 16 },
        ),
      })

      expect(dataRows(csv)[0]).toContain('Props to a slab (mixed — longest shown)')
    })

    test('the total row is the longest period, never a sum of the column', () => {
      // The arithmetic a spreadsheet does to any column of days. Summed, this bill's
      // plant is on hire for longer than the job runs.
      const lines = [line({ quantity: 26 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        hire: bomHire(lines, () => ['slab-props', 'vertical-form'], 'BS_8110', {
          temperatureC: 16,
        }),
      })

      const total = rows(csv).find((row) => row.includes('TOTAL')) as string
      expect(total).toContain(',26,9.62,"longest, not a total",')
    })

    test('sits between the supply split and the unit, in the header and the rows alike', () => {
      // Out of step by one column, every figure below the fold answers the wrong
      // question — and the file still opens.
      const lines = [line({ quantity: 26 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        supply: bomSupply(lines, { 'framax-2700-900': 20 }),
        hire: bomHire(lines, () => ['slab-props'], 'BS_8110', { temperatureC: 16 }),
      })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header.split(',').slice(5, 12)).toEqual([
        'Quantity',
        'From own stock',
        'To hire',
        'Consumed',
        'Days held',
        'Struck as',
        'Unit',
      ])
      expect(dataRows(csv)[0]).toContain(',26,20,6,0,9.62,Props to a slab,no,')
    })
  })

  describe('what it costs to hold', () => {
    const RATES = {
      currency: 'GBP',
      byCatalogId: { 'framax-2700-900': { purchasePerUnit: 200, rentalPercentPerMonth: 3 } },
    }
    const priced = (lines: readonly BomLine[], over: Partial<typeof RATES> = {}) => {
      const supply = bomSupply(lines, {})
      const hire = bomHire(lines, () => ['slab-props'], 'BS_8110', { temperatureC: 16 })
      return bomCost(lines, { ...RATES, ...over }, hire, supply)
    }

    test('is left out of the header entirely where the project has recorded no rates', () => {
      // Stronger than the supply columns' reason. A blank cell under "Hire cost GBP"
      // reads as free, and a spreadsheet sums a column of blanks into a tender figure.
      const csv = bomCsv([line()], { subject: 'Project' })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header).not.toContain('Hire cost')
      expect(header.split(',')).toHaveLength(9)
    })

    test('names the currency in the money headers, so no figure is a bare number', () => {
      const lines = [line({ quantity: 4 })]
      const csv = bomCsv(lines, { subject: 'Project', cost: priced(lines) })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header).toContain('Hire cost GBP')
      expect(header).toContain('Line cost GBP')
    })

    test('says what the money is before it shows any of it', () => {
      // The row a reader has to see first. Taken for the cost of forming the job this
      // is wrong by more than every gap in the rate table put together, because labour
      // is normally the largest cost and there is none of it here.
      const lines = [line({ quantity: 4 })]
      const csv = bomCsv(lines, { subject: 'Project', cost: priced(lines) })

      const basis = rows(csv).find((row) => row.startsWith('Cost basis,')) as string
      expect(basis).toContain('No labour, transport or finance')
    })

    test('prices the line and totals the three costs in the same columns', () => {
      // 4 panels at £200 and 3 %/month is £6/month, held 250/(16+10) = 9.62 d, so
      // 4 × 6 × 9.62/30 = £7.69.
      const lines = [line({ quantity: 4 })]
      const csv = bomCsv(lines, { subject: 'Project', cost: priced(lines) })

      // The own-stock cell is empty: no rack recorded, so nothing on this line is owned.
      expect(dataRows(csv)[0]).toContain(',4,9.62,7.69,,,7.69,,,no,')
      const total = rows(csv).find((row) => row.startsWith(',TOTAL,')) as string
      expect(total).toContain(',7.69,0,0,7.69,0,')
    })

    test('marks the charged period as the minimum where the minimum bit', () => {
      // The figure a reader checks an invoice against, and it is not the days held: a
      // set struck in 9.62 days against a 28-day minimum is charged for 28.
      const lines = [line({ quantity: 4 })]
      const csv = bomCsv(lines, { subject: 'Project', cost: priced(lines, { minHireDays: 28 }) })

      expect(dataRows(csv)[0]).toContain('28 (minimum)')
      expect(rows(csv)).toContain('Lines charged at the minimum hire period,1')
    })

    test('an unpriced line is blank with a reason, never a zero', () => {
      // The failure the whole module is shaped around. A 0 totals cleanly, reads as an
      // answer, and gives the reader no way to see the line was skipped.
      const lines = [line({ quantity: 4, catalogId: 'tie-dw15', description: 'Tie rod' })]
      const csv = bomCsv(lines, { subject: 'Project', cost: priced(lines) })

      expect(dataRows(csv)[0]).toContain('No rate recorded for this part')
      const total = rows(csv).find((row) => row.startsWith(',TOTAL,')) as string
      expect(total).toContain('a floor — some lines unpriced')
    })

    test('calls the total a floor rather than a price where a line went unpriced', () => {
      const lines = [line({ quantity: 4, catalogId: 'tie-dw15', description: 'Tie rod' })]
      const csv = bomCsv(lines, { subject: 'Project', cost: priced(lines) })

      expect(rows(csv).some((row) => row.startsWith('TOTAL COST — a floor'))).toBe(true)
      expect(rows(csv).some((row) => row.startsWith('UNPRICED,'))).toBe(true)
    })

    test('charges own stock at the internal rate and keeps it out of the total', () => {
      // Owning formwork is not free, and this file used to say it cost nothing. The row
      // has to sit outside the total and say so, because a spreadsheet reader adds
      // adjacent money columns without reading the labels.
      const lines = [line({ quantity: 4 })]
      const supply = bomSupply(lines, { 'framax-2700-900': 4 })
      const hire = bomHire(lines, () => ['slab-props'], 'BS_8110', { temperatureC: 16 })
      const cost = bomCost(lines, RATES, hire, supply)
      const csv = bomCsv(lines, { subject: 'Project', supply, cost })

      expect(cost.ownedCost).toBeGreaterThan(0)
      expect(rows(csv)).toContain(
        `Own stock at internal hire rate — not in the total,${cost.ownedCost.toFixed(2)}`,
      )
      expect(rows(csv)).toContain('TOTAL COST,0')
      // Complete, so nothing went uncharged — the old row must not appear.
      expect(rows(csv).some((row) => row.startsWith('Owned parts that could not'))).toBe(false)
    })

    test('names the owned parts it could not charge at all, rather than pricing them at zero', () => {
      // A rack with a list price and no hire rate has nothing to charge an internal
      // recharge at, and a spreadsheet cannot tell a zero that means free from a zero
      // that means unanswered.
      const lines = [line({ quantity: 4 })]
      const supply = bomSupply(lines, { 'framax-2700-900': 4 })
      const hire = bomHire(lines, () => ['slab-props'], 'BS_8110', { temperatureC: 16 })
      const csv = bomCsv(lines, {
        subject: 'Project',
        supply,
        cost: bomCost(
          lines,
          { currency: 'GBP', byCatalogId: { 'framax-2700-900': { purchasePerUnit: 200 } } },
          hire,
          supply,
        ),
      })

      expect(rows(csv)).toContain('Owned parts that could not be charged at all,4')
    })

    test('sits between the hire period and the unit, in the header and the rows alike', () => {
      // Out of step by one column, every figure below the fold answers the wrong
      // question — and the file still opens.
      const lines = [line({ quantity: 4 })]
      const supply = bomSupply(lines, {})
      const hire = bomHire(lines, () => ['slab-props'], 'BS_8110', { temperatureC: 16 })
      const csv = bomCsv(lines, {
        subject: 'Project',
        supply,
        hire,
        cost: bomCost(lines, RATES, hire, supply),
      })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header.split(',').slice(5, 19)).toEqual([
        'Quantity',
        'From own stock',
        'To hire',
        'Consumed',
        'Days held',
        'Struck as',
        'Days charged',
        'Hire cost GBP',
        'Recharge cost GBP',
        'Purchase cost GBP',
        'Line cost GBP',
        // After the line total, so a reader summing leftward reaches a total without it.
        'Own stock cost GBP (not in line)',
        'Cost gap',
        'Unit',
      ])
      expect(dataRows(csv)[0]).toContain(',4,0,4,0,9.62,Props to a slab,9.62,7.69,,,7.69,,,no,')
    })

    test('leaves the total row’s charged-days cell blank, because periods do not total', () => {
      // The money totals and the days do not: a set comes free when the last of it does,
      // and a column of periods summed is a hire longer than the job.
      const lines = [line({ quantity: 4 })]
      const csv = bomCsv(lines, { subject: 'Project', cost: priced(lines) })

      const total = rows(csv).find((row) => row.startsWith(',TOTAL,')) as string
      expect(total.split(',').slice(6, 8)).toEqual(['', '7.69'])
    })
  })

  describe('when the pours happen', () => {
    const programme = (
      pours: Array<{ id: string; pourAt?: string }>,
      settings: { erectionLeadDays?: number; returnLeadDays?: number } = {},
    ) =>
      formworkSchedule(
        pours.map((pour) => ({
          ...pour,
          striking: [strikingTime('BS_8110', { target: 'slab-props', temperatureC: 16 })],
        })),
        settings,
      )

    test('adds no dates at all where the project has programmed nothing', () => {
      const csv = bomCsv([line()], { subject: 'Project' })

      expect(rows(csv).some((row) => row.startsWith('First pour,'))).toBe(false)
      expect(rows(csv).some((row) => row.startsWith('Pour,Erect,'))).toBe(false)
    })

    test('the dates go in the preamble rather than on a line, because a line spans pours', () => {
      // The join, not a layout preference: the same panel type on a March wall and a May
      // wall is one row, and a "Pour date" cell on it could only hold one of the two.
      const lines = [line({ quantity: 4 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        schedule: programme([{ id: 'fwasm_a', pourAt: '2026-03-02' }], {
          erectionLeadDays: 2,
          returnLeadDays: 1,
        }),
      })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header).not.toContain('Pour date')
      expect(rows(csv)).toContain('Pour — fwasm_a,2026-02-28,2026-03-02,2026-03-12,2026-03-13,')
    })

    test('the window is arrival to release, and not the longest single hold', () => {
      // The figure a delivery is booked against. A set used on two pours a week apart is
      // held about ten days each time and on site for the whole span.
      const lines = [line({ quantity: 4 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        schedule: programme(
          [
            { id: 'fwasm_a', pourAt: '2026-03-02' },
            { id: 'fwasm_b', pourAt: '2026-03-09' },
          ],
          { erectionLeadDays: 1, returnLeadDays: 1 },
        ),
      })

      expect(rows(csv)).toContain('Plant wanted on site,2026-03-01')
      expect(rows(csv)).toContain('First pour,2026-03-02')
      expect(rows(csv)).toContain('Last pour,2026-03-09')
      expect(rows(csv)).toContain('Plant free again,2026-03-20')
      expect(rows(csv)).toContain('Plant on site d,20')
    })

    test('an undated pour is an INCOMPLETE row, not a blank cell in a sequence', () => {
      // The block above reads as a whole programme. One dated pour of three is a true
      // statement about one and a wrong one about the job, and nothing in the rows shows it.
      const lines = [line({ quantity: 4 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        schedule: programme(
          [{ id: 'fwasm_a', pourAt: '2026-03-02' }, { id: 'fwasm_b' }, { id: 'fwasm_c' }],
          { erectionLeadDays: 1, returnLeadDays: 1 },
        ),
      })

      expect(
        rows(csv).some(
          (row) => row.startsWith('INCOMPLETE,') && row.includes('2 of 3 pours have no date'),
        ),
      ).toBe(true)
      // Undated last, where it cannot be read as the start of the job.
      const pourRows = rows(csv).filter((row) => row.startsWith('Pour — '))
      expect(pourRows[2]).toContain('No pour date recorded')
    })

    test('under ACI the dates are labelled as the earliest, before any of them is shown', () => {
      const lines = [line({ quantity: 4 })]
      const csv = bomCsv(lines, {
        subject: 'Project',
        schedule: formworkSchedule(
          [
            {
              id: 'fwasm_a',
              pourAt: '2026-03-02',
              striking: [strikingTime('ACI_347', { target: 'slab-props' })],
            },
          ],
          { erectionLeadDays: 1 },
        ),
      })

      const flag = rows(csv).find((row) => row.startsWith('PROGRAMME,')) as string
      expect(flag).toContain('qualifying hours above 10 °C')
      expect(rows(csv).indexOf(flag)).toBeLessThan(
        rows(csv).findIndex((row) => row.startsWith('Pour — ')),
      )
    })
  })

  describe('how many to own or hire', () => {
    const twoPours = (secondAt: string) =>
      formworkSchedule(
        [
          { id: 'fwasm_a', pourAt: '2026-03-02', striking: [period('slab-props')] },
          { id: 'fwasm_b', pourAt: secondAt, striking: [period('slab-props')] },
        ],
        { erectionLeadDays: 1, returnLeadDays: 1 },
      )
    const perPour = (quantity: number) =>
      ['fwasm_a', 'fwasm_b'].map((id) => ({
        id,
        quantities: [
          {
            catalogId: 'framax-2700-900',
            kind: 'panel' as const,
            description: 'Framax Xlife 2700 × 900',
            quantity,
            target: 'slab-props' as const,
          },
        ],
      }))

    test('the peak goes in the preamble, because it is not a property of a line', () => {
      // A line's quantity is what passes through the job and a peak is what stands on one
      // day. Side by side in one row they invite a subtraction, and 8 less a peak of 4 is
      // not 4 of anything — the same panels are counted again when they are refitted.
      const schedule = twoPours('2026-04-02')
      const sets = formworkSetCount(schedule, perPour(4)) as FormworkSetCount
      const csv = bomCsv([line({ quantity: 8 })], { subject: 'Project', schedule, sets })

      const header = rows(csv).find((row) => row.startsWith('Mark count,')) as string
      expect(header).not.toContain('Most at once')
      expect(rows(csv).some((row) => row.startsWith('MOST NEEDED AT ONCE,'))).toBe(true)
      // The peak is 4 against the bill's 8, with the reuse figure that explains the gap.
      expect(rows(csv)).toContain('Framax Xlife 2700 × 900,framax-2700-900,4,2026-03-01,8,2.0')
    })

    test('the block says it is the order, so the bill’s own quantity is not read as one', () => {
      const schedule = twoPours('2026-04-02')
      const sets = formworkSetCount(schedule, perPour(4)) as FormworkSetCount
      const csv = bomCsv([line({ quantity: 8 })], { subject: 'Project', schedule, sets })

      const banner = rows(csv).find((row) => row.startsWith('MOST NEEDED AT ONCE,')) as string
      expect(banner).toContain('these are the order')
    })

    test('the per-kind rack row is a sum of the ids, not a second sweep of them', () => {
      const schedule = twoPours('2026-03-02')
      const sets = formworkSetCount(schedule, perPour(4)) as FormworkSetCount
      const csv = bomCsv([line({ quantity: 8 })], { subject: 'Project', schedule, sets })

      // Both pours on one day, so the rack needs both sets — and the row is the kind's
      // label rather than a catalog id, because a rack is what a yard stacks together.
      expect(rows(csv)).toContain('Rack —,Panel,8')
    })

    test('a refused count says why in the file, not only in the UI that made it', () => {
      // The absence is the one thing in this file a reader cannot interpret: an export with
      // no money means no rates, and an export with a programme and no set count looks
      // like a bug unless the file says otherwise.
      const schedule = formworkSchedule(
        [
          { id: 'fwasm_a', pourAt: '2026-03-02', striking: [period('slab-props')] },
          { id: 'fwasm_b', striking: [period('slab-props')] },
        ],
        { erectionLeadDays: 1, returnLeadDays: 1 },
      )
      expect(formworkSetCount(schedule, perPour(4))).toBeUndefined()

      const csv = bomCsv([line()], { subject: 'Project', schedule })

      const row = rows(csv).find((entry) => entry.startsWith('NO SET COUNT,')) as string
      expect(row).toContain('1 of 2 pours are dated')
      expect(row).toContain('comes out low')
    })

    test('an unprogrammed export carries neither the block nor the refusal', () => {
      const csv = bomCsv([line()], { subject: 'Project' })

      expect(rows(csv).some((row) => row.startsWith('MOST NEEDED AT ONCE,'))).toBe(false)
      expect(rows(csv).some((row) => row.startsWith('NO SET COUNT,'))).toBe(false)
    })

    test('a partial sweep is an INCOMPLETE row, because a floor read as a peak under-orders', () => {
      const pours = [
        ...Array.from({ length: 19 }, (_, index) => ({
          id: `d${index}`,
          pourAt: `2026-03-${String(index + 2).padStart(2, '0')}`,
          striking: [period('vertical-form')],
        })),
        { id: 'undated', striking: [period('vertical-form')] },
      ]
      const schedule = formworkSchedule(pours, { erectionLeadDays: 1, returnLeadDays: 1 })
      const sets = formworkSetCount(
        schedule,
        pours.map((pour) => ({
          id: pour.id,
          quantities: [
            {
              catalogId: 'framax-2700-900',
              kind: 'panel' as const,
              description: 'Framax Xlife 2700 × 900',
              quantity: 4,
              target: 'vertical-form' as const,
            },
          ],
        })),
      ) as FormworkSetCount
      const csv = bomCsv([line()], { subject: 'Project', schedule, sets })

      expect(
        rows(csv).some(
          (row) =>
            row.startsWith('INCOMPLETE,') &&
            row.includes('1 of 20 pours are not in this sweep') &&
            row.includes('floor'),
        ),
      ).toBe(true)
    })
  })

  describe('what to go out and get', () => {
    const twoPours = (secondAt: string) =>
      formworkSchedule(
        [
          { id: 'fwasm_a', pourAt: '2026-03-02', striking: [period('vertical-form')] },
          { id: 'fwasm_b', pourAt: secondAt, striking: [period('vertical-form')] },
        ],
        { erectionLeadDays: 1, returnLeadDays: 1 },
      )
    const perPour = (quantity: number) =>
      ['fwasm_a', 'fwasm_b'].map((id) => ({
        id,
        quantities: [
          {
            catalogId: 'framax-2700-900',
            kind: 'panel' as const,
            description: 'Framax Xlife 2700 × 900',
            quantity,
            target: 'vertical-form' as const,
          },
        ],
      }))

    /** Sequential pours, so the same set serves both and the peak is one pour's worth. */
    const sequential = (owned: number, rates?: RateTable) => {
      const schedule = twoPours('2026-04-02')
      const sets = formworkSetCount(schedule, perPour(4)) as FormworkSetCount
      const acquisition = formworkAcquisition(sets, { 'framax-2700-900': owned }, rates)
      return bomCsv([line({ quantity: 8 })], { subject: 'Project', schedule, sets, acquisition })
    }

    test('the shortfall is the peak against the rack, and says it is not the hire column', () => {
      // The claim that makes this block worth having and the one thing a reader can get
      // wrong from the file alone: the bill hires 7 of its 8 and only 3 have to be got.
      const csv = sequential(1)

      const banner = rows(csv).find((row) => row.startsWith('TO ACQUIRE,')) as string
      expect(banner).toContain('Not the “To hire” column below')
      expect(rows(csv)).toContain(
        'Framax Xlife 2700 × 900,framax-2700-900,4,1,3,2026-03-01,34,18%,,,,',
      )
      expect(rows(csv)).toContain('Short in total,,,,3')
    })

    test('a rack covering the peak carries no date and nothing to acquire', () => {
      // A delivery date beside a zero shortfall is a delivery somebody has to make.
      const csv = sequential(10)

      expect(rows(csv)).toContain('Framax Xlife 2700 × 900,framax-2700-900,4,10,0,,34,18%,,,,')
      expect(rows(csv)).toContain('Short in total,,,,0')
    })

    test('the payback gets its own column, so the verdict is not the only figure', () => {
      const csv = sequential(1, {
        currency: 'GBP',
        byCatalogId: { 'framax-2700-900': { purchasePerUnit: 210, rentalPercentPerMonth: 3 } },
      })

      // `Owned` in the prefix, because the set-count block above has its own `Item,Catalog
      // id,Most at once,` header and matching that one would assert nothing.
      const header = rows(csv).find((row) =>
        row.startsWith('Item,Catalog id,Most at once,Owned'),
      ) as string
      expect(header).toContain('Pays back over (jobs)')
      expect(header).toContain('Hire GBP')
      const row = rows(csv).find((entry) =>
        entry.startsWith('Framax Xlife 2700 × 900,framax-2700-900,4,1,3,'),
      ) as string
      // 3 panels at 3 % of £210 a month over the 34 days committed, against £630 to buy
      // them — so a purchase pays back over 29 jobs like this one, and the verdict alone
      // would not have said that.
      expect(row).toContain('21.42,630,29.4')
      expect(row).toContain('Cheaper to hire for this job')
    })

    test('the two courses are printed side by side and never differenced', () => {
      // A subtraction here would print a saving, and buying is not a saving — the money is
      // spent on the day rather than saved over a job that has not happened.
      const csv = sequential(1, {
        currency: 'GBP',
        byCatalogId: { 'framax-2700-900': { purchasePerUnit: 210, rentalPercentPerMonth: 3 } },
      })

      const row = rows(csv).find((entry) =>
        entry.startsWith('"Whole shortfall, hired against bought'),
      ) as string
      expect(row).toContain('21.42,630')
      expect(rows(csv).some((entry) => entry.toLowerCase().includes('saving'))).toBe(false)
    })

    test('an unpriced shortfall says which rate is missing rather than reading as free', () => {
      const csv = sequential(1, { byCatalogId: {} })

      const row = rows(csv).find((entry) =>
        entry.startsWith('Framax Xlife 2700 × 900,framax-2700-900,4,1,3,'),
      ) as string
      expect(row).toContain('No rate recorded for this part')
      // No verdict off no rates: "hire" printed there is a recommendation nobody made.
      expect(row).not.toContain('Cheaper to hire')
    })

    test('no rack recorded leaves the block off the file entirely', () => {
      const schedule = twoPours('2026-04-02')
      const sets = formworkSetCount(schedule, perPour(4)) as FormworkSetCount
      const csv = bomCsv([line({ quantity: 8 })], { subject: 'Project', schedule, sets })

      expect(rows(csv).some((row) => row.startsWith('TO ACQUIRE,'))).toBe(false)
    })
  })

  describe('what waits on what', () => {
    /**
     * Three walls in stated cast order, the first two on one day.
     *
     * The whole chain rather than fixtures, so the peak the move is compared against is the
     * peak printed above it in the same file — a hand-built sequence could pass here while
     * disagreeing with the acquisition block a reader is looking at.
     */
    const chain = (thirdAt: string, owned: number) => {
      const ids = ['fwasm_a', 'fwasm_b', 'fwasm_c']
      const dates = ['2026-03-09', '2026-03-09', thirdAt]
      const schedule = formworkSchedule(
        ids.map((id, index) => ({
          id,
          pourAt: dates[index] as string,
          striking: [period('vertical-form')],
        })),
        { returnLeadDays: 1 },
      )
      const quantities = ids.map((id) => ({
        id,
        quantities: [
          {
            catalogId: 'framax-2700-900',
            kind: 'panel' as const,
            description: 'Framax Xlife 2700 × 900',
            quantity: 30,
            target: 'vertical-form' as const,
          },
        ],
      }))
      const sets = formworkSetCount(schedule, quantities) as FormworkSetCount
      const acquisition = formworkAcquisition(sets, { 'framax-2700-900': owned }, undefined)
      const sequence = formworkSequence(
        ids.map((id, index) => ({
          id,
          elementId: `wall_${index + 1}`,
          segmentIndex: 0,
          liftIndex: 0,
          castOrder: index + 1,
        })),
        schedule,
      )
      return bomCsv([line({ quantity: 90 })], {
        subject: 'Project',
        schedule,
        sets,
        acquisition,
        sequence,
        resequence: formworkResequence(acquisition, schedule, quantities, sequence),
      })
    }

    test('the block refuses the phrase “critical path” before any float is shown', () => {
      // The one thing a reader takes from a float column is that it is a critical path, and
      // every bound here is a neighbour's stated date rather than a pass over a programme.
      const banner = rows(chain('2026-03-23', 40)).find((row) =>
        row.startsWith('PRECEDENCE AND FLOAT,'),
      ) as string

      expect(banner).toContain('not a critical path')
      expect(banner).toContain('pinned by the dates around it')
    })

    test('the allowance is per pour, with the dependency’s own reason under it', () => {
      const all = rows(chain('2026-03-23', 40))
      const header = all.find((row) => row.startsWith('Pour,Elements,')) as string
      const middle = all.find((row) => row.startsWith('fwasm_b,')) as string

      expect(header).toContain('Allowance (days)')
      expect(middle).toContain('wall_2')
      expect(middle).toContain('fwasm_a')
      expect(middle).toContain('fwasm_c')
      // The reason rather than only the pair: an edge with no provenance is one a planner
      // dismisses, and this is the sentence they argue with.
      expect(all).toContain(
        'fwasm_a → fwasm_b,"The project states an explicit cast order across these elements — fwasm_a is cast at order 1, fwasm_b at 2"',
      )
    })

    test('a move carries the peak it leaves behind, and what it costs elsewhere', () => {
      const all = rows(chain('2026-03-23', 40))
      const banner = all.find((row) => row.startsWith('MOVE INSTEAD OF BUYING,')) as string
      const move = all.find((row) =>
        row.startsWith('Framax Xlife 2700 × 900,20,fwasm_b,'),
      ) as string

      expect(banner).toContain('One move at a time')
      expect(banner).toContain('no gang, no crane, no concrete supply')
      expect(move).toContain('2026-03-09')
      // Peak before, peak after, and nothing left short — the three figures that make the
      // proposal arguable rather than an instruction.
      expect(move).toContain('60,30,0')
      expect(move).toContain('nothing')
    })

    test('a shortage no move clears says so where a move would have been', () => {
      // All three pours on one day and every one of them pinned by its neighbours: the answer
      // is that the shortfall has to be bought, and a missing row would read as no answer.
      const all = rows(chain('2026-03-09', 40))
      const refusal = all.find((row) => row.includes('NO MOVE —')) as string

      expect(refusal).toContain('Framax Xlife 2700 × 900,50')
      expect(refusal).toContain('Every pour in the overlap is pinned')
      expect(refusal).toContain('bought or hired')
      expect(all.some((row) => row.startsWith('Framax Xlife 2700 × 900,50,fwasm'))).toBe(false)
    })

    test('a programme with nothing short carries the precedence block and no proposal', () => {
      // The two blocks are independent: what waits on what is worth reading on a job that is
      // short of nothing, and a heading with no rows under it would read as a fault.
      const all = rows(chain('2026-03-23', 100))

      expect(all.some((row) => row.startsWith('PRECEDENCE AND FLOAT,'))).toBe(true)
      expect(all.some((row) => row.startsWith('MOVE INSTEAD OF BUYING,'))).toBe(false)
    })

    test('an export with no sequence in it carries neither block', () => {
      const schedule = formworkSchedule(
        [{ id: 'fwasm_a', pourAt: '2026-03-09', striking: [period('vertical-form')] }],
        { returnLeadDays: 1 },
      )
      const csv = bomCsv([line({ quantity: 8 })], { subject: 'Project', schedule })

      expect(rows(csv).some((row) => row.startsWith('PRECEDENCE AND FLOAT,'))).toBe(false)
      expect(rows(csv).some((row) => row.startsWith('MOVE INSTEAD OF BUYING,'))).toBe(false)
    })
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
