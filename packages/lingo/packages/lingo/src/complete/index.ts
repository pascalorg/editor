/**
 * Ranked completions — autocomplete over all plausible canonical readings.
 *
 * Import from `@pascal-app/lingo/complete` (not the main entry) to keep the
 * full bundle budget untouched. DOM fields can inject `completions` via
 * `LingoInputOptions.complete` without bundling this entry into `./dom`.
 */
import { createRegistry } from '../core/registry'
import { registerTemperatureVocabs } from '../fuzzy/temperature'
import { allKinds } from '../units/index'
import { completions as completionsImpl } from './completions'

export type { CompletionsOptions } from './completions'
export { completions as completionsCore } from './completions'
export type {
  Completion,
  CompletionDateParser,
  CompletionDateResult,
  CompletionResult,
  CompletionSource,
} from './types'

const defaultRegistry = createRegistry(allKinds)
registerTemperatureVocabs(defaultRegistry)

/**
 * Ranked autocomplete over quantity/range/conversion readings. Bound to
 * `defaultRegistry`; pass `{ registry }` for an isolated instance.
 * @example
 * ```ts
 * import { completions } from '@pascal-app/lingo/complete'
 * completions('2 f', { kind: 'length' }).map((c) => c.text)
 * ```
 */
export function completions(
  input: string,
  opts?: Parameters<typeof completionsImpl>[1],
): ReturnType<typeof completionsImpl> {
  return completionsImpl(input, { registry: defaultRegistry, ...opts })
}
