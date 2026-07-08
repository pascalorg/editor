import { describe, expect, test } from 'bun:test'
import {
  buildEnabledWallFaceBandPatch,
  getWallFaceBandConfig,
  WALL_FACE_BAND_DEFAULT,
  WallFaceBandConfig,
  type WallNode,
} from './wall'

describe('wall face bands', () => {
  test('defaults lower and middle bands to the requested heights', () => {
    expect(WALL_FACE_BAND_DEFAULT.lowerHeight).toBe(0.84)
    expect(WALL_FACE_BAND_DEFAULT.middleHeight).toBe(0.61)

    expect(WallFaceBandConfig.parse({ enabled: true })).toEqual({
      enabled: true,
      lowerHeight: 0.84,
      middleHeight: 0.61,
    })

    expect(
      getWallFaceBandConfig({
        height: 2.5,
        faceBands: { enabled: true, lowerHeight: 0.84, middleHeight: 0.61 },
      }),
    ).toMatchObject({
      lowerTop: 0.84,
      middleTop: 1.45,
    })
  })

  test('enabling bands seeds band slots from the current whole-wall face slots', () => {
    const patch = buildEnabledWallFaceBandPatch({
      faceBands: { enabled: false, lowerHeight: 0.2, middleHeight: 0.3 },
      slots: {
        interior: 'library:interior-finish',
        exterior: 'scene:exterior-finish',
        lowerInterior: 'library:stale-lower',
        middleExterior: 'library:stale-middle',
      },
    } as Pick<WallNode, 'faceBands' | 'slots'>)

    expect(patch.faceBands).toEqual({
      enabled: true,
      lowerHeight: 0.84,
      middleHeight: 0.61,
    })
    expect(patch.slots).toMatchObject({
      interior: 'library:interior-finish',
      exterior: 'scene:exterior-finish',
      lowerInterior: 'library:interior-finish',
      middleInterior: 'library:interior-finish',
      upperInterior: 'library:interior-finish',
      lowerExterior: 'scene:exterior-finish',
      middleExterior: 'scene:exterior-finish',
      upperExterior: 'scene:exterior-finish',
    })
  })

  test('enabling bands clears stale band slots when a side has no explicit slot', () => {
    const patch = buildEnabledWallFaceBandPatch({
      slots: {
        lowerInterior: 'library:stale-lower',
        middleInterior: 'library:stale-middle',
        upperExterior: 'library:stale-upper',
      },
    } as Pick<WallNode, 'faceBands' | 'slots'>)

    expect(patch.slots).toEqual({})
  })
})
