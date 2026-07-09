import { describe, expect, test } from 'bun:test'
import {
  buildEnabledWallFaceBandPatch,
  buildWallFaceBandCountPatch,
  getWallFaceBandConfig,
  WALL_FACE_BAND_DEFAULT,
  WallFaceBandConfig,
  type WallNode,
} from './wall'

describe('wall face bands', () => {
  test('defaults to one band while preserving legacy enabled scenes as three bands', () => {
    expect(WALL_FACE_BAND_DEFAULT.count).toBe(1)
    expect(WALL_FACE_BAND_DEFAULT.lowerHeight).toBe(0.84)
    expect(WALL_FACE_BAND_DEFAULT.middleHeight).toBe(0.61)
    expect(WALL_FACE_BAND_DEFAULT.upperHeight).toBe(0.61)

    expect(WallFaceBandConfig.parse({})).toEqual({
      enabled: false,
      count: 1,
      lowerHeight: 0.84,
      middleHeight: 0.61,
      upperHeight: 0.61,
    })

    expect(WallFaceBandConfig.parse({ enabled: true })).toEqual({
      enabled: true,
      count: 3,
      lowerHeight: 0.84,
      middleHeight: 0.61,
      upperHeight: 0.61,
    })

    expect(
      getWallFaceBandConfig({
        height: 2.5,
        faceBands: {
          enabled: true,
          count: 3,
          lowerHeight: 0.84,
          middleHeight: 0.61,
          upperHeight: 0.61,
        },
      }),
    ).toMatchObject({
      count: 3,
      lowerTop: 0.84,
      middleTop: 1.45,
    })
  })

  test('four bands adds an upper split below the final top band', () => {
    expect(
      getWallFaceBandConfig({
        height: 2.5,
        faceBands: {
          enabled: true,
          count: 4,
          lowerHeight: 0.5,
          middleHeight: 0.6,
          upperHeight: 0.7,
        },
      }),
    ).toMatchObject({
      count: 4,
      lowerTop: 0.5,
      middleTop: 1.1,
      upperTop: 1.8,
    })
  })

  test('enabling bands seeds band slots from the current whole-wall face slots', () => {
    const patch = buildEnabledWallFaceBandPatch({
      faceBands: {
        enabled: false,
        count: 1,
        lowerHeight: 0.2,
        middleHeight: 0.3,
        upperHeight: 0.61,
      },
      slots: {
        interior: 'library:interior-finish',
        exterior: 'scene:exterior-finish',
        lowerInterior: 'library:stale-lower',
        middleExterior: 'library:stale-middle',
      },
    } as Pick<WallNode, 'faceBands' | 'slots'>)

    expect(patch.faceBands).toEqual({
      enabled: true,
      count: 2,
      lowerHeight: 0.2,
      middleHeight: 0.3,
      upperHeight: 0.61,
    })
    expect(patch.slots).toMatchObject({
      interior: 'library:interior-finish',
      exterior: 'scene:exterior-finish',
      lowerInterior: 'library:interior-finish',
      upperInterior: 'library:interior-finish',
      lowerExterior: 'scene:exterior-finish',
      upperExterior: 'scene:exterior-finish',
    })
    expect(patch.slots?.middleInterior).toBeUndefined()
    expect(patch.slots?.middleExterior).toBeUndefined()
  })

  test('band count patch enables only the active slots', () => {
    const patch = buildWallFaceBandCountPatch(
      {
        faceBands: {
          enabled: true,
          count: 4,
          lowerHeight: 0.2,
          middleHeight: 0.3,
          upperHeight: 0.61,
        },
        slots: {
          interior: 'library:interior-finish',
          exterior: 'scene:exterior-finish',
          topInterior: 'library:stale-top',
        },
      } as Pick<WallNode, 'faceBands' | 'slots'>,
      3,
    )

    expect(patch.faceBands).toMatchObject({ enabled: true, count: 3 })
    expect(patch.slots).toMatchObject({
      lowerInterior: 'library:interior-finish',
      middleInterior: 'library:interior-finish',
      upperInterior: 'library:interior-finish',
      lowerExterior: 'scene:exterior-finish',
      middleExterior: 'scene:exterior-finish',
      upperExterior: 'scene:exterior-finish',
    })
    expect(patch.slots?.topInterior).toBeUndefined()
    expect(patch.slots?.topExterior).toBeUndefined()
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
