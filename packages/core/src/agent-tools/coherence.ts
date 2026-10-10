import { z } from 'zod'

/**
 * `dispute_coherence_item`'s contract: the maker says why an item of verify_scene's coherence
 * checklist stands, and shows what it looked at.
 */
export const disputeCoherenceItemTool = {
  name: 'dispute_coherence_item',
  title: 'Dispute a coherence item',
  description:
    "Say why an item of verify_scene's coherence checklist stands, and what shows it. Look at the item first (its `check` view, its numbers), then give the item's `id`, your `reason` (what you meant to build) and your `evidence`: a measurement you took, or a view you looked at, with what it showed. The item leaves the open list and the checklist lists it as disputed, with your reason, until a write changes its measurement: then it is open again. It is not a way to skip an item; whoever audits the build reads the reasons, and a disputed item is still measured. Refused: item_not_found (the answer lists the items there are), reason_required, evidence_required.",
  input: {
    itemId: z
      .string()
      .min(1)
      .describe("The item's id, from verify_scene's coherence.checklist or a write's coherence."),
    reason: z.string().min(1).describe('Why it stands: what you meant to build, in a sentence.'),
    evidence: z
      .object({
        kind: z
          .enum(['measurement', 'view'])
          .describe('A measurement you took, or a view_scene you looked at.'),
        detail: z
          .string()
          .min(1)
          .describe('What it showed: the numbers you read, or what the view makes plain.'),
      })
      .describe('What shows that it stands.'),
  },
}
