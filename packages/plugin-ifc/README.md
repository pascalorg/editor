# Pascal IFC Import / Export plugin

The Pascal IFC plugin adds a project panel for importing `.ifc` building models
and exporting the current scene as IFC4. IFC import uses the existing
`@pascal-app/ifc-converter` pipeline. Imported nodes are added through the scene
store's create action so the import is undoable and the current scene is kept.

The host app serves the `web-ifc` WASM binaries from `/`; see
`apps/editor/scripts/copy-web-ifc-wasm.mjs` for the host setup.

This plugin contributes no node kinds. Its file workflow is an editor host panel
registered alongside the Pascal plugin manifest.
