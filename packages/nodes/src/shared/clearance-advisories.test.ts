import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  CabinetNode,
  DoorNode,
  ItemNode,
  StairNode,
  StairSegmentNode,
  ZoneNode,
} from '@pascal-app/core'
import {
  buildClearanceAdvisories,
  type ClearanceProfile,
  DEFAULT_CLEARANCE_PROFILES,
} from './clearance-advisories'

const adaProfile: ClearanceProfile = {
  ...DEFAULT_CLEARANCE_PROFILES.find((profile) => profile.id === 'us-ada-2010-advisory')!,
  enabled: true,
}

const officeProfile: ClearanceProfile = {
  ...DEFAULT_CLEARANCE_PROFILES.find((profile) => profile.id === 'office-residential-advisory')!,
  enabled: true,
}

function nodes(...items: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(items.map((item) => [item.id, item])) as Record<string, AnyNode>
}

describe('clearance advisories', () => {
  test('keeps default clearance profiles optional and quiet', () => {
    const narrowHall = ZoneNode.parse({
      id: 'zone_hall',
      name: 'Hallway',
      polygon: [
        [0, 0],
        [0.8, 0],
        [0.8, 4],
        [0, 4],
      ],
    })

    expect(buildClearanceAdvisories(nodes(narrowHall))).toEqual([])
  })

  test('checks circulation, entry, and door clear widths with ADA provenance', () => {
    const hall = ZoneNode.parse({
      id: 'zone_hall',
      name: 'North Corridor',
      polygon: [
        [0, 0],
        [0.8, 0],
        [0.8, 5],
        [0, 5],
      ],
    })
    const entry = ZoneNode.parse({
      id: 'zone_entry',
      name: 'Entry vestibule',
      polygon: [
        [0, 0],
        [0.86, 0],
        [0.86, 2],
        [0, 2],
      ],
    })
    const door = DoorNode.parse({
      id: 'door_narrow',
      width: 0.78,
    })

    const advisories = buildClearanceAdvisories(nodes(hall, entry, door), {
      profiles: [adaProfile],
    })

    expect(advisories.map((advisory) => advisory.ruleId)).toEqual([
      'ada-door-clear-opening',
      'ada-entry-clear-width',
      'ada-accessible-route-clear-width',
    ])
    expect(advisories.every((advisory) => advisory.source.edition === '2010')).toBe(true)
    expect(advisories.every((advisory) => advisory.severity === 'warning')).toBe(true)
  })

  test('reports missing fixture, cabinet, and appliance clearance evidence', () => {
    const toilet = ItemNode.parse({
      id: 'item_toilet',
      asset: {
        id: 'asset_toilet',
        category: 'plumbing',
        name: 'Accessible Toilet',
        thumbnail: '',
        src: 'asset://toilet.glb',
        tags: ['fixture'],
      },
    })
    const sinkCabinet = CabinetNode.parse({
      id: 'cabinet_sink',
      stack: [{ id: 'sink', type: 'sink' }],
    })
    const applianceCabinet = CabinetNode.parse({
      id: 'cabinet_dishwasher',
      stack: [{ id: 'dishwasher', type: 'dishwasher' }],
    })

    const advisories = buildClearanceAdvisories(nodes(toilet, sinkCabinet, applianceCabinet), {
      profiles: [adaProfile, officeProfile],
    })

    expect(advisories.map((advisory) => advisory.id)).toEqual([
      'clearance:office-residential-advisory:cabinet_dishwasher:office-appliance-front-clearance',
      'clearance:office-residential-advisory:cabinet_dishwasher:office-cabinet-front-clearance',
      'clearance:office-residential-advisory:cabinet_sink:office-cabinet-front-clearance',
      'clearance:us-ada-2010-advisory:cabinet_sink:ada-fixture-clear-floor-depth',
      'clearance:us-ada-2010-advisory:cabinet_sink:ada-fixture-clear-floor-width',
      'clearance:us-ada-2010-advisory:item_toilet:ada-fixture-clear-floor-depth',
      'clearance:us-ada-2010-advisory:item_toilet:ada-fixture-clear-floor-width',
    ])
    expect(advisories.every((advisory) => advisory.measured === null)).toBe(true)
    expect(advisories.every((advisory) => advisory.severity === 'info')).toBe(true)
  })

  test('accepts explicit clearance evidence for surrounding cabinet and fixture checks', () => {
    const toilet = ItemNode.parse({
      id: 'item_toilet',
      asset: {
        id: 'asset_toilet',
        category: 'plumbing',
        name: 'Accessible Toilet',
        thumbnail: '',
        src: 'asset://toilet.glb',
        tags: ['fixture'],
      },
    })
    const cabinet = CabinetNode.parse({
      id: 'cabinet_base',
    })

    const advisories = buildClearanceAdvisories(nodes(toilet, cabinet), {
      profiles: [adaProfile, officeProfile],
      evidence: {
        item_toilet: {
          'ada-fixture-clear-floor-width': 0.9,
          'ada-fixture-clear-floor-depth': 1.0,
        },
        cabinet_base: {
          'office-cabinet-front-clearance': 1.0,
        },
      },
    })

    expect(advisories.map((advisory) => advisory.ruleId)).toEqual(['ada-fixture-clear-floor-depth'])
    expect(advisories[0]?.measured).toBe(1)
    expect(advisories[0]?.severity).toBe('warning')
  })

  test('checks closet depth and stair geometry from modeled dimensions', () => {
    const closet = ZoneNode.parse({
      id: 'zone_closet',
      name: 'Bedroom Closet',
      polygon: [
        [0, 0],
        [0.55, 0],
        [0.55, 2],
        [0, 2],
      ],
    })
    const stair = StairNode.parse({
      id: 'stair_tall_riser',
      width: 0.82,
      totalRise: 2.8,
      stepCount: 12,
    })
    const segment = StairSegmentNode.parse({
      id: 'sseg_shallow_treads',
      width: 1,
      length: 2.2,
      height: 2,
      stepCount: 10,
    })

    const advisories = buildClearanceAdvisories(nodes(closet, stair, segment), {
      profiles: [officeProfile],
    })

    expect(advisories.map((advisory) => advisory.ruleId)).toEqual([
      'office-stair-tread-depth',
      'office-stair-riser-height',
      'office-stair-tread-depth',
      'office-stair-width',
      'office-closet-depth',
    ])
    expect(advisories.every((advisory) => advisory.source.title.includes('Pascal'))).toBe(true)
  })

  test('can include disabled profiles for profile preview UIs', () => {
    const door = DoorNode.parse({
      id: 'door_preview',
      width: 0.78,
    })

    const advisories = buildClearanceAdvisories(nodes(door), {
      includeDisabled: true,
    })

    expect(advisories.map((advisory) => advisory.profileId)).toEqual(['us-ada-2010-advisory'])
  })
})
