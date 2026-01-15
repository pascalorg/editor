import { emitter, ItemNode, useRegistry } from "@pascal-app/core";
import { Clone } from "@react-three/drei/core/Clone";
import { useGLTF } from "@react-three/drei/core/Gltf";
import { ThreeEvent } from "@react-three/fiber/dist/declarations/src/core/events";
import { useCallback, useRef } from "react";
import { Group } from "three";

export const ItemRenderer = ({ node }: { node: ItemNode }) => {
  const ref = useRef<Group>(null!);
  const { scene, nodes } = useGLTF(node.asset.src);

  useRegistry(node.id, node.type, ref);

  if (nodes.cutout) {
    nodes.cutout.visible = false;
  }

  //  Event handlers

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // Only emit events for left-click (button 0)
      if (e.button !== 0) return;

      const eventData = {
        node,
        position: [e.point.x, e.point.y, e.point.z] as [number, number, number],
        normal: e.face
          ? ([e.face.normal.x, e.face.normal.y, e.face.normal.z] as [
              number,
              number,
              number
            ])
          : undefined,
        stopPropagation: () => e.stopPropagation(),
      };
      emitter.emit("item:pointerdown", eventData);
    },
    [node]
  );

  const onClick = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // Only emit events for left-click (button 0)
      if (e.button !== 0) return;

      const eventData = {
        node,
        position: [e.point.x, e.point.y, e.point.z] as [number, number, number],
        normal: e.face
          ? ([e.face.normal.x, e.face.normal.y, e.face.normal.z] as [
              number,
              number,
              number
            ])
          : undefined,
        stopPropagation: () => e.stopPropagation(),
      };
      emitter.emit("item:click", eventData);
    },
    [node]
  );

  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // Only emit events for left-click (button 0)
      if (e.button !== 0) return;

      emitter.emit("item:pointerup", {
        node,
        position: [e.point.x, e.point.y, e.point.z],
        normal: e.face
          ? ([e.face.normal.x, e.face.normal.y, e.face.normal.z] as [
              number,
              number,
              number
            ])
          : undefined,
        stopPropagation: () => e.stopPropagation(),
      });
    },
    [node]
  );

  const onPointerEnter = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      emitter.emit("item:enter", {
        node,
        position: [e.point.x, e.point.y, e.point.z],
        normal: e.face
          ? [e.face.normal.x, e.face.normal.y, e.face.normal.z]
          : undefined,
        stopPropagation: () => e.stopPropagation(),
      });
    },
    [node]
  );

  const onPointerLeave = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      emitter.emit("item:leave", {
        node,
        position: [e.point.x, e.point.y, e.point.z],
        normal: e.face
          ? [e.face.normal.x, e.face.normal.y, e.face.normal.z]
          : undefined,
        stopPropagation: () => e.stopPropagation(),
      });
    },
    [node]
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      emitter.emit("item:move", {
        node,
        position: [e.point.x, e.point.y, e.point.z],
        normal: e.face
          ? [e.face.normal.x, e.face.normal.y, e.face.normal.z]
          : undefined,
        stopPropagation: () => e.stopPropagation(),
      });
    },
    [node]
  );

  return (
    <Clone
      ref={ref}
      object={scene}
      position={node.position}
      rotation={node.rotation}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onPointerUp={onPointerUp}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
    />
  );
};
