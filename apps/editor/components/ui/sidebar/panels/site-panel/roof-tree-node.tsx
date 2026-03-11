import { type AnyNodeId, type RoofNode, type RoofSegmentNode, useScene } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { AnimatePresence } from "motion/react";
import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import useEditor from "@/store/use-editor";
import { InlineRenameInput } from "./inline-rename-input";
import { TreeNodeWrapper, handleTreeSelection } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";
import { DropIndicatorLine, useTreeNodeDrag } from "./tree-node-drag";

interface RoofTreeNodeProps {
  node: RoofNode;
  depth: number;
  isLast?: boolean;
}

export function RoofTreeNode({ node, depth, isLast }: RoofTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const isSelected = selectedIds.includes(node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);
  const nodes = useScene((state) => state.nodes);
  const { drag, dropTarget } = useTreeNodeDrag();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const handled = handleTreeSelection(e, node.id, selectedIds, setSelection);
    if (!handled && useEditor.getState().phase === "furnish") {
      useEditor.getState().setPhase("structure");
    }
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const handleMouseEnter = () => {
    setHoveredId(node.id);
  };

  const handleMouseLeave = () => {
    setHoveredId(null);
  };

  const segments = (node.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as RoofSegmentNode | undefined)
    .filter((n): n is RoofSegmentNode => n?.type === "roof-segment");

  const hasSelectedChild = segments.some((seg) => selectedIds.includes(seg.id));

  useEffect(() => {
    if (isSelected || hasSelectedChild) {
      setExpanded(true);
    }
  }, [isSelected, hasSelectedChild]);

  // Auto-expand when a segment is being dragged over this roof
  const isDropTarget = drag !== null && dropTarget?.parentId === node.id;
  useEffect(() => {
    if (isDropTarget && !expanded) {
      setExpanded(true);
    }
  }, [isDropTarget, expanded]);

  const segmentCount = segments.length;
  const defaultName = `Roof (${segmentCount} segment${segmentCount !== 1 ? "s" : ""})`;

  // Hide the dragged segment from every roof while dragging
  const visibleSegments = drag
    ? segments.filter((seg) => seg.id !== drag.nodeId)
    : segments;

  const isValidDropTarget = drag !== null && drag.nodeId !== node.id;

  return (
    <div data-drop-target={node.id}>
      <TreeNodeWrapper
        nodeId={node.id}
        icon={<Image src="/icons/roof.png" alt="" width={14} height={14} className="object-contain" />}
        label={
          <InlineRenameInput
            node={node}
            isEditing={isEditing}
            onStopEditing={() => setIsEditing(false)}
            onStartEditing={() => setIsEditing(true)}
            defaultName={defaultName}
          />
        }
        depth={depth}
        hasChildren={segments.length > 0}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        isSelected={isSelected}
        isHovered={isHovered || isDropTarget}
        isVisible={node.visible !== false}
        isLast={isLast && !expanded}
        isDropTarget={isValidDropTarget && isDropTarget}
        actions={<TreeNodeActions node={node} />}
      >
        {visibleSegments.map((seg, i) => {
          const showIndicatorBefore = isDropTarget && dropTarget?.insertIndex === i;
          const showIndicatorAfter =
            isDropTarget &&
            i === visibleSegments.length - 1 &&
            dropTarget?.insertIndex !== undefined &&
            dropTarget.insertIndex > i;

          return (
            <div key={seg.id}>
              <AnimatePresence>
                {showIndicatorBefore && <DropIndicatorLine key="indicator-before" />}
              </AnimatePresence>
              <RoofSegmentTreeNode
                node={seg}
                depth={depth + 1}
                isLast={isLast && i === visibleSegments.length - 1 && !showIndicatorAfter}
              />
              <AnimatePresence>
                {showIndicatorAfter && <DropIndicatorLine key="indicator-after" />}
              </AnimatePresence>
            </div>
          );
        })}
        <AnimatePresence>
          {isDropTarget && visibleSegments.length === 0 && <DropIndicatorLine />}
        </AnimatePresence>
      </TreeNodeWrapper>
    </div>
  );
}

function RoofSegmentTreeNode({
  node,
  depth,
  isLast,
}: {
  node: RoofSegmentNode;
  depth: number;
  isLast?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const isSelected = selectedIds.includes(node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);
  const { startDrag, isDragging } = useTreeNodeDrag();

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    e.stopPropagation();
    handleTreeSelection(e, node.id, selectedIds, setSelection);
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const label = `${node.roofType.charAt(0).toUpperCase() + node.roofType.slice(1)} (${node.width.toFixed(1)}×${node.depth.toFixed(1)}m)`;
      startDrag(node.id, node.type, node.parentId as string, label, e.clientX, e.clientY);
    },
    [node.id, node.type, node.parentId, node.roofType, node.width, node.depth, startDrag],
  );

  const defaultName = `${node.roofType.charAt(0).toUpperCase() + node.roofType.slice(1)} (${node.width.toFixed(1)}x${node.depth.toFixed(1)}m)`;

  return (
    <div data-drop-child={node.id}>
      <TreeNodeWrapper
        nodeId={node.id}
        icon={<Image src="/icons/roof.png" alt="" width={14} height={14} className="object-contain opacity-60" />}
        label={
          <InlineRenameInput
            node={node}
            isEditing={isEditing}
            onStopEditing={() => setIsEditing(false)}
            onStartEditing={() => setIsEditing(true)}
            defaultName={defaultName}
          />
        }
        depth={depth}
        hasChildren={false}
        expanded={false}
        onToggle={() => {}}
        onClick={handleClick}
        onDoubleClick={() => setIsEditing(true)}
        onMouseEnter={() => setHoveredId(node.id)}
        onMouseLeave={() => setHoveredId(null)}
        onPointerDown={handlePointerDown}
        isSelected={isSelected}
        isHovered={isHovered}
        isVisible={node.visible !== false}
        isLast={isLast}
        isDraggable
        actions={<TreeNodeActions node={node} />}
      />
    </div>
  );
}
