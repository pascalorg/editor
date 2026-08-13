import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  cutInstruction,
  cutSequenceCaveats,
  FORMWORK_CUT_SHEET_DESCRIPTION,
  sheetCutSequence,
} from '@pascal-app/core/formwork'
import { solveProjectFormwork } from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { formworkScopeInput, noSuchLevel, sceneNodes, textResult } from './shared'

export const formworkCutSheetOutput = {
  scope: z.string(),
  sheets: z.array(
    z.object({
      sheetId: z.string(),
      number: z.number(),
      widthMm: z.number(),
      heightMm: z.number(),
      boards: z.array(
        z.object({
          mark: z.string(),
          xMm: z.number(),
          yMm: z.number(),
          widthMm: z.number(),
          heightMm: z.number(),
          turned: z.boolean(),
        }),
      ),
      offcuts: z.array(
        z.object({
          xMm: z.number(),
          yMm: z.number(),
          widthMm: z.number(),
          heightMm: z.number(),
          /** Under the yard's stated policy. False is scrap rather than unstated. */
          worthRacking: z.boolean(),
        }),
      ),
      /** In the order they are made. Each one in the words the drawing prints. */
      cuts: z.array(z.string()),
      /** False where no edge-to-edge cut separates the layout — a refusal, not a warning. */
      guillotineable: z.boolean(),
      unsequencedMarks: z.array(z.string()),
      usedPercent: z.number(),
    }),
  ),
  /** Boards on no sheet here, so a drawing without them looks complete and is short. */
  boardsLargerThanEverySheet: z.array(
    z.object({ mark: z.string(), widthMm: z.number(), heightMm: z.number() }),
  ),
  caveats: z.array(z.string()),
  /** Why there are no sheets at all. */
  noCutSheetBecause: z.string().optional(),
}

/**
 * Where the boards go on the sheets, for an agent with no screen.
 *
 * `inspect_project_formwork` already answers the purchasing question — how many sheets, at
 * what waste — and that reply is deliberately a *summary* of the nest. This is the nest
 * itself, and it is a separate tool for the reason the editor draws it in a separate section:
 * the sheet count is read by whoever places the order and the placements are read by whoever
 * cuts, days apart. Folding the placements into the takeoff reply would put several hundred
 * rectangles into every answer about what a floor costs.
 *
 * ## The cuts are sentences rather than coordinates
 *
 * `cuts` is `cutInstruction` output, the same wording the panel and the downloaded drawing
 * print, and the structured extents are deliberately not here. A model handed `atMm`,
 * `fromMm` and `toMm` will compose its own sentence, and the sentence it composes is
 * plausibly "cut at 600 mm across the sheet" — which is the one wrong thing to say about a
 * guillotine sequence, because a later cut that ran the full width goes back through a board
 * already freed. The extent is *in* the sentence, and the sentence is not the model's to
 * write.
 *
 * ## Why the placements are here at all, given nothing on this surface draws
 *
 * An agent asked to check a nest, to explain why a job needs four sheets rather than three,
 * or to answer "which sheet is W2-P3 on" has no other route to it: the boards are marks in a
 * bill and the sheets are a count, and the join between them exists only in the placements.
 */
export function registerFormworkCutSheet(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'formwork_cut_sheet',
    {
      title: 'Formwork cut sheet',
      description: FORMWORK_CUT_SHEET_DESCRIPTION,
      inputSchema: formworkScopeInput,
      outputSchema: formworkCutSheetOutput,
    },
    async ({ elementIds, levelId }) => {
      const nodes = sceneNodes(bridge)
      if (levelId !== undefined && nodes[levelId]?.type !== 'level') return noSuchLevel(levelId)

      const solution = solveProjectFormwork(nodes, { hostIds: elementIds, parentId: levelId })
      const scope = levelId ?? (elementIds ? 'the elements named' : 'whole scene')
      const cutList = solution.cutList
      if (cutList === undefined) {
        return textResult({
          scope,
          sheets: [],
          boardsLargerThanEverySheet: [],
          caveats: [],
          // The same two absences `inspect_project_formwork` distinguishes, because they
          // have different remedies and only one of them is a missing input.
          noCutSheetBecause: solution.bom.some((line) => line.kind === 'ply-piece')
            ? 'This job cuts ply and the project has not recorded which sheet the yard buys, so there is nothing to nest the boards into and no cut sheet. Never take the sheet size from a sheathing grade and never pick one: a grade carries the pressures it takes and no width or length at all. Ask the user which sheet the yard buys and record it with set_formwork_settings sheets.'
            : 'Nothing in scope is cut out of sheet material — every part in the bill is a standard product — so there is nothing to cut and no cut sheet. Not a missing input.',
        })
      }

      const plans = cutList.list.sheets.map((sheet) => sheetCutSequence(sheet))
      return textResult({
        scope,
        sheets: cutList.list.sheets.map((sheet, index) => {
          const plan = plans[index]
          return {
            sheetId: sheet.sheetId,
            number: sheet.number,
            widthMm: sheet.widthMm,
            heightMm: sheet.heightMm,
            boards: sheet.placements.map((placed) => ({
              mark: placed.mark,
              xMm: placed.xMm,
              yMm: placed.yMm,
              widthMm: placed.widthMm,
              heightMm: placed.heightMm,
              turned: placed.rotated === true,
            })),
            offcuts: sheet.offcuts.map((offcut) => ({
              xMm: offcut.xMm,
              yMm: offcut.yMm,
              widthMm: offcut.widthMm,
              heightMm: offcut.heightMm,
              worthRacking: offcut.keep,
            })),
            cuts: (plan?.cuts ?? []).map(cutInstruction),
            guillotineable: plan?.guillotineable ?? false,
            unsequencedMarks: plan?.unsequencedMarks ?? [],
            usedPercent: Math.round((sheet.usedAreaMm2 / (sheet.widthMm * sheet.heightMm)) * 100),
          }
        }),
        boardsLargerThanEverySheet: cutList.list.oversize.map((piece) => ({
          mark: piece.mark,
          widthMm: piece.widthMm,
          heightMm: piece.heightMm,
        })),
        caveats: cutSequenceCaveats(plans),
      })
    },
  )
}
