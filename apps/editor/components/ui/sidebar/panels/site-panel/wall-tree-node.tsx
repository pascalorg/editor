import { type AnyNodeId, WallNode, useScene } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import Image from "next/image";
import { useState, useEffect } from "react";
import useEditor from "@/store/use-editor";
import { InlineRenameInput } from "./inline-rename-input";
import { TreeNode, TreeNodeWrapper, handleTreeSelection } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface WallTreeNodeProps {
  node: WallNode;
  depth: number;
  isLast?: boolean;
}

export function WallTreeNode({ node, depth, isLast }: WallTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const isSelected = selectedIds.includes(node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);

  useEffect(() => {
    if (selectedIds.length === 0) return;
    const nodes = useScene.getState().nodes;
    let isDescendant = false;
    for (const id of selectedIds) {
      let current = nodes[id as AnyNodeId];
      while (current && current.parentId) {
        if (current.parentId === node.id) {
          isDescendant = true;
          break;
        }
        current = nodes[current.parentId as AnyNodeId];
      }
      if (isDescendant) break;
    }
    if (isDescendant) {
      setExpanded(true);
    }
  }, [selectedIds, node.id]);

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

  const defaultName = "Wall";

  return (
    <TreeNodeWrapper
      nodeId={node.id}
      icon={<Image src="/icons/wall.png" alt="" width={14} height={14} className="object-contain" />}
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
      hasChildren={node.children.length > 0}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      isSelected={isSelected}
      isHovered={isHovered}
      isVisible={node.visible !== false}
      isLast={isLast}
      actions={<TreeNodeActions node={node} />}
    >
      {node.children.map((childId, index) => (
        <TreeNode key={childId} nodeId={childId} depth={depth + 1} isLast={index === node.children.length - 1} />
      ))}
    </TreeNodeWrapper>
  );
}
