"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { IconRail, type PanelId } from "./icon-rail";
import {
  ArrowUpCircle,
  ChevronDown,
  Clock3,
  Moon,
  Pencil,
  RotateCcw,
  Search,
  Sun,
} from "lucide-react";
import { motion } from "framer-motion";
import { useScene } from "@pascal-app/core";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
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
  getProjectVersionByNumber,
  getProjectVersionList,
  getProjectVersionStatus,
  publishProjectModel,
  saveProjectModel,
  saveProjectVersion,
  type ProjectVersionListItem,
  type ProjectVersionStatus,
} from "@/features/community/lib/models/actions";
import { useProjectStore } from "@/features/community/lib/projects/store";
import { updateProjectName } from "@/features/community/lib/projects/actions";
import { useViewer } from "@pascal-app/viewer";
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
  const theme = useViewer((state) => state.theme);
  const setTheme = useViewer((state) => state.setTheme);
  const [mounted, setMounted] = useState(false);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [versionStatus, setVersionStatus] = useState<ProjectVersionStatus | null>(null);
  const [versionList, setVersionList] = useState<ProjectVersionListItem[]>([]);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [isVersionListLoading, setIsVersionListLoading] = useState(false);
  const [versionSearch, setVersionSearch] = useState("");
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [activeVersionAction, setActiveVersionAction] = useState<VersionAction | null>(null);
  const [activeVersionItemAction, setActiveVersionItemAction] = useState<{
    version: number;
    action: VersionItemAction;
  } | null>(null);
  const activeProjectId = activeProject?.id ?? null;

  useEffect(() => {
    setMounted(true);
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
      setVersionSearch("");
      setIsVersionPreviewMode(false);
      return;
    }

    loadVersionList();
    setPreviewVersion(null);
    setVersionSearch("");
    setIsVersionPreviewMode(false);
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

  const handlePreviewVersion = useCallback(
    async (version: number) => {
      if (!activeProjectId) return;

      setIsSceneLoading(true);
      try {
        const result = await getProjectVersionByNumber(activeProjectId, version);
        if (!result.success || !result.data?.scene_graph) {
          return;
        }

        applySceneWithoutAutosave(result.data.scene_graph, true);
        setPreviewVersion(version);
      } finally {
        setIsSceneLoading(false);
      }
    },
    [activeProjectId, applySceneWithoutAutosave, setIsSceneLoading],
  );

  const handleBackToLatest = useCallback(async () => {
    if (!activeProjectId) return;

    setIsSceneLoading(true);
    try {
      const result = await getProjectModel(activeProjectId);
      const sceneGraph = result.success ? result.data?.model?.scene_graph ?? null : null;
      applySceneWithoutAutosave(sceneGraph, false);
      setPreviewVersion(null);
    } finally {
      setIsSceneLoading(false);
    }
  }, [activeProjectId, applySceneWithoutAutosave, setIsSceneLoading]);

  const handleRestoreVersion = useCallback(
    async (version: number) => {
      if (!activeProjectId || activeVersionItemAction) return;

      setActiveVersionItemAction({ version, action: "restore" });
      setIsSceneLoading(true);
      try {
        const versionResult = await getProjectVersionByNumber(activeProjectId, version);
        if (!versionResult.success || !versionResult.data?.scene_graph) {
          return;
        }

        const saveResult = await saveProjectModel(activeProjectId, versionResult.data.scene_graph);
        if (!saveResult.success) {
          console.error("Failed to restore version:", saveResult.error);
          return;
        }

        if (saveResult.data) {
          applyVersionStatus(saveResult.data);
        }

        applySceneWithoutAutosave(versionResult.data.scene_graph, false);
        setPreviewVersion(null);
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
  const hasUnsavedDraftChanges = !!versionStatus?.hasUnsavedDraftChanges;
  const hasPublishableVersion = !!versionStatus?.hasPublishableVersion;
  const isVersionActionsDisabled = isVersionActionRunning || isVersionPreviewMode;

  const filteredVersions = useMemo(() => {
    const query = versionSearch.trim().toLowerCase();
    if (!query) {
      return versionList;
    }

    return versionList.filter((item) => {
      return (
        `version ${item.version}`.includes(query) ||
        formatRelativeTime(item.createdAt).toLowerCase().includes(query)
      );
    });
  }, [versionList, versionSearch]);

  const currentVersionLabel = useMemo(() => {
    if (isVersionPreviewMode && previewVersion !== null) {
      return `Preview v${previewVersion}`;
    }

    if (versionStatus?.draftVersion !== null && versionStatus?.draftVersion !== undefined) {
      return `Draft v${versionStatus.draftVersion}`;
    }

    return "Latest";
  }, [isVersionPreviewMode, previewVersion, versionStatus?.draftVersion]);

  const publishedVersionLabel = useMemo(() => {
    if (!versionStatus) return "Version status unavailable";
    if (versionStatus.publishedVersion === null) return "Not published yet";
    return `Published v${versionStatus.publishedVersion}`;
  }, [versionStatus]);

  const publishStateLabel = useMemo(() => {
    if (!activeProjectId) return "No active project";
    if (!versionStatus) return "Checking status...";
    if (isVersionPreviewMode && previewVersion !== null) {
      return `Previewing v${previewVersion}`;
    }
    if (versionStatus.hasUnsavedDraftChanges) {
      if (versionStatus.draftVersion !== null) {
        return `Draft v${versionStatus.draftVersion} has version changes`;
      }
      return "Draft has version changes";
    }
    if (versionStatus.hasPublishableVersion) {
      if (versionStatus.latestSavedVersion !== null) {
        return `Saved v${versionStatus.latestSavedVersion} is ready to publish`;
      }
      return "A saved version is ready to publish";
    }
    if (versionStatus.draftVersion !== null) {
      return `Editing draft v${versionStatus.draftVersion}`;
    }
    return "No draft version yet";
  }, [activeProjectId, isVersionPreviewMode, previewVersion, versionStatus]);

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

  const getPanelTitle = () => {
    switch (activePanel) {
      case "site":
        return "Site";
      case "settings":
        return "Settings";
      default:
        return "";
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
                  <div 
                    className="flex items-center gap-2 group/title cursor-pointer w-full h-7 border-b border-transparent"
                    onClick={() => setIsEditingTitle(true)}
                  >
                    <h1 className="font-semibold text-lg truncate">
                      {activeProject?.name || "Untitled Project"}
                    </h1>
                    <Pencil className="w-3.5 h-3.5 opacity-0 group-hover/title:opacity-100 transition-opacity text-muted-foreground shrink-0" />
                  </div>
                )}
              </div>
              
              {mounted && (
                <button
                  className="shrink-0 flex items-center bg-black/20 rounded-full p-1 border border-border/50 cursor-pointer"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  type="button"
                  aria-label="Toggle theme"
                >
                  <div className="relative flex">
                    {/* Sliding Background */}
                    <motion.div
                      className="absolute inset-0 bg-[#3A3A3C] shadow-sm rounded-full"
                      initial={false}
                      animate={{
                        x: theme === "light" ? "100%" : "0%",
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                      }}
                      style={{ width: "50%" }}
                    />

                    {/* Dark Mode Icon */}
                    <div
                      className={cn(
                        "relative z-10 flex h-6 w-8 items-center justify-center rounded-full transition-colors duration-200 pointer-events-none",
                        theme === "dark"
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      <Moon className="h-3.5 w-3.5" />
                    </div>

                    {/* Light Mode Icon */}
                    <div
                      className={cn(
                        "relative z-10 flex h-6 w-8 items-center justify-center rounded-full transition-colors duration-200 pointer-events-none",
                        theme === "light"
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      <Sun className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </button>
              )}
            </div>
            
            {activeProjectId && (
              <div className="mt-1 flex w-full items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {publishedVersionLabel}
                  </div>
                  <div
                    className={cn(
                      "text-[10px] truncate",
                      hasUnsavedDraftChanges
                        ? "text-amber-400"
                        : "text-muted-foreground"
                    )}
                  >
                    {publishStateLabel}
                  </div>

                  <Popover open={isVersionsOpen} onOpenChange={setIsVersionsOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="mt-0.5 inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted/40"
                      >
                        <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">Versions</span>
                        <span className="text-muted-foreground">{currentVersionLabel}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[290px] p-0 overflow-hidden"
                      sideOffset={8}
                    >
                      <div className="border-b border-border/60 p-2">
                        <button
                          type="button"
                          onClick={handleBackToLatest}
                          disabled={!isVersionPreviewMode}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                            isVersionPreviewMode
                              ? "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
                              : "border-border/60 bg-muted/20 text-muted-foreground"
                          )}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Back to latest
                        </button>
                        <div className="relative mt-2">
                          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            value={versionSearch}
                            onChange={(event) => setVersionSearch(event.target.value)}
                            placeholder="Search versions..."
                            className="h-8 w-full rounded-md border border-border/60 bg-transparent pl-7 pr-2 text-xs outline-none focus:border-primary/60"
                          />
                        </div>
                      </div>

                      <div className="max-h-[280px] overflow-y-auto p-1">
                        {isVersionListLoading ? (
                          <div className="px-2 py-3 text-xs text-muted-foreground">
                            Loading versions...
                          </div>
                        ) : filteredVersions.length === 0 ? (
                          <div className="px-2 py-3 text-xs text-muted-foreground">
                            No versions found
                          </div>
                        ) : (
                          filteredVersions.map((item) => {
                            const isPublished = item.isPublished;
                            const isPreviewed = isVersionPreviewMode && previewVersion === item.version;
                            const isActionPending =
                              activeVersionItemAction?.version === item.version;

                            return (
                              <div
                                key={item.id}
                                className={cn(
                                  "group/version-item relative mb-1 rounded-md border",
                                  isPublished
                                    ? "border-primary/40 bg-primary/5"
                                    : "border-transparent hover:border-border/70 hover:bg-muted/20",
                                  isPreviewed && "border-amber-400/70 bg-amber-500/10"
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => handlePreviewVersion(item.version)}
                                  className="w-full px-2 py-1.5 text-left"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-medium leading-none">
                                      Version {item.version}
                                    </span>
                                    {isPublished && (
                                      <span className="rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium text-primary">
                                        Published
                                      </span>
                                    )}
                                    {isPreviewed && (
                                      <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-medium text-amber-300">
                                        Preview
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {formatRelativeTime(item.updatedAt)}
                                  </div>
                                </button>

                                <div className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/version-item:opacity-100">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleRestoreVersion(item.version);
                                        }}
                                        disabled={!!activeVersionItemAction}
                                        className={cn(
                                          "flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-background/90 text-muted-foreground transition-colors hover:text-foreground",
                                          isActionPending &&
                                            activeVersionItemAction?.action === "restore" &&
                                            "border-primary/60 text-primary"
                                        )}
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Restore to draft</TooltipContent>
                                  </Tooltip>

                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handlePublishVersion(item.version);
                                        }}
                                        disabled={!!activeVersionItemAction}
                                        className={cn(
                                          "flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-background/90 text-muted-foreground transition-colors hover:text-foreground",
                                          isActionPending &&
                                            activeVersionItemAction?.action === "publish" &&
                                            "border-primary/60 text-primary"
                                        )}
                                      >
                                        <ArrowUpCircle className="h-3.5 w-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Publish this version</TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  {hasUnsavedDraftChanges ? (
                    <>
                      <button
                        type="button"
                        onClick={() => runVersionAction("save")}
                        disabled={isVersionActionsDisabled}
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                          isVersionActionsDisabled
                            ? "border-border/60 bg-muted/20 text-muted-foreground"
                            : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/60"
                        )}
                      >
                        {activeVersionAction === "save" ? "Saving..." : "Save version"}
                      </button>
                      <button
                        type="button"
                        onClick={() => runVersionAction("savePublish")}
                        disabled={isVersionActionsDisabled}
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                          isVersionActionsDisabled
                            ? "border-border/60 bg-muted/20 text-muted-foreground"
                            : "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
                        )}
                      >
                        {activeVersionAction === "savePublish" ? "Publishing..." : "Save & publish"}
                      </button>
                    </>
                  ) : hasPublishableVersion ? (
                    <button
                      type="button"
                      onClick={() => runVersionAction("publish")}
                      disabled={isVersionActionsDisabled}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                        isVersionActionsDisabled
                          ? "border-border/60 bg-muted/20 text-muted-foreground"
                          : "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
                      )}
                    >
                      {activeVersionAction === "publish" ? "Publishing..." : "Publish"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[11px] font-medium text-muted-foreground"
                    >
                      Published
                    </button>
                  )}
                </div>
              </div>
            )}

            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {getPanelTitle()}
            </span>
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
