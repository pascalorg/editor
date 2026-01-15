"use client";

import { AnyNode, useScene } from "@pascal-app/core";
import { ItemRenderer } from "./item/item-renderer";
import { LevelRenderer } from "./level/level-renderer";
import { WallRenderer } from "./wall/wall-renderer";

export const NodeRenderer = ({ nodeId }: { nodeId: AnyNode["id"] }) => {
  const node = useScene((state) => state.nodes[nodeId]);

  if (!node) return null;

  return (
    <>
      {node.type === "level" && <LevelRenderer node={node} />}
      {node.type === "item" && <ItemRenderer node={node} />}
      {node.type === "wall" && <WallRenderer node={node} />}
    </>
  );
};
