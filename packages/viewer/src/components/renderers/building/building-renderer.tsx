import { BuildingNode, LevelNode, useRegistry } from "@pascal-app/core";
import { useRef } from "react";
import { Group } from "three";
import { NodeRenderer } from "../node-renderer";

export const BuildingRenderer = ({ node }: { node: BuildingNode }) => {
  const ref = useRef<Group>(null!);

  useRegistry(node.id, node.type, ref);
  return (
    <group ref={ref}>
      {/* <mesh receiveShadow>
        <boxGeometry args={[10, 0.1, 10]} />
        <meshStandardMaterial color="orange" />
      </mesh> */}
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </group>
  );
};
