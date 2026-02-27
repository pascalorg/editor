import { emitter, useScene } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { VisualJson, TreeView } from "@visual-json/react";
import { Camera, Download, Save, Trash2, Upload } from "lucide-react";
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/primitives/dialog";
import { Switch } from "@/components/ui/primitives/switch";
import useEditor from "@/store/use-editor";
import { AudioSettingsDialog } from "./audio-settings-dialog";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { useProjectStore } from "@/features/community/lib/projects/store";
import { updateProjectVisibility } from "@/features/community/lib/projects/actions";

type SceneNode = Record<string, unknown> & {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  parentId?: unknown;
  children?: unknown;
};

type SceneGraphNode = {
  id: string;
  type: string;
  name: string | null;
  parentId: string | null;
  children: SceneGraphNode[];
  missing?: true;
  cycle?: true;
};

type SceneGraphValue = {
  roots: SceneGraphNode[];
  detachedNodes?: SceneGraphNode[];
};

const isSceneNode = (value: unknown): value is SceneNode => {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as { id: unknown }).id === "string"
  );
};

const getChildIdsFromNode = (node: SceneNode): string[] => {
  if (!Array.isArray(node.children)) {
    return [];
  }

  const childIds = new Set<string>();

  for (const child of node.children) {
    if (typeof child === "string") {
      childIds.add(child);
      continue;
    }

    if (isSceneNode(child)) {
      childIds.add(child.id as string);
    }
  }

  return Array.from(childIds);
};

const buildSceneGraphValue = (
  nodes: Record<string, SceneNode>,
  rootNodeIds: string[],
): SceneGraphValue => {
  const childIdsByParent = new Map<string, Set<string>>();

  for (const [id, node] of Object.entries(nodes)) {
    const childIds = getChildIdsFromNode(node);
    if (childIds.length > 0) {
      childIdsByParent.set(id, new Set(childIds));
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (typeof node.parentId !== "string") {
      continue;
    }

    const siblings = childIdsByParent.get(node.parentId) ?? new Set<string>();
    siblings.add(id);
    childIdsByParent.set(node.parentId, siblings);
  }

  const visited = new Set<string>();

  const buildNode = (id: string, path: Set<string>): SceneGraphNode => {
    const node = nodes[id];
    if (!node) {
      return {
        id,
        type: "missing",
        name: null,
        parentId: null,
        missing: true,
        children: [],
      };
    }

    const nodeType = typeof node.type === "string" ? node.type : "unknown";
    const nodeName = typeof node.name === "string" ? node.name : null;
    const parentId = typeof node.parentId === "string" ? node.parentId : null;

    if (path.has(id)) {
      return {
        id,
        type: nodeType,
        name: nodeName,
        parentId,
        cycle: true,
        children: [],
      };
    }

    visited.add(id);
    const nextPath = new Set(path);
    nextPath.add(id);

    const childIds = Array.from(childIdsByParent.get(id) ?? []);
    return {
      id,
      type: nodeType,
      name: nodeName,
      parentId,
      children: childIds.map((childId) => buildNode(childId, nextPath)),
    };
  };

  const roots = rootNodeIds.map((id) => buildNode(id, new Set()));
  const detachedNodeIds = Object.keys(nodes).filter((id) => !visited.has(id));

  if (detachedNodeIds.length === 0) {
    return { roots };
  }

  return {
    roots,
    detachedNodes: detachedNodeIds.map((id) => buildNode(id, new Set())),
  };
};

export function SettingsPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nodes = useScene((state) => state.nodes);
  const rootNodeIds = useScene((state) => state.rootNodeIds);
  const setScene = useScene((state) => state.setScene);
  const clearScene = useScene((state) => state.clearScene);
  const resetSelection = useViewer((state) => state.resetSelection);
  const exportScene = useViewer((state) => state.exportScene);
  const setPhase = useEditor((state) => state.setPhase);
  const activeProject = useProjectStore((state) => state.activeProject);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const sceneGraphValue = useMemo(
    () => buildSceneGraphValue(nodes as Record<string, SceneNode>, rootNodeIds),
    [nodes, rootNodeIds],
  );
  const blockSceneGraphMutations = useCallback((event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const blockSceneGraphDeletion = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [],
  );

  const projectId = activeProject?.id;
  const isLocalProject = false; // Store only contains cloud projects

  const handleExport = async () => {
    if (exportScene) {
      await exportScene();
    }
  };

  const handleSaveBuild = () => {
    const sceneData = { nodes, rootNodeIds };
    const json = JSON.stringify(sceneData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const date = new Date().toISOString().split("T")[0];
    link.download = `layout_${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.nodes && data.rootNodeIds) {
          setScene(data.nodes, data.rootNodeIds);
          resetSelection();
          setPhase("site");
        }
      } catch (err) {
        console.error("Failed to load build:", err);
      }
    };
    reader.readAsText(file);

    // Reset input so the same file can be loaded again
    e.target.value = "";
  };

  const handleResetToDefault = () => {
    clearScene();
    resetSelection();
    setPhase("site");
  };

  const handleGenerateThumbnail = () => {
    if (!projectId) return;
    setIsGeneratingThumbnail(true);
    emitter.emit('camera-controls:generate-thumbnail', { projectId });
    setTimeout(() => setIsGeneratingThumbnail(false), 3000);
  };

  const handleVisibilityChange = async (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => {
    if (!projectId) return;

    // Optimistic update
    useProjectStore.setState((state) => ({
      activeProject: state.activeProject
        ? {
            ...state.activeProject,
            ...(field === 'isPrivate' && { is_private: value }),
            ...(field === 'showScansPublic' && { show_scans_public: value }),
            ...(field === 'showGuidesPublic' && { show_guides_public: value }),
          }
        : null,
    }));

    await updateProjectVisibility(projectId, { [field]: value });
  };

  return (
    <div className="flex flex-col gap-6 p-3">
      {/* Visibility Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-3">
          <label className="font-medium text-muted-foreground text-xs uppercase">
            Visibility
          </label>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Public</div>
              <div className="text-xs text-muted-foreground">
                {activeProject?.is_private ? 'Only you' : 'Anyone'} can view
              </div>
            </div>
            <Switch
              checked={!activeProject?.is_private}
              onCheckedChange={(checked) => handleVisibilityChange('isPrivate', !checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Show 3D Scans</div>
              <div className="text-xs text-muted-foreground">
                Visible to public viewers
              </div>
            </div>
            <Switch
              checked={activeProject?.show_scans_public ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showScansPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Show Floorplans</div>
              <div className="text-xs text-muted-foreground">
                Visible to public viewers
              </div>
            </div>
            <Switch
              checked={activeProject?.show_guides_public ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showGuidesPublic', checked)}
            />
          </div>
        </div>
      )}

      {/* Export Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          Export
        </label>
        <Button
          className="w-full justify-start gap-2"
          onClick={handleExport}
          variant="outline"
        >
          <Download className="size-4" />
          Export 3D Model
        </Button>
      </div>

      {/* Thumbnail Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">
            Thumbnail
          </label>
          {activeProject?.thumbnail_url && (
            <div className="rounded overflow-hidden border border-border aspect-video w-full bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeProject.thumbnail_url}
                alt="Project thumbnail"
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <Button
            className="w-full justify-start gap-2"
            onClick={handleGenerateThumbnail}
            variant="outline"
            disabled={isGeneratingThumbnail}
          >
            <Camera className="size-4" />
            {isGeneratingThumbnail ? 'Generating...' : 'Generate Thumbnail'}
          </Button>
        </div>
      )}

      {/* Save/Load Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          Save & Load
        </label>

        <Button
          className="w-full justify-start gap-2"
          onClick={handleSaveBuild}
          variant="outline"
        >
          <Save className="size-4" />
          Save Build
        </Button>

        <Button
          className="w-full justify-start gap-2"
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
        >
          <Upload className="size-4" />
          Load Build
        </Button>

        <input
          accept="application/json"
          className="hidden"
          onChange={handleFileLoad}
          ref={fileInputRef}
          type="file"
        />
      </div>

      {/* Audio Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          Audio
        </label>
        <AudioSettingsDialog />
      </div>

      {/* Keyboard Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          Keyboard
        </label>
        <KeyboardShortcutsDialog />
      </div>

      {/* Scene Graph */}
      <div className="space-y-1">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          Scene Graph
        </label>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="h-auto justify-start p-0 text-sm" variant="link">
              Explore scene graph
            </Button>
          </DialogTrigger>
          <DialogContent className="h-[80vh] max-w-[95vw] gap-0 overflow-hidden border-0 bg-[#1e1e1e] p-0 shadow-none sm:max-w-5xl">
            <DialogTitle className="sr-only">Scene Graph</DialogTitle>
            <div
              className="flex h-full w-full min-h-0 min-w-0 *:h-full *:w-full *:overflow-y-auto"
              onContextMenuCapture={blockSceneGraphMutations}
              onDragStartCapture={blockSceneGraphMutations}
              onDropCapture={blockSceneGraphMutations}
              onKeyDownCapture={blockSceneGraphDeletion}
            >
              <VisualJson value={sceneGraphValue}>
                <TreeView showCounts />
              </VisualJson>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Danger Zone */}
      <div className="space-y-2">
        <label className="font-medium text-destructive text-xs uppercase">
          Danger Zone
        </label>

        <Button
          className="w-full justify-start gap-2"
          onClick={handleResetToDefault}
          variant="destructive"
        >
          <Trash2 className="size-4" />
          Clear & Start New
        </Button>
      </div>
    </div>
  );
}
