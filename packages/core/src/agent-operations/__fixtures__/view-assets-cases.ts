import type { AssetInput } from '../../schema'
import type { AssetViewFacts } from '../asset-views'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `view_assets`: a picture of catalog items by id, with their size and the names of their
 * paintable surfaces. The host reads the pictures and the surfaces before the call (`assetViews`);
 * the operation says what it was given and what it was not, as facts. What goes wrong, written
 * first: an id the library lacks answered with nothing; an item with no named surfaces read as one
 * whose surfaces are unknown; a host that cannot fetch pictures answering as if it had.
 */

const item = (id: string, name: string, dimensions: [number, number, number]): AssetInput => ({
  id,
  name,
  category: 'furniture',
  tags: [],
  thumbnail: `https://library.test/${id}/thumbnail.png`,
  src: `https://library.test/${id}/model.glb`,
  dimensions,
})

const LIBRARY: AssetInput[] = [
  item('single-bed', 'Single Bed', [1.5, 0.7, 2.5]),
  item('bunkbed', 'Bunkbed', [1.2, 1.8, 2.1]),
  item('sofa', 'Sofa', [2.5, 0.8, 1.5]),
  item('desk', 'Desk', [1.4, 0.75, 0.7]),
  item('dresser', 'Dresser', [1.5, 0.8, 1]),
  item('lamp', 'Lamp', [0.3, 1.5, 0.3]),
]

const PICTURE = 'data:image/webp;base64,UklGRg=='

const seen = (...surfaces: string[]): AssetViewFacts => ({ picture: PICTURE, surfaces })

const noScene = (): SceneGraph => ({ nodes: {}, rootNodeIds: [] })
const library = (assetViews?: Record<string, AssetViewFacts>) => ({
  activeLevelId: null,
  catalog: LIBRARY,
  ...(assetViews ? { assetViews } : {}),
})

export const VIEW_ASSETS_CASES: AgentToolCase[] = [
  {
    name: 'one item: its size, category and surface names, and a picture shown',
    tool: 'view_assets',
    scene: noScene,
    input: { ids: ['single-bed'] },
    context: library({ 'single-bed': seen('sheet', 'pillow', 'matress', 'frame') }),
    readOnly: true,
    expect: {
      result: {
        shown: 1,
        items: [
          {
            id: 'single-bed',
            name: 'Single Bed',
            category: 'furniture',
            dimensions: [1.5, 0.7, 2.5],
            surfaces: ['sheet', 'pillow', 'matress', 'frame'],
            picture: true,
          },
        ],
      },
      check: (result) => ('note' in result ? ['a note on a call that showed everything'] : []),
    },
  },
  {
    name: 'six items in one call, each with a picture, in the order asked',
    tool: 'view_assets',
    scene: noScene,
    input: { ids: LIBRARY.map((entry) => entry.id) },
    context: library(
      Object.fromEntries(LIBRARY.map((entry) => [entry.id, seen('body')])) as Record<
        string,
        AssetViewFacts
      >,
    ),
    readOnly: true,
    expect: {
      result: { shown: 6 },
      check: (result) => {
        const ids = (result.items as { id: string }[]).map((entry) => entry.id)
        return ids.join() === LIBRARY.map((entry) => entry.id).join()
          ? []
          : [`items came back as ${ids.join()}`]
      },
    },
  },
  {
    name: 'an id twice is one picture',
    tool: 'view_assets',
    scene: noScene,
    input: { ids: ['sofa', 'sofa'] },
    context: library({ sofa: seen('body', 'cushion', 'pillow') }),
    readOnly: true,
    expect: { result: { shown: 1, items: [{ id: 'sofa' }] } },
  },
  {
    name: 'an id the library lacks is refused with the fact, and nothing is shown',
    tool: 'view_assets',
    scene: noScene,
    input: { ids: ['sofa', 'throne'] },
    context: library({ sofa: seen('body') }),
    readOnly: true,
    expect: {
      refusal: 'unknown_asset',
      mentions: ['"throne" is not in the item library', 'search_assets', 'Nothing was shown'],
    },
  },
  {
    name: 'an item whose model names no surface says so',
    tool: 'view_assets',
    scene: noScene,
    input: { ids: ['bunkbed'] },
    context: library({ bunkbed: seen() }),
    readOnly: true,
    expect: { result: { shown: 1, items: [{ id: 'bunkbed', surfaces: [], picture: true }] } },
  },
  {
    name: 'a host that read nothing gives the sizes, and says no picture is shown',
    tool: 'view_assets',
    scene: noScene,
    input: { ids: ['desk', 'lamp'] },
    context: library(),
    readOnly: true,
    expect: {
      result: {
        shown: 0,
        items: [
          { id: 'desk', dimensions: [1.4, 0.75, 0.7], surfaces: null, picture: false },
          { id: 'lamp', surfaces: null, picture: false },
        ],
      },
      mentions: ['2 of 2 items show no picture here'],
    },
  },
  {
    name: 'a picture that could not be fetched leaves the surfaces and names why',
    tool: 'view_assets',
    scene: noScene,
    input: { ids: ['dresser', 'sofa'] },
    context: library({
      dresser: { surfaces: ['drawers', 'body'], unavailable: 'its picture could not be fetched (the file answered 404)' },
      sofa: seen('body'),
    }),
    readOnly: true,
    expect: {
      result: {
        shown: 1,
        items: [
          { id: 'dresser', surfaces: ['drawers', 'body'], picture: false },
          { id: 'sofa', picture: true },
        ],
      },
      mentions: ['1 of 2 items show no picture here', 'the file answered 404'],
    },
  },
  {
    name: 'a host with no library has nothing to look in',
    tool: 'view_assets',
    scene: noScene,
    input: { ids: ['sofa'] },
    context: { activeLevelId: null },
    // The standalone MCP always has its built-in list.
    surfaces: ['core', 'chat'],
    readOnly: true,
    expect: { refusal: 'no_catalog' },
  },
]
