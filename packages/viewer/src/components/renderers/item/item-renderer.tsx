import { ItemNode, useRegistry } from "@pascal-app/core";
import { Clone } from "@react-three/drei/core/Clone";
import { useGLTF } from "@react-three/drei/core/Gltf";
import { useRef } from "react";
import { Group } from "three";

export const ItemRenderer = ({ node }: { node: ItemNode }) => {
  const ref = useRef<Group>(null!);
  const { scene, nodes } = useGLTF(node.asset.src);

  useRegistry(node.id, node.type, ref);

  if (nodes.cutout) {
    nodes.cutout.visible = false;
  }

  return (
    <Clone
      ref={ref}
      object={scene}
      position={node.position}
      rotation={node.rotation}
    />
  );
};
