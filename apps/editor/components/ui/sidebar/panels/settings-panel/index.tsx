import { useScene } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/primitives/button";
import useEditor from "@/store/use-editor";

export function SettingsPanel() {
  const clearScene = useScene((state) => state.clearScene);
  const resetSelection = useViewer((state) => state.resetSelection);
  const setPhase = useEditor((state) => state.setPhase);

  const handleResetToDefault = () => {
    clearScene();
    resetSelection();
    setPhase("site");
  };

  return (
    <div className="flex flex-col gap-6 p-3">
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
