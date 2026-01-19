import { useScene } from "@pascal-app/core";
import { TreeNode } from "./tree-node";

export function SitePanel() {
  const rootNodeIds = useScene((state) => state.rootNodeIds);

  return (
    <div className="py-1">
      {rootNodeIds.map((nodeId) => (
        <TreeNode key={nodeId} nodeId={nodeId} />
      ))}
    </div>
  );
}
