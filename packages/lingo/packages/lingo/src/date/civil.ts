// Pure civil-calendar math: Date in, Date out, no parser state. Day-and-up
// arithmetic must stay DST-safe — add calendar days and keep wall-clock time,
// never add fixed milliseconds (plan 005).

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function withTime(date: Date, hour: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0)
}

export function addCalendar(
  date: Date,
  delta: Partial<
    Record<'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds', number>
  >,
): Date {
  const totalMonths = (delta.years ?? 0) * 12 + (delta.months ?? 0)
  let out = date
  if (totalMonths === 0) {
    out = new Date(out.getTime())
  } else {
    const monthIndex = out.getMonth() + totalMonths
    const year = out.getFullYear() + Math.floor(monthIndex / 12)
    const month = ((monthIndex % 12) + 12) % 12
    const day = Math.min(out.getDate(), daysInMonth(year, month))
    out = new Date(
      year,
      month,
      day,
      out.getHours(),
      out.getMinutes(),
      out.getSeconds(),
      out.getMilliseconds(),
    )
  }
  const days = (delta.weeks ?? 0) * 7 + (delta.days ?? 0)
  if (days !== 0) {
    out = new Date(
      out.getFullYear(),
      out.getMonth(),
      out.getDate() + days,
      out.getHours(),
      out.getMinutes(),
      out.getSeconds(),
      out.getMilliseconds(),
    )
  }
  const ms = ((delta.hours ?? 0) * 3600 + (delta.minutes ?? 0) * 60 + (delta.seconds ?? 0)) * 1000
  if (ms !== 0) {
    out = new Date(out.getTime() + ms)
  }
  return out
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

export function startOfWeek(date: Date, weekStart: number): Date {
  const today = startOfDay(date)
  return addCalendar(today, { days: -((today.getDay() - weekStart + 7) % 7) })
}

export function dateInWeek(weekStartDate: Date, weekday: number, weekStart: number): Date {
  return addCalendar(weekStartDate, { days: (weekday - weekStart + 7) % 7 })
}

export function forwardDiff(from: number, to: number): number {
  return (to - from + 7) % 7
}

export function backwardDiff(from: number, to: number): number {
  return (from - to + 7) % 7
}

export function closestWeekdayDiff(from: number, to: number): number {
  const f = forwardDiff(from, to)
  const b = backwardDiff(from, to)
  return b < f ? -b : f
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function validDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date | null {
  if (
    month < 0 ||
    month > 11 ||
    day < 1 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null
  }
  const date = new Date(year, month, day, hour, minute, second, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null
  }
  return date
}

export function parseYear(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return
  }
  const clean = raw.startsWith("'") ? raw.slice(1) : raw
  const value = Number(clean)
  if (clean.length === 2) {
    return value <= 69 ? 2000 + value : 1900 + value
  }
  return value
}
