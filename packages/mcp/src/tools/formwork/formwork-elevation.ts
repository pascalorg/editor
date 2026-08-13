import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { elevationCaveats, FORMWORK_ELEVATION_DESCRIPTION } from '@pascal-app/core/formwork'
import { shutterElevations } from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { castableOrRefusal, refusal, sceneNodes, textResult } from './shared'

const piece = z.object({
  mark: z.string(),
  kind: z.string(),
  xMm: z.number(),
  yMm: z.number(),
  widthMm: z.number(),
  heightMm: z.number(),
  course: z.number().nullable(),
})

export const formworkElevationOutput = {
  elementId: z.string(),
  drawings: z.array(
    z.object({
      assemblyId: z.string(),
      /** "Pour 1, lift 2" — how the parts table and the design report name the same pour. */
      pour: z.string(),
      runMm: z.number(),
      formBaseMm: z.number(),
      concreteTopMm: z.number(),
      formTopMm: z.number(),
      courses: z.array(z.object({ baseMm: z.number(), topMm: z.number() })),
      openings: z.array(
        z.object({
          id: z.string(),
          xMm: z.number(),
          yMm: z.number(),
          widthMm: z.number(),
          heightMm: z.number(),
        }),
      ),
      ties: z.array(z.object({ xMm: z.number(), yMm: z.number(), mark: z.string() })),
      /** Stations the grid offers that this wall cannot use. An absence with a reason. */
      tiesNotTied: z.array(z.object({ xMm: z.number(), yMm: z.number(), because: z.string() })),
      tiesFrom: z.string(),
      faces: z.array(z.object({ face: z.string(), pieces: z.array(piece) })),
      caveats: z.array(z.string()),
    }),
  ),
  /** Why there is no drawing, where the element could never have one. */
  noElevationBecause: z.string().optional(),
}

/**
 * Which rectangle each mark is, for an agent with no screen.
 *
 * `inspect_formwork_parts` already answers what the parts are — mark, product, weight, how hard
 * each is worked — and that reply is deliberately a list. A list is what an order is placed
 * from and it is not what a shutter is set out from: it says P-A-1-01250 is a 1200 × 2400 panel
 * at 1250 mm, and it cannot say which panel is beside it, whether the tie at 1250 falls on its
 * joint, or that the course above it starts where it ends. The join between a mark and its
 * neighbours exists only in the elevation.
 *
 * ## Why the reasons are here and the shapes are not
 *
 * The rectangles are the layout's own, in the pour's frame, and nothing about how they are
 * *drawn* is on this surface: no colours, no label placement, no flipped Y. A model composing a
 * picture out of those would be a third implementation of the drawing, and the two that exist
 * share `elevationShapes` precisely so the printed sheet and the screen cannot diverge.
 *
 * What is here instead is every reason a reader needs to not mis-read the figures, in core's
 * own words: `caveats` is the same text under the panel and on the issued SVG. A caveat present
 * on two surfaces and absent from the third is a caveat that did not arrive, and this is the
 * surface whose reader is most likely to restate a drilled tie station as a spacing it could
 * move.
 *
 * ## Walls only, and that is stated rather than empty
 *
 * A column is clamped to a schedule and a slab is decked to a plan; neither is an elevation of
 * a face, and neither has one to draw. Answered with the reason rather than with no drawings,
 * because an empty array reads as a wall whose shutter was never solved.
 */
export function registerFormworkElevation(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'formwork_elevation',
    {
      title: 'Formwork shutter elevation',
      description: FORMWORK_ELEVATION_DESCRIPTION,
      inputSchema: { elementId: z.string() },
      outputSchema: formworkElevationOutput,
    },
    async ({ elementId }) => {
      const nodes = sceneNodes(bridge)
      const host = castableOrRefusal(nodes, elementId)
      if ('isError' in host) return host

      // Refused rather than answered with nothing, for the reason `inspect_formwork_parts`
      // refuses: a drawing of no shutter reads as a wall that needs none.
      const drawings = shutterElevations(host, nodes)
      if (drawings === undefined) {
        return refusal(
          `No formwork on ${elementId}, so there is nothing to draw. Call attach_formwork on it first, and set_element_construction before that if it has no shuttering system.`,
        )
      }
      if (drawings.length === 0) {
        return textResult({
          elementId,
          drawings: [],
          noElevationBecause:
            host.type === 'wall'
              ? 'This wall is formed but no face of it is panelled in this scope — a single-sided pour against an existing face, or a pour whose faces are all buried against neighbours. There is no shutter face to draw an elevation of.'
              : `A ${host.type} has no shutter elevation. A column is clamped to a schedule and a slab is decked to a plan, and neither is an elevation of a face — call inspect_formwork_parts for what it is made of. Not a missing input.`,
        })
      }

      return textResult({
        elementId,
        drawings: drawings.map((drawing) => ({
          assemblyId: drawing.assemblyId,
          pour: drawing.pour,
          runMm: Math.round(drawing.elevation.runMm),
          formBaseMm: Math.round(drawing.elevation.formBaseMm),
          concreteTopMm: Math.round(drawing.elevation.concreteTopMm),
          formTopMm: Math.round(drawing.elevation.formTopMm),
          courses: drawing.elevation.courses.map((course) => ({
            baseMm: Math.round(course.baseMm),
            topMm: Math.round(course.topMm),
          })),
          openings: drawing.elevation.openings.map((opening) => ({
            id: opening.id,
            xMm: Math.round(opening.xMm),
            yMm: Math.round(opening.yMm),
            widthMm: Math.round(opening.widthMm),
            heightMm: Math.round(opening.heightMm),
          })),
          ties: drawing.elevation.ties.map((tie) => ({
            xMm: Math.round(tie.xMm),
            yMm: Math.round(tie.yMm),
            mark: tie.mark,
          })),
          tiesNotTied: drawing.elevation.tiesDropped.map((tie) => ({
            xMm: Math.round(tie.xMm),
            yMm: Math.round(tie.yMm),
            because: tie.because,
          })),
          tiesFrom: drawing.elevation.tiesFrom,
          faces: drawing.elevation.faces.map((face) => ({
            face: face.role,
            pieces: face.pieces.map((shutterPiece) => ({
              mark: shutterPiece.mark,
              kind: shutterPiece.kind,
              xMm: Math.round(shutterPiece.xMm),
              yMm: Math.round(shutterPiece.yMm),
              widthMm: Math.round(shutterPiece.widthMm),
              heightMm: Math.round(shutterPiece.heightMm),
              course: shutterPiece.courseIndex ?? null,
            })),
          })),
          caveats: elevationCaveats(drawing.elevation),
        })),
      })
    },
  )
}
