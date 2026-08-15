import { readFile } from 'node:fs/promises'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { parseDxf } from '@pascal-app/cad-import'
import { z } from 'zod'
import { ErrorCode, throwMcpError } from './errors'

/**
 * Read a DXF drawing so an agent can build from it.
 *
 * Deliberately *not* `import_cad`. In the editor a drawing is imported as a
 * locked underlay — reference material a person traces over by hand, with the
 * snapping doing the precision work. An agent does none of that: it writes
 * coordinates directly, and a locked underlay it cannot see is no use to it.
 *
 * What an agent lacks is the judgement the editor's user supplies — which
 * layer is a wall and which is a parked car. That judgement is exactly what a
 * language model has and a geometric heuristic does not: the layers in a real
 * Turkish drawing are called `ARK_Duvar_Dış` and `ARK_Tefriş`, and knowing
 * which is which is a reading problem, not a geometry problem. So this tool
 * hands over the drawing's structure and, on request, the line work of chosen
 * layers — and lets the agent call `create_wall` itself.
 */
const MAX_FILE_BYTES = 200 * 1024 * 1024

/**
 * Cap on segments returned in one call. A real drawing holds a hundred
 * thousand-plus; returning them all would blow any context window long before
 * it helped. Agents narrow by layer first, which is the useful order anyway.
 */
const MAX_RETURNED_SEGMENTS = 4000

export const readCadDrawingInput = {
  path: z
    .string()
    .describe(
      'Absolute path to an ASCII DXF file **on the machine running this server**. This tool does not receive uploads: a file attached to your chat lives in the client and never becomes a path here. If the user attached one, ask them to save it to disk and give you the path.',
    ),
  layers: z
    .array(z.string())
    .optional()
    .describe(
      'Layer names whose line work to return. Omit to get the summary only — do that first, then ask for the layers that look structural.',
    ),
  maxSegments: z
    .number()
    .int()
    .min(1)
    .max(MAX_RETURNED_SEGMENTS)
    .optional()
    .describe(`Cap on returned segments (default ${MAX_RETURNED_SEGMENTS}).`),
}

export const readCadDrawingOutput = {
  units: z.object({
    insunits: z.number().nullable(),
    metersPerUnit: z
      .number()
      .nullable()
      .describe('Null when the drawing declares no units; coordinates are then unitless.'),
  }),
  bounds: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }),
  layers: z.array(
    z.object({
      name: z.string(),
      segmentCount: z.number(),
      visible: z.boolean(),
    }),
  ),
  entityCounts: z.record(z.string(), z.number()),
  skippedTypes: z
    .record(z.string(), z.number())
    .describe('Entity types this parser does not draw — text, hatches, dimensions.'),
  segments: z
    .array(
      z.object({
        layer: z.string(),
        start: z.tuple([z.number(), z.number()]),
        end: z.tuple([z.number(), z.number()]),
      }),
    )
    .describe('Line work of the requested layers, in metres when the drawing declares units.'),
  truncated: z.boolean().describe('True when the segment cap cut the result short.'),
}

export function registerReadCadDrawing(server: McpServer): void {
  server.registerTool(
    'read_cad_drawing',
    {
      title: 'Read CAD drawing',
      description:
        'Parse a DXF and report its layers, units, extent and line work. Takes a path on the server host — it cannot read a file attached to the chat. Call it once without `layers` to see the layer names and how much geometry each carries, then again naming the structural ones to get their coordinates — which you can turn into walls with create_wall. Layer names carry the meaning: a layer called ARK_Duvar_Dış is exterior walls, ARK_Tefriş is furniture. Check `units` against the geometry before building: a drawing that declares the wrong unit is common, so confirm `metersPerUnit` gives a believable wall thickness and facade length before trusting it.',
      inputSchema: readCadDrawingInput,
      outputSchema: readCadDrawingOutput,
    },
    async ({ path, layers: requested, maxSegments }) => {
      let source: string
      try {
        const bytes = await readFile(path)
        if (bytes.byteLength > MAX_FILE_BYTES) {
          throwMcpError(
            ErrorCode.InvalidParams,
            `File is ${(bytes.byteLength / 1024 / 1024).toFixed(0)} MB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
          )
        }
        source = bytes.toString('utf8')
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err) {
          const hint =
            String(err.code) === 'ENOENT'
              ? " This tool reads the server host's own filesystem and never receives uploads, so a file attached to the chat will not be here. Ask the user for an absolute path to a saved copy."
              : ''
          throwMcpError(
            ErrorCode.InvalidParams,
            `Could not read ${path}: ${String(err.code)}.${hint}`,
          )
        }
        throw err
      }

      let drawing: ReturnType<typeof parseDxf>
      try {
        drawing = parseDxf(source)
      } catch (err) {
        throwMcpError(
          ErrorCode.InvalidParams,
          err instanceof Error ? err.message : 'That file could not be parsed as a DXF.',
        )
      }

      const counts = new Array<number>(drawing.layers.length).fill(0)
      for (let i = 0; i < drawing.segmentLayers.length; i++) {
        const layer = drawing.segmentLayers[i]!
        if (layer < counts.length) counts[layer] = counts[layer]! + 1
      }

      const layerSummary = drawing.layers
        .map((layer, index) => ({
          name: layer.name,
          segmentCount: counts[index] ?? 0,
          visible: layer.visible,
        }))
        .filter((layer) => layer.segmentCount > 0)
        .sort((a, b) => b.segmentCount - a.segmentCount)

      // Coordinates go out in metres when we can, because everything else in
      // the scene API is metres — an agent should never have to apply a unit
      // factor by hand.
      const scale = drawing.units.metersPerUnit ?? 1
      const wanted = requested ? new Set(requested) : null
      const cap = maxSegments ?? MAX_RETURNED_SEGMENTS

      const segments: { layer: string; start: [number, number]; end: [number, number] }[] = []
      let truncated = false
      if (wanted && wanted.size > 0) {
        for (let i = 0; i < drawing.segmentLayers.length; i++) {
          const name = drawing.layers[drawing.segmentLayers[i]!]?.name
          if (!name || !wanted.has(name)) continue
          if (segments.length >= cap) {
            truncated = true
            break
          }
          segments.push({
            layer: name,
            start: [drawing.segments[i * 4]! * scale, drawing.segments[i * 4 + 1]! * scale],
            end: [drawing.segments[i * 4 + 2]! * scale, drawing.segments[i * 4 + 3]! * scale],
          })
        }
      }

      const result = {
        units: drawing.units,
        bounds: {
          minX: drawing.bounds.minX * scale,
          minY: drawing.bounds.minY * scale,
          maxX: drawing.bounds.maxX * scale,
          maxY: drawing.bounds.maxY * scale,
        },
        layers: layerSummary,
        entityCounts: drawing.stats.entityCounts,
        skippedTypes: drawing.stats.skippedTypes,
        segments,
        truncated,
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    },
  )
}
