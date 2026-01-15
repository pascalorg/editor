import z from "zod";
import { BuildingNode } from "./nodes/building";
import { ItemNode } from "./nodes/item";
import { LevelNode } from "./nodes/level";
import { SiteNode } from "./nodes/site";
import { WallNode } from "./nodes/wall";

export const AnyNode = z.discriminatedUnion("type", [
  SiteNode,
  BuildingNode,
  LevelNode,
  WallNode,
  ItemNode,
]);

export type AnyNode = z.infer<typeof AnyNode>;
export type AnyNodeType = AnyNode["type"];
export type AnyNodeId = AnyNode["id"];
