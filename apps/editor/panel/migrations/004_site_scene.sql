-- A site is represented in the editor by a 3D scene. The column stays NULL in
-- a standalone console deployment (nothing there creates scenes); in the
-- combined app the editor's site-scene worker fills it in after provisioning.
ALTER TABLE sites ADD COLUMN scene_id VARCHAR(64) NULL;
