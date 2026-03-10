"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { IconRail, type PanelId } from "./icon-rail";
import {
  ArrowUpCircle,
  ChevronDown,
  Clock3,
  RotateCcw,
  Save,
} from "lucide-react";
import { useScene } from "@pascal-app/core";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebarStore,
} from "@/components/ui/primitives/sidebar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/primitives/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";
import { cn } from "@/lib/utils";
import { SettingsPanel } from "./panels/settings-panel";
import { SitePanel } from "./panels/site-panel";
import {
  getProjectModel,
  getProjectVersionById,
  getProjectVersionList,
  getProjectVersionStatus,
  publishProjectModel,
  saveProjectModel,
  saveProjectVersion,
  type SceneGraph,
  type ProjectVersionListItem,
  type ProjectVersionStatus,
} from "@/features/community/lib/models/actions";
import { useProjectStore } from "@/features/community/lib/projects/store";
import { updateProjectName } from "@/features/community/lib/projects/actions";
import { applySceneGraphToEditor } from "@/features/community/lib/models/hooks";

function formatRelativeTime(value: string): string {
  const target = new Date(value).getTime();
  const now = Date.now();
  const diffSeconds = Math.max(1, Math.floor((now - target) / 1000));

  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}min ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;

  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears}y ago`;
}

export function AppSidebar() {
  type VersionAction = "save" | "savePublish" | "publish";
  type VersionItemAction = "restore" | "publish";

  const [activePanel, setActivePanel] = useState<PanelId>("site");
  const activeProject = useProjectStore((s) => s.activeProject);
  const isVersionPreviewMode = useProjectStore((s) => s.isVersionPreviewMode);
  const setIsVersionPreviewMode = useProjectStore((s) => s.setIsVersionPreviewMode);
  const setIsSceneLoading = useProjectStore((s) => s.setIsSceneLoading);
  const setAutosaveStatus = useProjectStore((s) => s.setAutosaveStatus);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [versionStatus, setVersionStatus] = useState<ProjectVersionStatus | null>(null);
  const [versionList, setVersionList] = useState<ProjectVersionListItem[]>([]);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [isVersionListLoading, setIsVersionListLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const [activeVersionAction, setActiveVersionAction] = useState<VersionAction | null>(null);
  const [activeVersionItemAction, setActiveVersionItemAction] = useState<{
    version: number;
    action: VersionItemAction;
  } | null>(null);
  const latestSceneSnapshotRef = useRef<SceneGraph | null>(null);
  const activeProjectId = activeProject?.id ?? null;

  useEffect(() => {
    // Widen default sidebar (288px → 432px) for better project title visibility
    const store = useSidebarStore.getState();
    if (store.width <= 288) {
      store.setWidth(432);
    }
  }, []);

  useEffect(() => {
    if (isEditingTitle) {
      setTitleValue(activeProject?.name || "Untitled Project");
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 0);
    }
  }, [isEditingTitle, activeProject?.name]);

  const handleSaveTitle = useCallback(async () => {
    const trimmed = titleValue.trim();
    if (trimmed && activeProject && trimmed !== activeProject.name) {
      // Optimistic update
      useProjectStore.setState((state) => ({
        activeProject: state.activeProject ? { ...state.activeProject, name: trimmed } : null,
        projects: state.projects.map((p) => p.id === activeProject.id ? { ...p, name: trimmed } : p)
      }));
      // Server update
      try {
        await updateProjectName(activeProject.id, trimmed);
      } catch (error) {
        console.error("Failed to update project name:", error);
      }
    }
    setIsEditingTitle(false);
  }, [titleValue, activeProject]);

  const applyVersionStatus = useCallback(
    (status: ProjectVersionStatus) => {
      if (!activeProjectId) return;

      const publishedVersion = status.publishedVersion ?? null;
      setVersionStatus(status);
      useProjectStore.setState((state) => ({
        activeProject: state.activeProject
          ? {
              ...state.activeProject,
              published_model_version: publishedVersion,
            }
          : null,
        projects: state.projects.map((project) =>
          project.id === activeProjectId
            ? {
                ...project,
                published_model_version: publishedVersion,
              }
            : project,
        ),
      }));
    },
    [activeProjectId],
  );

  const refreshVersionStatus = useCallback(async () => {
    if (!activeProjectId) {
      setVersionStatus(null);
      return;
    }

    const statusResult = await getProjectVersionStatus(activeProjectId);
    if (!statusResult.success || !statusResult.data) {
      return;
    }

    if (useProjectStore.getState().activeProject?.id !== activeProjectId) {
      return;
    }

    applyVersionStatus(statusResult.data);
  }, [activeProjectId, applyVersionStatus]);

  useEffect(() => {
    if (!activeProjectId) {
      setVersionStatus(null);
      return;
    }

    refreshVersionStatus();

    const intervalId = window.setInterval(() => {
      refreshVersionStatus();
    }, 12_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeProjectId, refreshVersionStatus]);

  const loadVersionList = useCallback(async () => {
    if (!activeProjectId) {
      setVersionList([]);
      return;
    }

    setIsVersionListLoading(true);
    try {
      const result = await getProjectVersionList(activeProjectId);
      if (!result.success || !result.data) {
        setVersionList([]);
        return;
      }

      setVersionList(result.data);
    } finally {
      setIsVersionListLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setVersionList([]);
      setPreviewVersion(null);
      setIsVersionPreviewMode(false);
      latestSceneSnapshotRef.current = null;
      return;
    }

    loadVersionList();
    setPreviewVersion(null);
    setIsVersionPreviewMode(false);
    latestSceneSnapshotRef.current = null;
  }, [activeProjectId, loadVersionList, setIsVersionPreviewMode]);

  useEffect(() => {
    if (isVersionsOpen) {
      loadVersionList();
    }
  }, [isVersionsOpen, loadVersionList]);

  const applySceneWithoutAutosave = useCallback(
    (sceneGraph: Parameters<typeof applySceneGraphToEditor>[0], keepPreviewMode: boolean) => {
      setIsVersionPreviewMode(true);
      applySceneGraphToEditor(sceneGraph);
      requestAnimationFrame(() => {
        setIsVersionPreviewMode(keepPreviewMode);
      });
    },
    [setIsVersionPreviewMode],
  );

  const snapshotCurrentSceneGraph = useCallback((): SceneGraph => {
    const { nodes, rootNodeIds } = useScene.getState();
    // Keep a local latest snapshot so preview toggles never drop unsaved work.
    return JSON.parse(JSON.stringify({ nodes, rootNodeIds })) as SceneGraph;
  }, []);

  const handlePreviewVersion = useCallback(
    async (modelId: string, version: number) => {
      if (!activeProjectId) return;

      if (!isVersionPreviewMode) {
        latestSceneSnapshotRef.current = snapshotCurrentSceneGraph();
      }

      setIsSceneLoading(true);
      try {
        const result = await getProjectVersionById(activeProjectId, modelId);
        if (!result.success || !result.data?.scene_graph) {
          return;
        }

        applySceneWithoutAutosave(result.data.scene_graph, true);
        setPreviewVersion({ id: modelId, version });
      } finally {
        setIsSceneLoading(false);
      }
    },
    [
      activeProjectId,
      applySceneWithoutAutosave,
      isVersionPreviewMode,
      setIsSceneLoading,
      snapshotCurrentSceneGraph,
    ],
  );

  const handleBackToLatest = useCallback(async () => {
    if (!activeProjectId) return;

    setIsSceneLoading(true);
    try {
      const latestSceneSnapshot = latestSceneSnapshotRef.current;
      if (latestSceneSnapshot) {
        applySceneWithoutAutosave(latestSceneSnapshot, false);
        setPreviewVersion(null);
        latestSceneSnapshotRef.current = null;

        setAutosaveStatus("saving");
        const saveResult = await saveProjectModel(activeProjectId, latestSceneSnapshot);
        if (saveResult.success) {
          if (saveResult.data) {
            applyVersionStatus(saveResult.data);
          }
          setAutosaveStatus("saved");
          await loadVersionList();
        } else {
          setAutosaveStatus("pending");
        }
        return;
      }

      const result = await getProjectModel(activeProjectId);
      const sceneGraph = result.success ? result.data?.model?.scene_graph ?? null : null;
      applySceneWithoutAutosave(sceneGraph, false);
      setPreviewVersion(null);
      setAutosaveStatus("saved");
    } finally {
      setIsSceneLoading(false);
    }
  }, [
    activeProjectId,
    applySceneWithoutAutosave,
    applyVersionStatus,
    loadVersionList,
    setAutosaveStatus,
    setIsSceneLoading,
  ]);

  const handleRestoreVersion = useCallback(
    async (modelId: string, version: number) => {
      if (!activeProjectId || activeVersionItemAction) return;

      setActiveVersionItemAction({ version, action: "restore" });
      setIsSceneLoading(true);
      try {
        const versionResult = await getProjectVersionById(activeProjectId, modelId);
        if (!versionResult.success || !versionResult.data?.scene_graph) {
          return;
        }

        const saveResult = await saveProjectModel(activeProjectId, versionResult.data.scene_graph, {
          restoredFromVersion: version,
        });
        if (!saveResult.success) {
          console.error("Failed to restore version:", saveResult.error);
          return;
        }

        if (saveResult.data) {
          applyVersionStatus(saveResult.data);
        }

        applySceneWithoutAutosave(versionResult.data.scene_graph, false);
        setPreviewVersion(null);
        latestSceneSnapshotRef.current = null;
        setAutosaveStatus("saved");
        await loadVersionList();
      } finally {
        setIsSceneLoading(false);
        setActiveVersionItemAction(null);
        refreshVersionStatus();
      }
    },
    [
      activeProjectId,
      activeVersionItemAction,
      applySceneWithoutAutosave,
      applyVersionStatus,
      loadVersionList,
      refreshVersionStatus,
      setAutosaveStatus,
      setIsSceneLoading,
    ],
  );

  const handlePublishVersion = useCallback(
    async (version: number) => {
      if (!activeProjectId || activeVersionItemAction) return;

      setActiveVersionItemAction({ version, action: "publish" });
      try {
        const result = await publishProjectModel(activeProjectId, { version });
        if (!result.success || !result.data) {
          console.error("Failed to publish version:", result.error);
          return;
        }

        applyVersionStatus(result.data);
        await loadVersionList();
      } finally {
        setActiveVersionItemAction(null);
        refreshVersionStatus();
      }
    },
    [
      activeProjectId,
      activeVersionItemAction,
      applyVersionStatus,
      loadVersionList,
      refreshVersionStatus,
    ],
  );

  const runVersionAction = useCallback(
    async (action: VersionAction) => {
      if (!activeProjectId || activeVersionAction || isVersionPreviewMode) return;

      setActiveVersionAction(action);

      try {
        const { nodes, rootNodeIds } = useScene.getState();
        const sceneGraph = { nodes, rootNodeIds };

        // Flush latest in-memory scene into the current draft before version actions.
        const saveDraftResult = await saveProjectModel(activeProjectId, sceneGraph);
        if (!saveDraftResult.success) {
          console.error("Failed to save draft:", saveDraftResult.error);
          return;
        }
        if (saveDraftResult.data) {
          applyVersionStatus(saveDraftResult.data);
        }

        const versionResult = await saveProjectVersion(activeProjectId, {
          publish: action !== "save",
        });
        if (!versionResult.success || !versionResult.data) {
          console.error("Failed to save/publish version:", versionResult.error);
          return;
        }

        if (useProjectStore.getState().activeProject?.id !== activeProjectId) {
          return;
        }

        applyVersionStatus(versionResult.data);
        await loadVersionList();
      } catch (error) {
        console.error("Failed to run version action:", error);
      } finally {
        setActiveVersionAction(null);
        refreshVersionStatus();
      }
    },
    [
      activeProjectId,
      activeVersionAction,
      applyVersionStatus,
      isVersionPreviewMode,
      loadVersionList,
      refreshVersionStatus,
    ],
  );

  const isVersionActionRunning = activeVersionAction !== null;
  const isVersionActionsDisabled = isVersionActionRunning || isVersionPreviewMode;
  const isQuickSaveDisabled = isVersionActionsDisabled;
  const quickSaveLabel = activeVersionAction === "save" ? "Saving..." : "Save";
  const quickSaveDescription = isVersionPreviewMode
    ? "Back to latest to save"
    : "Save a new version";

  const triggerVersionLabel = useMemo(() => {
    if (isVersionPreviewMode && previewVersion !== null) {
      return `v${previewVersion.version}`;
    }

    if (versionStatus?.draftVersion !== null && versionStatus?.draftVersion !== undefined) {
      return "Latest";
    }

    if (versionStatus?.latestSavedVersion !== null && versionStatus?.latestSavedVersion !== undefined) {
      return "Latest";
    }

    return "Versions";
  }, [
    isVersionPreviewMode,
    previewVersion,
    versionStatus?.draftVersion,
    versionStatus?.latestSavedVersion,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsEditingTitle(false);
    }
  };

  const renderPanelContent = () => {
    switch (activePanel) {
      case "site":
        return <SitePanel />;
      case "settings":
        return <SettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <Sidebar className={cn("dark text-white ")} variant="floating">
      <div className="flex h-full">
        {/* Icon Rail */}
        <IconRail activePanel={activePanel} onPanelChange={setActivePanel} />

        {/* Panel Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <SidebarHeader className="flex-col items-start justify-center px-3 py-3 gap-1 border-b border-border/50 relative">
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                {isEditingTitle ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={titleValue}
                    onChange={(e) => setTitleValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSaveTitle}
                    placeholder="Untitled Project"
                    className="w-full bg-transparent text-foreground outline-none border-b border-primary/50 focus:border-primary rounded-none px-0 py-0 m-0 h-7 font-semibold text-lg"
                  />
                ) : (
                  <h1
                    className="font-semibold text-lg truncate cursor-text w-full h-7 border-b border-transparent hover:border-border/50 transition-colors leading-7"
                    onClick={() => setIsEditingTitle(true)}
                  >
                    {activeProject?.name || "Untitled Project"}
                  </h1>
                )}
              </div>
              <div className={cn("shrink-0 flex items-center gap-1 transition-all duration-200", isEditingTitle && "hidden")}>
                {activeProjectId && (
                  <Popover open={isVersionsOpen} onOpenChange={setIsVersionsOpen}>
                    <div className="inline-flex h-8 overflow-hidden rounded-full border border-border/50 bg-black/20">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => runVersionAction("save")}
                            disabled={isQuickSaveDisabled}
                            className={cn(
                              "group/save-trigger relative inline-flex h-full w-16 items-center border-r border-border/50 px-1.5 text-[10px] transition-colors",
                              isQuickSaveDisabled
                                ? "cursor-not-allowed opacity-50"
                                : "hover:bg-black/30",
                            )}
                          >
                            <span className="pointer-events-none inline-flex min-w-0 items-center gap-1 transition-opacity group-hover/save-trigger:opacity-0">
                              <Clock3 className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 truncate text-left text-muted-foreground">
                                {triggerVersionLabel}
                              </span>
                            </span>
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 opacity-0 transition-opacity group-hover/save-trigger:opacity-100">
                              <Save className="h-3 w-3 shrink-0 text-foreground" />
                              <span className="font-medium text-foreground">{quickSaveLabel}</span>
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">{quickSaveDescription}</TooltipContent>
                      </Tooltip>

                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-full w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-black/30 hover:text-foreground data-[state=open]:bg-black/35"
                        >
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        </button>
                      </PopoverTrigger>
                    </div>
                    <PopoverContent
                      align="end"
                      className="w-[min(320px,calc(var(--sidebar-width)-3rem),calc(100vw-2rem))] min-w-[230px] p-2"
                      sideOffset={8}
                    >
                      <div className="max-h-[280px] overflow-y-auto">
                        {isVersionListLoading ? (
                          <div className="px-2 py-3 text-xs text-muted-foreground">
                            Loading versions...
                          </div>
                        ) : versionList.length === 0 ? (
                          <div className="px-2 py-3 text-xs text-muted-foreground">
                            No versions found
                          </div>
                        ) : (
                          versionList.map((item) => {
                            const isPublished = item.isPublished;
                            const isCurrentlyViewed = isVersionPreviewMode
                              ? previewVersion?.id === item.id
                              : item.isDraft;
                            const isActionPending = activeVersionItemAction?.version === item.version;

                            return (
                              <div
                                key={item.id}
                                className={cn(
                                  "group/version-item relative mb-0.5 flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors",
                                  isCurrentlyViewed ? "bg-accent/25" : "hover:bg-accent/20"
                                )}
                              >
                                {isCurrentlyViewed && (
                                  <span className="pointer-events-none absolute right-0 top-1 bottom-1 w-0.5 rounded-full bg-primary/70" />
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    item.isDraft
                                      ? handleBackToLatest()
                                      : handlePreviewVersion(item.id, item.version)
                                  }
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate text-sm font-medium leading-none">
                                      {item.isDraft
                                        ? "Latest"
                                        : `Version ${item.version}`}
                                    </span>
                                    {item.isDraft && item.restoredFromVersion !== null && (
                                      <span className="text-[10px] text-muted-foreground">
                                        restored from v{item.restoredFromVersion}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                                    {formatRelativeTime(item.updatedAt)}
                                  </div>
                                </button>

                                {!item.isDraft && (
                                  <div className="absolute right-1 top-1 flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRestoreVersion(item.id, item.version);
                                      }}
                                      disabled={!!activeVersionItemAction}
                                      className={cn(
                                        "group/restore pointer-events-none inline-flex h-6 items-center rounded-md border border-border/50 bg-background/80 px-1.5 text-muted-foreground opacity-0 transition-all duration-150 group-hover/version-item:pointer-events-auto group-hover/version-item:opacity-100 hover:border-border hover:bg-accent/20 hover:text-foreground",
                                        isActionPending &&
                                          activeVersionItemAction?.action === "restore" &&
                                          "border-primary/40 text-primary"
                                      )}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                                      <span className="max-w-0 overflow-hidden whitespace-nowrap text-[10px] opacity-0 transition-all duration-150 group-hover/restore:ml-1 group-hover/restore:max-w-14 group-hover/restore:opacity-100">
                                        Restore
                                      </span>
                                    </button>

                                    {isPublished ? (
                                      <span className="inline-flex h-6 items-center rounded-md bg-emerald-500/15 px-2 text-[10px] font-medium text-emerald-400">
                                        Published
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handlePublishVersion(item.version);
                                        }}
                                        disabled={!!activeVersionItemAction}
                                        className={cn(
                                          "group/publish pointer-events-none inline-flex h-6 items-center rounded-md border border-sky-500/35 bg-sky-500/10 px-1.5 text-sky-300 opacity-0 transition-all duration-150 group-hover/version-item:pointer-events-auto group-hover/version-item:opacity-100 hover:border-sky-400/50 hover:bg-sky-500/20 hover:text-sky-200",
                                          isActionPending &&
                                            activeVersionItemAction?.action === "publish" &&
                                            "border-sky-300/60 text-sky-200"
                                        )}
                                      >
                                        <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
                                        <span className="max-w-0 overflow-hidden whitespace-nowrap text-[10px] opacity-0 transition-all duration-150 group-hover/publish:ml-1 group-hover/publish:max-w-14 group-hover/publish:opacity-100">
                                          Publish
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent
            className={cn("no-scrollbar flex flex-1 flex-col overflow-hidden")}
          >
            {renderPanelContent()}
          </SidebarContent>
        </div>
      </div>
    </Sidebar>
  );
}
