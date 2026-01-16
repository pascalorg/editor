import { BuildingNode, useRegistry } from "@pascal-app/core";
import { useRef } from "react";
import { Group } from "three";
import { NodeRenderer } from "../node-renderer";
import { useNodeEvents } from "../../../hooks/use-node-events";

export const BuildingRenderer = ({ node }: { node: BuildingNode }) => {
  const ref = useRef<Group>(null!);

  useRegistry(node.id, node.type, ref);
  const handlers = useNodeEvents(node, "building");
  return (
    <group ref={ref} {...handlers}>
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </group>
  );
};
