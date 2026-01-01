/**
 * Node Registry Initialization
 *
 * Imports all node components to trigger their registration with the component registry.
 * Some components (level, environment-item, site-ui) are kept in the editor package
 * because they have editor-specific UI dependencies.
 */
import './building/building-node'
import './wall/wall-node'
import './column/column-node'
import './slab/slab-node'
import './ceiling/ceiling-node'
import './roof/roof-node'
import './room/room-node'
import './custom-room/custom-room-node'
import './zone/zone-tool'
import './image/image-node'
import './scan/scan-node'
import './item/item-node'
import './group/group-node'
import './stair/stair-node'
import './site/site-node'

// Re-export renderers for direct use
export { WallRenderer } from './wall/wall-renderer'
export { ColumnRenderer } from './column/column-renderer'
export { SlabRenderer } from './slab/slab-renderer'
export { CeilingRenderer } from './ceiling/ceiling-renderer'
export { RoofRenderer } from './roof/roof-renderer'
export { ItemRenderer } from './item/item-renderer'
export { StairRenderer } from './stair/stair-renderer'
export { ScanRenderer } from './scan/scan-renderer'
export { ImageRenderer } from './image/image-renderer'
export { SiteRenderer } from './site/site-renderer'
export { ZoneRenderer } from './zone/zone-renderer'
export { EnvironmentRenderer } from './environment/environment-renderer'

// Re-export UI components for direct use
export { ImageUI } from './image/image-ui'
export { RoofUI } from './roof/roof-ui'
export { ScanUI } from './scan/scan-ui'

// Re-export tools for direct use
export { PaintingTool } from './painting/painting-tool'
export { SledgehammerTool } from './sledgehammer/sledgehammer-tool'
export { ZoneBoundaryEditor } from './zone/zone-boundary-editor'
