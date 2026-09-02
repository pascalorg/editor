import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { describe, expect, test } from 'bun:test'
import { doorSchedule, formatScheduleLength, roomSchedule, windowSchedule } from './schedules'

function fixture(): Record<string, AnyNode> {
  const nodes: Record<string, AnyNode> = {}
  const node = (value: Record<string, unknown>) => {
    nodes[value.id as string] = {
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      ...value,
    } as unknown as AnyNode
  }

  node({ id: 'level_1', type: 'level', level: 0, children: ['w_n', 'w_s', 'zone_1'] })
  node({
    id: 'w_n',
    type: 'wall',
    parentId: 'level_1',
    start: [0, 0],
    end: [6, 0],
    thickness: 0.15,
    frontSide: 'exterior',
    backSide: 'interior',
    children: ['d_1', 'win_1'],
  })
  node({
    id: 'w_s',
    type: 'wall',
    parentId: 'level_1',
    start: [6, 4],
    end: [0, 4],
    thickness: 0.1,
    frontSide: 'interior',
    backSide: 'interior',
    children: ['d_2'],
  })
  node({
    id: 'd_1',
    type: 'door',
    parentId: 'w_n',
    wallId: 'w_n',
    doorType: 'hinged',
    openingKind: 'door',
    width: 0.9144,
    height: 2.0574,
    frameThickness: 0.05,
    frameDepth: 0.07,
    threshold: true,
    doorCloser: false,
    panicBar: false,
    roughOpeningWidth: 0.9652,
    roughOpeningHeight: 2.0828,
    position: [1, 1.05, 0],
  })
  node({
    id: 'd_2',
    type: 'door',
    parentId: 'w_s',
    wallId: 'w_s',
    doorType: 'pocket',
    openingKind: 'door',
    width: 0.762,
    height: 2.0574,
    frameThickness: 0.05,
    frameDepth: 0.07,
    threshold: false,
    doorCloser: false,
    panicBar: false,
    position: [2, 1.05, 0],
  })
  node({
    id: 'win_1',
    type: 'window',
    parentId: 'w_n',
    wallId: 'w_n',
    windowType: 'casement',
    openingKind: 'window',
    width: 1.2192,
    height: 1.2192,
    position: [4, 1.1, 0],
  })
  node({
    id: 'zone_1',
    type: 'zone',
    parentId: 'level_1',
    spaceRole: 'room',
    name: 'Living',
    roomNumber: '101',
    floorFinish: 'Oak',
    wallFinish: '',
    ceilingFinish: '',
    ceilingHeight: 2.44,
    occupancy: 'Residential',
    enclosureStatus: 'unknown',
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
  })
  return nodes
}

describe('formatScheduleLength', () => {
  test('imperial to sixteenths', () => {
    expect(formatScheduleLength(0.9144, 'imperial')).toBe(`3'-0"`)
    expect(formatScheduleLength(2.0574, 'imperial')).toBe(`6'-9"`)
    expect(formatScheduleLength(0.1524, 'imperial')).toBe(`6"`)
  })
  test('metric is millimetres', () => {
    expect(formatScheduleLength(0.9144, 'metric')).toBe('914')
  })
})

describe('doorSchedule', () => {
  test('rows carry mark, type, size, rough opening, frame, hardware, remarks', () => {
    const { rows, issues } = doorSchedule(fixture(), 'level_1' as AnyNodeId)
    expect(issues).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      mark: 'D101',
      type: 'Hinged',
      sizeText: `3'-0" x 6'-9"`,
      roughOpening: `3'-2" x 6'-10"`,
      frame: `1 15/16" / 2 3/4"`,
      hardware: 'Threshold',
      count: 1,
      remarks: 'Exterior',
    })
    expect(rows[1]).toMatchObject({
      mark: 'D102',
      type: 'Pocket',
      roughOpening: null,
      remarks: 'VERIFY R.O.',
    })
  })

  test('grouping collapses identical openings and counts them', () => {
    const nodes = fixture()
    // A second identical exterior door on the same wall.
    ;(nodes.w_n as unknown as { children: string[] }).children = ['d_1', 'd_1b', 'win_1']
    nodes.d_1b = {
      ...(nodes.d_1 as unknown as Record<string, unknown>),
      id: 'd_1b',
      position: [3, 1.05, 0],
    } as unknown as AnyNode
    const { rows } = doorSchedule(nodes, 'level_1' as AnyNodeId, { group: true })
    const hinged = rows.find((row) => row.type === 'Hinged')
    expect(hinged?.count).toBe(2)
  })
})

describe('windowSchedule', () => {
  test('windows number from W101', () => {
    const { rows } = windowSchedule(fixture(), 'level_1' as AnyNodeId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      mark: 'W101',
      type: 'Casement',
      sizeText: `4'-0" x 4'-0"`,
      hardware: null,
    })
  })
})

describe('roomSchedule', () => {
  test('one row per room zone with area and floor finish', () => {
    const { rows, issues } = roomSchedule(fixture(), 'level_1' as AnyNodeId)
    expect(issues).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.number).toBe('101')
    expect(rows[0]?.name).toBe('Living')
    expect(rows[0]?.floorFinish).toBe('Oak')
    expect(rows[0]?.area).toBeCloseTo(24, 6)
    expect(rows[0]?.areaText).toBe('258.3 ft²')
  })

  test('a room without a number is reported', () => {
    const nodes = fixture()
    ;(nodes.zone_1 as unknown as { roomNumber: string }).roomNumber = ''
    const { issues } = roomSchedule(nodes, 'level_1' as AnyNodeId)
    expect(issues).toEqual(['Room Living has no room number'])
  })
})
