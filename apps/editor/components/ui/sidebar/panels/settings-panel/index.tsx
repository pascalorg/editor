import { emitter, useScene } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Camera, Download, Save, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/primitives/button";
import useEditor from "@/store/use-editor";
import { AudioSettingsDialog } from "./audio-settings-dialog";
import { useProjectStore } from "@/features/community/lib/projects/store";

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

  return (
    <div className="flex flex-col gap-6 p-3">
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
