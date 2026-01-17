import dedent from "dedent";
import { z } from "zod";
import { BaseNode, nodeType, objectId } from "../base";

const assetSchema = z.object({
  category: z.string(),
  name: z.string(),
  thumbnail: z.string(),
  src: z.string(),
  dimensions: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]), // [w, h, d]
  attachTo: z.enum(["wall", "wall-side", "ceiling"]).optional(),
  // These are "Corrective" transforms to normalize the GLB
  offset: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
});

export type AssetInput = z.input<typeof assetSchema>;

export const ItemNode = BaseNode.extend({
  id: objectId("item"),
  type: nodeType("item"),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  side: z.enum(["front", "back"]).optional(),

  asset: assetSchema,
}).describe(dedent`Item node - used to represent a item in the building
  - position: position in level coordinate system (or parent coordinate system if attached)
  - rotation: rotation in level coordinate system (or parent coordinate system if attached)
  - asset: asset data
    - category: category of the item
    - dimensions: size in level coordinate system
    - src: url of the model
    - attachTo: where to attach the item (wall, wall-side, ceiling)
    - offset: corrective position offset for the model
    - rotation: corrective rotation for the model
    - scale: corrective scale for the model
`);

export type ItemNode = z.infer<typeof ItemNode>;
