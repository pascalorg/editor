/**
 * Catalog Types
 *
 * Types specific to the element catalog system
 */

import type { ElementSpec } from '@/lib/engine'

// ============================================================================
// CATALOG TYPES
// ============================================================================

/**
 * Category of catalog elements
 */
export type CatalogCategory = 'structure' | 'items' | 'outdoor' | 'systems'

/**
 * Catalog element with extended metadata
 */
export interface CatalogElement {
  /** Unique identifier */
  id: string
  /** Element specification for the engine */
  spec: ElementSpec
  /** Category for organization */
  category: CatalogCategory
  /** Tags for searching/filtering */
  tags?: string[]
  /** Thumbnail URL */
  thumbnail?: string
  /** Is this a premium/pro element? */
  premium?: boolean
  /** Vendor information (for third-party elements) */
  vendor?: {
    name: string
    url?: string
    license?: string
  }
}

/**
 * Structural element categories
 */
export type StructuralElementType =
  | 'wall'
  | 'door'
  | 'window'
  | 'column'
  | 'roof'
  | 'floor'
  | 'stairs'

/**
 * Item element categories
 */
export type ItemElementType = 'furniture' | 'appliance' | 'fixture' | 'decoration' | 'plant'
