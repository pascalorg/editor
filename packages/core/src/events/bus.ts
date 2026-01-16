import mitt from "mitt";
import { ItemNode, WallNode } from "../schema";
import { AnyNode } from "../schema/types";

// Base event interfaces
export interface GridEvent {
  position: [number, number];
}

export interface NodeEvent<T extends AnyNode = AnyNode> {
  node: T;
  position: [number, number, number];
  normal?: [number, number, number];
  stopPropagation: () => void;
}

export type WallEvent = NodeEvent<WallNode>;
export type ItemEvent = NodeEvent<ItemNode>;

// Event suffixes - exported for use in hooks
export const eventSuffixes = [
  "click",
  "move",
  "enter",
  "leave",
  "pointerdown",
  "pointerup",
  "context-menu",
  "double-click",
] as const;

export type EventSuffix = (typeof eventSuffixes)[number];

type NodeEvents<T extends string, E> = {
  [K in `${T}:${EventSuffix}`]: E;
};

type GridEvents = {
  [K in `grid:${EventSuffix}`]: GridEvent;
};

type EditorEvents = GridEvents &
  NodeEvents<"wall", WallEvent> &
  NodeEvents<"item", ItemEvent>;

export const emitter = mitt<EditorEvents>();
