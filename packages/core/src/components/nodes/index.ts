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

export { CeilingRenderer } from './ceiling/ceiling-renderer'
export { ColumnRenderer } from './column/column-renderer'
export { EnvironmentRenderer } from './environment/environment-renderer'
export { ImageRenderer } from './image/image-renderer'
// Re-export UI components for direct use
export { ImageUI } from './image/image-ui'
export { ItemRenderer } from './item/item-renderer'
// Re-export tools for direct use
export { PaintingTool } from './painting/painting-tool'
export { RoofRenderer } from './roof/roof-renderer'
export { RoofUI } from './roof/roof-ui'
export { ScanRenderer } from './scan/scan-renderer'
export { ScanUI } from './scan/scan-ui'
export { SiteRenderer } from './site/site-renderer'
export { SlabRenderer } from './slab/slab-renderer'
export { SledgehammerTool } from './sledgehammer/sledgehammer-tool'
export { StairRenderer } from './stair/stair-renderer'
// Re-export renderers for direct use
export { WallRenderer } from './wall/wall-renderer'
export { ZoneBoundaryEditor } from './zone/zone-boundary-editor'
export { ZoneRenderer } from './zone/zone-renderer'
