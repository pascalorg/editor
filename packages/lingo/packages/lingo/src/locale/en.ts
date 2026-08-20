import {
  DAY_OFFSETS,
  DAY_TIME_PHRASES,
  DURATION_UNIT_SECONDS,
  MODIFIERS,
  MONTHS,
  PERIOD_WORDS,
  RELATIVE_WORDS,
  SUBUNIT,
  TIME_ALIASES,
  TIME_CORE_PATTERN,
  TIME_PATTERN,
  UNIT_WORDS,
  WEEKDAY_NAMES,
  WEEKDAYS,
} from '../date/vocab'
import { enCore } from './en-core'
import type { LocalePack } from './types'

export const en: LocalePack = {
  ...enCore,
  date: {
    dayOffsets: DAY_OFFSETS,
    dayTimePhrases: DAY_TIME_PHRASES,
    durationUnitSeconds: DURATION_UNIT_SECONDS,
    modifiers: MODIFIERS,
    months: MONTHS,
    periodWords: PERIOD_WORDS,
    relative: RELATIVE_WORDS,
    subunit: SUBUNIT,
    timeAliases: TIME_ALIASES,
    timeCorePattern: TIME_CORE_PATTERN,
    timePattern: TIME_PATTERN,
    unitWords: UNIT_WORDS,
    weekdayNames: WEEKDAY_NAMES,
    weekdays: WEEKDAYS,
  },
}

export default en
