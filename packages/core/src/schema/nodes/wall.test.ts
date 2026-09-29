import {
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CHAIR_RAIL_SLOT_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_CROWN_SLOT_DEFAULT,
  WALL_SKIRTING_DEFAULT,
  WALL_SKIRTING_SLOT_DEFAULT,
  WALL_SURFACE_SLOT_DEFAULTS,
  WallNode,
  WallTrimConfig,
} from './wall'

describe('wall support offset', () => {
  test('stores a finite offset without defaulting it onto ordinary walls', () => {
    expect(WallNode.parse({ start: [0, 0], end: [4, 0] }).supportOffset).toBeUndefined()
    expect(WallNode.parse({ start: [0, 0], end: [4, 0], supportOffset: 1.75 }).supportOffset).toBe(
      1.75,
    )
    expect(
      WallNode.safeParse({ start: [0, 0], end: [4, 0], supportOffset: Number.NaN }).success,
    ).toBe(false)
  })

  test('stores terrain infill only when explicitly enabled', () => {
    expect(WallNode.parse({ start: [0, 0], end: [4, 0] }).fillToTerrain).toBeUndefined()
    expect(WallNode.parse({ start: [0, 0], end: [4, 0], fillToTerrain: true }).fillToTerrain).toBe(
      true,
    )
  })
})

describe('wall face regions', () => {
  const region = (id: string, face: 'a' | 'b') => ({ id, face, v1: 0.9, finish: 'library:x' })

  test('stores sparse bounds and at most eight regions per face', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      faceRegions: [{ id: 'r', face: 'a', u0: 1, finish: 'library:x' }],
    })
    expect(wall.faceRegions).toEqual([{ id: 'r', face: 'a', u0: 1, finish: 'library:x' }])

    const eightPerFace = [
      ...Array.from({ length: 8 }, (_, i) => region(`a${i}`, 'a')),
      ...Array.from({ length: 8 }, (_, i) => region(`b${i}`, 'b')),
    ]
    expect(
      WallNode.safeParse({ start: [0, 0], end: [4, 0], faceRegions: eightPerFace }).success,
    ).toBe(true)
    expect(
      WallNode.safeParse({
        start: [0, 0],
        end: [4, 0],
        faceRegions: [...eightPerFace, region('a8', 'a')],
      }).success,
    ).toBe(false)
  })

  test('drops the retired face band config on parse', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], faceBands: { enabled: true } })
    expect('faceBands' in wall).toBe(false)
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

    expect(WALL_SURFACE_SLOT_DEFAULTS.aSkirting).toBe(WALL_SKIRTING_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.bSkirting).toBe(WALL_SKIRTING_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.aCrown).toBe(WALL_CROWN_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.bCrown).toBe(WALL_CROWN_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.aChairRail).toBe(WALL_CHAIR_RAIL_SLOT_DEFAULT)
    expect(WALL_SURFACE_SLOT_DEFAULTS.bChairRail).toBe(WALL_CHAIR_RAIL_SLOT_DEFAULT)
  })
})
