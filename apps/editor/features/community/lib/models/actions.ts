/**
 * Project model actions - Server actions for scene loading/saving
 * Manages 3D models (scene graphs) stored in projects_models table
 */

'use server'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { createServerSupabaseClient } from '../database/server'
import { getSession } from '../auth/server'
import { createId } from '../utils/id-generator'
import type { ActionResult } from '../projects/actions'
import { isSceneGraphEmpty } from './scene-graph-utils'

export interface SceneGraph {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
}

export interface ProjectModel {
  id: string
  name: string
  version: number
  draft: boolean
  project_id: string
  scene_graph: SceneGraph | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface ProjectVersionStatus {
  publishedVersion: number | null
  draftVersion: number | null
  latestSavedVersion: number | null
  hasUnsavedDraftChanges: boolean
  hasPublishableVersion: boolean
}

export interface ProjectModelState extends ProjectVersionStatus {
  model: ProjectModel | null
}

export interface ProjectVersionListItem {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  isPublished: boolean
  isDraft: boolean
  restoredFromVersion: number | null
}

type ProjectVersionListRow = {
  id: string
  version: number
  draft: boolean
  metadata: unknown
  created_at: string
  updated_at: string
}

interface ProjectOwnershipRow {
  id: string
  owner_id: string
  name: string
  published_model_version: number | null
}

type AuthenticatedProjectContext = {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
  project: ProjectOwnershipRow
}

function sceneGraphsEqual(
  left: SceneGraph | null | undefined,
  right: SceneGraph | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function parseModelMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }

  return { ...(input as Record<string, unknown>) }
}

function readRestoredFromVersion(input: unknown): number | null {
  const metadata = parseModelMetadata(input)
  const restoredFromVersion = metadata.restoredFromVersion
  if (typeof restoredFromVersion !== 'number' || !Number.isFinite(restoredFromVersion)) {
    return null
  }

  return restoredFromVersion
}

function buildVersionStatus(params: {
  publishedVersion: number | null
  draftModel: ProjectModel | null
  latestSavedModel: ProjectModel | null
}): ProjectVersionStatus {
  const publishedVersion = params.publishedVersion
  const draftVersion = params.draftModel?.version ?? null
  const latestSavedVersion = params.latestSavedModel?.version ?? null

  const hasUnsavedDraftChanges = params.draftModel
    ? params.latestSavedModel
      ? !sceneGraphsEqual(params.draftModel.scene_graph, params.latestSavedModel.scene_graph)
      : true
    : false

  const hasPublishableVersion =
    latestSavedVersion !== null && latestSavedVersion !== publishedVersion

  return {
    publishedVersion,
    draftVersion: draftVersion,
    latestSavedVersion,
    hasUnsavedDraftChanges,
    hasPublishableVersion,
  }
}

async function getProjectVersionModels(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  projectId: string,
): Promise<
  ActionResult<{
    draftModel: ProjectModel | null
    latestSavedModel: ProjectModel | null
  }>
> {
  const { data: draftModel, error: draftModelError } = await supabase
    .from('projects_models')
    .select('*')
    .eq('project_id', projectId)
    .eq('draft', true)
    .is('deleted_at', null)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ProjectModel>()

  if (draftModelError) {
    return {
      success: false,
      error: draftModelError.message,
    }
  }

  const { data: latestSavedModel, error: latestSavedModelError } = await supabase
    .from('projects_models')
    .select('*')
    .eq('project_id', projectId)
    .eq('draft', false)
    .is('deleted_at', null)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ProjectModel>()

  if (latestSavedModelError) {
    return {
      success: false,
      error: latestSavedModelError.message,
    }
  }

  return {
    success: true,
    data: {
      draftModel: draftModel ?? null,
      latestSavedModel: latestSavedModel ?? null,
    },
  }
}

async function getAuthenticatedProjectContext(
  projectId: string,
): Promise<ActionResult<AuthenticatedProjectContext>> {
  const session = await getSession()

  if (!session?.user) {
    return {
      success: false,
      error: 'Not authenticated',
    }
  }

  const supabase = await createServerSupabaseClient()
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, owner_id, name, published_model_version')
    .eq('id', projectId)
    .single<ProjectOwnershipRow>()

  if (projectError || !project) {
    return {
      success: false,
      error: 'Project not found',
    }
  }

  if (project.owner_id !== session.user.id) {
    return {
      success: false,
      error: 'Unauthorized',
    }
  }

  return {
    success: true,
    data: {
      supabase,
      project,
    },
  }
}

/**
 * Returns publish/draft status for the current project.
 */
export async function getProjectVersionStatus(
  projectId: string,
): Promise<ActionResult<ProjectVersionStatus>> {
  try {
    const contextResult = await getAuthenticatedProjectContext(projectId)
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        error: contextResult.error,
      }
    }

    const { supabase, project } = contextResult.data
    const versionModelsResult = await getProjectVersionModels(supabase, projectId)
    if (!versionModelsResult.success || !versionModelsResult.data) {
      return {
        success: false,
        error: versionModelsResult.error,
      }
    }

    const { draftModel, latestSavedModel } = versionModelsResult.data

    return {
      success: true,
      data: buildVersionStatus({
        publishedVersion: project.published_model_version ?? null,
        draftModel,
        latestSavedModel,
      }),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch project version status',
    }
  }
}

/**
 * List all project versions (including current draft), newest first.
 */
export async function getProjectVersionList(
  projectId: string,
): Promise<ActionResult<ProjectVersionListItem[]>> {
  try {
    const contextResult = await getAuthenticatedProjectContext(projectId)
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        error: contextResult.error,
        data: [],
      }
    }

    const { supabase, project } = contextResult.data
    const { data: versions, error: versionsError } = await supabase
      .from('projects_models')
      .select('id, version, draft, metadata, created_at, updated_at')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .returns<ProjectVersionListRow[]>()

    if (versionsError) {
      return {
        success: false,
        error: versionsError.message,
        data: [],
      }
    }

    const publishedVersion = project.published_model_version ?? null
    return {
      success: true,
      data: (versions ?? []).map((item) => ({
        id: item.id,
        version: item.version,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        isPublished: publishedVersion !== null && item.version === publishedVersion,
        isDraft: item.draft,
        restoredFromVersion: readRestoredFromVersion(item.metadata),
      })),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch project version list',
      data: [],
    }
  }
}

/**
 * Fetch a single version by version number (saved or draft).
 */
export async function getProjectVersionByNumber(
  projectId: string,
  version: number,
): Promise<ActionResult<ProjectModel | null>> {
  try {
    const contextResult = await getAuthenticatedProjectContext(projectId)
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        error: contextResult.error,
        data: null,
      }
    }

    const { supabase } = contextResult.data
    const { data: model, error: modelError } = await supabase
      .from('projects_models')
      .select('*')
      .eq('project_id', projectId)
      .eq('version', version)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle<ProjectModel>()

    if (modelError) {
      return {
        success: false,
        error: modelError.message,
        data: null,
      }
    }

    return {
      success: true,
      data: model ?? null,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch project version',
      data: null,
    }
  }
}

/**
 * Fetch a single version by model id.
 */
export async function getProjectVersionById(
  projectId: string,
  modelId: string,
): Promise<ActionResult<ProjectModel | null>> {
  try {
    const contextResult = await getAuthenticatedProjectContext(projectId)
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        error: contextResult.error,
        data: null,
      }
    }

    const { supabase } = contextResult.data
    const { data: model, error: modelError } = await supabase
      .from('projects_models')
      .select('*')
      .eq('project_id', projectId)
      .eq('id', modelId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle<ProjectModel>()

    if (modelError) {
      return {
        success: false,
        error: modelError.message,
        data: null,
      }
    }

    return {
      success: true,
      data: model ?? null,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch project version',
      data: null,
    }
  }
}

/**
 * Get the editor model for a project:
 * - Draft if one exists
 * - Otherwise the published version
 * - Otherwise latest available model (legacy fallback)
 */
export async function getProjectModel(projectId: string): Promise<ActionResult<ProjectModelState>> {
  try {
    const contextResult = await getAuthenticatedProjectContext(projectId)
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        error: contextResult.error,
      }
    }

    const { supabase, project } = contextResult.data
    const publishedVersion = project.published_model_version ?? null

    const versionModelsResult = await getProjectVersionModels(supabase, projectId)
    if (!versionModelsResult.success || !versionModelsResult.data) {
      return {
        success: false,
        error: versionModelsResult.error,
      }
    }

    const { draftModel, latestSavedModel } = versionModelsResult.data
    let modelToLoad = draftModel ?? null

    if (!modelToLoad && publishedVersion !== null) {
      const { data: publishedModel, error: publishedModelError } = await supabase
        .from('projects_models')
        .select('*')
        .eq('project_id', projectId)
        .eq('version', publishedVersion)
        .eq('draft', false)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle<ProjectModel>()

      if (publishedModelError) {
        return {
          success: false,
          error: publishedModelError.message,
        }
      }

      modelToLoad = publishedModel ?? null
    }

    if (!modelToLoad && latestSavedModel) {
      modelToLoad = latestSavedModel
    }

    if (!modelToLoad) {
      const { data: latestModel, error: latestModelError } = await supabase
        .from('projects_models')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('version', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<ProjectModel>()

      if (latestModelError) {
        return {
          success: false,
          error: latestModelError.message,
        }
      }

      modelToLoad = latestModel ?? null
    }

    const status = buildVersionStatus({
      publishedVersion,
      draftModel,
      latestSavedModel,
    })

    return {
      success: true,
      data: {
        model: modelToLoad,
        ...status,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch project model',
    }
  }
}

/**
 * Save or update the project's draft model scene graph.
 */
export interface SaveProjectModelOptions {
  restoredFromVersion?: number | null
}

export async function saveProjectModel(
  projectId: string,
  sceneGraph: SceneGraph,
  options?: SaveProjectModelOptions,
): Promise<ActionResult<ProjectModelState>> {
  try {
    const contextResult = await getAuthenticatedProjectContext(projectId)
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        error: contextResult.error,
      }
    }

    const { supabase, project } = contextResult.data

    // Determine if scene graph is empty
    const isEmpty = isSceneGraphEmpty(sceneGraph)

    // Update the project's is_empty flag
    await (supabase.from('projects') as any)
      .update({ is_empty: isEmpty })
      .eq('id', projectId)

    const versionModelsResult = await getProjectVersionModels(supabase, projectId)
    if (!versionModelsResult.success || !versionModelsResult.data) {
      return {
        success: false,
        error: versionModelsResult.error,
      }
    }

    const { draftModel: existingDraftModel, latestSavedModel } = versionModelsResult.data
    let savedModel: ProjectModel | null = null
    const restoredFromVersionOption = options?.restoredFromVersion
    const metadataOverride =
      restoredFromVersionOption === undefined
        ? undefined
        : (() => {
            const metadata = parseModelMetadata(existingDraftModel?.metadata ?? null)

            if (typeof restoredFromVersionOption === 'number') {
              metadata.restoredFromVersion = restoredFromVersionOption
            } else {
              delete metadata.restoredFromVersion
            }

            return Object.keys(metadata).length > 0 ? metadata : null
          })()

    if (existingDraftModel) {
      const updateData: Record<string, unknown> = {
        scene_graph: sceneGraph,
        updated_at: new Date().toISOString(),
      }
      if (metadataOverride !== undefined) {
        updateData.metadata = metadataOverride
      }
      const { data: updatedModel, error: updateError } = (await (supabase
        .from('projects_models') as any)
        .update(updateData)
        .eq('id', existingDraftModel.id)
        .select()
        .single()) as { data: ProjectModel | null; error: any }

      if (updateError) {
        return {
          success: false,
          error: updateError.message,
        }
      }

      savedModel = updatedModel as ProjectModel
    } else {
      const baselineModel = latestSavedModel

      if (baselineModel && sceneGraphsEqual(baselineModel.scene_graph, sceneGraph)) {
        return {
          success: true,
          data: {
            model: baselineModel,
            ...buildVersionStatus({
              publishedVersion: project.published_model_version ?? null,
              draftModel: null,
              latestSavedModel: baselineModel,
            }),
          },
          message: 'No draft changes to save',
        }
      }

      const { data: latestModel, error: latestModelError } = await supabase
        .from('projects_models')
        .select('version')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('version', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ version: number }>()

      if (latestModelError) {
        return {
          success: false,
          error: latestModelError.message,
        }
      }

      const nextVersion = (latestModel?.version ?? 0) + 1
      const modelId = createId('model')

      const insertData = {
        id: modelId,
        project_id: projectId,
        name: `${project.name} - Draft v${nextVersion}`,
        version: nextVersion,
        draft: true,
        scene_graph: sceneGraph,
        ...(metadataOverride !== undefined ? { metadata: metadataOverride } : {}),
      }
      const { data: newModel, error: createError } = (await (supabase
        .from('projects_models') as any)
        .insert(insertData)
        .select()
        .single()) as { data: ProjectModel | null; error: any }

      if (createError) {
        return {
          success: false,
          error: createError.message,
        }
      }

      savedModel = newModel as ProjectModel
    }

    if (!savedModel) {
      return {
        success: false,
        error: 'Failed to save project model',
      }
    }

    const status = buildVersionStatus({
      publishedVersion: project.published_model_version ?? null,
      draftModel: savedModel,
      latestSavedModel,
    })

    return {
      success: true,
      data: {
        model: savedModel,
        ...status,
      },
      message: existingDraftModel
        ? 'Draft model updated successfully'
        : 'Draft model created successfully',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save project model',
    }
  }
}

async function createNextDraftVersion(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  params: {
    projectId: string
    projectName: string
    sceneGraph: SceneGraph | null
  },
): Promise<ActionResult<ProjectModel>> {
  const { data: latestModel, error: latestModelError } = await supabase
    .from('projects_models')
    .select('version')
    .eq('project_id', params.projectId)
    .is('deleted_at', null)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>()

  if (latestModelError) {
    return {
      success: false,
      error: latestModelError.message,
    }
  }

  const nextVersion = (latestModel?.version ?? 0) + 1
  const modelId = createId('model')
  const insertData = {
    id: modelId,
    project_id: params.projectId,
    name: `${params.projectName} - Draft v${nextVersion}`,
    version: nextVersion,
    draft: true,
    scene_graph: params.sceneGraph,
  }

  const { data: newDraftModel, error: createError } = (await (supabase
    .from('projects_models') as any)
    .insert(insertData)
    .select()
    .single()) as { data: ProjectModel | null; error: any }

  if (createError || !newDraftModel) {
    return {
      success: false,
      error: createError?.message ?? 'Failed to create next draft version',
    }
  }

  return {
    success: true,
    data: newDraftModel as ProjectModel,
  }
}

export interface SaveProjectVersionOptions {
  publish?: boolean
}

/**
 * Save the current draft into a locked version, and optionally publish it.
 *
 * Behavior:
 * - Save only: lock draft as a saved version, then create the next draft.
 * - Save + publish: lock draft, publish it, then create the next draft.
 * - Publish when already saved: publish latest saved version directly.
 */
export async function saveProjectVersion(
  projectId: string,
  options?: SaveProjectVersionOptions,
): Promise<ActionResult<ProjectVersionStatus>> {
  try {
    const contextResult = await getAuthenticatedProjectContext(projectId)
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        error: contextResult.error,
      }
    }

    const { supabase, project } = contextResult.data
    const shouldPublish = options?.publish ?? false
    let publishedVersion = project.published_model_version ?? null

    const versionModelsResult = await getProjectVersionModels(supabase, projectId)
    if (!versionModelsResult.success || !versionModelsResult.data) {
      return {
        success: false,
        error: versionModelsResult.error,
      }
    }

    let { draftModel, latestSavedModel } = versionModelsResult.data
    let didSaveVersion = false
    let didPublishVersion = false

    if (draftModel) {
      const draftDiffersFromSaved = latestSavedModel
        ? !sceneGraphsEqual(draftModel.scene_graph, latestSavedModel.scene_graph)
        : true

      if (draftDiffersFromSaved) {
        const { data: lockedModel, error: lockDraftError } = (await (supabase
          .from('projects_models') as any)
          .update({
            draft: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', draftModel.id)
          .select()
          .single()) as { data: ProjectModel | null; error: any }

        if (lockDraftError || !lockedModel) {
          return {
            success: false,
            error: lockDraftError?.message ?? 'Failed to lock draft version',
          }
        }

        latestSavedModel = lockedModel as ProjectModel
        draftModel = null
        didSaveVersion = true
      }
    }

    if (shouldPublish) {
      if (!latestSavedModel) {
        return {
          success: false,
          error: 'No saved version available to publish',
        }
      }

      if (publishedVersion !== latestSavedModel.version) {
        const { error: updateProjectError } = await (supabase
          .from('projects') as any)
          .update({
            published_model_version: latestSavedModel.version,
          })
          .eq('id', projectId)

        if (updateProjectError) {
          return {
            success: false,
            error: updateProjectError.message,
          }
        }

        publishedVersion = latestSavedModel.version
        didPublishVersion = true
      }
    }

    // Keep autosave flowing onto a fresh draft whenever we lock/publish a version.
    if ((didSaveVersion || didPublishVersion) && !draftModel && latestSavedModel) {
      const nextDraftResult = await createNextDraftVersion(supabase, {
        projectId,
        projectName: project.name,
        sceneGraph: latestSavedModel.scene_graph,
      })

      if (!nextDraftResult.success || !nextDraftResult.data) {
        return {
          success: false,
          error: nextDraftResult.error,
        }
      }

      draftModel = nextDraftResult.data
    }

    const status = buildVersionStatus({
      publishedVersion,
      draftModel,
      latestSavedModel,
    })

    let message = 'No version changes'
    if (didSaveVersion && didPublishVersion && latestSavedModel) {
      message = `Saved and published v${latestSavedModel.version}`
    } else if (didSaveVersion && latestSavedModel) {
      message = `Saved version v${latestSavedModel.version}`
    } else if (didPublishVersion && latestSavedModel) {
      message = `Published version v${latestSavedModel.version}`
    } else if (shouldPublish && latestSavedModel && publishedVersion === latestSavedModel.version) {
      message = `Version v${latestSavedModel.version} is already published`
    }

    return {
      success: true,
      data: status,
      message,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save project version',
    }
  }
}

export interface PublishProjectModelOptions {
  version?: number
}

/**
 * Publish a project model version to the community.
 *
 * - If `options.version` is provided, republish that saved version.
 * - Otherwise publish using saveProjectVersion(publish=true) behavior.
 */
export async function publishProjectModel(
  projectId: string,
  options?: PublishProjectModelOptions,
): Promise<ActionResult<ProjectVersionStatus>> {
  try {
    if (typeof options?.version !== 'number') {
      return await saveProjectVersion(projectId, { publish: true })
    }

    const contextResult = await getAuthenticatedProjectContext(projectId)
    if (!contextResult.success || !contextResult.data) {
      return {
        success: false,
        error: contextResult.error,
      }
    }

    const { supabase, project } = contextResult.data
    const { data: targetVersionModel, error: targetVersionError } = await supabase
      .from('projects_models')
      .select('*')
      .eq('project_id', projectId)
      .eq('version', options.version)
      .eq('draft', false)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle<ProjectModel>()

    if (targetVersionError) {
      return {
        success: false,
        error: targetVersionError.message,
      }
    }

    if (!targetVersionModel) {
      return {
        success: false,
        error: `Version ${options.version} is not a saved version`,
      }
    }

    const { error: updateProjectError } = await (supabase
      .from('projects') as any)
      .update({
        published_model_version: targetVersionModel.version,
      })
      .eq('id', projectId)

    if (updateProjectError) {
      return {
        success: false,
        error: updateProjectError.message,
      }
    }

    const versionModelsResult = await getProjectVersionModels(supabase, projectId)
    if (!versionModelsResult.success || !versionModelsResult.data) {
      return {
        success: false,
        error: versionModelsResult.error,
      }
    }

    let { draftModel, latestSavedModel } = versionModelsResult.data
    if (!latestSavedModel || latestSavedModel.version < targetVersionModel.version) {
      latestSavedModel = targetVersionModel
    }

    if (!draftModel) {
      const nextDraftResult = await createNextDraftVersion(supabase, {
        projectId,
        projectName: project.name,
        sceneGraph: targetVersionModel.scene_graph,
      })

      if (!nextDraftResult.success || !nextDraftResult.data) {
        return {
          success: false,
          error: nextDraftResult.error,
        }
      }

      draftModel = nextDraftResult.data
    }

    return {
      success: true,
      data: buildVersionStatus({
        publishedVersion: targetVersionModel.version,
        draftModel,
        latestSavedModel,
      }),
      message: `Published version v${targetVersionModel.version}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to publish project model',
    }
  }
}
