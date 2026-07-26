import { defineHook } from 'workflow'
import { z } from 'zod'

/**
 * Pauses `planConstructionPackage` until the user answers the scene-wide
 * formwork clarifying question. Costs zero compute while waiting — the
 * workflow can resume minutes or days later.
 */
export const constructionQuestionHook = defineHook({
  schema: z.object({ answer: z.string().min(1) }),
})
