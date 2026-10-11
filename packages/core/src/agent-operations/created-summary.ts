/** Ids a result lists in full; past this the model gets counts, which is what it uses. */
const MAX_LISTED_IDS = 40

/**
 * What an operation created, for its result: a count per node type, and the ids up to a cap.
 * Victor run 8: create_reference_elements returned 2,773 ids the model never used; written into
 * the cache once, they were read back on every call after.
 */
export function createdSummary(ids: readonly string[]) {
  const created: Record<string, number> = {}
  for (const id of ids) {
    const type = id.replace(/_[^_]*$/, '')
    created[type] = (created[type] ?? 0) + 1
  }
  return {
    createdIds: ids.slice(0, MAX_LISTED_IDS),
    created,
    ...(ids.length > MAX_LISTED_IDS ? { createdIdsOmitted: ids.length - MAX_LISTED_IDS } : {}),
  }
}
