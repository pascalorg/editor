import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  assemblyThickness,
  DEFAULT_INTERIOR_WALL_PAINT,
  GYPSUM_HALF,
  getSceneDocument,
  SiteNode,
  STUD_2X8,
  useScene,
  WallTypeDefinition,
  wallTypeAssembly,
} from '@pascal-app/core'
import useEditor from '../store/use-editor'
import { getDrawnWallTypes, setWallTypeOverride } from './wall-draw-variant'
import {
  currentProjectWallTypes,
  DEFAULT_WALL_FINISHES,
  DEFAULT_WALL_TYPES,
  deleteProjectWallType,
  newWallTypeBlockedReason,
  normalizeWallFinishes,
  normalizeWallTypes,
  PLAIN_WALL_TYPE,
  PROJECT_WALL_TYPE_LIMIT,
  saveProjectWallType,
  WALL_TYPE_LAYER_LIMIT,
  WALL_TYPE_SAVE_FAILURE,
  wallTypeOptions,
  wallTypePlacementOf,
  wallTypeThickness,
} from './wall-type'

// Scene writes schedule their dirty pass on a frame; bun has none.
globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

/** A 2x8 at 24 in partition, drywall both faces. */
const SOUND_WALL: WallTypeDefinition = {
  id: 'custom-soundwall',
  label: '2x8 sound wall',
  assembly: wallTypeAssembly('custom-soundwall', [
    { role: 'lining', material: 'drywall', thickness: GYPSUM_HALF },
    { role: 'structure', core: true, material: 'wood', thickness: STUD_2X8, spacing: 0.6096 },
    { role: 'lining', material: 'drywall', thickness: GYPSUM_HALF },
  ]),
}

beforeEach(() => {
  useScene.getState().unloadScene()
  useScene.getState().loadScene()
})

afterEach(() => {
  setWallTypeOverride(null)
  useEditor.setState({ wallTypes: DEFAULT_WALL_TYPES, wallFinishes: DEFAULT_WALL_FINISHES })
  useScene.getState().unloadScene()
})

describe('the Exterior and Interior lists', () => {
  test('each lists the presets that build its kind of wall, and the plain wall', () => {
    const exterior = wallTypeOptions('exterior', []).map((option) => option.id)
    const interior = wallTypeOptions('interior', []).map((option) => option.id)
    expect(exterior).toContain('exterior-2x6-siding')
    expect(exterior).toContain('exterior-cmu-stucco')
    expect(exterior).not.toContain('interior-2x4-drywall')
    expect(interior).toEqual([
      'interior-2x4-drywall',
      'interior-2x6-plumbing',
      'cmu-8-furred-drywall',
      PLAIN_WALL_TYPE,
    ])
    expect(exterior.at(-1)).toBe(PLAIN_WALL_TYPE)
  })

  test('a pick made before the split still shows in its old list', () => {
    const exterior = wallTypeOptions('exterior', [], 'interior-2x4-drywall')
    expect(exterior.map((option) => option.id)).toContain('interior-2x4-drywall')
  })

  test("a project type lists under the placement its layers give, in a group of the project's own", () => {
    expect(wallTypePlacementOf(SOUND_WALL.assembly)).toBe('interior')
    const interior = wallTypeOptions('interior', [SOUND_WALL])
    expect(interior.find((option) => option.id === SOUND_WALL.id)?.group).toBe('This project')
    expect(wallTypeOptions('exterior', [SOUND_WALL]).map((option) => option.id)).not.toContain(
      SOUND_WALL.id,
    )
  })
})

describe('project wall types', () => {
  test('save with the project and come back from a saved scene', () => {
    expect(saveProjectWallType(SOUND_WALL)).toBe('saved')
    expect(currentProjectWallTypes()).toEqual([SOUND_WALL])
    const document = JSON.parse(JSON.stringify(getSceneDocument()))
    useScene.getState().unloadScene()
    expect(currentProjectWallTypes()).toEqual([])
    useScene.getState().setScene(document.nodes, document.rootNodeIds)
    expect(currentProjectWallTypes()).toEqual([SOUND_WALL])
    // Saving again under the same id edits it in place.
    saveProjectWallType({ ...SOUND_WALL, label: 'Sound wall' })
    expect(currentProjectWallTypes().map((type) => type.label)).toEqual(['Sound wall'])
    deleteProjectWallType(SOUND_WALL.id)
    expect(currentProjectWallTypes()).toEqual([])
  })

  test('walls drawn with one take its stack, at the thickness its layers sum to', () => {
    saveProjectWallType(SOUND_WALL)
    useEditor.getState().setWallType('interior', SOUND_WALL.id)
    expect(useEditor.getState().wallTypes.interior).toBe(SOUND_WALL.id)
    const drawn = getDrawnWallTypes().interior
    expect(drawn?.assembly?.presetId).toBe(SOUND_WALL.id)
    expect(drawn?.thickness).toBeCloseTo(assemblyThickness(SOUND_WALL.assembly), 12)
    expect(drawn?.thickness).toBeCloseTo(STUD_2X8 + 2 * GYPSUM_HALF, 12)
    expect(wallTypeThickness(SOUND_WALL.id, 'interior')).toBeCloseTo(drawn!.thickness!, 12)
  })

  test('a 13th layer and a 65th type are refused, each saying why, and nothing is written', () => {
    const stack = (linings: number) =>
      wallTypeAssembly('custom-thick', [
        { role: 'structure', core: true, material: 'wood', thickness: STUD_2X8 },
        ...Array.from({ length: linings }, () => ({
          role: 'lining' as const,
          material: 'drywall',
          thickness: GYPSUM_HALF,
        })),
      ])
    const thick = { id: 'custom-thick', label: 'Thick', assembly: stack(WALL_TYPE_LAYER_LIMIT) }
    expect(saveProjectWallType(thick)).toBe('too-many-layers')
    expect(currentProjectWallTypes()).toEqual([])
    // The limits are the schema's own.
    expect(WallTypeDefinition.safeParse(thick).success).toBe(false)
    expect(saveProjectWallType({ ...thick, assembly: stack(WALL_TYPE_LAYER_LIMIT - 1) })).toBe(
      'saved',
    )
    deleteProjectWallType(thick.id)

    const numbered = (n: number) => ({
      ...SOUND_WALL,
      id: `custom-sound-${n}`,
      label: `Sound ${n}`,
    })
    for (let n = 1; n <= PROJECT_WALL_TYPE_LIMIT; n += 1)
      expect(saveProjectWallType(numbered(n))).toBe('saved')
    expect(newWallTypeBlockedReason(currentProjectWallTypes())).toContain(
      `${PROJECT_WALL_TYPE_LIMIT} wall types`,
    )
    expect(saveProjectWallType(numbered(PROJECT_WALL_TYPE_LIMIT + 1))).toBe('too-many-types')
    expect(currentProjectWallTypes()).toHaveLength(PROJECT_WALL_TYPE_LIMIT)
    const site = Object.values(useScene.getState().nodes).find((node) => node.type === 'site')
    expect(SiteNode.safeParse(site).success).toBe(true)
    const over = [...currentProjectWallTypes(), numbered(PROJECT_WALL_TYPE_LIMIT + 1)]
    expect(SiteNode.safeParse({ ...site, wallTypes: over }).success).toBe(false)
    // A type the project keeps can still be edited in place.
    expect(saveProjectWallType({ ...numbered(1), label: 'Quiet wall' })).toBe('saved')
    expect(currentProjectWallTypes()[0]?.label).toBe('Quiet wall')
    deleteProjectWallType(numbered(1).id)
    expect(newWallTypeBlockedReason(currentProjectWallTypes())).toBeNull()
  })

  test('a type that does not parse says so, apart from a scene with no site', () => {
    const coreless = {
      ...SOUND_WALL,
      assembly: {
        ...SOUND_WALL.assembly,
        layers: SOUND_WALL.assembly.layers.filter((l) => !l.core),
      },
    }
    expect(saveProjectWallType(coreless)).toBe('invalid')
    expect(saveProjectWallType({ ...SOUND_WALL, label: '  ' })).toBe('invalid')
    expect(currentProjectWallTypes()).toEqual([])
    useScene.getState().unloadScene()
    expect(saveProjectWallType(SOUND_WALL)).toBe('no-site')
    expect(WALL_TYPE_SAVE_FAILURE.invalid).not.toBe(WALL_TYPE_SAVE_FAILURE['no-site'])
    expect(WALL_TYPE_SAVE_FAILURE.invalid).not.toContain('site')
  })

  test("a pick this project does not have draws the placement's default", () => {
    useEditor.getState().setWallType('interior', 'custom-elsewhere')
    expect(useEditor.getState().wallTypes.interior).toBe('custom-elsewhere')
    expect(getDrawnWallTypes().interior?.assembly?.presetId).toBe(DEFAULT_WALL_TYPES.interior)
    expect(normalizeWallTypes({ exterior: 'custom-x', interior: 'custom bad' })).toEqual({
      exterior: 'custom-x',
      interior: DEFAULT_WALL_TYPES.interior,
    })
  })
})

describe('finishes picked while drafting', () => {
  test('start at the defaults, which write nothing on the wall', () => {
    expect(useEditor.getState().wallFinishes.paint).toBe(DEFAULT_INTERIOR_WALL_PAINT)
    const types = getDrawnWallTypes()
    expect(types.exterior?.slots).toBeUndefined()
    expect(types.interior?.slots).toBeUndefined()
  })

  test('go on the cladding of the exterior type and on every drywall face', () => {
    useEditor.getState().setWallCladding('siding', 'library:siding-lap-navy')
    useEditor.getState().setWallPaint('library:preset-sage')
    const types = getDrawnWallTypes()
    expect(types.exterior?.slots).toEqual({
      'layer:exterior': 'library:siding-lap-navy',
      'layer:interior': 'library:preset-sage',
    })
    expect(types.interior?.slots).toEqual({
      'layer:interior-back': 'library:preset-sage',
      'layer:interior': 'library:preset-sage',
    })
    // Stucco keeps its own pick: the navy siding is not a stucco.
    useEditor.getState().setWallType('exterior', 'exterior-2x6-stucco')
    expect(getDrawnWallTypes().exterior?.slots).toEqual({ 'layer:interior': 'library:preset-sage' })
    useEditor.getState().setWallCladding('stucco', 'library:preset-sand')
    expect(getDrawnWallTypes().exterior?.slots?.['layer:exterior']).toBe('library:preset-sand')
  })

  test('the Interior wall tool draws its type and paint everywhere', () => {
    useEditor.getState().setWallPaint('library:preset-sage')
    setWallTypeOverride('interior')
    const types = getDrawnWallTypes()
    expect(types.exterior?.assembly?.presetId).toBe(DEFAULT_WALL_TYPES.interior)
    expect(types.exterior?.slots?.['layer:interior']).toBe('library:preset-sage')
  })

  test('stored picks come back; anything else is dropped', () => {
    expect(
      normalizeWallFinishes({
        cladding: { siding: 'library:siding-lap-sage', stucco: 42 },
        paint: 'library:preset-mint',
      }),
    ).toEqual({ cladding: { siding: 'library:siding-lap-sage' }, paint: 'library:preset-mint' })
    expect(normalizeWallFinishes(undefined)).toEqual(DEFAULT_WALL_FINISHES)
  })
})
