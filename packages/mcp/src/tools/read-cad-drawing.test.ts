import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerReadCadDrawing } from './read-cad-drawing'

type ToolHandler = (args: Record<string, unknown>) => Promise<{ structuredContent: Result }>

type Result = {
  units: { insunits: number | null; metersPerUnit: number | null }
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  layers: { name: string; segmentCount: number; visible: boolean }[]
  entityCounts: Record<string, number>
  skippedTypes: Record<string, number>
  segments: { layer: string; start: [number, number]; end: [number, number] }[]
  truncated: boolean
}

/** Minimal stand-in for the MCP server: captures the registered handler. */
function register(): ToolHandler {
  let handler: ToolHandler | null = null
  registerReadCadDrawing({
    registerTool: (_name: string, _meta: unknown, fn: ToolHandler) => {
      handler = fn
    },
  } as never)
  if (!handler) throw new Error('tool did not register')
  return handler
}

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`
}

function line(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return (
    pair(0, 'LINE') +
    pair(8, layer) +
    pair(10, x1) +
    pair(20, y1) +
    pair(30, 0) +
    pair(11, x2) +
    pair(21, y2) +
    pair(31, 0)
  )
}

/** A millimetre drawing: 10 m of wall, 2 m of furniture, and a hatch we drop. */
function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pascal-cad-'))
  const path = join(dir, 'plan.dxf')

  const body =
    line('ARK_Duvar_Dış', 0, 0, 10_000, 0) +
    line('ARK_Duvar_Dış', 10_000, 0, 10_000, 5000) +
    line('ARK_Tefriş', 2000, 2000, 4000, 2000) +
    pair(0, 'HATCH') +
    pair(8, 'ARK_Bitki') +
    pair(10, 0) +
    pair(20, 0)

  const source =
    pair(0, 'SECTION') +
    pair(2, 'HEADER') +
    pair(9, '$INSUNITS') +
    pair(70, 4) +
    pair(0, 'ENDSEC') +
    pair(0, 'SECTION') +
    pair(2, 'ENTITIES') +
    body +
    pair(0, 'ENDSEC') +
    pair(0, 'EOF')

  writeFileSync(path, source)
  return path
}

describe('read_cad_drawing', () => {
  test('summarises layers heaviest first without being asked for geometry', async () => {
    const result = (await register()({ path: writeFixture() })).structuredContent

    expect(result.layers.map((l) => l.name)).toEqual(['ARK_Duvar_Dış', 'ARK_Tefriş'])
    expect(result.layers[0]?.segmentCount).toBe(2)
    // The summary call must stay cheap: no coordinates until asked.
    expect(result.segments).toEqual([])
  })

  test('reports units and converts coordinates to metres', async () => {
    const handler = register()
    const path = writeFixture()

    const summary = (await handler({ path })).structuredContent
    expect(summary.units.metersPerUnit).toBe(0.001)
    // 10,000 mm of wall is reported as 10 m, not 10,000.
    expect(summary.bounds.maxX).toBeCloseTo(10, 6)

    const detail = (await handler({ path, layers: ['ARK_Duvar_Dış'] })).structuredContent
    expect(detail.segments[0]?.end).toEqual([10, 0])
  })

  test('returns only the layers asked for', async () => {
    const result = (await register()({ path: writeFixture(), layers: ['ARK_Tefriş'] }))
      .structuredContent

    expect(result.segments).toHaveLength(1)
    expect(result.segments.every((s) => s.layer === 'ARK_Tefriş')).toBe(true)
  })

  test('says what it could not draw rather than dropping it silently', async () => {
    const result = (await register()({ path: writeFixture() })).structuredContent
    expect(result.skippedTypes.HATCH).toBe(1)
  })

  test('caps the segment list and admits when it did', async () => {
    const result = (
      await register()({ path: writeFixture(), layers: ['ARK_Duvar_Dış'], maxSegments: 1 })
    ).structuredContent

    expect(result.segments).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  test('does not claim truncation when it returned everything', async () => {
    const result = (await register()({ path: writeFixture(), layers: ['ARK_Duvar_Dış'] }))
      .structuredContent

    expect(result.truncated).toBe(false)
  })

  test('reports a missing file as a parameter error, not a crash', async () => {
    await expect(register()({ path: '/nonexistent/plan.dxf' })).rejects.toThrow(/Could not read/)
  })

  // A real session went wrong here: the user attached a DXF to the chat, the
  // tool found nothing at that path, and the agent concluded the upload had
  // failed and asked for the file again. It had not failed — this tool never
  // receives uploads, so the miss has to say so.
  test('a missing file says uploads are not how this tool gets a file', async () => {
    await expect(register()({ path: '/nonexistent/plan.dxf' })).rejects.toThrow(
      /never receives uploads/,
    )
  })

  test('reports an unparseable file with an actionable message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pascal-cad-'))
    const path = join(dir, 'binary.dxf')
    writeFileSync(path, 'AutoCAD Binary DXF\r\n ')

    await expect(register()({ path })).rejects.toThrow(/ASCII DXF/)
  })
})
