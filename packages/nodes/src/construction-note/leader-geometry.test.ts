import { describe, expect, test } from 'bun:test'
import { ConstructionNoteNode } from '@pascal-app/core'
import {
  constructionNoteCurveControlFromPoint,
  resolveConstructionNoteLeader,
} from './leader-geometry'

describe('construction-note leader geometry', () => {
  test('round-trips the leader-local curve control through a plan point', () => {
    const note = ConstructionNoteNode.parse({
      id: 'construction-note_curve-control',
      type: 'construction-note',
      textPosition: [4, 1],
      curveControl: [0.4, -0.3],
    })
    const anchor = [0, 0] as const
    const leader = resolveConstructionNoteLeader(note, anchor)
    const roundTrip = constructionNoteCurveControlFromPoint(
      anchor,
      leader.elbow,
      leader.curveHandlePoint,
    )

    expect(roundTrip[0]).toBeCloseTo(0.4)
    expect(roundTrip[1]).toBeCloseTo(-0.3)
    const t = note.curveControl[0]
    const inverse = 1 - t
    const pointOnCurve = [
      inverse * inverse * anchor[0] +
        2 * inverse * t * leader.quadraticControlPoint[0] +
        t * t * leader.elbow[0],
      inverse * inverse * anchor[1] +
        2 * inverse * t * leader.quadraticControlPoint[1] +
        t * t * leader.elbow[1],
    ]
    expect(pointOnCurve[0]).toBeCloseTo(leader.curveHandlePoint[0])
    expect(pointOnCurve[1]).toBeCloseTo(leader.curveHandlePoint[1])
  })

  test('keeps the curve control associative when the whole note moves', () => {
    const note = ConstructionNoteNode.parse({
      id: 'construction-note_curve-follow',
      type: 'construction-note',
      textPosition: [4, 1],
      curveControl: [0.5, 0.35],
    })
    const original = resolveConstructionNoteLeader(note, [0, 0])
    const moved = resolveConstructionNoteLeader({ ...note, textPosition: [6, 4] }, [2, 3])

    expect(moved.curveHandlePoint[0] - original.curveHandlePoint[0]).toBeCloseTo(2)
    expect(moved.curveHandlePoint[1] - original.curveHandlePoint[1]).toBeCloseTo(3)
  })

  test('clamps the draggable control to the useful part of the leader chord', () => {
    expect(constructionNoteCurveControlFromPoint([0, 0], [4, 0], [-2, 1])).toEqual([0.1, 1])
    expect(constructionNoteCurveControlFromPoint([0, 0], [4, 0], [8, -1])).toEqual([0.9, -1])
  })
})
