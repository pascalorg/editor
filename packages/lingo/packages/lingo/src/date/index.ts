import { setDefaultMessages } from '../core/errors'
import { en } from '../messages/en'

// Standalone `lingo/date` ships batteries too: register the English
// copy pack. No-op when the main entry already did.
setDefaultMessages(en)

export type { DurationOptions, DurationResult } from './duration'
export { parseDuration } from './duration'
export type {
  HumanizeDateOptions,
  HumanizeDateRangeOptions,
  HumanizeDurationOptions,
} from './humanize'
export { humanizeDate, humanizeDateRange, humanizeDuration } from './humanize'
export type {
  DateAlternative,
  DateFail,
  DateGrain,
  DateOptions,
  DateRange,
  DateRangeEndpoint,
  DateRangeFail,
  DateResult,
} from './parse'
export { parseDate, parseDateRange } from './parse'
export type {
  SerializedDate,
  SerializedDateAlternative,
  SerializedDateFailure,
  SerializedDateRange,
  SerializedDateRangeEndpoint,
  SerializedDuration,
} from './serialize'
export type { DateZone } from './zone'
