-- Backfill script to update the is_empty flag for existing projects
-- This can be run multiple times safely as logic evolves

UPDATE projects p
SET is_empty = false
FROM (
  -- 1. Get the latest model for each project
  SELECT DISTINCT ON (project_id) project_id, scene_graph
  FROM projects_models
  WHERE deleted_at IS NULL
  ORDER BY project_id, version DESC, created_at DESC
) latest_model
WHERE p.id = latest_model.project_id
AND p.is_empty = true -- Only process projects that are currently marked empty
AND latest_model.scene_graph IS NOT NULL
AND latest_model.scene_graph->'nodes' IS NOT NULL
AND (
  -- Condition 1: More than 3 nodes
  (SELECT count(*) FROM jsonb_object_keys(latest_model.scene_graph->'nodes')) > 3
  
  OR 
  
  -- Condition 2 & 3: Iterate through nodes to check type and children
  EXISTS (
    SELECT 1 
    FROM jsonb_each(latest_model.scene_graph->'nodes') AS n(key, value)
    WHERE 
      -- Not a default node type
      (n.value->>'type' NOT IN ('site', 'building', 'level'))
      OR
      -- Or is a level node with > 0 children
      (
        n.value->>'type' = 'level' 
        AND jsonb_typeof(n.value->'children') = 'array' 
        AND jsonb_array_length(n.value->'children') > 0
      )
  )
);