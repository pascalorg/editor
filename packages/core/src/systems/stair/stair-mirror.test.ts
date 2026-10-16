import { describe, expect, test } from 'bun:test'
import { StairNode, StairSegmentNode } from '../../schema'
import { getStairMirrorUpdates, hasStairMirrorUpdates } from './stair-mirror'

describe('getStairMirrorUpdates', () => {
  test('mirrors Cut Back / switchback stair turns in place and inverts railing', () => {
    const flight1 = StairSegmentNode.parse({
      id: 'sseg_flight1',
      segmentType: 'stair',
      attachmentSide: 'front',
      length: 2.5,
      height: 1.25,
      stepCount: 8,
    })
    const landing = StairSegmentNode.parse({
      id: 'sseg_landing',
      segmentType: 'landing',
      attachmentSide: 'front',
      length: 1.0,
      width: 2.0,
    })
    const flight2 = StairSegmentNode.parse({
      id: 'sseg_flight2',
      segmentType: 'stair',
      attachmentSide: 'left',
      length: 2.5,
      height: 1.25,
      stepCount: 8,
    })
    const stair = StairNode.parse({
      id: 'stair_cut_back',
      stairType: 'straight',
      railingMode: 'left',
      children: [flight1.id, landing.id, flight2.id],
    })
    const nodes = {
      [stair.id]: stair,
      [flight1.id]: flight1,
      [landing.id]: landing,
      [flight2.id]: flight2,
    }

    const mirror1 = getStairMirrorUpdates(stair, nodes)
    expect(mirror1.stairUpdates).toEqual({ railingMode: 'right' })
    expect(mirror1.segmentUpdates).toHaveLength(1)
    expect(mirror1.segmentUpdates[0]).toEqual({
      id: flight2.id,
      updates: { attachmentSide: 'right' },
    })

    // Double mirror roundtrip restores original handedness
    const mirroredStair = { ...stair, ...mirror1.stairUpdates }
    const mirroredFlight2 = { ...flight2, ...mirror1.segmentUpdates[0]!.updates }
    const mirroredNodes = {
      ...nodes,
      [mirroredStair.id]: mirroredStair,
      [mirroredFlight2.id]: mirroredFlight2,
    }
    const mirror2 = getStairMirrorUpdates(mirroredStair, mirroredNodes)
    expect(mirror2.stairUpdates).toEqual({ railingMode: 'left' })
    expect(mirror2.segmentUpdates[0]).toEqual({
      id: flight2.id,
      updates: { attachmentSide: 'left' },
    })
  })

  test('mirrors multi-turn stair with left, front, and right segments', () => {
    const seg1 = StairSegmentNode.parse({ id: 'sseg_1', attachmentSide: 'left' })
    const seg2 = StairSegmentNode.parse({ id: 'sseg_2', attachmentSide: 'front' })
    const seg3 = StairSegmentNode.parse({ id: 'sseg_3', attachmentSide: 'right' })
    const stair = StairNode.parse({
      id: 'stair_multi',
      stairType: 'straight',
      railingMode: 'both',
      children: [seg1.id, seg2.id, seg3.id],
    })
    const nodes = {
      [stair.id]: stair,
      [seg1.id]: seg1,
      [seg2.id]: seg2,
      [seg3.id]: seg3,
    }

    const { stairUpdates, segmentUpdates } = getStairMirrorUpdates(stair, nodes)
    // Symmetric railing remains untouched
    expect(stairUpdates.railingMode).toBeUndefined()
    expect(segmentUpdates).toHaveLength(2)
    expect(segmentUpdates).toEqual([
      { id: seg1.id, updates: { attachmentSide: 'right' } },
      { id: seg3.id, updates: { attachmentSide: 'left' } },
    ])
  })

  test('mirrors curved stair sweep angle and railing', () => {
    const curved = StairNode.parse({
      id: 'stair_curved',
      stairType: 'curved',
      sweepAngle: Math.PI / 2,
      railingMode: 'right',
    })
    const result = getStairMirrorUpdates(curved, { [curved.id]: curved })

    expect(result.stairUpdates).toEqual({
      railingMode: 'left',
      sweepAngle: -Math.PI / 2,
    })
    expect(result.segmentUpdates).toHaveLength(0)
  })

  test('mirrors spiral stair with default sweep angle and railing', () => {
    const spiral = StairNode.parse({
      id: 'stair_spiral',
      stairType: 'spiral',
      sweepAngle: Math.PI * 2,
      railingMode: 'left',
    })
    const result = getStairMirrorUpdates(spiral, { [spiral.id]: spiral })

    expect(result.stairUpdates).toEqual({
      railingMode: 'right',
      sweepAngle: -Math.PI * 2,
    })
  })

  test('single straight flight with symmetric railing produces no updates', () => {
    const flight = StairSegmentNode.parse({
      id: 'sseg_single',
      attachmentSide: 'front',
    })
    const stair = StairNode.parse({
      id: 'stair_straight',
      stairType: 'straight',
      railingMode: 'both',
      children: [flight.id],
    })
    const result = getStairMirrorUpdates(stair, { [stair.id]: stair, [flight.id]: flight })

    expect(result.stairUpdates).toEqual({})
    expect(result.segmentUpdates).toHaveLength(0)
  })

  test('single straight flight with asymmetric railing flips railing', () => {
    const flight = StairSegmentNode.parse({
      id: 'sseg_single',
      attachmentSide: 'front',
    })
    const stair = StairNode.parse({
      id: 'stair_straight',
      stairType: 'straight',
      railingMode: 'left',
      children: [flight.id],
    })
    const result = getStairMirrorUpdates(stair, { [stair.id]: stair, [flight.id]: flight })

    expect(result.stairUpdates).toEqual({ railingMode: 'right' })
    expect(result.segmentUpdates).toHaveLength(0)
  })

  test('mirrors winder turns and keeps the other winder settings', () => {
    const entry = StairSegmentNode.parse({ id: 'sseg_entry', attachmentSide: 'front' })
    const winder = StairSegmentNode.parse({
      id: 'sseg_winder',
      attachmentSide: 'front',
      winder: { turn: 'left', innerGap: 0.1, walkingLineOffset: 0.4, division: 'equal-angle' },
    })
    const exit = StairSegmentNode.parse({ id: 'sseg_exit', attachmentSide: 'front' })
    const stair = StairNode.parse({
      id: 'stair_winder',
      stairType: 'straight',
      children: [entry.id, winder.id, exit.id],
    })
    const nodes = { [stair.id]: stair, [entry.id]: entry, [winder.id]: winder, [exit.id]: exit }

    const result = getStairMirrorUpdates(stair, nodes)
    expect(result.stairUpdates).toEqual({})
    expect(result.segmentUpdates).toEqual([
      {
        id: winder.id,
        updates: {
          winder: { turn: 'right', innerGap: 0.1, walkingLineOffset: 0.4, division: 'equal-angle' },
        },
      },
    ])

    const mirroredWinder = { ...winder, ...result.segmentUpdates[0]!.updates }
    const back = getStairMirrorUpdates(stair, { ...nodes, [winder.id]: mirroredWinder })
    expect(back.segmentUpdates[0]!.updates.winder?.turn).toBe('left')
  })

  test('mirrors a one-sided handrail and keeps its other settings', () => {
    const stair = StairNode.parse({
      id: 'stair_handrail',
      stairType: 'straight',
      railingMode: 'both',
      handrail: { mode: 'right', height: 0.95, top: { extension: 0.3 } },
    })
    const result = getStairMirrorUpdates(stair, { [stair.id]: stair })

    expect(result.stairUpdates).toEqual({ handrail: { ...stair.handrail!, mode: 'left' } })
  })

  test('leaves a two-sided handrail untouched and reports nothing to mirror', () => {
    const stair = StairNode.parse({
      id: 'stair_handrail_both',
      stairType: 'straight',
      railingMode: 'none',
      handrail: { mode: 'both' },
    })
    const result = getStairMirrorUpdates(stair, { [stair.id]: stair })

    expect(result).toEqual({ stairUpdates: {}, segmentUpdates: [] })
    expect(hasStairMirrorUpdates(result)).toBe(false)
  })
})
