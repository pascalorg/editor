import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { AssemblyNode } from './assembly'
import { BoxNode } from './box'
import { CableTrayNode } from './cable-tray'
import { CapsuleNode } from './capsule'
import { CeilingNode } from './ceiling'
import { ColumnNode } from './column'
import { ConeNode } from './cone'
import { ConformalStripNode } from './conformal-strip'
import { ConveyorBeltNode } from './conveyor-belt'
import { CylinderNode } from './cylinder'
import { DataChartNode } from './data-chart'
import { DataTableNode } from './data-table'
import { DataWidgetNode } from './data-widget'
import { ExtrudeNode } from './extrude'
import { FenceNode } from './fence'
import { FrustumNode } from './frustum'
import { GuideNode } from './guide'
import { HalfCylinderNode } from './half-cylinder'
import { HemisphereNode } from './hemisphere'
import { ItemNode } from './item'
import { LadderNode } from './ladder'
import { LatheNode } from './lathe'
import { PipeNode } from './pipe'
import { PipeFittingNode } from './pipe-fitting'
import { RoadNode } from './road'
import { RoofNode } from './roof'
import { RoundedPanelNode } from './rounded-panel'
import { ScanNode } from './scan'
import { ShelfNode } from './shelf'
import { SlabNode } from './slab'
import { SpawnNode } from './spawn'
import { SphereNode } from './sphere'
import { StairNode } from './stair'
import { SteelBeamNode } from './steel-beam'
import { SteelFrameNode } from './steel-frame'
import { SweepNode } from './sweep'
import { TankNode } from './tank'
import { TorusNode } from './torus'
import { TrapezoidPrismNode } from './trapezoid-prism'
import { WallNode } from './wall'
import { WedgeNode } from './wedge'
import { ZoneNode } from './zone'

export const LevelNode = BaseNode.extend({
  id: objectId('level'),
  type: nodeType('level'),
  children: z
    .array(
      z.union([
        AssemblyNode.shape.id,
        BoxNode.shape.id,
        CapsuleNode.shape.id,
        WallNode.shape.id,
        FenceNode.shape.id,
        CableTrayNode.shape.id,
        ConveyorBeltNode.shape.id,
        ConeNode.shape.id,
        ConformalStripNode.shape.id,
        CylinderNode.shape.id,
        DataChartNode.shape.id,
        DataTableNode.shape.id,
        DataWidgetNode.shape.id,
        ExtrudeNode.shape.id,
        FrustumNode.shape.id,
        HalfCylinderNode.shape.id,
        HemisphereNode.shape.id,
        PipeFittingNode.shape.id,
        PipeNode.shape.id,
        RoadNode.shape.id,
        SteelBeamNode.shape.id,
        SteelFrameNode.shape.id,
        ColumnNode.shape.id,
        ItemNode.shape.id,
        LadderNode.shape.id,
        LatheNode.shape.id,
        ZoneNode.shape.id,
        SlabNode.shape.id,
        CeilingNode.shape.id,
        RoofNode.shape.id,
        RoundedPanelNode.shape.id,
        StairNode.shape.id,
        ScanNode.shape.id,
        GuideNode.shape.id,
        SpawnNode.shape.id,
        SphereNode.shape.id,
        ShelfNode.shape.id,
        SweepNode.shape.id,
        TankNode.shape.id,
        TorusNode.shape.id,
        TrapezoidPrismNode.shape.id,
        WedgeNode.shape.id,
      ]),
    )
    .default([]),
  // Specific props
  level: z.number().default(0),
}).describe(
  dedent`
  Level node - used to represent a level in the building
  - children: array of floor, wall, ceiling, roof, item nodes
  - level: level number
  `,
)

export type LevelNode = z.infer<typeof LevelNode>
