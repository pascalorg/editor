import { type AnyNodeId, type RoofNode, type RoofSegmentNode, useScene } from "@pascal-app/core";
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
  const [expanded, setExpanded] = useState(false);
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const isSelected = selectedIds.includes(node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);
  const nodes = useScene((state) => state.nodes);

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

  const segmentCount = segments.length;
  const defaultName = `Roof (${segmentCount} segment${segmentCount !== 1 ? "s" : ""})`;

  return (
    <>
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
        isHovered={isHovered}
        isVisible={node.visible !== false}
        isLast={isLast && !expanded}
        actions={<TreeNodeActions node={node} />}
      />
      {expanded &&
        segments.map((seg, i) => (
          <RoofSegmentTreeNode
            key={seg.id}
            node={seg}
            depth={depth + 1}
            isLast={isLast && i === segments.length - 1}
          />
        ))}
    </>
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

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleTreeSelection(e, node.id, selectedIds, setSelection);
  };

  const defaultName = `${node.roofType.charAt(0).toUpperCase() + node.roofType.slice(1)} (${node.width.toFixed(1)}x${node.depth.toFixed(1)}m)`;

  return (
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
      isSelected={isSelected}
      isHovered={isHovered}
      isVisible={node.visible !== false}
      isLast={isLast}
      actions={<TreeNodeActions node={node} />}
    />
  );
}
