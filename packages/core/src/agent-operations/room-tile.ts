import { foldRoomName } from '../building/room-use'
import { getSceneMaterialIdFromRef } from '../material-library'
import type { SceneMaterial } from '../schema'
import type { FinishFact } from './room-finishes'

/** `unknown` is a finish the nodes cannot name (an inline material, a scene ref with no scene
 *  materials at hand, a script-built face): a check never fires on what it cannot read. */
export type Tiled = 'yes' | 'no' | 'unknown'

type Materials = Readonly<Record<string, SceneMaterial>> | undefined

const TILE_WORDS =
  /tile|ceramic|cerame|mosaic|mosaique|terracotta|terre cuite|tomette|zellige|azulejo|porcelain|\bgres\b|marble|statuar|carrel|carreau|faience|marbre/

/**
 * Whether one finish is tile: the library's own kind, else its words. "Stone Tile" is filed under
 * stone and "Statuaretto White" (white marble flooring) under stone too, so the kind alone misses
 * both. A material the maker generated is read from what it is made of, as its name may say
 * anything: a tile or marble preset is tile, a flat colour is paint, and a texture could be either.
 */
export function finishTiled(fact: FinishFact, materials?: Materials): Tiled {
  if (fact.ref === null) return fact.name === 'default' ? 'no' : 'unknown'
  if (fact.kind === 'tile') return 'yes'
  // A written colour (#rrggbb, what a dressing layer paints with) is flat paint.
  if (/^#[0-9a-f]{6}$/i.test(fact.ref)) return 'no'
  if (TILE_WORDS.test(foldRoomName(`${fact.name} ${fact.ref}`))) return 'yes'
  const sceneId = getSceneMaterialIdFromRef(fact.ref)
  if (sceneId) {
    const made = materials?.[sceneId]?.material
    if (!made) return 'unknown'
    if (made.preset === 'tile' || made.preset === 'marble') return 'yes'
    return made.texture ? 'unknown' : 'no'
  }
  return fact.name === fact.ref ? 'unknown' : 'no'
}
