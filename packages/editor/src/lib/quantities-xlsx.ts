'use client'

import {
  type CurrencyTotal,
  type PricedQuantityLine,
  type PricedQuantityTakeoff,
  QUANTITY_UNIT_SUFFIX,
} from '@pascal-app/core'
import { strToU8, zipSync } from 'fflate'

/**
 * XLSX export for the quantity takeoff — a hand-rolled OOXML spreadsheet.
 *
 * The CSV export already exists and stays: it is dependency-free and readable
 * anywhere. XLSX buys two things the issue asks for — one sheet per category
 * and real number formatting (a currency cell sums without anyone parsing
 * "₺1.234,56" back out of a string) — at the cost of writing the OOXML zip
 * by hand over `fflate`. That is deliberately a tiny, self-contained format
 * rather than a spreadsheet library: the file only ever contains strings and
 * numbers, so the full XLSX spec is not needed.
 *
 * Values stay in SI, exactly like the CSV: a quantity is the raw metre/square-
 * metre/cubic-metre/count number and the unit sits in its own column. Money is
 * a raw amount with a per-cell currency format; the summary sheet rolls the
 * per-currency totals so a mixed-currency model still sums honestly.
 */

// Built-in OOXML number formats (no <numFmts> section needed): 1 = "0",
// 2 = "0.00", 4 = "#,##0.00".
const STYLE_QUANTITY = 1
const STYLE_MONEY = 2
const STYLE_INTEGER = 3
const STYLE_HEADER = 4
const STYLE_MONEY_TOTAL = 5

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const NS = {
  types: 'http://schemas.openxmlformats.org/package/2006/content-types',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  relsDoc: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  main: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
} as const

/** Escape text for an XML text node. */
function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function cellRef(row: number, column: number): string {
  return `${COLUMNS[column]}${row}`
}

function numberCell(ref: string, value: number, styleId: number): string {
  return `<c r="${ref}" s="${styleId}"><v>${value}</v></c>`
}

function textCell(ref: string, value: string, styleId: number): string {
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
}

function emptyCell(ref: string): string {
  return `<c r="${ref}"/>`
}

/** A worksheet name is case-insensitively unique, ≤31 chars, and `[]:*?/\\`-free. */
function uniqueSheetName(raw: string, used: Set<string>): string {
  const base =
    raw
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet'
  let candidate = base
  let suffix = 2
  while (used.has(candidate.toLowerCase())) {
    const marker = ` (${suffix})`
    candidate = `${base.slice(0, 31 - marker.length)}${marker}`
    suffix++
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function rowXml(rowNumber: number, cells: string[]): string {
  return `<row r="${rowNumber}">${cells.join('')}</row>`
}

function sectionSheetXml(section: { label: string; lines: PricedQuantityLine[] }): string {
  const header = ['Item', 'Group', 'Quantity', 'Unit', 'Currency', 'Unit Price', 'Cost', 'Count']
  const rows: string[] = [
    rowXml(
      1,
      header.map((text, column) => textCell(cellRef(1, column), text, STYLE_HEADER)),
    ),
  ]

  section.lines.forEach((line, index) => {
    const row = index + 2
    const priced = line.unitPrice !== undefined
    const cells: string[] = [
      textCell(cellRef(row, 0), line.label, 0),
      textCell(cellRef(row, 1), line.group ?? '', 0),
      numberCell(
        cellRef(row, 2),
        Number.parseFloat(line.value.toFixed(6)),
        line.unit === 'count' ? STYLE_INTEGER : STYLE_QUANTITY,
      ),
      textCell(cellRef(row, 3), QUANTITY_UNIT_SUFFIX[line.unit], 0),
      priced ? textCell(cellRef(row, 4), line.unitPrice!.currency, 0) : emptyCell(cellRef(row, 4)),
      priced
        ? numberCell(cellRef(row, 5), line.unitPrice!.amount, STYLE_MONEY)
        : emptyCell(cellRef(row, 5)),
      priced ? numberCell(cellRef(row, 6), line.cost!, STYLE_MONEY) : emptyCell(cellRef(row, 6)),
      numberCell(cellRef(row, 7), line.nodeCount, STYLE_INTEGER),
    ]
    rows.push(rowXml(row, cells))
  })

  return `<worksheet xmlns="${NS.main}"><sheetData>${rows.join('')}</sheetData></worksheet>`
}

function summarySheetXml(totals: CurrencyTotal[]): string {
  const rows: string[] = [
    rowXml(1, [
      textCell(cellRef(1, 0), 'Currency', STYLE_HEADER),
      textCell(cellRef(1, 1), 'Total Cost', STYLE_HEADER),
    ]),
  ]
  totals.forEach((total, index) => {
    const row = index + 2
    rows.push(
      rowXml(row, [
        textCell(cellRef(row, 0), total.currency, 0),
        numberCell(cellRef(row, 1), total.cost, STYLE_MONEY_TOTAL),
      ]),
    )
  })
  return `<worksheet xmlns="${NS.main}"><sheetData>${rows.join('')}</sheetData></worksheet>`
}

const STYLES_XML = `${XML_HEADER}
<styleSheet xmlns="${NS.main}">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
  </cellXfs>
</styleSheet>`

/**
 * Serialise a priced takeoff as an XLSX byte array.
 *
 * One "Summary" sheet carries the per-currency totals, then one sheet per
 * category section. Pure — no DOM, no browser — so it can be tested in Node.
 */
export function buildQuantityTakeoffXlsx(takeoff: PricedQuantityTakeoff): Uint8Array<ArrayBuffer> {
  const usedNames = new Set<string>()
  const sheetNames: string[] = [uniqueSheetName('Summary', usedNames)]
  for (const section of takeoff.sections) {
    sheetNames.push(uniqueSheetName(section.label, usedNames))
  }

  // The summary sheet is index 0; the category sheets follow it.
  const worksheets: string[] = [summarySheetXml(takeoff.totals)]
  for (const section of takeoff.sections) {
    worksheets.push(sectionSheetXml(section))
  }

  const sheetOverrides = sheetNames
    .map(
      (name, index) =>
        `  <Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('\n')

  const contentTypes = `${XML_HEADER}
<Types xmlns="${NS.types}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheetOverrides}
</Types>`

  const rootRels = `${XML_HEADER}
<Relationships xmlns="${NS.rels}">
  <Relationship Id="rId1" Type="${NS.relsDoc}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const sheetElements = sheetNames
    .map(
      (name, index) =>
        `  <sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('\n')

  const workbook = `${XML_HEADER}
<workbook xmlns="${NS.main}" xmlns:r="${NS.relsDoc}">
  <sheets>
${sheetElements}
  </sheets>
</workbook>`

  const workbookRelEntries = sheetNames
    .map(
      (_, index) =>
        `  <Relationship Id="rId${index + 1}" Type="${NS.relsDoc}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('\n')

  const workbookRels = `${XML_HEADER}
<Relationships xmlns="${NS.rels}">
${workbookRelEntries}
  <Relationship Id="rId${sheetNames.length + 1}" Type="${NS.relsDoc}/styles" Target="styles.xml"/>
</Relationships>`

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(STYLES_XML),
  }
  worksheets.forEach((xml, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(xml)
  })

  // fflate allocates a real `ArrayBuffer`, never a `SharedArrayBuffer`, but its
  // types widen to `ArrayBufferLike`; narrow so the result satisfies `BlobPart`.
  return zipSync(files) as Uint8Array<ArrayBuffer>
}

/**
 * Hand the XLSX to the browser as a download.
 *
 * Mirrors `downloadQuantityCsv`'s defer-revoke-on-next-tick dance for Safari.
 */
export function downloadQuantityXlsx(
  takeoff: PricedQuantityTakeoff,
  filename = 'quantities.xlsx',
): void {
  if (typeof document === 'undefined') return

  const blob = new Blob([buildQuantityTakeoffXlsx(takeoff)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
