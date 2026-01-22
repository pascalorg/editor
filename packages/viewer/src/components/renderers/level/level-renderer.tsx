import { type LevelNode, useRegistry, useScene } from "@pascal-app/core";
import { useRef } from "react";
import type { Group } from "three";
import { useShallow } from "zustand/shallow";
import { NodeRenderer } from "../node-renderer";
import { ZoneRenderer } from "../zone/zone-renderer";

export const LevelRenderer = ({ node }: { node: LevelNode }) => {
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
      <LevelZones levelId={node.id} />
    </group>
  );
};

const LevelZones = ({ levelId }: { levelId: LevelNode["id"] }) => {
  const zoneIds = useScene(
    useShallow((s) =>
      s.zoneIds.filter((id) => s.zones[id]?.levelId === levelId),
    ),
  );

  return zoneIds.map((zoneId) => <ZoneRenderer key={zoneId} zoneId={zoneId} />);
};
