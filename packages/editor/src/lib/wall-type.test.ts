import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  GYPSUM_HALF,
  getSceneDocument,
  projectWallTypes,
  SiteNode,
  STUD_2X8,
  useScene,
  WallTypeDefinition,
  wallTypeAssembly,
} from '@pascal-app/core'
import {
  deleteProjectWallType,
  newWallTypeBlockedReason,
  PROJECT_WALL_TYPE_LIMIT,
  saveProjectWallType,
  WALL_TYPE_LAYER_LIMIT,
  WALL_TYPE_SAVE_FAILURE,
} from './wall-type'

// Scene writes schedule their dirty pass on a frame; bun has none.
globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const currentProjectWallTypes = () => {
  const { nodes, rootNodeIds } = useScene.getState()
  return projectWallTypes(nodes, rootNodeIds)
}

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
  useScene.getState().unloadScene()
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
})
