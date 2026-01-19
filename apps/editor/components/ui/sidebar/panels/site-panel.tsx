import { useScene } from "@pascal-app/core";

export function SitePanel() {
  const rootNodes = useScene((state) => state.rootNodeIds);
  return (
    <div>
      {rootNodes.map((nodeId) => (
        <div key={nodeId}>{nodeId}</div>
      ))}
    </div>
  );
}
