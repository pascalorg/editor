import { describe, expect, test } from 'bun:test'
import {
  buildEnabledWallFaceBandPatch,
  buildWallFaceBandCountPatch,
  getWallAssemblyDatumReferenceId,
  getWallAssemblyFaceOffsets,
  getWallAssemblyThickness,
  getWallDatumEligibleLayers,
  getWallFaceBandConfig,
  resolveWallAssemblyDatumReference,
  resolveWallAssemblyDatumReferences,
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
  WallNode,
  type WallNode as WallNodeType,
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
    } as Pick<WallNodeType, 'faceBands' | 'slots'>)

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
      } as Pick<WallNodeType, 'faceBands' | 'slots'>,
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
    } as Pick<WallNodeType, 'faceBands' | 'slots'>)

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
      } as Pick<WallNodeType, 'faceBands' | 'slots'>,
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
      } as Pick<WallNodeType, 'faceBands' | 'slots'>,
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

describe('wall assembly layers', () => {
  test('defaults to legacy thickness when no assembly layers are modeled', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      thickness: 0.14,
    })

    expect(wall.assemblyLayers).toEqual([])
    expect(getWallAssemblyThickness(wall)).toBe(0.14)
  })

  test('stores role, side, thickness, material reference, and datum eligibility', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      assemblyLayers: [
        {
          id: 'stud-core',
          role: 'structure',
          side: 'core',
          thickness: 0.09,
          materialRef: 'library:wood-framing',
          datumEligible: ['centerline', 'structural-face'],
        },
        {
          id: 'interior-gwb',
          role: 'interior-finish',
          side: 'interior',
          thickness: 0.016,
          materialRef: 'library:gypsum-board',
          datumEligible: ['finish-face'],
        },
        {
          id: 'brick-veneer',
          role: 'masonry-veneer',
          side: 'exterior',
          thickness: 0.09,
          materialRef: 'library:brick',
          datumEligible: ['veneer-face', 'finish-face'],
        },
      ],
    })

    expect(getWallAssemblyThickness(wall)).toBeCloseTo(0.196)
    expect(getWallDatumEligibleLayers(wall, 'finish-face').map((layer) => layer.id)).toEqual([
      'interior-gwb',
      'brick-veneer',
    ])
    expect(getWallDatumEligibleLayers(wall, 'structural-face')).toMatchObject([
      { id: 'stud-core', role: 'structure', side: 'core' },
    ])
    expect(getWallAssemblyFaceOffsets(wall)).toEqual({
      interior: -0.061,
      exterior: 0.135,
    })
  })

  test('resolves stable datum references for legacy single-thickness walls', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      thickness: 0.14,
    })

    expect(resolveWallAssemblyDatumReferences(wall)).toEqual([
      { id: 'wall:centerline:center', datum: 'centerline', side: 'center', offset: 0 },
      {
        id: 'wall:structural-face:interior',
        datum: 'structural-face',
        side: 'interior',
        offset: -0.07,
      },
      {
        id: 'wall:structural-face:exterior',
        datum: 'structural-face',
        side: 'exterior',
        offset: 0.07,
      },
      {
        id: 'wall:finish-face:interior',
        datum: 'finish-face',
        side: 'interior',
        offset: -0.07,
      },
      {
        id: 'wall:finish-face:exterior',
        datum: 'finish-face',
        side: 'exterior',
        offset: 0.07,
      },
    ])
  })

  test('resolves layer-owned centerline, structural, finish, and veneer datum references', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      assemblyLayers: [
        {
          id: 'stud-core',
          role: 'structure',
          side: 'core',
          thickness: 0.09,
          materialRef: 'library:wood-framing',
          datumEligible: ['centerline', 'structural-face'],
        },
        {
          id: 'interior-gwb',
          role: 'interior-finish',
          side: 'interior',
          thickness: 0.016,
          materialRef: 'library:gypsum-board',
          datumEligible: ['finish-face'],
        },
        {
          id: 'exterior-sheathing',
          role: 'exterior-sheathing',
          side: 'exterior',
          thickness: 0.012,
          materialRef: 'library:sheathing',
          datumEligible: ['finish-face'],
        },
        {
          id: 'brick-veneer',
          role: 'masonry-veneer',
          side: 'exterior',
          thickness: 0.09,
          materialRef: 'library:brick',
          datumEligible: ['veneer-face'],
        },
      ],
    })

    const references = resolveWallAssemblyDatumReferences(wall)

    expect(references).toContainEqual({
      id: 'wall:centerline:center',
      datum: 'centerline',
      side: 'center',
      offset: 0,
    })
    expect(references).toContainEqual({
      id: 'wall:structural-face:interior:stud-core',
      datum: 'structural-face',
      side: 'interior',
      layerId: 'stud-core',
      offset: -0.045,
    })
    expect(references).toContainEqual({
      id: 'wall:structural-face:exterior:stud-core',
      datum: 'structural-face',
      side: 'exterior',
      layerId: 'stud-core',
      offset: 0.045,
    })
    expect(references).toContainEqual({
      id: 'wall:finish-face:interior:interior-gwb',
      datum: 'finish-face',
      side: 'interior',
      layerId: 'interior-gwb',
      offset: -0.061,
    })
    expect(
      references.find(
        (reference) => reference.id === 'wall:finish-face:exterior:exterior-sheathing',
      ),
    ).toMatchObject({
      datum: 'finish-face',
      side: 'exterior',
      layerId: 'exterior-sheathing',
    })
    expect(
      references.find(
        (reference) => reference.id === 'wall:finish-face:exterior:exterior-sheathing',
      )?.offset,
    ).toBeCloseTo(0.057)

    expect(
      references.find((reference) => reference.id === 'wall:veneer-face:exterior:brick-veneer'),
    ).toMatchObject({
      datum: 'veneer-face',
      side: 'exterior',
      layerId: 'brick-veneer',
    })
    expect(
      references.find((reference) => reference.id === 'wall:veneer-face:exterior:brick-veneer')
        ?.offset,
    ).toBeCloseTo(0.147)
    expect(
      resolveWallAssemblyDatumReference(
        wall,
        getWallAssemblyDatumReferenceId('veneer-face', 'exterior', 'brick-veneer'),
      ),
    ).toMatchObject({
      datum: 'veneer-face',
      side: 'exterior',
      layerId: 'brick-veneer',
      offset: 0.147,
    })
  })
})
