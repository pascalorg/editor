import mitt from "mitt";
import { ItemNode, WallNode } from "../schema";
import { AnyNode } from "../schema/types";
export interface GridEvent {
  position: [number, number];
}

export interface NodeEvent {
  node: AnyNode;
  position: [number, number, number]; // [x, y, z] world coordinates
  normal?: [number, number, number]; // [x, y, z] normal vector
  stopPropagation: () => void;
}

export interface WallEvent extends NodeEvent {
  node: WallNode;
}

export interface ItemEvent extends NodeEvent {
  node: ItemNode;
}

type EditorEvents = {
  "grid:click": GridEvent;
  "grid:rightclick": GridEvent;
  "grid:move": GridEvent;
  "grid:double-click": GridEvent;
  "grid:enter": GridEvent;
  "grid:leave": GridEvent;
  "grid:pointerdown": GridEvent;
  "grid:pointerup": GridEvent;
  "wall:click": WallEvent;
  "wall:move": WallEvent;
  "wall:enter": WallEvent;
  "wall:leave": WallEvent;
  "wall:pointerdown": WallEvent;
  "wall:pointerup": WallEvent;
  "item:click": ItemEvent;
  "item:move": ItemEvent;
  "item:enter": ItemEvent;
  "item:leave": ItemEvent;
  "item:pointerdown": ItemEvent;
  "item:pointerup": ItemEvent;
};
export const emitter = mitt<EditorEvents>();
