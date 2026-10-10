import { levelTarget } from './levels'
import { NodeId } from './node-id'

/** What a plan costs, as the tool says it; a host that charges otherwise replaces it (`vectorizePlanPricing`). */
export const VECTORIZE_PRICING = "about $0.37 and 50 s a plan, on the account's credits"

export const vectorizePlanTool = {
  name: 'vectorize_plan',
  title: 'Vectorize a raster plan',
  description: `Turn a raster plan reference (PNG, JPEG, WebP) into an SVG plan, so its furniture, fixtures, cars, door swings and labels can be read: a raster import traces its walls only, and furnish_from_plan finds no pieces on it. Paid, by a model on the host (the hosted Pascal: QuiverAI, ${VECTORIZE_PRICING}), and the plan image is sent to that service. Call it once per plan, only when you need what it draws beyond its walls; a plan already in SVG is refused before any spend. The plan keeps its place and calibration; its guide shows the SVG, and the original image is kept.`,
  input: {
    guideId: NodeId.optional().describe("The plan reference: by default the level's own."),
    ...levelTarget,
  },
}
