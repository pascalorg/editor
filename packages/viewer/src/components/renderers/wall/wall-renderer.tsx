import { useRegistry, WallNode } from "@pascal-app/core";
import { useRef } from "react";
import { Mesh } from "three";
import { NodeRenderer } from "../node-renderer";
import { useNodeEvents } from "../../../hooks/use-node-events";

export const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!);

  useRegistry(node.id, "wall", ref);

  const handlers = useNodeEvents(node, "wall");

  return (
    <mesh
      ref={ref}
      castShadow
      receiveShadow
      {...handlers}
    >
      {/* WallSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
      <meshStandardMaterial color="lightgray" />

      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </mesh>
  );
};
