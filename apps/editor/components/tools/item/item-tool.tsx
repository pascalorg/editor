import useEditor from "@/store/use-editor";
import {
  emitter,
  GridEvent,
  ItemNode,
  sceneRegistry,
  useRegistry,
  useScene,
  WallNode,
} from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { useFrame } from "@react-three/fiber";
import { use, useEffect, useRef } from "react";
import { Line, Mesh, Vector3 } from "three";
import { randInt } from "three/src/math/MathUtils.js";

export const ItemTool: React.FC = () => {
  const cursorRef = useRef<Mesh>(null);
  const draftItem = useRef<ItemNode | null>(null);
  const gridPosition = useRef(new Vector3(0, 0, 0));
  const selectedItem = useEditor((state) => state.selectedItem);

  useEffect(() => {
    if (!selectedItem) {
      return;
    }
    const createDraftItem = () => {
      const { currentLevelId } = useViewer.getState();
      if (!currentLevelId) {
        return null;
      }
      useScene.temporal.getState().pause();
      draftItem.current = ItemNode.parse({
        position: [
          gridPosition.current.x,
          gridPosition.current.y,
          gridPosition.current.z,
        ],
        name: "Draft Item",
        asset: selectedItem,
      });
      useScene.getState().createNode(draftItem.current, currentLevelId);
    };
    createDraftItem();

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return;

      gridPosition.current.set(
        Math.round(event.position[0] * 2) / 2,
        0,
        Math.round(event.position[1] * 2) / 2,
      );
      cursorRef.current.position.set(
        gridPosition.current.x,
        0.1,
        gridPosition.current.z,
      );
      if (draftItem.current) {
        draftItem.current.position = [
          gridPosition.current.x,
          0,
          gridPosition.current.z,
        ];
      }
    };
    const onGridClick = (event: GridEvent) => {
      const { currentLevelId } = useViewer.getState();

      console.log("oh", currentLevelId, draftItem.current);
      if (!currentLevelId || !draftItem.current) return;

      console.log("oh");
      useScene.temporal.getState().resume();
      useScene.getState().updateNode(draftItem.current.id, {
        position: [
          gridPosition.current.x,
          gridPosition.current.y,
          gridPosition.current.z,
        ],
      });
      draftItem.current = null;

      useScene.temporal.getState().pause();
      createDraftItem();
    };

    emitter.on("grid:move", onGridMove);
    emitter.on("grid:click", onGridClick);

    return () => {
      if (draftItem.current) {
        useScene.getState().deleteNode(draftItem.current.id);
      }
      emitter.off("grid:move", onGridMove);
      emitter.off("grid:click", onGridClick);
    };
  }, [selectedItem]);

  useFrame((_, delta) => {
    if (draftItem.current) {
      const draftItemMesh = sceneRegistry.nodes.get(draftItem.current.id);
      if (draftItemMesh) {
        draftItemMesh.position.lerp(gridPosition.current, delta * 20);
      }
    }
  });

  return (
    <group>
      <mesh ref={cursorRef}>
        <boxGeometry args={[0.2, 0.2, 0.2]} />
        <meshStandardMaterial color="red" />
      </mesh>
    </group>
  );
};
