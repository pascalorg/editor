import { emitter, useRegistry, WallNode } from "@pascal-app/core";
import { ThreeEvent } from "@react-three/fiber";
import { useCallback, useRef } from "react";
import { Mesh } from "three";
import { NodeRenderer } from "../node-renderer";

export const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!);

  useRegistry(node.id, "wall", ref);

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
      emitter.emit("wall:pointerdown", eventData);
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
      emitter.emit("wall:click", eventData);
    },
    [node]
  );

  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // Only emit events for left-click (button 0)
      if (e.button !== 0) return;

      emitter.emit("wall:pointerup", {
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
      emitter.emit("wall:enter", {
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
      emitter.emit("wall:leave", {
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
      emitter.emit("wall:move", {
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
    <mesh
      ref={ref}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      onClick={onClick}
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
