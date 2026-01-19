import useEditor from "@/store/use-editor";
import {
  emitter,
  GridEvent,
  ItemNode,
  sceneRegistry,
  useRegistry,
  useScene,
  useSpatialQuery,
  WallEvent,
  WallNode,
} from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { useFrame } from "@react-three/fiber";
import { is } from "@react-three/fiber/dist/declarations/src/core/utils";
import { use, useEffect, useRef } from "react";
import { BoxGeometry, Line, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { randInt } from "three/src/math/MathUtils.js";

export const ItemTool: React.FC = () => {
  const cursorRef = useRef<Mesh>(null!);
  const draftItem = useRef<ItemNode | null>(null);
  const gridPosition = useRef(new Vector3(0, 0, 0));
  const selectedItem = useEditor((state) => state.selectedItem);
  const { canPlaceOnFloor, canPlaceOnWall } = useSpatialQuery();
  const isOnWall = useRef(false);

  useEffect(() => {
    if (!selectedItem) {
      return;
    }

    let currentWallId: string | null = null;

    const checkCanPlace = () => {
      const currentLevelId = useViewer.getState().currentLevelId;
      if (currentLevelId && draftItem.current) {
        let placeable = true;
        if (draftItem.current.asset.attachTo) {
          if (!isOnWall.current || !currentWallId) {
            placeable = false;
          } else {
            const result = canPlaceOnWall(
              currentLevelId,
              currentWallId as WallNode["id"],
              gridPosition.current.x,
              gridPosition.current.y,
              draftItem.current.asset.dimensions,
              [draftItem.current.id],
            );
            placeable = result.valid;
          }
        } else {
          placeable = canPlaceOnFloor(
            currentLevelId,
            [gridPosition.current.x, 0, gridPosition.current.z],
            draftItem.current.asset.dimensions,
            [0, 0, 0],
            [draftItem.current.id],
          ).valid;
        }
        if (placeable) {
          (cursorRef.current.material as MeshStandardMaterial).color.set(
            "green",
          );
          return true;
        } else {
          (cursorRef.current.material as MeshStandardMaterial).color.set("red");
          return false;
        }
      }
    };
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
        name: selectedItem.name,
        asset: selectedItem,
      });
      useScene.getState().createNode(draftItem.current, currentLevelId);
      checkCanPlace();
    };
    createDraftItem();

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return;

      if (isOnWall.current) return;

      gridPosition.current.set(
        Math.round(event.position[0] * 2) / 2,
        0,
        Math.round(event.position[2] * 2) / 2,
      );
      cursorRef.current.position.set(
        gridPosition.current.x,
        event.position[1],
        gridPosition.current.z,
      );
      checkCanPlace();
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
      if (isOnWall.current) return;

      if (!currentLevelId || !draftItem.current || !checkCanPlace()) return;

      useScene.temporal.getState().resume();
      useScene.getState().updateNode(draftItem.current.id, {
        position: [gridPosition.current.x, 0, gridPosition.current.z],
      });
      draftItem.current = null;

      useScene.temporal.getState().pause();
      createDraftItem();
    };

    const onWallEnter = (event: WallEvent) => {
      if (
        draftItem.current?.asset.attachTo === "wall" ||
        draftItem.current?.asset.attachTo === "wall-side"
      ) {
        event.stopPropagation();
        isOnWall.current = true;
        currentWallId = event.node.id;
        gridPosition.current.set(
          Math.round(event.localPosition[0] * 2) / 2,
          Math.round(event.localPosition[1] * 2) / 2,
          Math.round(event.localPosition[2] * 2) / 2,
        );
        draftItem.current.parentId = event.node.id;
        useScene.getState().updateNode(draftItem.current.id, {
          position: [
            gridPosition.current.x,
            gridPosition.current.y,
            gridPosition.current.z,
          ],
          parentId: event.node.id,
        });
        checkCanPlace();
      }
    };

    const onWallLeave = (event: WallEvent) => {
      isOnWall.current = false;
      currentWallId = null;
      event.stopPropagation();
      if (!draftItem.current) return;
      const currentLevelId = useViewer.getState().currentLevelId;
      draftItem.current.parentId = currentLevelId;
      useScene.getState().updateNode(draftItem.current.id, {
        position: [
          gridPosition.current.x,
          gridPosition.current.y,
          gridPosition.current.z,
        ],
        parentId: currentLevelId,
      });
      checkCanPlace();
    };

    const onWallClick = (event: WallEvent) => {
      event.stopPropagation();
      if (!isOnWall.current) return;

      const currentLevelId = useViewer.getState().currentLevelId;
      if (!currentLevelId || !draftItem.current || !checkCanPlace()) return;

      useScene.temporal.getState().resume();
      useScene.getState().updateNode(draftItem.current.id, {
        position: [
          gridPosition.current.x,
          gridPosition.current.y,
          gridPosition.current.z,
        ],
        parentId: event.node.id,
      });
      useScene.getState().dirtyNodes.add(event.node.id);
      draftItem.current = null;

      useScene.temporal.getState().pause();
      createDraftItem();
      checkCanPlace();
    };

    const onWallMove = (event: WallEvent) => {
      if (isOnWall.current === false) return;
      event.stopPropagation();
      if (!draftItem.current) return;
      gridPosition.current.set(
        Math.round(event.localPosition[0] * 2) / 2,
        Math.round(event.localPosition[1] * 2) / 2,
        Math.round(event.localPosition[2] * 2) / 2,
      );
      cursorRef.current.position.set(
        Math.round(event.position[0] * 2) / 2,
        Math.round(event.position[1] * 2) / 2,
        Math.round(event.position[2] * 2) / 2,
      );

      const {
        node: { start, end },
      } = event;
      const dx = end[0] - start[0];
      const dz = end[1] - start[1];
      const { normal } = event;
      const wallAngle = Math.atan2(dx, dz);

      cursorRef.current.rotation.y = wallAngle + Math.PI / 2;
      const canPlace = checkCanPlace();
      if (draftItem.current && canPlace) {
        draftItem.current.position = [
          gridPosition.current.x,
          gridPosition.current.y,
          gridPosition.current.z,
        ];
        const draftItemMesh = sceneRegistry.nodes.get(draftItem.current.id);
        if (draftItemMesh) {
          draftItemMesh.position.copy(gridPosition.current);
        }

        useScene.getState().dirtyNodes.add(event.node.id);
      }
    };

    emitter.on("grid:move", onGridMove);
    emitter.on("grid:click", onGridClick);
    emitter.on("wall:enter", onWallEnter);
    emitter.on("wall:move", onWallMove);
    emitter.on("wall:click", onWallClick);
    emitter.on("wall:leave", onWallLeave);

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
      useScene.temporal.getState().resume();
      emitter.off("grid:move", onGridMove);
      emitter.off("grid:click", onGridClick);
      emitter.off("wall:enter", onWallEnter);
      emitter.off("wall:leave", onWallLeave);
      emitter.off("wall:click", onWallClick);
      emitter.off("wall:move", onWallMove);
    };
  }, [selectedItem]);

  useFrame((_, delta) => {
    if (draftItem.current && !isOnWall.current) {
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
