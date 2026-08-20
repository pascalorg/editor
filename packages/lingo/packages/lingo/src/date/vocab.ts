// English date vocabulary as data tables (conventions.md): locale packs must
// stay additive — new languages add tables, they never edit grammar code.

export type OffsetUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'
export type RelativeModifier = 'this' | 'next' | 'last' | 'afterNext' | 'beforeLast'
export type PeriodUnit = 'week' | 'month' | 'year'
export type TimeAlias = {
  grain?: 'hour' | 'minute' | 'second'
  hour: number
  minute?: number
  second?: number
}
export type DayTimePhrase = TimeAlias & { dayOffset?: number }

export const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
}

export const UNIT_WORDS: Record<string, OffsetUnit> = {
  second: 'second',
  seconds: 'second',
  sec: 'second',
  secs: 'second',
  s: 'second',
  minute: 'minute',
  minutes: 'minute',
  min: 'minute',
  mins: 'minute',
  m: 'minute',
  hour: 'hour',
  hours: 'hour',
  hr: 'hour',
  hrs: 'hour',
  h: 'hour',
  day: 'day',
  days: 'day',
  d: 'day',
  week: 'week',
  weeks: 'week',
  w: 'week',
  wk: 'week',
  wks: 'week',
  fortnight: 'week',
  fortnights: 'week',
  month: 'month',
  months: 'month',
  mo: 'month',
  mos: 'month',
  year: 'year',
  years: 'year',
  y: 'year',
  yr: 'year',
  yrs: 'year',
}

export const SUBUNIT: Partial<Record<OffsetUnit, OffsetUnit>> = {
  hour: 'minute',
  minute: 'second',
  day: 'hour',
  week: 'day',
}

export const DAY_OFFSETS: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  tmr: 1,
  tmrw: 1,
  yesterday: -1,
  yday: -1,
  "y'day": -1,
  'day after tomorrow': 2,
  overmorrow: 2,
  'day before yesterday': -2,
}

export const DAY_TIME_PHRASES: Record<string, DayTimePhrase> = {
  'this morning': { dayOffset: 0, hour: 9 },
  'this afternoon': { dayOffset: 0, hour: 15 },
  'this evening': { dayOffset: 0, hour: 19 },
  tonight: { dayOffset: 0, hour: 22 },
  tonite: { dayOffset: 0, hour: 22 },
  noon: { dayOffset: 0, hour: 12 },
}

export const TIME_ALIASES: Record<string, TimeAlias> = {
  noon: { hour: 12 },
  midday: { hour: 12 },
  midi: { hour: 12 },
  '12 noon': { hour: 12 },
  midnight: { hour: 0 },
  minuit: { hour: 0 },
  '12 midnight': { hour: 0 },
}

export const RELATIVE_WORDS = {
  anchorWords: ['from', 'after'],
  futurePrefixes: ['in'],
  pastPrefixes: [],
  pastSuffixes: ['ago'],
} as const

export const MODIFIERS: Record<RelativeModifier, readonly string[]> = {
  this: ['this'],
  next: ['next'],
  last: ['last'],
  afterNext: ['after next'],
  beforeLast: ['before last'],
}

export const PERIOD_WORDS: Record<PeriodUnit, readonly string[]> = {
  week: ['week'],
  month: ['month'],
  year: ['year'],
}

// Julian/UCUM civil averages — mo = 30.4375 d, yr = 365.25 d — matching the
// duration KindDef factors in src/units/duration.ts; CIVIL_AVERAGE flags any
// output that leans on these approximations.
export const DURATION_UNIT_SECONDS = {
  yr: 31_557_600,
  mo: 2_629_800,
  wk: 604_800,
  d: 86_400,
  h: 3600,
  min: 60,
  s: 1,
} as const

export const TIME_CORE_PATTERN = String.raw`(?:(?:at|@)\s*)?(?:noon|midnight|\d{1,2}(?::\d{2}(?::\d{2})?)?\s*(?:am|pm)|\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}h\d{2}|\d{1,2}\s+in\s+the\s+(?:morning|afternoon|evening|night))`
// A 2-5 letter trailing word after a valid time is allowed so a trailing zone
// designator ("3pm EST") is caught by date+time detection; the zone itself is
// detected and exposed downstream (plan 030), not just ignored.
export const TIME_PATTERN = String.raw`(?:${TIME_CORE_PATTERN})(?:\s+[a-z]{2,5})?`
