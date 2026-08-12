import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { validationSummary } from '@pascal-app/core/formwork'
import { validateProjectFormwork } from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { NodeIdSchema } from '../schemas'
import { formworkScopeInput, noSuchLevel, sceneNodes, textResult } from './shared'

export const validateFormworkOutput = {
  scope: z.string(),
  elementCount: z.number(),
  errorCount: z.number(),
  warningCount: z.number(),
  findings: z.array(
    z.object({
      invariant: z.string(),
      severity: z.enum(['error', 'warning']),
      elementIds: z.array(NodeIdSchema),
      message: z.string(),
      locus: z
        .object({
          alongM: z.number().optional(),
          elevationM: z.number().optional(),
          segmentIndex: z.number().optional(),
          liftIndex: z.number().optional(),
        })
        .nullable(),
    }),
  ),
  summary: z.array(z.string()),
  shutteredIds: z.array(NodeIdSchema),
  notChecked: z.array(z.object({ invariant: z.string(), needs: z.string() })),
}

export function registerValidateFormwork(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'validate_formwork',
    {
      title: 'Validate formwork',
      description:
        'Whether the formwork in scope can actually be built. This is a different question from what it costs: a bill can total correctly for a shutter nobody can erect, and almost nothing that makes a bill wrong is what makes a shutter unbuildable. It checks cast-order cycles, single-sided pours with no earlier anchor, formed areas that do not sum to the wrapped area, runs with a stretch no panel or filler closes, make-up pieces too narrow to fix, walls no tie in the system reaches, piers and head bands beside an opening that no drilled tie hole falls in, asymmetric tie grids on architectural faces, openings crossing a lift joint, junction angles no hinged unit sweeps, bridged expansion joints, waterstop runs that do not close, drilled tie holes falling inside the width of a waterstop, lift joints off a permitted elevation, pours over the supply limit, designs outside the code envelope, concurrent pours needing more of a part at once than the yard owns, and — where the project has recorded a load chart — gangs heavier than the crane takes at the radius it must reach and gangs whose slings want more height under the hook than there is. Scope it with levelId for a floor, or leave it off for the whole scene. Two things to do with the result rather than summarise it away: errors are things the crew cannot do and warnings are exceptions somebody has to sign, so never merge the two counts; and notChecked lists assertions that could not run here — say so, because a report of failures alone reads as a clean bill of health for everything it never examined, and read each entry’s needs rather than treating the list as permanent, because most of them name an input to record and the crane checks run the moment set_formwork_settings crane has a capacity curve in it. Run this before presenting a takeoff as an order.',
      inputSchema: formworkScopeInput,
      outputSchema: validateFormworkOutput,
    },
    async ({ elementIds, levelId }) => {
      const nodes = sceneNodes(bridge)
      if (levelId !== undefined && nodes[levelId]?.type !== 'level') return noSuchLevel(levelId)

      const { report, shutteredIds } = validateProjectFormwork(nodes, {
        hostIds: elementIds,
        parentId: levelId,
      })

      return textResult({
        scope: levelId ?? (elementIds ? 'the elements named' : 'whole scene'),
        elementCount: report.elementIds.length,
        errorCount: report.errorCount,
        warningCount: report.warningCount,
        findings: report.findings.map((finding) => ({
          invariant: finding.invariant as string,
          severity: finding.severity,
          elementIds: finding.elementIds as string[],
          message: finding.message,
          locus: finding.locus ?? null,
        })),
        // The same sentences the Buildability panel prints and the editor's own AI
        // reads, so a user comparing the three is not left working out whether they
        // are looking at one fault or three.
        summary: validationSummary(report),
        // Which elements had a layout to check at all. Four of the assertions are
        // about a packed run, a pressure solve, a catalog system and a drilled hole
        // grid, and an element nobody has formed has none of them — a pass over it is
        // not a pass.
        shutteredIds: shutteredIds as string[],
        notChecked: report.notChecked.map((entry) => ({
          invariant: entry.invariant as string,
          needs: entry.needs,
        })),
      })
    },
  )
}
