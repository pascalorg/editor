/**
 * A type withheld from what verify_scene reports while its check keeps emitting it.
 *
 * `usage_wall_object_protrudes` is on probation: most of its findings were towel rails and robe
 * fit-outs, which stand out from the wall by design; it comes back after an improvement, or is
 * removed.
 */
export const SCENE_CHECK_PROBATION: Readonly<Record<string, string>> = {
  usage_wall_object_protrudes:
    'most findings were towel rails and robe fit-outs, which stand out from the wall by design',
}

/** The issues whose type is not on probation, in the order they came. */
export function withoutProbation<T extends { type: string }>(issues: T[]): T[] {
  return issues.filter((issue) => !Object.hasOwn(SCENE_CHECK_PROBATION, issue.type))
}
