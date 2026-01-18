import useEditor from "@/store/use-editor";
import {
  emitter,
  GridEvent,
  ItemNode,
  sceneRegistry,
  useRegistry,
  useScene,
  useSpatialQuery,
  WallNode,
} from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { useFrame } from "@react-three/fiber";
import { use, useEffect, useRef } from "react";
import { BoxGeometry, Line, Mesh, Vector3 } from "three";
import { randInt } from "three/src/math/MathUtils.js";

export const ItemTool: React.FC = () => {
  const cursorRef = useRef<Mesh>(null!);
  const draftItem = useRef<ItemNode | null>(null);
  const gridPosition = useRef(new Vector3(0, 0, 0));
  const selectedItem = useEditor((state) => state.selectedItem);
  const { canPlace } = useSpatialQuery();

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
        0,
        gridPosition.current.z,
      );
      if (draftItem.current) {
        draftItem.current.position = [
          gridPosition.current.x,
          0,
          gridPosition.current.z,
        ];

        const currentLevelId = useViewer.getState().currentLevelId;
        if (currentLevelId) {
          const placeable = canPlace(
            currentLevelId,
            [gridPosition.current.x, 0, gridPosition.current.z],
            selectedItem.dimensions,
            [0, 0, 0],
          );
          console.log(
            "placeable",
            placeable,
            [gridPosition.current.x, 0, gridPosition.current.z],
            selectedItem.dimensions,
          );
        }
      }
    };
    const onGridClick = (event: GridEvent) => {
      const { currentLevelId } = useViewer.getState();

      if (!currentLevelId || !draftItem.current) return;

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

    const setupBoundingBox = () => {
      const boxGeometry = new BoxGeometry(
        selectedItem.dimensions[0],
        selectedItem.dimensions[1],
        selectedItem.dimensions[2],
      );
      boxGeometry.translate(0, selectedItem.dimensions[1] / 2, 0);
      cursorRef.current.geometry = boxGeometry;
    };
    setupBoundingBox();

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
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color="red" wireframe />
      </mesh>
    </group>
  );
};
