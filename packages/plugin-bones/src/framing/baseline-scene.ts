import { FramingNode } from './schema'

/**
 * The representative scene + config behind `master-baseline.json` — shared
 * by the capture script (scripts/capture-master-baseline.ts) and the
 * byte-equality regression gate (compute.devices.test.ts). Side-effect free:
 * importing this never re-captures anything.
 *
 * Exercises: rect shell + interior partition (receptacle pairs on both
 * faces), door + window, kitchen/bath GFCI zones, bedroom smoke alarm,
 * door-less hallway switch, panel + meter + full wiring, plumbing, hvac.
 */

export function baselineScene(): Record<string, Record<string, unknown>> {
  const wall = (
    id: string,
    start: [number, number],
    end: [number, number],
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    type: 'wall',
    parentId: 'level_1',
    start,
    end,
    thickness: 0.15,
    height: 2.5,
    frontSide: 'exterior',
    children: [],
    ...extra,
  })
  const zone = (
    id: string,
    name: string,
    polygon: [number, number][],
    boundaryWallIds: string[] = [],
  ) => ({ id, type: 'zone', parentId: 'level_1', name, polygon, boundaryWallIds })
  return {
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    w_s: wall('w_s', [0, 0], [12, 0], {
      children: ['door_front', 'win_s'],
    }),
    door_front: {
      id: 'door_front',
      type: 'door',
      parentId: 'w_s',
      position: [3, 0, 0],
      width: 0.9,
      height: 2.1,
    },
    win_s: {
      id: 'win_s',
      type: 'window',
      parentId: 'w_s',
      position: [8.5, 0, 0],
      width: 1.2,
      height: 1.2,
      sillHeight: 0.9,
    },
    w_e: wall('w_e', [12, 0], [12, 8]),
    w_n: wall('w_n', [12, 8], [0, 8]),
    w_w: wall('w_w', [0, 8], [0, 0]),
    w_mid: wall('w_mid', [6, 0], [6, 8], {
      thickness: 0.114,
      frontSide: 'interior',
      backSide: 'interior',
      children: ['door_mid'],
    }),
    door_mid: {
      id: 'door_mid',
      type: 'door',
      parentId: 'w_mid',
      position: [4, 0, 0],
      width: 0.85,
      height: 2.1,
    },
    slab_1: {
      id: 'slab_1',
      type: 'slab',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [12, 0],
        [12, 8],
        [0, 8],
      ],
      holes: [],
    },
    z_kitchen: zone('z_kitchen', 'Kitchen', [
      [6, 0],
      [12, 0],
      [12, 4],
      [6, 4],
    ]),
    z_bath: zone('z_bath', 'Bathroom', [
      [6, 4],
      [12, 4],
      [12, 8],
      [6, 8],
    ]),
    z_bed: zone('z_bed', 'Bedroom', [
      [0, 4],
      [6, 4],
      [6, 8],
      [0, 8],
    ]),
    z_hall: zone('z_hall', 'Hallway', [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ]),
    toilet_1: {
      id: 'toilet_1',
      type: 'item',
      parentId: 'level_1',
      name: 'Toilet',
      position: [11, 0, 6],
      rotation: [0, 0, 0],
    },
  }
}

export function baselineConfig(jurisdiction: string): FramingNode {
  return FramingNode.parse({
    id: 'bonesframing_baseline',
    parentId: 'level_1',
    jurisdiction,
    detail: '400',
    studSpacingIn: 16,
    showWalls: true,
    showFloor: true,
    showRoof: true,
    showFoundation: true,
    showElectrical: true,
    showPlumbing: true,
    showHvac: true,
  })
}
