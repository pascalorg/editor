# How successful open-source Blender add-ons run their GitHub presence

Research date: 2026-08-02. All numbers verified live via the GitHub API (`gh api`) and the
extensions.blender.org API (`/api/v1/extensions/`). Six add-ons studied across tiers:
from a 9k-star community giant (BlenderGIS) to a 363-star long-tail workhorse with
100k+ downloads per release (MCprep).

| Add-on | Stars | Releases | Latest cadence | Downloads (recent asset) | License |
|---|---|---|---|---|---|
| [BlenderGIS](https://github.com/domlysz/BlenderGIS) | 9,247 | 9 tags | sporadic bursts | n/a (no assets) | GPL-3.0 |
| [dream-textures](https://github.com/carson-katri/dream-textures) | 8,193 | 15 | dormant since 2024 | 38k (windows-cuda 0.4.1) | GPL-3.0 |
| [Blender-For-UnrealEngine](https://github.com/xavier150/Blender-For-UnrealEngine-Addons) | 2,623 | 65 | ~monthly | 100–460 per asset | GPL-3.0 |
| [glTF-Blender-IO](https://github.com/KhronosGroup/glTF-Blender-IO) | 1,650 | 1 (!) | ships inside Blender | n/a | Apache-2.0 |
| [MolecularNodes](https://github.com/BradyAJohnston/MolecularNodes) | 1,329 | 93 | ~monthly, patch-heavy | 100s–1k per release | GPL-3.0 |
| [MCprep](https://github.com/Moo-Ack-Productions/MCprep) | 363 | 38 | 2–4/year | **13k–130k per release zip** | GPL-3.0 |

Key insight up front: **stars ≠ users**. MCprep has 25x fewer stars than BlenderGIS but
129,742 downloads on a single release zip (v3.6.1.2). Download funnels, video tutorials,
and in-release install UX matter far more than repo aesthetics for actual adoption.

---

## 1. MCprep (Moo-Ack-Productions/MCprep) — the download-funnel master

- **Stats**: 363 stars, 38 releases, latest 3.6.3 (2026-07-12) with 13,751 downloads
  already; previous zips at 88k and 129k downloads.
- **Repo structure**: `MCprep_addon/` (source pkg), `docs/`, `test_files/`, `visuals/`
  (all README media committed in-repo), `CONTRIBUTING.md`, `run_tests.py`, poetry +
  `bpy-build.yaml` build tooling, `.github/ISSUE_TEMPLATE/` + `workflows/run_tests.yaml`.
- **README layout**: title → 4 badges (Discord, license, stars, "contributions welcome")
  → one-sentence pitch → **Install as the very first section**, with a giant clickable
  download-button *image* (`visuals/mcprep_download.png`) that links to their own site
  theduckcow.com/dev/blender/mcprep-download/ (redirect → latest zip; gives them
  analytics + a stable URL that never goes stale in old videos). Explicitly warns "do
  NOT click Download ZIP". Then a YouTube tutorial-playlist thumbnail ("short 1-minute
  videos"), then feature tables, screenshots and GIFs (`meshswap.demo.gif`,
  `spawner-gif.gif`).
- **Releases**: single zip per release (`MCprep_addon_3.6.3.zip`), release body =
  the same download-button image at top + "See README" + Discord link + a 1920×1080
  splash image + human-curated "What's Changed" grouped Improvements/Bug fixes/Non-user
  impacting + auto "Full Changelog" compare link. RC releases (3.6.0-rc-1..3) with a
  `User-Acceptance-Testing.yml` issue form for community testing.
- **Docs**: README + wiki + their own site; `docs/` holds contributor-facing specs.
- **Issues**: 4 YAML issue *forms* (Bug-Report, Feature-Request, Asset-Submission,
  User-Acceptance-Testing). Bug form forces checkboxes: "restarted Blender?", "checked
  known issues?", version fields — triage armor. Discussions enabled (18, low-use;
  Discord is the real community channel).
- **Funnel**: own website button (analytics + stable URL) → GitHub Releases hosts the
  file. Discord badge first in README. Twitter share link, user survey link, donation
  link inline in README.
- **Virality**: YouTube tutorial playlist is the centerpiece ("Learn how to use MCprep"
  is the #2 README section); TheDuckCow's channel drives most installs. Splash image
  per release like a game patch.

## 2. BlenderGIS (domlysz/BlenderGIS) — wiki-first, GIFs sell it

- **Stats**: 9,247 stars, 1,511 forks, 319 open issues. Only 9 releases with **no
  attached assets** (users install from source zip / tags) — release bodies are 1-line.
- **Repo structure**: flat, old-school: `__init__.py` at root plus `core/`, `operators/`,
  `clients/`, `icons/`, `prefs.py`. No `.github/` dir at all — a root `issue_template.md`
  (legacy mechanism) that threatens auto-close if not followed.
- **README layout**: minimal. Version requirement, one gotcha note (OpenTopography API
  key), then a **link bar: Wiki – FAQ – Quick start guide – Flowchart**, then
  "Functionalities overview" with two **demo GIFs served from the wiki's git repo**
  (`raw.githubusercontent.com/wiki/domlysz/blenderGIS/...gif`) showing terrain built
  from real data in seconds. That's it — the GIFs do all the selling.
- **Docs**: GitHub **wiki** is the real documentation (Home, FAQ, Quick start,
  flowchart image). Wiki repo doubles as media CDN.
- **Issues/community**: single markdown issue template; Discussions enabled and
  actually used (119 discussions).
- **Funnel**: GitHub only. Not on extensions.blender.org (checked the API — absent).
- **Virality**: the two README GIFs (import OSM/terrain → 3D city in seconds) are
  endlessly re-shared; the add-on demos itself. Lesson: one jaw-dropping
  before/after GIF above the fold beats pages of text.

## 3. glTF-Blender-IO (KhronosGroup) — the "importer done right" reference

- **Stats**: 1,650 stars; exactly **1 GitHub release** (a legacy 2.79 zip) because the
  add-on ships bundled inside Blender itself; branches mirror Blender release branches
  (`blender-v4.5-release`, `blender-v5.0-release`...).
- **Repo structure**: `addons/io_scene_gltf2/`, `tests/`, `docs/` (architecture PNGs),
  `example-addons/` (extension samples for third parties), `Technical.md`,
  `DEBUGGING.md`, `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/` (md bug/feature
  templates + config.yml).
- **README layout**: two logos side-by-side (Blender + glTF) as hero → **documentation
  version table first** (per-Blender-version manual links) → credits → architecture
  section with two diagrams (`docs/packages.png`, `docs/io_process.png`) explaining
  the importer/exporter pipeline → CI badge + description of round-trip validation
  tests ("export → validate with glTF-Validator → re-import → compare").
- **Docs**: external official manual (docs.blender.org), versioned per Blender release.
- **Issues**: bug template makes a **sample file mandatory** ("A zipped folder
  containing a .blend file for exporter issues and a .gltf file for importer
  issues") — the single most valuable line for any importer project. No Discussions.
- **Relevance to pascal-blender**: this is the closest architectural cousin (format
  importer, format spec owned elsewhere). Their credibility levers: CI badge + spec
  round-trip validation prominently described, architecture diagrams, per-version docs,
  mandatory repro files.

## 4. dream-textures (carson-katri) — the modern high-gloss template

- **Stats**: 8,193 stars, 15 releases, 38k+ downloads on the top 0.4.1 asset.
- **Repo structure**: add-on source at root, `docs/assets/` for README media,
  `.github/` with `FUNDING.yml` (GitHub Sponsors), YAML bug form, `package-release.yml`
  workflow (multi-platform build) + `stale.yml`.
- **README layout** (the one to copy):
  1. **Custom banner PNG** (`docs/assets/banner.png`) — logo + tagline, no plain text title.
  2. Badge row: **Latest Release · Discord · Total Downloads (shields.io
     `github/downloads/.../total`) · "Buy on Blender Market"**.
  3. 5 bullet points of what it does.
  4. `# Installation` immediately: "Download the latest release and follow the
     instructions there" + macOS quarantine workaround in a `>` callout + link to a
     community video guide.
  5. `# Usage`: one `##` section per feature, each linking to a **wiki page** and
     showing a **step-by-step composite graphic** (`docs/assets/image_generation.png`
     etc. — multi-panel images showing input → settings → result).
  6. Compatibility, Contributing (wiki dev-env guide), Troubleshooting (how to read
     Blender's console, search-issues-first link, Discord).
- **Releases**: per-platform/per-Blender-version assets; release body contains a
  **download matrix table** (OS × Blender version → direct asset links) + step-by-step
  install + auto-generated "What's Changed" with contributor credits and "New
  Contributors" section. The release page IS the install landing page.
- **Docs**: GitHub wiki for guides; README links per-topic.
- **Funnel**: GitHub Releases is primary; **Blender Market listing as an alternative
  channel** (badge in README); Discord for support; FUNDING.yml → Sponsors.
- **Virality**: launched with viral demo images/videos (depth-to-image texturing whole
  scenes); every README feature section has its own shareable graphic.

## 5. MolecularNodes (BradyAJohnston) — the automation/CI gold standard

- **Stats**: 1,329 stars, **93 releases**, ~monthly cadence with fast patch trains
  (three releases in one week of Nov 2025).
- **Repo structure**: `molecularnodes/` pkg, `tests/` (pytest), `docs/` (**Quarto**
  site), `build.py`, `pyproject.toml` + `uv.lock`, `.pre-commit-config.yaml`,
  `CHANGELOG.md`, `CONTRIBUTING.md`, `AI_POLICY.md`, 5 workflows:
  `ci.yml`, `test-daily.yml`, `release.yml`, `upload.yml`, `pypi.yml`.
- **The release pipeline (worth copying verbatim)**:
  - `release.yml`: on tag `v*` → installs Blender via `BradyAJohnston/setup-blender`
    action → `blender -b -P build.py` builds per-platform extension zips
    (`molecularnodes-4.5.13-{windows_x64,macos_arm64,linux_x64}.zip`) →
    `gh release create --draft --generate-notes *.zip` (draft = human gate).
  - `upload.yml`: on release **published** → downloads the zips → **POSTs them to
    `https://extensions.blender.org/api/v1/extensions/molecularnodes/versions/upload/`**
    with a bearer token. GitHub release and extensions.blender.org stay in lockstep
    automatically. Also publishes to PyPI (`pypi.yml`) since the core is usable as a
    Python lib.
- **README layout**: emoji title + logo floated right → CI badge + release/downloads/
  license/stars badges → **big Patreon / Buy-me-a-coffee / Discord buttons** → About →
  Examples section leading with **social proof: YouTube thumbnails of Veritasium and
  other famous videos made with it** → Installation ("use Get Extensions menu in
  Blender ≥4.2" — extensions platform is the primary channel now) → tutorials link →
  Contributing (recommends `git clone --depth 1`, blender_vscode workflow) → Zenodo
  DOI badge for academic citation.
- **Docs**: full **Quarto docs site on GitHub Pages**
  (bradyajohnston.github.io/MolecularNodes) with tutorials, per-node reference
  auto-generated (`docs/generate.py`), examples gallery, citations page.
- **Issues**: bug/feature md templates; Discussions active (76).
- **Funnel**: extensions.blender.org first (one-click install + auto-updates inside
  Blender), GitHub releases as mirror, Patreon/BMC monetization, Discord community.
- **Virality**: being used in Veritasium videos + BCON talks; the README leads with
  that. Academic citability (Zenodo DOI) is its niche-specific virality lever.

## 6. Blender-For-UnrealEngine (xavier150) — wiki-as-docs, version-matrix builds

- **Stats**: 2,623 stars, 65 releases, roughly monthly; only 9 open issues (aggressive
  hygiene).
- **Repo structure**: default branch is literally called `release`; source in
  `blender_for_unrealengine/` (modular `bfu_*` sub-packages), `ReleaseLogs/`,
  custom builder (`run_bfu_builder.py`) that produces **one zip per supported Blender
  range**: `...-blender_2.80.zip`, `...-blender_2.91-4.1.zip`, `...-blender_4.2.zip`,
  ..., `...-blender_5.0-5.2.zip` (7 assets per release). No `.github/` folder at all.
- **README layout**: plain text title → capability bullet list → "How it works"
  narrative → then a **massive linkfarm to ~30 wiki pages** organized as Quick Start /
  Overview Pages / Skeletal / Videos. README is a table of contents; the wiki is the
  product manual.
- **Releases**: tag `v4.4.8` → "Rev 4.4.8", short human changelog, the 7 per-version
  zips. Download counts show users pick exactly their Blender version.
- **Funnel**: GitHub + Discord ("BleuRaven side projects"); personal site homepage.
  Support via Discord, not issues — which is how it keeps 9 open issues.
- **Lesson**: naming assets by supported Blender version range removes the #1 support
  question ("which zip do I download?"), at the cost of build-matrix complexity.

---

## Cross-cutting patterns (what actually correlates with success)

1. **Install section within the first screenful**, always above features. The three
   biggest funnels (MCprep, dream-textures, MolecularNodes) make "get it" the first
   actionable thing, and 2 of 3 use a visual button/badge, not a text link.
2. **The release page is a landing page**: splash image, download matrix, install
   steps repeated, human-grouped changelog on top of `--generate-notes`. Old videos
   and forum posts deep-link to releases; those pages must self-explain.
3. **Downloads-total badge** (shields.io `github/downloads/:user/:repo/total`) is the
   social proof that matters for tools (MolecularNodes, dream-textures both show it).
4. **GIFs beat text**: BlenderGIS is 9k stars on essentially two GIFs. Every studied
   README with real traction has motion or multi-step composite images above the fold.
5. **extensions.blender.org is the new default channel** for Blender 4.2+:
   MolecularNodes even automates upload via the public API on release-publish.
   1,124 extensions listed; the platform gives in-Blender one-click install **and
   auto-updates**. License reality check: 975/1124 are GPL-3.0, 146 GPL-2.0, only 7
   include MIT (usually dual-tagged with GPL) — Blender add-ons that `import bpy` are
   effectively GPL-derived, and the platform requires GPL-compatible sharing. MIT is
   GPL-compatible, so pascal-blender can stay MIT-licensed while being *distributed*
   under GPL terms on the platform (several add-ons there do exactly this dual
   MIT+GPL tagging, e.g. `vrm`, `blender_magicavoxel`).
6. **Issue forms with mandatory repro artifacts**: glTF-Blender-IO's "attach the
   file (mandatory)" and MCprep's checkbox-gauntlet YAML forms are the difference
   between 9 and 319 open issues. For an importer, "attach the JSON scene" is the
   whole ballgame.
7. **Discord (or Discussions) absorbs support** so issues stay engineering-only.
   Every project with healthy issue counts routes "help me" traffic elsewhere.
8. **Video is the top-of-funnel**: MCprep's tutorial playlist, dream-textures' launch
   demos, MolecularNodes' Veritasium cameo. GitHub is where people land *after* seeing
   the tool move.
9. **CI that runs Blender headless on every push, tag-triggered draft releases,
   human-published**. MolecularNodes' 3-workflow chain (test → build+draft on tag →
   upload to extensions platform on publish) is the state of the art. pascal-blender's
   existing `release.yml` (download Blender 4.5, run `tests/run_headless.py`, `blender
   --command extension build`, softprops release) is already 80% of this.

---

## Prioritized checklist for pascal-blender

New MIT importer for a web building editor; already has: strong README copy, CI +
tag-triggered release with zip, TESTING.md, demo renders, `docs/marketing/demo.gif`.
Gaps ranked by impact:

### P0 — do before/at 0.2.0 launch
1. **README hero: demo GIF + hero render above the fold.** Move
   `docs/marketing/demo.gif` (editor screenshot → Blender native objects) and
   `hero-clay-render.png` to the top of README, before the prose. Pattern: BlenderGIS
   (GIF is the pitch), dream-textures (banner.png). A before/after "triangle-soup GLB
   vs native walls/roofs" composite is this project's killer image.
2. **Badge row**: latest-release, downloads-total, CI status, Blender 4.2+, license
   MIT. (`img.shields.io/github/v/release/...`, `.../downloads/.../total`,
   actions workflow badge). Pattern: dream-textures, MolecularNodes.
3. **Issue forms (YAML) with mandatory scene JSON attachment** + Blender version +
   extension version + console traceback. Copy glTF-Blender-IO's "mandatory file"
   language and MCprep's checkbox gating. Add `config.yml` routing questions to
   Discussions. This is cheap now and priceless at 50 users.
4. **Release body template**: hero image at top, 3-step install (drag zip into
   Blender), human-grouped changes above `generate_release_notes`, link to sample
   scene JSON so people can try without a Pascal account. Pattern: MCprep splash +
   dream-textures install-matrix.
5. **Ship a bundled sample scene** (`examples/demo-house.json`) and reference it in
   README + release notes — an importer nobody can feed is an importer nobody tries.

### P1 — first weeks after launch
6. **Submit to extensions.blender.org** (task #8 adjacent). It is the discovery +
   auto-update channel (1,124 extensions, in-Blender search). Handle licensing the way
   `vrm`/`blender_magicavoxel` do: keep repo MIT, tag the extension MIT+GPL-3.0 (MIT
   is GPL-compatible; `import bpy` code is distributed under GPL terms). Then copy
   MolecularNodes' `upload.yml`: on release published → `curl -X POST
   https://extensions.blender.org/api/v1/extensions/<id>/versions/upload/` with
   bearer token → GitHub and the platform never drift.
7. **Switch release workflow to draft-then-publish** (MolecularNodes pattern):
   `gh release create --draft --generate-notes` so a human writes the top half of the
   notes and attaches the splash before it goes live; keep upload automation keyed on
   `release: published`.
8. **Enable GitHub Discussions** (Q&A + Show-and-tell categories). Show-and-tell of
   users' imported buildings/renders is the community flywheel for an archviz-adjacent
   tool. Pattern: BlenderGIS (119), dream-textures (125).
9. **60–90s YouTube video**: export JSON from editor.pascal.app → drag into Blender →
   orbit native geometry → move a door and watch the hole follow → Cycles render.
   Embed thumbnail in README the MCprep way. Every high-download add-on has one; none
   of the low-download ones do.
10. **One README composite graphic per headline feature** (dream-textures pattern):
    (a) native rebuild vs GLB soup, (b) live door/opening drag, (c) lossless
    round-trip diagram (the datablock/props table as a visual). The lossless story is
    unique — glTF-Blender-IO shows that importers win trust with architecture
    diagrams + validation-test descriptions; pascal-blender's deep-equal round-trip
    test deserves a diagram and a named badge-able CI job.

### P2 — as the project grows
11. **Docs site when README overflows**: MolecularNodes' Quarto-on-Pages is the
    best-in-class model; a wiki (BlenderGIS/xavier150 style) is the lower-effort
    interim. Move the per-node-type mapping tables (`docs/design/lossless-mapping.md`)
    into user-facing docs; keep README to pitch + install + quickstart + links.
12. **Per-Blender-version compatibility statement** in README and, if divergence ever
    happens, version-suffixed zips (xavier150 pattern). For now "4.2+ / tested on
    4.5 LTS" as a badge is enough.
13. **Stable download URL / landing page** on pascal.app (MCprep's theduckcow.com
    pattern) once there's marketing traffic — survives repo renames and gives
    analytics; point it at `releases/latest`.
14. **Community/support channel** (Discord server or a #blender channel in an existing
    Pascal community) + `stale.yml`, so GitHub issues stay engineering-only
    (xavier150: 65 releases, 9 open issues).
15. **FUNDING.yml / sponsors row** only if/when relevant — for a company-adjacent
    project, replace with "made for the Pascal editor" cross-links both ways
    (pascalorg/editor README should link back; that's free discovery from the
    editor's own audience).

### Explicit anti-patterns observed (avoid)
- Releasing with **no attached zip** (BlenderGIS) — forces source installs, kills
  the downloads badge, breaks Blender's drag-install story.
- Letting "help" traffic hit the issue tracker untemplated (BlenderGIS: 319 open).
- Burying install below the fold or only in the wiki.
- Relying on auto-generated release notes alone — every high-download project
  hand-writes the top section.
