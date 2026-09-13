import { describe, expect, test } from 'bun:test'
import {
  adaptSchedule,
  buildOpeningSchedule,
  feetInches,
  resolveMarks,
  type ScheduleNodes,
} from './schedule'

function scene(): ScheduleNodes {
  return {
    level_0: { id: 'level_0', type: 'level', level: 0, children: ['wall_a', 'wall_b'] },
    level_1: { id: 'level_1', type: 'level', level: 1, children: ['wall_c'] },
    wall_a: { id: 'wall_a', type: 'wall', children: ['door_1', 'win_1'] },
    wall_b: { id: 'wall_b', type: 'wall', children: ['door_2'] },
    wall_c: { id: 'wall_c', type: 'wall', children: ['door_3'] },
    door_1: { id: 'door_1', type: 'door', width: 0.9, height: 2.1 },
    door_2: { id: 'door_2', type: 'door', width: 0.8, height: 2.1, mark: 'D-ENTRY' },
    door_3: { id: 'door_3', type: 'door', width: 0.9, height: 2.1 },
    win_1: { id: 'win_1', type: 'window', width: 1.2, height: 1.5 },
  }
}

describe('mark fallback numbering', () => {
  test('level 0 numbers doors 101, 102 …', () => {
    const marks = resolveMarks(scene(), 'level_0', 'door')
    expect(marks.get('door_1')).toBe('101')
  })

  test('an authored mark wins but does not shift the sequence', () => {
    const marks = resolveMarks(scene(), 'level_0', 'door')
    expect(marks.get('door_2')).toBe('D-ENTRY')
    // door_2 still occupies position 2, so a third door would be 103.
    const withThird = scene()
    withThird.wall_b = { id: 'wall_b', type: 'wall', children: ['door_2', 'door_4'] }
    withThird.door_4 = { id: 'door_4', type: 'door', width: 0.9, height: 2.1 }
    expect(resolveMarks(withThird, 'level_0', 'door').get('door_4')).toBe('103')
  })

  test('level 1 starts at 201', () => {
    expect(resolveMarks(scene(), 'level_1', 'door').get('door_3')).toBe('201')
  })

  test('doors and windows are separate sequences', () => {
    expect(resolveMarks(scene(), 'level_0', 'window').get('win_1')).toBe('101')
  })

  test('numbering is stable across repeated calls', () => {
    const a = [...resolveMarks(scene(), 'level_0', 'door').entries()]
    const b = [...resolveMarks(scene(), 'level_0', 'door').entries()]
    expect(a).toEqual(b)
  })
})

describe('schedule table', () => {
  test('one row per opening, sorted by mark', () => {
    const table = buildOpeningSchedule(scene(), 'level_0', 'door')
    expect(table.title).toBe('DOOR SCHEDULE')
    expect(table.rows.map((r) => r.mark)).toEqual(['101', 'D-ENTRY'])
  })

  test('hidden openings are left out', () => {
    const nodes = scene()
    nodes.door_1 = { ...nodes.door_1!, visible: false }
    expect(buildOpeningSchedule(nodes, 'level_0', 'door').rows).toHaveLength(1)
  })

  test('dimensions print in feet and inches', () => {
    expect(feetInches(0.9144)).toBe("3'-0\"")
    expect(feetInches(2.1336)).toBe("7'-0\"")
  })
})

describe('host schedules', () => {
  test('a registry-contributed schedule is adapted without losing marks or issues', () => {
    const adapted = adaptSchedule({
      title: 'DOOR SCHEDULE',
      columns: [
        { key: 'mark', label: 'MARK', weight: 0.8 },
        { key: 'type', label: 'TYPE' },
      ],
      rows: [{ cells: { mark: '101', type: 'Hinged' } }],
      issues: ['Duplicate door mark D1 (2 instances)'],
    })
    expect(adapted.rows).toEqual([{ mark: '101', type: 'Hinged' }])
    expect(adapted.columns[1]?.weight).toBe(1)
    expect(adapted.issues).toHaveLength(1)
  })
})
