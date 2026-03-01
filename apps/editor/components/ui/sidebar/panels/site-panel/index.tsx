import {
  type AnyNodeId,
  type AnyNode,
  type BuildingNode,
  emitter,
  LevelNode,
  type SiteNode,
  useScene,
  type ZoneNode,
  type ScanNode,
  type GuideNode,
} from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import {
  Box,
  Building2,
  Camera,
  ChevronDown,
  Image as ImageIcon,
  Layers,
  Loader2,
  Pentagon,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import useEditor from "@/store/use-editor";
import { TreeNode } from "./tree-node";
import { InlineRenameInput } from "./inline-rename-input";
import { useProjectStore } from '@/features/community/lib/projects/store';
import { deleteProjectAssetByUrl } from '@/features/community/lib/assets/actions';
import { useUploadStore } from '@/store/use-upload';
import { uploadAssetWithProgress } from '@/lib/upload-asset';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/primitives/popover";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";

// Preset colors for zones
const PRESET_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red
  "#a855f7", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
];

// ============================================================================
// PROPERTY LINE SECTION
// ============================================================================

function calculatePerimeter(points: Array<[number, number]>): number {
  if (points.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]!;
    const [x2, z2] = points[(i + 1) % points.length]!;
    perimeter += Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
  }
  return perimeter;
}

function calculatePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i]![0] * polygon[j]![1];
    area -= polygon[j]![0] * polygon[i]![1];
  }
  return Math.abs(area) / 2;
}

function useSiteNode(): SiteNode | null {
  const siteId = useScene((state) => {
    for (const id of state.rootNodeIds) {
      if (state.nodes[id]?.type === "site") return id;
    }
    return null;
  });
  return useScene((state) =>
    siteId ? ((state.nodes[siteId] as SiteNode | undefined) ?? null) : null
  );
}

function PropertyLineSection() {
  const siteNode = useSiteNode();
  const updateNode = useScene((state) => state.updateNode);
  const mode = useEditor((state) => state.mode);
  const setMode = useEditor((state) => state.setMode);

  if (!siteNode) return null;

  const points = siteNode.polygon?.points ?? [];
  const area = calculatePolygonArea(points);
  const perimeter = calculatePerimeter(points);
  const isEditing = mode === "edit";

  const handleToggleEdit = () => {
    setMode(isEditing ? "select" : "edit");
  };

  const handlePointChange = (index: number, axis: 0 | 1, value: number) => {
    const newPoints = [...points.map((p) => [...p] as [number, number])];
    newPoints[index]![axis] = value;
    updateNode(siteNode.id, {
      polygon: { type: "polygon" as const, points: newPoints },
    });
  };

  const handleAddPoint = () => {
    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];
    if (!lastPoint || !firstPoint) return;

    const newPoint: [number, number] = [
      (lastPoint[0] + firstPoint[0]) / 2,
      (lastPoint[1] + firstPoint[1]) / 2,
    ];
    const newPoints = [...points, newPoint];
    updateNode(siteNode.id, {
      polygon: { type: "polygon" as const, points: newPoints },
    });
  };

  const handleDeletePoint = (index: number) => {
    if (points.length <= 3) return;
    const newPoints = points.filter((_, i) => i !== index);
    updateNode(siteNode.id, {
      polygon: { type: "polygon" as const, points: newPoints },
    });
  };

  return (
    <div className="border-b border-border/50 relative">
      {/* Vertical tree line */}
      <div className="absolute left-[21px] top-0 bottom-0 w-px bg-border/50" />

      {/* Header */}
      <div className="flex items-center justify-between pl-10 pr-3 py-2 relative">
        {/* Horizontal branch line */}
        <div className="absolute left-[21px] top-1/2 w-4 h-px bg-border/50" />
        
        <div className="flex items-center gap-2">
          <Pentagon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Property Line</span>
        </div>
        <button
          className={cn(
            "w-6 h-6 flex items-center justify-center rounded cursor-pointer transition-colors",
            isEditing
              ? "bg-orange-500/20 text-orange-400"
              : "hover:bg-accent text-muted-foreground"
          )}
          onClick={handleToggleEdit}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Measurements */}
      <div className="flex gap-3 pl-10 pr-3 pb-2 relative">
        <div className="text-xs text-muted-foreground">
          Area: <span className="text-foreground">{area.toFixed(1)} m²</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Perimeter:{" "}
          <span className="text-foreground">{perimeter.toFixed(1)} m</span>
        </div>
      </div>

      {/* Vertex list (shown when editing) */}
      {isEditing && (
        <div className="pl-10 pr-3 pb-2 relative">
          <div className="flex flex-col gap-1">
            {points.map((point, index) => (
              <div
                key={index}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className="w-4 text-muted-foreground text-right shrink-0">
                  {index + 1}
                </span>
                <label className="text-muted-foreground shrink-0">X</label>
                <input
                  type="number"
                  value={point[0]}
                  onChange={(e) =>
                    handlePointChange(index, 0, parseFloat(e.target.value) || 0)
                  }
                  step={0.5}
                  className="w-16 bg-accent/50 rounded px-1.5 py-0.5 text-xs text-foreground border border-border/50 focus:outline-none focus:border-primary"
                />
                <label className="text-muted-foreground shrink-0">Z</label>
                <input
                  type="number"
                  value={point[1]}
                  onChange={(e) =>
                    handlePointChange(index, 1, parseFloat(e.target.value) || 0)
                  }
                  step={0.5}
                  className="w-16 bg-accent/50 rounded px-1.5 py-0.5 text-xs text-foreground border border-border/50 focus:outline-none focus:border-primary"
                />
                <button
                  className={cn(
                    "w-5 h-5 flex items-center justify-center rounded cursor-pointer shrink-0",
                    points.length > 3
                      ? "hover:bg-red-500/20 text-muted-foreground hover:text-red-400"
                      : "text-muted-foreground/30 cursor-not-allowed"
                  )}
                  onClick={() => handleDeletePoint(index)}
                  disabled={points.length <= 3}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <button
            className="flex items-center gap-1 mt-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded cursor-pointer transition-colors"
            onClick={handleAddPoint}
          >
            <Plus className="w-3 h-3" />
            Add point
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SITE PHASE VIEW - Property line + building buttons
// ============================================================================

function CameraPopover({
  nodeId,
  hasCamera,
  open,
  onOpenChange,
  buttonClassName,
}: {
  nodeId: AnyNodeId;
  hasCamera: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buttonClassName?: string;
}) {
  const updateNode = useScene((state) => state.updateNode);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "relative w-6 h-6 flex items-center justify-center rounded cursor-pointer",
            buttonClassName
          )}
          onClick={(e) => e.stopPropagation()}
          title="Camera snapshot"
        >
          <Camera className="w-3.5 h-3.5" />
          {hasCamera && (
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-auto p-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-0.5">
          {hasCamera && (
            <button
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
              onClick={(e) => {
                e.stopPropagation();
                emitter.emit("camera-controls:view", { nodeId });
                onOpenChange(false);
              }}
            >
              <Camera className="w-3.5 h-3.5" />
              View snapshot
            </button>
          )}
          <button
            className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
            onClick={(e) => {
              e.stopPropagation();
              emitter.emit("camera-controls:capture", { nodeId });
              onOpenChange(false);
            }}
          >
            <Camera className="w-3.5 h-3.5" />
            {hasCamera ? "Update snapshot" : "Take snapshot"}
          </button>
          {hasCamera && (
            <button
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-destructive hover:text-destructive-foreground text-left w-full"
              onClick={(e) => {
                e.stopPropagation();
                updateNode(nodeId, { camera: undefined });
                onOpenChange(false);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear snapshot
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


function ReferenceItem({ refNode, isLastRow, setSelectedReferenceId, handleDelete }: {
  refNode: ScanNode | GuideNode;
  isLastRow: boolean;
  setSelectedReferenceId: (id: string) => void;
  handleDelete: (id: string, e: React.MouseEvent) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="relative group/ref flex items-center border-b border-border/50 text-xs pr-2 transition-colors hover:bg-accent/30 h-8 select-none">
      <div className={cn("absolute w-px bg-border/50 pointer-events-none z-10", isLastRow ? "top-0 bottom-1/2" : "top-0 bottom-0")} style={{ left: 45 }} />
      <div className="absolute top-1/2 h-px bg-border/50 pointer-events-none z-10" style={{ left: 45, width: 8 }} />
      
      <div 
        className="flex-1 flex items-center gap-2 pl-[60px] py-0 h-8 text-muted-foreground group-hover/ref:text-foreground cursor-pointer min-w-0" 
        onClick={() => setSelectedReferenceId(refNode.id)}
        onDoubleClick={() => setIsEditing(true)}
      >
        {refNode.type === 'scan' ? <img src="/icons/mesh.png" alt="Scan" className="w-3.5 h-3.5 shrink-0 object-contain opacity-70 group-hover/ref:opacity-100 transition-opacity" /> : <img src="/icons/floorplan.png" alt="Guide" className="w-3.5 h-3.5 shrink-0 object-contain opacity-70 group-hover/ref:opacity-100 transition-opacity" />}
        <InlineRenameInput
          node={refNode}
          isEditing={isEditing}
          onStopEditing={() => setIsEditing(false)}
          onStartEditing={() => setIsEditing(true)}
          defaultName={refNode.type === 'scan' ? '3D Scan' : 'Guide Image'}
        />
      </div>
      
      <button
        className="opacity-0 group-hover/ref:opacity-100 w-5 h-5 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0 z-20"
        onClick={(e) => handleDelete(refNode.id, e)}
        title="Delete"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

function LevelReferences({ levelId, isLastLevel }: { levelId: string, isLastLevel?: boolean }) {
  const nodes = useScene((s) => s.nodes);
  const deleteNode = useScene((s) => s.deleteNode);
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId);
  const activeProject = useProjectStore((s) => s.activeProject);
  const uploadState = useUploadStore((s) => s.uploads[levelId]);
  const clearUpload = useUploadStore((s) => s.clearUpload);

  const uploading = uploadState?.status === 'preparing' ||
    uploadState?.status === 'uploading' ||
    uploadState?.status === 'confirming';
  const uploadingType = uploadState?.assetType ?? null;
  const uploadError = uploadState?.error ?? null;
  const progress = uploadState?.progress ?? 0;

  const scanInputRef = useRef<HTMLInputElement>(null);

  const references = Object.values(nodes).filter(
    (node): node is ScanNode | GuideNode =>
      (node.type === 'scan' || node.type === 'guide') && node.parentId === levelId,
  );

  const handleAddAsset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const projectId = activeProject?.id;
    if (!projectId) {
      useUploadStore.getState().startUpload(levelId, 'scan', file.name);
      useUploadStore.getState().setError(levelId, 'No active project. Please open a project first.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      useUploadStore.getState().startUpload(levelId, 'scan', file.name);
      useUploadStore.getState().setError(levelId, `File is too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum size is 200 MB.`);
      return;
    }

    // Auto-detect type based on file extension/mime type
    const isScan = file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf');
    const isImage = file.type.startsWith('image/');

    if (!isScan && !isImage) {
      useUploadStore.getState().startUpload(levelId, 'scan', file.name);
      useUploadStore.getState().setError(levelId, 'Invalid file type. Please upload a .glb/.gltf scan or an image.');
      return;
    }

    const type = isScan ? 'scan' : 'guide';

    clearUpload(levelId);
    uploadAssetWithProgress(projectId, levelId, file, type);
  };

  const handleDelete = async (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const refNode = nodes[nodeId as AnyNodeId] as ScanNode | GuideNode | undefined;
    const projectId = activeProject?.id;

    if (
      projectId &&
      refNode?.url &&
      (refNode.url.startsWith('http://') || refNode.url.startsWith('https://'))
    ) {
      deleteProjectAssetByUrl(projectId, refNode.url);
    }
    deleteNode(nodeId as AnyNodeId);
  };

  const rows = [
    { type: 'upload' as const },
    ...references.map(ref => ({ type: 'ref' as const, data: ref }))
  ];

  return (
    <div className="flex flex-col relative">
      {!isLastLevel && (
        <div className="absolute top-0 bottom-0 w-px bg-border/50 pointer-events-none z-10" style={{ left: 21 }} />
      )}

      {rows.map((row, i) => {
        const isLastRow = i === rows.length - 1;

        if (row.type === 'upload') {
          return (
            <div key="upload" className="relative group/ref border-b border-border/50">
              <div className={cn("absolute w-px bg-border/50 pointer-events-none z-10", isLastRow ? "top-0 bottom-1/2" : "top-0 bottom-0")} style={{ left: 45 }} />
              <div className="absolute top-1/2 h-px bg-border/50 pointer-events-none z-10" style={{ left: 45, width: 8 }} />
              
              <button 
                className="flex items-center gap-2 w-full pl-[60px] pr-2 py-0 h-8 text-xs text-muted-foreground hover:bg-accent/30 hover:text-foreground cursor-pointer transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed select-none" 
                disabled={uploading}
                onClick={() => scanInputRef.current?.click()}
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {uploading ? `Uploading ${uploadingType}... ${progress}%` : "Upload scan/floorplan"}
              </button>

              <input ref={scanInputRef} type="file" accept=".glb,.gltf,image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleAddAsset} />
            </div>
          );
        }

        const ref = row.data as ScanNode | GuideNode;
        return (
          <ReferenceItem
            key={ref.id}
            refNode={ref}
            isLastRow={isLastRow}
            setSelectedReferenceId={setSelectedReferenceId}
            handleDelete={handleDelete}
          />
        );
      })}

      {uploadError && (
        <div className="relative pl-[60px] pr-2 py-1 text-[10px] text-destructive border-b border-border/50 bg-destructive/5 select-none min-h-8 flex items-center">
          <div className="absolute top-0 bottom-0 w-px bg-border/50 pointer-events-none z-10" style={{ left: 45 }} />
          {uploadError}
        </div>
      )}
    </div>
  );
}

function LevelItem({
  level,
  selectedLevelId,
  setSelection,
  deleteNode,
  updateNode,
  isLast,
}: {
  level: LevelNode;
  selectedLevelId: string | null;
  setSelection: (selection: any) => void;
  deleteNode: (id: AnyNodeId) => void;
  updateNode: (id: AnyNodeId, updates: Partial<AnyNode>) => void;
  isLast?: boolean;
}) {
  const [cameraPopoverOpen, setCameraPopoverOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const isSelected = selectedLevelId === level.id;
  const [isExpanded, setIsExpanded] = useState(isSelected);

  useEffect(() => {
    setIsExpanded(isSelected);
  }, [isSelected]);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);

  return (
    <div className="flex flex-col relative">
      <div
        ref={itemRef}
        className={cn(
          "flex items-center group/level border-b border-border/50 pr-2 transition-all duration-200 relative h-8 select-none",
          isSelected
            ? "bg-accent/50 text-foreground"
            : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
        )}
      >
        {/* Vertical tree line */}
        <div className={cn("absolute left-[21px] w-px bg-border/50 pointer-events-none z-10", isLast && !isExpanded ? "top-0 bottom-1/2" : "top-0 bottom-0")} />
        {/* Horizontal branch line */}
        <div className="absolute left-[21px] top-1/2 w-[11px] h-px bg-border/50 pointer-events-none z-10" />
        <div className={cn(
          "absolute left-[32px] top-[10px] w-4 h-[12px] pointer-events-none z-10 transition-colors duration-200",
          isSelected ? "bg-accent/50" : "bg-background group-hover/level:bg-accent/30"
        )} />
        {/* Line down to children */}
        {isExpanded && (
          <div className="absolute left-[45px] top-[16px] bottom-0 w-px bg-border/50 pointer-events-none z-10" />
        )}

          <div className="flex items-center pl-[28px] pr-1 z-20 relative h-8">
          <button
            className="w-4 h-4 flex items-center justify-center shrink-0 z-20 bg-inherit cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              if (!isSelected) {
                setSelection({ levelId: level.id });
              } else {
                setIsExpanded(!isExpanded);
              }
            }}
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3 h-3 -rotate-90 text-muted-foreground" />
            )}
          </button>
        </div>

          <div className="flex-1 flex items-center gap-2 py-0 text-sm cursor-pointer min-w-0 h-8 pl-0.5"
            onClick={() => setSelection({ levelId: level.id })}
            onDoubleClick={() => setIsEditing(true)}
          >
            <img 
              src="/icons/level.png" 
              className={cn("w-4 h-4 object-contain shrink-0 transition-all duration-200", !isSelected && "opacity-60 grayscale")} 
              alt="Level" 
            />
            <InlineRenameInput
              node={level}
              isEditing={isEditing}
              onStopEditing={() => setIsEditing(false)}
              onStartEditing={() => setIsEditing(true)}
              defaultName={`Level ${level.level}`}
            />
          </div>
        {/* Camera snapshot button */}
        <Popover open={cameraPopoverOpen} onOpenChange={setCameraPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "relative opacity-0 group-hover/level:opacity-100 w-6 h-6 mr-1 flex items-center justify-center rounded-md cursor-pointer shrink-0 transition-colors",
                selectedLevelId === level.id
                  ? "hover:bg-black/5 dark:hover:bg-white/10"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
              )}
              onClick={(e) => e.stopPropagation()}
              title="Camera snapshot"
            >
              <Camera className="w-3.5 h-3.5" />
              {level.camera && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            className="w-auto p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-0.5">
              {level.camera && (
                <button
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    emitter.emit("camera-controls:view", { nodeId: level.id });
                    setCameraPopoverOpen(false);
                  }}
                >
                  <Camera className="w-3.5 h-3.5" />
                  View snapshot
                </button>
              )}
              <button
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  emitter.emit("camera-controls:capture", { nodeId: level.id });
                  setCameraPopoverOpen(false);
                }}
              >
                <Camera className="w-3.5 h-3.5" />
                {level.camera ? "Update snapshot" : "Take snapshot"}
              </button>
              {level.camera && (
                <button
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-destructive hover:text-destructive-foreground text-left w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateNode(level.id, { camera: undefined });
                    setCameraPopoverOpen(false);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear snapshot
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "opacity-0 group-hover/level:opacity-100 w-6 h-6 mr-1 flex items-center justify-center rounded-md cursor-pointer shrink-0 transition-colors",
                selectedLevelId === level.id
                  ? "hover:bg-black/5 dark:hover:bg-white/10"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="right" className="w-40 p-1">
            {level.level !== 0 && (
              <button
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded text-sm hover:bg-accent hover:text-red-600 cursor-pointer"
                onClick={() => deleteNode(level.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
            className="overflow-hidden"
          >
            <LevelReferences levelId={level.id} isLastLevel={isLast} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LevelsSection() {
  const nodes = useScene((state) => state.nodes);
  const createNode = useScene((state) => state.createNode);
  const updateNode = useScene((state) => state.updateNode);
  const deleteNode = useScene((state) => state.deleteNode);
  const selectedBuildingId = useViewer((state) => state.selection.buildingId);
  const selectedLevelId = useViewer((state) => state.selection.levelId);
  const setSelection = useViewer((state) => state.setSelection);

  const building = selectedBuildingId
    ? (nodes[selectedBuildingId] as BuildingNode)
    : null;

  if (!building) return null;

  const levels = building.children
    .map((id) => nodes[id])
    .filter((node): node is LevelNode => node?.type === "level");

  const handleAddLevel = () => {
    const newLevel = LevelNode.parse({
      level: levels.length,
      children: [],
      parentId: building.id,
    });
    createNode(newLevel, building.id);
    setSelection({ levelId: newLevel.id });
  };

  return (
    <div className="flex flex-col relative">
      {/* Level buttons */}
      <div className="flex flex-col flex-1 min-h-0">
        <button
          className="flex items-center gap-2 pl-0 py-0 text-sm text-muted-foreground hover:bg-accent/30 hover:text-foreground cursor-pointer transition-all duration-200 border-b border-border/50 relative h-8 select-none"
          onClick={handleAddLevel}
        >
          {/* Vertical tree line */}
          <div className="absolute left-[21px] top-0 bottom-0 w-px bg-border/50 pointer-events-none" />
          {/* Horizontal branch line */}
          <div className="absolute left-[21px] top-1/2 w-[11px] h-px bg-border/50 pointer-events-none z-10" />
          
          <div className="flex items-center pl-[38px] pr-1 z-10 relative">
            <Plus className="w-3.5 h-3.5" />
          </div>
          <span className="truncate">Add level</span>
        </button>
        {levels.length === 0 && (
          <div className="text-xs text-muted-foreground pl-[38px] pr-2 py-0 relative border-b border-border/50 h-8 flex items-center select-none">
            {/* Vertical tree line */}
            <div className="absolute left-[21px] top-0 bottom-1/2 w-px bg-border/50 pointer-events-none" />
            {/* Horizontal branch line */}
            <div className="absolute left-[21px] top-1/2 w-[11px] h-px bg-border/50 pointer-events-none" />
            No levels yet
          </div>
        )}
        {[...levels].reverse().map((level, index) => (
          <LevelItem
            key={level.id}
            level={level}
            selectedLevelId={selectedLevelId}
            setSelection={setSelection}
            deleteNode={deleteNode}
            updateNode={updateNode}
            isLast={index === levels.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function LayerToggle() {
  const structureLayer = useEditor((state) => state.structureLayer);
  const setStructureLayer = useEditor((state) => state.setStructureLayer);
  const phase = useEditor((state) => state.phase);
  const setPhase = useEditor((state) => state.setPhase);

  const activeTab = 
    phase === "structure" && structureLayer === "elements" ? "structure" :
    phase === "furnish" ? "furnish" :
    phase === "structure" && structureLayer === "zones" ? "zones" : "none";

  return (
    <div className="flex items-center p-1 bg-[#2C2C2E] gap-1 border-b border-border/50 relative">
      <button
        className={cn(
          "relative flex-1 flex flex-col items-center justify-center py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer",
          activeTab === "structure"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
        )}
        onClick={() => {
          setPhase("structure");
          setStructureLayer("elements");
        }}
      >
        {activeTab === "structure" && (
          <motion.div
            layoutId="layerToggleActiveBg"
            className="absolute inset-0 bg-[#3e3e3e] shadow-sm ring-1 ring-border/50 rounded-md"
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
          />
        )}
        <div className="relative z-10 flex flex-col items-center">
          <img
            src="/icons/room.png"
            alt="Structure"
            className={cn("w-6 h-6 mb-1 transition-all", activeTab !== "structure" && "opacity-50 grayscale")}
          />
          Structure
        </div>
        <div className="absolute bottom-1 right-1.5 rounded border border-border/40 bg-background/40 px-1 py-[2px] backdrop-blur-md z-10">
          <span className="block font-mono text-[9px] font-medium leading-none text-muted-foreground/70">
            S
          </span>
        </div>
      </button>

      <button
        className={cn(
          "relative flex-1 flex flex-col items-center justify-center py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer",
          activeTab === "furnish"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
        )}
        onClick={() => {
          setPhase("furnish");
        }}
      >
        {activeTab === "furnish" && (
          <motion.div
            layoutId="layerToggleActiveBg"
            className="absolute inset-0 bg-[#3e3e3e] shadow-sm ring-1 ring-border/50 rounded-md"
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
          />
        )}
        <div className="relative z-10 flex flex-col items-center">
          <img
            src="/icons/couch.png"
            alt="Furnish"
            className={cn("w-6 h-6 mb-1 transition-all", activeTab !== "furnish" && "opacity-50 grayscale")}
          />
          Furnish
        </div>
        <div className="absolute bottom-1 right-1.5 rounded border border-border/40 bg-background/40 px-1 py-[2px] backdrop-blur-md z-10">
          <span className="block font-mono text-[9px] font-medium leading-none text-muted-foreground/70">
            F
          </span>
        </div>
      </button>

      <button
        className={cn(
          "relative flex-1 flex flex-col items-center justify-center py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer",
          activeTab === "zones"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
        )}
        onClick={() => {
          setPhase("structure");
          setStructureLayer("zones");
        }}
      >
        {activeTab === "zones" && (
          <motion.div
            layoutId="layerToggleActiveBg"
            className="absolute inset-0 bg-[#3e3e3e] shadow-sm ring-1 ring-border/50 rounded-md"
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
          />
        )}
        <div className="relative z-10 flex flex-col items-center">
          <img
            src="/icons/kitchen.png"
            alt="Zones"
            className={cn("w-6 h-6 mb-1 transition-all", activeTab !== "zones" && "opacity-50 grayscale")}
          />
          Zones
        </div>
        <div className="absolute bottom-1 right-1.5 rounded border border-border/40 bg-background/40 px-1 py-[2px] backdrop-blur-md z-10">
          <span className="block font-mono text-[9px] font-medium leading-none text-muted-foreground/70">
            Z
          </span>
        </div>
      </button>
    </div>
  );
}

function ZoneItem({ zone, isLast }: { zone: ZoneNode, isLast?: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [cameraPopoverOpen, setCameraPopoverOpen] = useState(false);
  const deleteNode = useScene((state) => state.deleteNode);
  const updateNode = useScene((state) => state.updateNode);
  const selectedZoneId = useViewer((state) => state.selection.zoneId);
  const hoveredId = useViewer((state) => state.hoveredId);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);
  const setPhase = useEditor((state) => state.setPhase);
  const setMode = useEditor((state) => state.setMode);

  const isSelected = selectedZoneId === zone.id;
  const isHovered = hoveredId === zone.id;

  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);

  const area = calculatePolygonArea(zone.polygon).toFixed(1);
  const defaultName = `Zone (${area}m²)`;

  const handleClick = () => {
    setSelection({ zoneId: zone.id });
    setPhase("structure");
    setMode("select");
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(zone.id);
    if (isSelected) {
      setSelection({ zoneId: null });
    }
  };

  const handleColorChange = (color: string) => {
    updateNode(zone.id, { color });
  };

  return (
    <div
      ref={itemRef}
      className={cn(
        "relative flex items-center h-8 cursor-pointer group/row text-sm px-3 select-none border-b border-border/50 transition-all duration-200",
        isSelected
          ? "bg-accent/50 text-foreground"
          : isHovered
            ? "bg-accent/30 text-foreground"
            : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setHoveredId(zone.id)}
      onMouseLeave={() => setHoveredId(null)}
    >
      {/* Vertical tree line */}
      <div className={cn("absolute w-px bg-border/50 pointer-events-none", isLast ? "top-0 bottom-1/2" : "top-0 bottom-0")} style={{ left: 8 }} />
      {/* Horizontal branch line */}
      <div className="absolute top-1/2 h-px bg-border/50 pointer-events-none" style={{ left: 8, width: 4 }} />

      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "mr-2 size-3 shrink-0 rounded-sm border border-border/50 transition-all hover:scale-110 cursor-pointer",
              !isSelected && "opacity-60 grayscale"
            )}
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: zone.color }}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto p-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-4 gap-1">
            {PRESET_COLORS.map((color) => (
              <button
                className={cn(
                  "size-6 rounded-sm border transition-transform hover:scale-110 cursor-pointer",
                  color === zone.color ? "ring-2 ring-primary ring-offset-1" : ""
                )}
                key={color}
                onClick={() => handleColorChange(color)}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <div className="flex-1 min-w-0 pr-1">
        <InlineRenameInput
          node={zone}
          isEditing={isEditing}
          onStopEditing={() => setIsEditing(false)}
          onStartEditing={() => setIsEditing(true)}
          defaultName={defaultName}
        />
      </div>
      <div className="flex items-center gap-0.5">
        {/* Camera snapshot button */}
        <Popover open={cameraPopoverOpen} onOpenChange={setCameraPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className="relative opacity-0 group-hover/row:opacity-100 w-6 h-6 flex items-center justify-center rounded-md cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e) => e.stopPropagation()}
              title="Camera snapshot"
            >
              <Camera className="w-3 h-3" />
              {zone.camera && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            className="w-auto p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-0.5">
              {zone.camera && (
                <button
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    emitter.emit("camera-controls:view", { nodeId: zone.id });
                    setCameraPopoverOpen(false);
                  }}
                >
                  <Camera className="w-3.5 h-3.5" />
                  View snapshot
                </button>
              )}
              <button
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  emitter.emit("camera-controls:capture", { nodeId: zone.id });
                  setCameraPopoverOpen(false);
                }}
              >
                <Camera className="w-3.5 h-3.5" />
                {zone.camera ? "Update snapshot" : "Take snapshot"}
              </button>
              {zone.camera && (
                <button
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-destructive hover:text-destructive-foreground text-left w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateNode(zone.id, { camera: undefined });
                    setCameraPopoverOpen(false);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear snapshot
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <button
          className="opacity-0 group-hover/row:opacity-100 w-6 h-6 flex items-center justify-center rounded-md cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          onClick={handleDelete}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function MultiSelectionBadge() {
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const setSelection = useViewer((state) => state.setSelection);

  if (selectedIds.length <= 1) return null;

  return (
    <div className="sticky top-4 z-50 pointer-events-none flex justify-center w-full h-0 overflow-visible">
      <div className="pointer-events-auto flex items-center gap-2.5 px-0.5 pl-2 py-4 bg-primary text-primary-foreground text-xs font-medium rounded-full shadow-lg shadow-black/10 border border-primary/20 backdrop-blur-md">
        <span>{selectedIds.length} objects selected</span>
        <button
          onClick={() => setSelection({ selectedIds: [] })}
          className="hover:bg-primary-foreground/20 p-1.5 rounded-full transition-colors cursor-pointer"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ContentSection() {
  const nodes = useScene((state) => state.nodes);
  const selectedLevelId = useViewer((state) => state.selection.levelId);
  const structureLayer = useEditor((state) => state.structureLayer);
  const phase = useEditor((state) => state.phase);
  const setPhase = useEditor((state) => state.setPhase);
  const setMode = useEditor((state) => state.setMode);
  const setTool = useEditor((state) => state.setTool);

  const level = selectedLevelId ? (nodes[selectedLevelId] as LevelNode) : null;

  if (!level) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">
        Select a level to view content
      </div>
    );
  }

  if (structureLayer === "zones") {
    // Show zones for this level
    const levelZones = Object.values(nodes).filter(
      (node): node is ZoneNode =>
        node.type === "zone" && node.parentId === selectedLevelId
    );

    const handleAddZone = () => {
      setPhase("structure");
      setMode("build");
      setTool("zone");
    };

    if (levelZones.length === 0) {
      return (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          No zones on this level.{" "}
          <button
            className="text-primary hover:underline cursor-pointer"
            onClick={handleAddZone}
          >
            Add one
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col">
        {levelZones.map((zone, index) => (
          <ZoneItem key={zone.id} zone={zone} isLast={index === levelZones.length - 1} />
        ))}
      </div>
    );
  }

  // Filter elements based on phase
  const elementChildren = level.children.filter((childId) => {
    const childNode = nodes[childId];
    if (!childNode || childNode.type === "zone") return false;

    // We no longer filter out structural nodes in furnish mode or furnish nodes in structure mode
    // This allows nested items (like lights in a ceiling or cabinetry on a wall) to remain visible
    // and selectable in both modes, ensuring seamless transition in the tree view.
    return true;
  });

  if (elementChildren.length === 0) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground">
        No elements on this level
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {elementChildren.map((childId, index) => (
        <TreeNode key={childId} nodeId={childId} depth={0} isLast={index === elementChildren.length - 1} />
      ))}
    </div>
  );
}

function BuildingItem({
  building,
  isBuildingActive,
  buildingCameraOpen,
  setBuildingCameraOpen,
}: {
  building: BuildingNode;
  isBuildingActive: boolean;
  buildingCameraOpen: string | null;
  setBuildingCameraOpen: (id: string | null) => void;
}) {
  const setSelection = useViewer((state) => state.setSelection);
  const phase = useEditor((state) => state.phase);
  const setPhase = useEditor((state) => state.setPhase);
  const updateNode = useScene((state) => state.updateNode);
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isBuildingActive && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isBuildingActive]);

  return (
    <motion.div 
      layout
      transition={{ type: "spring", bounce: 0, duration: 0.4 }}
      className={cn("flex flex-col shrink-0 overflow-hidden", isBuildingActive && "flex-1 min-h-0")}
    >
      <motion.div
        layout="position"
        ref={itemRef}
        className={cn(
          "group/building flex items-center h-10 border-b border-border/50 pr-2 transition-all duration-200 shrink-0",
          isBuildingActive
            ? "bg-accent/50 text-foreground"
            : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
        )}
      >
        <button
          className="flex-1 flex items-center gap-2 pl-3 py-2 h-full cursor-pointer min-w-0"
          onClick={() => {
            setSelection({ buildingId: building.id });
            if (phase === "site") {
              setPhase("structure");
            }
          }}
        >
          <img 
            src="/icons/building.png" 
            className={cn("w-5 h-5 object-contain transition-all", !isBuildingActive && "opacity-60 grayscale")} 
            alt="Building" 
          />
          <span className="truncate font-medium text-sm">{building.name || "Building"}</span>
        </button>
        <Popover
          open={buildingCameraOpen === building.id}
          onOpenChange={(open) => setBuildingCameraOpen(open ? building.id : null)}
        >
          <PopoverTrigger asChild>
            <button
              className={cn(
                "relative opacity-0 group-hover/building:opacity-100 w-7 h-7 mr-1.5 flex items-center justify-center rounded-md cursor-pointer shrink-0 transition-colors",
                isBuildingActive
                  ? "hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
              )}
              onClick={(e) => e.stopPropagation()}
              title="Camera snapshot"
            >
              <Camera className="w-4 h-4" />
              {building.camera && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            className="w-auto p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-0.5">
              {building.camera && (
                <button
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    emitter.emit("camera-controls:view", { nodeId: building.id });
                    setBuildingCameraOpen(null);
                  }}
                >
                  <Camera className="w-3.5 h-3.5" />
                  View snapshot
                </button>
              )}
              <button
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-accent text-left w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  emitter.emit("camera-controls:capture", { nodeId: building.id });
                  setBuildingCameraOpen(null);
                }}
              >
                <Camera className="w-3.5 h-3.5" />
                {building.camera ? "Update snapshot" : "Take snapshot"}
              </button>
              {building.camera && (
                <button
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-popover-foreground hover:bg-destructive hover:text-destructive-foreground text-left w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateNode(building.id, { camera: undefined });
                    setBuildingCameraOpen(null);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear snapshot
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </motion.div>

      {/* Tools and content for the active building */}
      <AnimatePresence initial={false}>
        {isBuildingActive && (
          <motion.div
            initial={{ opacity: 0, flex: 0 }}
            animate={{ opacity: 1, flex: "1 1 0%" }}
            exit={{ opacity: 0, flex: "0 0 0px" }}
            transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            className="flex flex-col w-full overflow-hidden"
          >
            <div className="flex flex-col flex-1 min-h-0 w-full">
              <div className="shrink-0 flex flex-col">
                <LevelsSection />
                <LayerToggle />
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 relative">
                <MultiSelectionBadge />
                <ContentSection />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function SitePanel() {
  const nodes = useScene((state) => state.nodes);
  const rootNodeIds = useScene((state) => state.rootNodeIds);
  const updateNode = useScene((state) => state.updateNode);
  const selectedBuildingId = useViewer((state) => state.selection.buildingId);
  const setSelection = useViewer((state) => state.setSelection);
  const phase = useEditor((state) => state.phase);
  const setPhase = useEditor((state) => state.setPhase);

  const [siteCameraOpen, setSiteCameraOpen] = useState(false);
  const [buildingCameraOpen, setBuildingCameraOpen] = useState<string | null>(null);

  const siteNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : null;
  const buildings = (siteNode?.type === 'site' ? siteNode.children : [])
    .map((child) => {
      const id = typeof child === 'string' ? child : child.id;
      return nodes[id] as BuildingNode | undefined;
    })
    .filter((node): node is BuildingNode => node?.type === "building");

  return (
    <LayoutGroup>
      <div className="flex flex-col h-full">
        {/* Site Header */}
        {siteNode && (
          <motion.div 
            layout="position"
            className={cn(
              "flex items-center justify-between px-3 py-3 border-b border-border/50 cursor-pointer transition-colors shrink-0",
              phase === "site" ? "bg-accent/50 text-foreground" : "hover:bg-accent/30 text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setPhase("site")}
          >
            <div className="flex items-center gap-2">
              <img 
                src="/icons/site.png" 
                className={cn("w-5 h-5 object-contain transition-all", phase !== "site" && "opacity-60 grayscale")} 
                alt="Site" 
              />
              <span className="text-sm font-medium">{siteNode.name || "Site"}</span>
            </div>
            <CameraPopover
              nodeId={siteNode.id as AnyNodeId}
              hasCamera={!!siteNode.camera}
              open={siteCameraOpen}
              onOpenChange={setSiteCameraOpen}
              buttonClassName={cn("transition-colors", phase === "site" ? "hover:bg-black/5 dark:hover:bg-white/10" : "hover:bg-accent")}
            />
          </motion.div>
        )}

        <motion.div layout className={cn("flex-1 flex flex-col min-h-0", phase === "site" && "overflow-y-auto")}>
          {/* When phase is site, show property line immediately under site header */}
          <AnimatePresence initial={false}>
            {phase === "site" && (
              <motion.div
                layout="position"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: "spring", bounce: 0, duration: 0.4 }}
                className="shrink-0 overflow-hidden"
              >
                <PropertyLineSection />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Buildings List */}
          {buildings.length === 0 ? (
            <motion.div layout="position" className="px-3 py-4 text-sm text-muted-foreground">
              No buildings yet
            </motion.div>
          ) : (
            <motion.div layout className="flex flex-col flex-1 min-h-0">
              {buildings.map((building) => {
                const isBuildingActive = (phase === "structure" || phase === "furnish") && selectedBuildingId === building.id;

                return (
                  <BuildingItem
                    key={building.id}
                    building={building}
                    isBuildingActive={isBuildingActive}
                    buildingCameraOpen={buildingCameraOpen}
                    setBuildingCameraOpen={setBuildingCameraOpen}
                  />
                );
              })}
            </motion.div>
          )}
        </motion.div>
      </div>
    </LayoutGroup>
  );
}
