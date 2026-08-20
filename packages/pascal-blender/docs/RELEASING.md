# Releasing pascal-blender

## One-time setup (publishing to pascalorg)

```sh
cd ~/Documents/GitHub/pascal-blender
gh repo create pascalorg/pascal-blender --public \
    --description "Open Pascal editor scenes in Blender — drag & drop, fully editable, zero data loss" \
    --source . --push
```

(Requires admin rights on the pascalorg org; otherwise create the repo in the
GitHub UI and `git remote add origin git@github.com:pascalorg/pascal-blender.git && git push -u origin master:main`.)

Then in the repo settings: add topics `blender`, `blender-extension`,
`blender-addon`, `pascal`, `architecture`, `3d`; set the social preview image
to `docs/marketing/hero-clay-render.png`.

## Every release

1. Bump `version` in `pascal_blender/blender_manifest.toml`.
2. Commit, then tag and push:

   ```sh
   git tag v0.1.0 && git push origin v0.1.0
   ```

3. The `release.yml` workflow runs the full headless test suite, builds the
   extension zip with Blender itself, and attaches it to a GitHub Release
   with auto-generated notes. Users install by dragging that zip into Blender.

CI (`ci.yml`) runs the same suite on every push/PR, so a red main never ships.

## Distribution channels (in order of reach)

1. **GitHub Releases** (live — the zip installs by drag & drop).
2. **Self-hosted extension repository** (live — auto-updates): every published
   release re-generates https://pascalorg.github.io/pascal-blender/index.json
   via `pages.yml`. Users add that URL once under Preferences → Get
   Extensions → Repositories and Blender handles updates natively.
   One-click install link format (drag into Blender, offers to add the repo):
   `https://github.com/pascalorg/pascal-blender/releases/download/vX.Y.Z/pascal_blender-X.Y.Z.zip?repository=https%3A%2F%2Fpascalorg.github.io%2Fpascal-blender%2Findex.json&blender_version_min=4.2.0`
3. **extensions.blender.org** — the official marketplace. Caveats found in
   research (docs/research/extensions-platform.md): the ToS requires
   GPL-3.0-or-later for listed add-ons (fix: dual-license the manifest as
   `["SPDX:MIT", "SPDX:GPL-3.0-or-later"]`, precedent: the VRM add-on), and
   asset downloads must work without a Pascal account or it counts as a
   rejected "mixed product". First review takes days; after approval, new
   versions can be uploaded automatically from CI
   (`POST /api/v1/extensions/pascal_blender/versions/upload/` with a token).
4. **Pascal editor cross-link** — a small PR to pascalorg/editor adding a
   "Download scene (.json)" button with an "Open in Blender" hint linking
   here. Highest-intent audience of all.

## Moderation-readiness notes (from research)

- Never add a self-updater to the add-on (hard rejection; the repo handles it).
- Asset cache must stay in `bpy.utils.extension_path_user` (it does).
- Network access must stay gated on `bpy.app.online_access` (it is).
- Ship only `extension build` output (no `__pycache__`), keep permission
  strings ≤64 chars without trailing periods.
