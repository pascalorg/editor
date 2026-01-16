import {
  emitter,
  EventSuffix,
  ItemEvent,
  ItemNode,
  WallEvent,
  WallNode,
} from "@pascal-app/core";
import { ThreeEvent } from "@react-three/fiber";

type NodeConfig = {
  item: { node: ItemNode; event: ItemEvent };
  wall: { node: WallNode; event: WallEvent };
};

type NodeType = keyof NodeConfig;

export function useNodeEvents<T extends NodeType>(node: NodeConfig[T]["node"], type: T) {
  const emit = (suffix: EventSuffix, e: ThreeEvent<PointerEvent>) => {
    const eventKey = `${type}:${suffix}` as `${T}:${EventSuffix}`;
    const payload = {
      node,
      position: [e.point.x, e.point.y, e.point.z],
      normal: e.face
        ? [e.face.normal.x, e.face.normal.y, e.face.normal.z]
        : undefined,
      stopPropagation: () => e.stopPropagation(),
    } as NodeConfig[T]["event"];

    emitter.emit(eventKey, payload);
  };

  return {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      emit("pointerdown", e);
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      emit("pointerup", e);
    },
    onClick: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      emit("click", e);
    },
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => emit("enter", e),
    onPointerLeave: (e: ThreeEvent<PointerEvent>) => emit("leave", e),
    onPointerMove: (e: ThreeEvent<PointerEvent>) => emit("move", e),
    onDoubleClick: (e: ThreeEvent<PointerEvent>) => emit("double-click", e),
    onContextMenu: (e: ThreeEvent<PointerEvent>) => emit("context-menu", e),
  };
}