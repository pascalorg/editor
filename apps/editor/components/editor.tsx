"use client";

import { useScene } from "@pascal-app/core";
import { Viewer } from "@pascal-app/viewer";

export default function Editor() {
  return (
    <div className="w-full h-full bg-pink-50">
      <LevelModeSwitcher />
      <Viewer />
    </div>
  );
}

const LevelModeSwitcher = () => {
  const setLevelMode = useScene((state) => state.setLevelMode);
  const levelMode = useScene((state) => state.levelMode);

  return (
    <div className="absolute top-4 left-4 z-10 flex gap-2">
      <button
        className={`px-4 py-2 rounded ${
          levelMode === "exploded" ? "bg-blue-500 text-white" : "bg-white"
        }`}
        onClick={() => setLevelMode("exploded")}
      >
        Exploded
      </button>
      <button
        className={`px-4 py-2 rounded ${
          levelMode === "stacked" ? "bg-blue-500 text-white" : "bg-white"
        }`}
        onClick={() => setLevelMode("stacked")}
      >
        Stacked
      </button>
    </div>
  );
};
