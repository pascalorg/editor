import { RoofNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import Image from "next/image";
import { useState } from "react";
import useEditor from "@/store/use-editor";
import { InlineRenameInput } from "./inline-rename-input";
import { TreeNodeWrapper, handleTreeSelection } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface RoofTreeNodeProps {
  node: RoofNode;
  depth: number;
  isLast?: boolean;
}

export function RoofTreeNode({ node, depth, isLast }: RoofTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const isSelected = selectedIds.includes(node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);

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

  // Calculate dimensions: length × total width (leftWidth + rightWidth)
  const totalWidth = node.leftWidth + node.rightWidth;
  const sizeLabel = `${node.length.toFixed(1)}×${totalWidth.toFixed(1)}m`;
  const defaultName = `Roof (${sizeLabel})`;

  return (
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
      hasChildren={false}
      expanded={false}
      onToggle={() => {}}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      isSelected={isSelected}
      isHovered={isHovered}
      isVisible={node.visible !== false}
      isLast={isLast}
      actions={<TreeNodeActions node={node} />}
    />
  );
}
