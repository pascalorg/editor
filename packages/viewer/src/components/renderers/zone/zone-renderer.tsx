import { useRegistry, type Zone } from "@pascal-app/core";

import { useRef } from "react";
import type { Group } from "three";

export const ZoneRenderer = ({ zoneId }: { zoneId: Zone["id"] }) => {
  const ref = useRef<Group>(null!);
  useRegistry(zoneId, "zone", ref);

  return (
    <mesh ref={ref}>
      {/* <shapeGeometry /> */}
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicNodeMaterial color="pink" />
    </mesh>
  );
};
