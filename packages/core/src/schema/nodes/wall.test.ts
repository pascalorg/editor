import { describe, expect, test } from 'bun:test'
import {
  buildEnabledWallFaceBandPatch,
  buildWallFaceBandCountPatch,
  getWallFaceBandConfig,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CHAIR_RAIL_SLOT_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_CROWN_SLOT_DEFAULT,
  WALL_FACE_BAND_DEFAULT,
  WALL_FACE_BAND_SOLID_SLOT_DEFAULTS,
  WALL_SKIRTING_DEFAULT,
  WALL_SKIRTING_SLOT_DEFAULT,
  WALL_SURFACE_SLOT_DEFAULTS,
  WallFaceBandConfig,
  type WallNode,
  WallTrimConfig,
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
      getWallFaceBandConfig(
        {
          height: 2.5,
          faceBands: {
            enabled: true,
            count: 3,
            lowerHeight: 0.84,
            middleHeight: 0.61,
            upperHeight: 0.61,
          },
        },
        2.5,
      ),
    ).toMatchObject({
      count: 3,
      lowerTop: 0.84,
      middleTop: 1.45,
    })
  })

  test('four bands adds an upper split below the final top band', () => {
    expect(
      getWallFaceBandConfig(
        {
          height: 2.5,
          faceBands: {
            enabled: true,
            count: 4,
            lowerHeight: 0.5,
            middleHeight: 0.6,
            upperHeight: 0.7,
          },
        },
        2.5,
      ),
    ).toMatchObject({
      count: 4,
      lowerTop: 0.5,
      middleTop: 1.1,
      upperTop: 1.8,
    })
  })

  test('enabling bands seeds visible solid-color band slots', () => {
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
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      upperInterior: 'library:interior-finish',
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
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
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperInterior: 'library:stale-top',
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperExterior: 'scene:exterior-finish',
    })
    expect(patch.slots?.topInterior).toBeUndefined()
    expect(patch.slots?.topExterior).toBeUndefined()
  })

  test('enabling bands replaces stale inactive band slots with solid-color defaults', () => {
    const patch = buildEnabledWallFaceBandPatch({
      slots: {
        lowerInterior: 'library:stale-lower',
        middleInterior: 'library:stale-middle',
        upperExterior: 'library:stale-upper',
      },
    } as Pick<WallNode, 'faceBands' | 'slots'>)

    expect(patch.slots).toEqual({
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      upperInterior: WALL_SURFACE_SLOT_DEFAULTS.interior,
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      upperExterior: WALL_SURFACE_SLOT_DEFAULTS.exterior,
    })
    expect(patch.slots?.middleInterior).toBeUndefined()
    expect(patch.slots?.middleExterior).toBeUndefined()
  })

  test('increasing band count paints newly active bands with the solid palette', () => {
    const patch = buildWallFaceBandCountPatch(
      {
        faceBands: {
          enabled: true,
          count: 2,
          lowerHeight: 0.2,
          middleHeight: 0.3,
          upperHeight: 0.61,
        },
        slots: {
          lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
          upperInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
          lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
          upperExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
        },
      } as Pick<WallNode, 'faceBands' | 'slots'>,
      3,
    )

    expect(patch.slots).toMatchObject({
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
    })
  })

  test('increasing to four bands keeps the previous top material on the new top band', () => {
    const patch = buildWallFaceBandCountPatch(
      {
        faceBands: {
          enabled: true,
          count: 3,
          lowerHeight: 0.2,
          middleHeight: 0.3,
          upperHeight: 0.61,
        },
        slots: {
          lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
          middleInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
          upperInterior: 'scene:painted-top-interior',
          lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
          middleExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
          upperExterior: 'library:painted-top-exterior',
        },
      } as Pick<WallNode, 'faceBands' | 'slots'>,
      4,
    )

    expect(patch.slots).toMatchObject({
      lowerInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperInterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
      topInterior: 'scene:painted-top-interior',
      lowerExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.lower,
      middleExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.middle,
      upperExterior: WALL_FACE_BAND_SOLID_SLOT_DEFAULTS.upper,
      topExterior: 'library:painted-top-exterior',
    })
  })
})

describe('wall trim profiles', () => {
  test('uses curated defaults while preserving legacy profile values', () => {
    expect(WALL_SKIRTING_DEFAULT.profile).toBe('flat')
    expect(WALL_CROWN_DEFAULT.profile).toBe('flat')
    expect(WALL_CHAIR_RAIL_DEFAULT.profile).toBe('flat')

    expect(WallTrimConfig.parse({ profile: 'flat' }).profile).toBe('flat')
    expect(WallTrimConfig.parse({ profile: 'crown-layered' }).profile).toBe('crown-layered')
    expect(WallTrimConfig.parse({ profile: 'triangle' }).profile).toBe('triangle')
  })

  test('declares separate default materials for each trim family', () => {
    expect(WALL_SKIRTING_SLOT_DEFAULT).toBe('library:preset-softwhite')
    expect(WALL_CROWN_SLOT_DEFAULT).toBe('library:preset-white')
    expect(WALL_CHAIR_RAIL_SLOT_DEFAULT).toBe('library:preset-cream')

    expect(WALL_SURFACE_SLOT_DEFAULTS.skirtingInterior).toBe(WALL_SKIRTING_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.skirtingExterior).toBe(WALL_SKIRTING_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.crownInterior).toBe(WALL_CROWN_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.crownExterior).toBe(WALL_CROWN_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.chairRailInterior).toBe(WALL_CHAIR_RAIL_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.chairRailExterior).toBe(WALL_CHAIR_RAIL_SLOT_DEFAULT)
  })
})
