import { nodeRegistry } from '@pascal-app/core'

export const REGISTERED_DRAFT_SNAP_EXTENSION = 'pascal:editor/draft-snap'

export function snapRegisteredDraftPoint<TArgs, TResult>(
  kind: string,
  args: TArgs,
  fallback: TResult,
): TResult {
  const snap = nodeRegistry.get(kind)?.extensions?.[REGISTERED_DRAFT_SNAP_EXTENSION]
  return typeof snap === 'function' ? (snap as (args: TArgs) => TResult)(args) : fallback
}
