// ─── Articraft bridge types ───────────────────────────────────────────────

export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]

export interface ArticraftOrigin {
  xyz: Vec3
  rpy: Vec3
}

export interface ArticraftVisualGeometry {
  type: 'box' | 'cylinder' | 'sphere' | 'mesh'
  /** Box: [length, width, height]; Cylinder: [radius, length]; Sphere: [radius] */
  params: Record<string, number>
  /** OBJ/glb file path, relative to the articraft repo root (for mesh type) */
  meshPath?: string
}

export interface ArticraftVisual {
  geometry: ArticraftVisualGeometry
  origin: ArticraftOrigin
  material?: {
    name: string
    rgba: Vec4
  }
  name?: string
}

export interface ArticraftLink {
  /** Link name (matches URDF link/@name) */
  name: string
  /** Visual geometry attached to this link */
  visuals: ArticraftVisual[]
  /** Inertial origin (for simulation reference) */
  inertialOrigin?: ArticraftOrigin
}

export type ArticraftJointType =
  | 'revolute'
  | 'continuous'
  | 'prismatic'
  | 'fixed'
  | 'floating'

export interface ArticraftJoint {
  /** Joint name */
  name: string
  /** Joint type */
  type: ArticraftJointType
  /** Parent link name */
  parent: string
  /** Child link name */
  child: string
  /** Transform from parent link frame to joint frame */
  origin: ArticraftOrigin
  /** Motion axis in joint frame */
  axis: Vec3
  /** Joint limits (required for revolute/prismatic) */
  limits?: {
    effort: number
    velocity: number
    lower?: number
    upper?: number
  }
  /** Mimic relationship to another joint */
  mimic?: {
    joint: string
    multiplier: number
    offset: number
  }
}

export interface ArticraftMeshAsset {
  /** Logical mesh name */
  name: string
  /** OBJ file path relative to the record directory */
  objPath: string
  /** Optional converted glb path */
  glbPath?: string
}

/** Structured output from the Python bridge script */
export interface ArticraftModelData {
  /** Record ID from articraft storage */
  recordId: string
  /** Human-readable model name */
  name: string
  /** Links (URDF links with visual geometry) */
  links: ArticraftLink[]
  /** Joints (URDF joints between links) */
  joints: ArticraftJoint[]
  /** Mesh asset files produced by the compile step */
  meshes: ArticraftMeshAsset[]
  /** Path to the generated model.py (for regeneration) */
  modelPyPath: string
  /** Path to the record directory */
  recordPath: string
  /** Warnings from the compile step */
  warnings: string[]
}

/** Options for generating an articulated model */
export interface GenerateOptions {
  /** Prompt text for the model */
  prompt: string
  /** Optional reference image path */
  imagePath?: string
  /** Generation mode: 'articulated' or 'static' */
  mode: 'articulated' | 'static'
  /** Optional model override */
  model?: string
  /** Optional provider override */
  provider?: string
  /** Maximum generation turns */
  maxTurns?: number
  /** Working directory for articraft (repo root) */
  repoRoot?: string
  /** Signal for cancellation */
  signal?: AbortSignal
  /** Callback for progress updates */
  onProgress?: (message: string) => void
}

/** Result of converting articraft model data to editor scene nodes */
export interface SceneNodeResult {
  /** Created node IDs */
  nodeIds: string[]
  /** Root node IDs (should be placed under a level) */
  rootNodeIds: string[]
  /** Joint metadata stored on nodes (joint name → metadata) */
  jointMetadata: Record<string, {
    jointName: string
    jointType: ArticraftJointType
    parentLink: string
    childLink: string
    axis: Vec3
    origin: ArticraftOrigin
    limits?: ArticraftJoint['limits']
    mimic?: ArticraftJoint['mimic']
    currentValue: number
  }>
}
