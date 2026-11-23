import { formatFixed, type PascalI18n } from '@pascal-app/core'
import { pipeGrade } from './slope'

type Point = readonly [number, number, number]

/** A grade's fall as plan labels and inspectors print it: a percentage to two decimals. */
export function formatPipeGradePercent(grade: number, i18n: PascalI18n): string {
  return i18n._({
    id: 'node.pipeSegment.grade.percent',
    message: '{percent}%',
    values: { percent: formatFixed(Math.abs(grade) * 100, 2, i18n.getLocale()) },
  })
}

export function pipeGradeLabel(start: Point, end: Point, i18n: PascalI18n): string {
  if (Math.hypot(...start.map((v, i) => v - end[i]!)) < 1e-6)
    return i18n._({ id: 'node.pipeSegment.grade.chooseEndpoint', message: 'Choose an endpoint' })
  const grade = pipeGrade(start, end)
  if (grade === null)
    return i18n._({
      id: 'node.pipeSegment.grade.vertical',
      message: 'Vertical · {direction, select, forward {start → end} other {end → start}} (down)',
      values: { direction: start[1] > end[1] ? 'forward' : 'reverse' },
    })
  if (Math.abs(grade) < 1e-6)
    return i18n._({ id: 'node.pipeSegment.grade.level', message: 'Level · no gravity fall' })
  return i18n._({
    id: 'node.pipeSegment.grade.sloped',
    message:
      '{percent} · 1:{ratio} · {direction, select, forward {start → end} other {end → start}} (down)',
    values: {
      percent: formatPipeGradePercent(grade, i18n),
      ratio: formatFixed(1 / Math.abs(grade), 1, i18n.getLocale()),
      direction: grade > 0 ? 'forward' : 'reverse',
    },
  })
}
