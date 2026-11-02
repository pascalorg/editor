import { describe, expect, test } from 'bun:test'
import { dressingBrief, salonBrief } from './__fixtures__/room-dressing-cases'
import { briefRevisions } from './brief-findings'
import { announcedDressing, dressingRevision } from './room-dressing'

describe('the dressing announced for each room, and revised within the turn', () => {
  const first = announcedDressing(salonBrief(['wainscot', 'chairRail', 'crown']))
  test('is kept by the room’s folded name, and only for rooms that announce one', () => {
    expect(first).toEqual({ salon: ['wainscot', 'chairRail', 'crown'] })
    expect(announcedDressing(salonBrief())).toEqual({})
  })

  test.each([
    ['fewer kinds', salonBrief(['wainscot']), true],
    ['the same', salonBrief(['wainscot', 'chairRail', 'crown']), false],
    ['more', salonBrief(['wainscot', 'chairRail', 'crown', 'accent']), false],
    ['a different set of the same size', salonBrief(['wainscot', 'chairRail', 'accent']), true],
    ['none stated for the room', salonBrief(), true],
    ['the room taken out of the brief', dressingBrief(), false],
  ])('%s', (_, latest, plainer) => {
    expect(dressingRevision(first, latest) !== null).toBe(plainer)
  })

  test('a first brief that announced none has nothing to revise, and the revision joins the others', () => {
    expect(dressingRevision(undefined, salonBrief(['wainscot']))).toBeNull()
    expect(
      briefRevisions({
        designBrief: salonBrief(['wainscot']),
        firstDressing: first,
      }).map((finding) => finding.code),
    ).toEqual(['room_dressing_revised_simpler'])
  })
})
