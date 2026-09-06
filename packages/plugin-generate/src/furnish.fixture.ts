/**
 * The catalog entries the furnishing tests place — ids and dimensions copied
 * verbatim from the editor's item catalog (`CATALOG_ITEMS`), so a test never
 * depends on the editor package while still placing the real sizes.
 */
import type { Sized } from './furnish'

const entry = (
  id: string,
  category: string,
  name: string,
  dimensions: [number, number, number],
  extra: Partial<Sized> = {},
): Sized => ({
  id,
  category,
  name,
  thumbnail: `https://example.test/items/${id}/thumbnail.png`,
  src: `https://example.test/items/${id}/model.glb`,
  floorPlanUrl: `https://example.test/items/${id}/floor-plan.png`,
  dimensions,
  offset: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  ...extra,
})

export const FIXTURE_CATALOG: Sized[] = [
  entry('bathroom-sink', 'bathroom', 'Bathroom Sink', [1.83, 0.97, 0.63]),
  entry('toilet', 'bathroom', 'Toilet', [0.42, 0.82, 0.72]),
  entry('bathtub', 'bathroom', 'Bathtub', [2.34, 0.79, 1.11]),
  entry('shower-square', 'bathroom', 'Squared Shower', [0.81, 1.8, 0.81]),
  entry('kitchen-counter', 'kitchen', 'Kitchen Counter', [1.96, 0.73, 0.63], {
    surface: { height: 0.73 },
  }),
  entry('kitchen', 'kitchen', 'Kitchen', [2.38, 1.03, 0.84], { surface: { height: 0.797 } }),
  entry('kitchen-cabinet', 'kitchen', 'Kitchen Cabinet', [1.65, 1.09, 0.77], {
    surface: { height: 1.09 },
  }),
  entry('fridge', 'kitchen', 'Fridge', [0.7, 1.92, 0.72]),
  entry('stove', 'kitchen', 'Stove', [0.92, 0.85, 0.76]),
  entry('double-bed', 'furniture', 'Double Bed', [1.52, 0.71, 2]),
  entry('single-bed', 'furniture', 'Single Bed', [1.08, 0.6, 2.14]),
  entry('bedside-table', 'furniture', 'Bedside Table', [0.45, 0.48, 0.46], {
    surface: { height: 0.48 },
  }),
  entry('dresser', 'furniture', 'Dresser', [1.23, 0.73, 0.61], { surface: { height: 0.73 } }),
  entry('dining-table', 'furniture', 'Dining Table', [2.16, 0.7, 0.95], {
    surface: { height: 0.7 },
  }),
  entry('dining-chair', 'furniture', 'Dining Chair', [0.47, 0.87, 0.5]),
  entry('sofa', 'furniture', 'Sofa', [2.06, 0.74, 1.01]),
  entry('coffee-table', 'furniture', 'Coffee Table', [1.72, 0.3, 1.04], {
    surface: { height: 0.3 },
  }),
  entry('tv-stand', 'furniture', 'TV Stand', [1.86, 0.35, 0.32], { surface: { height: 0.35 } }),
  entry('office-table', 'furniture', 'Office Table', [1.51, 0.76, 0.62], {
    surface: { height: 0.75 },
  }),
  entry('bookshelf', 'furniture', 'Bookshelf', [0.93, 1.99, 0.33]),
  entry('washing-machine', 'bathroom', 'Washing Machine', [0.6, 0.86, 0.53]),
]
