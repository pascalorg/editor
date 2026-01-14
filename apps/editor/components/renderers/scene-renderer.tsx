"use client";

import { AnyNode, LevelNode, useScene, WallNode } from "@pascal-app/core";
import { useRef } from "react";
import * as THREE from "three/webgpu";

export const SceneRenderer = () => {
  const rootNodes = useScene((state) => state.rootNodeIds);

  return rootNodes.map((nodeId) => (
    <NodeRenderer key={nodeId} nodeId={nodeId} />
  ));
};

const NodeRenderer = ({ nodeId }: { nodeId: AnyNode["id"] }) => {
  const node = useScene((state) => state.nodes[nodeId]);

  if (!node) return null;

  return (
    <>
      {node.type === "level" && <LevelRenderer node={node} />}
      {/* {node.type === "item" && <ItemRenderer node={node} />} */}
      {node.type === "wall" && <WallRenderer node={node} />}
    </>
  );
};

const LevelRenderer = ({ node }: { node: LevelNode }) => {
  const ref = useRef<THREE.Group>(null!);

  // useRegistry(node.id, node.type, ref);
  return (
    <group ref={ref}>
      <mesh receiveShadow>
        <boxGeometry args={[10, 0.1, 10]} />
        <meshStandardMaterial color="orange" />
      </mesh>
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </group>
  );
};

const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<THREE.Mesh>(null!);
  console.log("node", node);

  // useRegistry(node.id, "wall", ref);

  return (
    <mesh ref={ref} castShadow receiveShadow>
      {/* WallSystem will replace this geometry in the next frame */}
      <boxGeometry args={[1, 2, 0.1]} />
      <meshStandardMaterial color="lightgray" />

      {/* If you want windows to be inside the wall's local coordinate system:
         render children here. 
      */}
      {/* {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))} */}
    </mesh>
  );
};
