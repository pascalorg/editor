/**
 * Catalog Registration
 *
 * Registers all catalog elements with the ECS engine
 */

import { registerFromSpec } from '@/lib/engine'
import { ColumnSpec } from './structure/column'
import { DoorSpec } from './structure/door'
import { RoofSpec } from './structure/roof'
import { WallSpec } from './structure/wall'
import { WindowSpec } from './structure/window'

/**
 * Register all structural elements
 */
export function registerStructuralElements(): void {
  console.log('[Catalog] Registering structural elements...')

  registerFromSpec(WallSpec)
  registerFromSpec(DoorSpec)
  registerFromSpec(WindowSpec)
  registerFromSpec(ColumnSpec)
  registerFromSpec(RoofSpec)

  console.log('[Catalog] ✓ Registered 5 structural elements')
}

/**
 * Register all catalog elements (main entry point)
 */
export function registerCatalogElements(): void {
  registerStructuralElements()
  // Future: registerItemElements()
  // Future: registerOutdoorElements()
  // Future: registerSystemElements()
}
