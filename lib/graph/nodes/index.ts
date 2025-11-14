/**
 * 
 * NODE HIERARCHY:
Root (Root node)
├── ☀️ Environment   (Sky, Sun, etc.)
├── 🌳 Site
│   ├── PropertyNode (Type "": 2D/3D polygon)
│   ├── Terrain (Type "terrain": 3D topography mesh)
│   └── 🌿 Landscape (Type "Group")
│       ├── Softscape (Type "softscape": trees, shrubs, lawns glTF)
│       │   ├── Tree_1 (Type "Plant")
│       │   └── Plant_1 (Type "Plant")
│       ├── 🪨 Hardscape (Type "hardscape": rocks, gravel, paths, walls glTF)
│       │   ├── Rock_1 (Type "Rock")
│       │   └── Boulder_1 (Type "Rock")
│       └── 💧 Waterscape (Type "waterscape": ponds, pools, fountains glTF)
│           ├── Pond_1 (Type "Water")
│           └── Fountain_1 (Type "Water")
│
└── 🏢 BuildingNode (Type "building")
    ├── LevelNode (Type "level")
    │   ├── Floor_Slab_1_1 (Type "Floor")
    │   ├── Ceiling_Slab_1_1 (Type "Ceiling")
    │   │   ├── Light_Fixture_1 (parent "Ceiling_Slab_1_1")
    │   │   └── AC_Return_1 (parent "Ceiling_Slab_1_1")
    │   ├── Wall_1_1 (Type "Wall")
    │   │   └── Window_1_1 (Type "Window", parent "Wall_1_1")
    │   ├── Wall_1_2 (Type "Wall")
    │   │   └── Door_1_1 (Type "Door", parent "Wall_1_2")
    │   ├── Wall_1_3 (Type "Wall")
    │   ├── 🛋️ Kitchen_Group (Type "Group")
    │   │   ├── Countertop_1 (parent "Kitchen_Group")
    │   │   ├── Fridge_1 (parent "Kitchen_Group")
    │   │   └── Stove_1 (parent "Kitchen_Group")
    │   ├── Couch_1 (Type "Furniture", parent "Level_1")
    │   └── Stair_to_L2 (Type "Stair", parent "Level_1")
    │
    ├── Level_2 (Type "Level")
    │   ├── Floor_Slab_2_1 (Type "Floor")
    │   ├── Ceiling_Slab_2_1 (Type "Ceiling")
    │   │   └── Fan_1 (parent "Ceiling_Slab_2_1")
    │   └── 🏠 Rooftop_Patio_Elements (Type "Group", parent "Level_2")
    │       └── Patio_Roof (Type "Roof", parent "Rooftop_Patio_Elements")
    │
    └── Top_Level (Type "Level")
        ├── Floor_Slab_3_1 (e.g., attic floor)
        └── 🏠 Main_Roof_Group (Type "Group", parent "Top_Level")
            ├── Gable_Roof_1 (Type "Roof")
            └── Jerkin_Roof_1 (Type "Roof")
 */
import './site/landscape/landscape-node'
import './site/property/property-node'
import './wall/wall-node'
import './column/column-node'
import './level/building/slab/slab-node'
import './item/item-node'
import './environment/environment-node'
import './site/site-node'
import './building/building-node'
import './level/level-node'
import './level/building/slab/slab-node'
import './level/building/window/window-node'
import './level/building/room/room-node'
import './level/building/custom-room/custom-room-node'
import './level/building/door/door-node'
import './level/building/column/column-node'
import z from 'zod'
import { RootNode } from './root-node'

export const SceneGraph = z.object({
  // version: z.string().default('0.1'),
  createdAt: z.string().default(new Date().toISOString()),
  updatedAt: z.string().default(new Date().toISOString()),
  root: RootNode,
})

export type SceneGraph = z.infer<typeof SceneGraph>
