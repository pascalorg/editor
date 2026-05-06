# Pascal Viewer Card for Home Assistant

This package contains the Pascal Lovelace custom card and the HACS-facing bundle:

```text
dist/pascal-viewer-card.js
```

Use this guide to go from a fresh Home Assistant install to seeing a live Pascal render in a Home Assistant dashboard.

## What Gets Installed

Pascal uses two separate pieces:

- HACS: the Home Assistant Community Store integration that installs custom dashboard cards.
- Pascal Viewer Card: the Lovelace custom card that renders an exported Pascal scene inside Home Assistant.

The Pascal card does not install a Home Assistant add-on, custom integration, or backend service. Home Assistant loads it as a frontend JavaScript module.

## 1. Install Get HACS From Apps / Add-ons

If HACS is not already installed:

1. In Home Assistant, open `Settings`.
2. Open `Apps`. On older Home Assistant UIs, this may still be named `Add-ons`.
3. Open `App Store`. On older Home Assistant UIs, this may still be named `Add-on Store`.
4. Search for `Get HACS`.
5. Install the `Get HACS` app/add-on.
6. Open `Get HACS` and press `Start`.
7. Open its `Log` tab.
8. Wait until the log says HACS has been downloaded and tells you to restart Home Assistant.

`Get HACS` is only a downloader. It is not the HACS sidebar entry.

## 2. Restart Home Assistant

Restart Home Assistant after `Get HACS` finishes.

Depending on the Home Assistant version and install type, restart may be under one of these paths:

- `Settings` -> `System` -> power icon in the top right -> `Restart Home Assistant`
- `Developer tools` -> `YAML` -> `Restart Home Assistant`
- Supervisor or host restart if the UI does not expose a Home Assistant restart button

After restart, hard-refresh the browser tab if the UI still looks stale.

## 3. Add The HACS Integration

After Home Assistant restarts:

1. Open `Settings`.
2. Open `Devices & services`.
3. Press `Add integration`.
4. Search for `HACS`.
5. Follow the GitHub authorization flow.

HACS asks for GitHub authorization because it uses GitHub to download custom integrations and dashboard cards, check releases, and respect GitHub rate limits. For normal HACS use, it does not need permission to control Home Assistant.

When setup is complete, `HACS` should appear in the left sidebar.

## 4. Add The Pascal Repository To HACS

In Home Assistant:

1. Open `HACS`.
2. Open the three-dot menu or custom repository dialog.
3. Add this repository URL:

```text
https://github.com/pascalorg/editor
```

4. Set the category to `Dashboard`.
5. Install `Pascal Viewer Card`.

The installed resource should appear under:

```text
Settings -> Dashboards -> Resources
```

Expected resource:

```text
/hacsfiles/editor/pascal-viewer-card.js
```

Expected type:

```text
JavaScript module
```

Avoid adding duplicate resources for the same card. If HACS already added the resource, do not add another manual copy with the same path.

## 5. Export A Pascal Scene

Open the Pascal app outside Home Assistant.

1. Connect Pascal to the Home Assistant instance.
2. Import Home Assistant devices, rooms, scenes, scripts, or groups.
3. Bind those resources to Pascal rooms, items, or controls.
4. Use Pascal's Lovelace export/download action.

There are two valid export shapes:

- Full card config: a file such as `pascal-viewer-card-config.json` or `pascal-viewer-card-config (1).json`.
- Scene artifact only: a scene data file that the Lovelace card loads through `scene_url`.

If Pascal downloaded `pascal-viewer-card-config.json`, paste that into the Lovelace manual card editor. Do not put that file path into `scene_url`.

If Pascal exported only a scene artifact, host it from Home Assistant and reference it with `scene_url`.

## 6. Host A Scene Artifact With `/local`

Skip this section when using the full exported card config.

For a scene artifact file, place it under Home Assistant's `www` folder:

```text
/config/www/pascal/home.scene.json
```

Home Assistant serves that file at:

```text
/local/pascal/home.scene.json
```

The Lovelace config then references:

```yaml
scene_url: /local/pascal/home.scene.json
```

## 7. Create A Pascal Dashboard

Do not use the auto-generated `Overview` page as the main setup path. Its pencil can open display preferences instead of the normal Lovelace card editor.

Create a dedicated dashboard instead:

1. Open `Settings`.
2. Open `Dashboards`.
3. Press `Add dashboard`.
4. Choose `New dashboard from scratch`.
5. Name it `Pascal`.
6. Enable `Show in sidebar`.
7. Open the new `Pascal` dashboard from the left sidebar.

## 8. Add The Pascal Card

On the `Pascal` dashboard:

1. Press the pencil icon to edit the dashboard.
2. Press `Add card`.
3. Choose `Manual`.
4. Paste the Pascal card config.
5. Save.

For a hosted scene artifact:

```yaml
type: custom:pascal-viewer-card
scene_url: /local/pascal/home.scene.json
mode: overview
show_header: true
tap_action:
  action: toggle
```

For a full exported config, paste the whole exported object. It should still start with:

```yaml
type: custom:pascal-viewer-card
```

and may include inline scene data instead of `scene_url`.

## 9. Make The Render Wide

If the Pascal render appears as a narrow vertical slice, the card is loaded but the Home Assistant dashboard layout is constraining it.

Preferred setup for one large Pascal viewer:

1. Use a dedicated `Pascal` dashboard.
2. Use a panel-style view when available.
3. Put only the Pascal card in that view.

If using a Sections dashboard, increasing the card width alone may not be enough. Widen the section or column span that contains the card.

## 10. Confirm Live Behavior

The card is live when:

- Home Assistant entity state changes update Pascal controls.
- Pressing a Pascal light or switch control calls the matching Home Assistant service.
- Bound devices reflect their current on/off state after Home Assistant sends a new `hass` object to the card.

If the render appears but controls are not live, re-export from Pascal after binding Home Assistant resources to rooms/items.

## Troubleshooting

### HACS Is Not In The Sidebar

You probably installed only `Get HACS`.

Finish the downloader flow:

1. Start the `Get HACS` app/add-on.
2. Read its log until it says the download finished.
3. Restart Home Assistant.
4. Add the `HACS` integration from `Settings` -> `Devices & services`.

### `Custom element doesn't exist: pascal-viewer-card`

Home Assistant has not loaded the JavaScript module.

Check:

- HACS installed `Pascal Viewer Card`.
- `Settings` -> `Dashboards` -> `Resources` contains `/hacsfiles/editor/pascal-viewer-card.js`.
- The resource type is `JavaScript module`.
- The browser was hard-refreshed after installation.

### Pascal Scene Could Not Load

The card loaded, but the scene did not.

Check:

- `scene_url` points to a served URL, not a local Windows path.
- `/config/www/pascal/home.scene.json` maps to `/local/pascal/home.scene.json`.
- A full `pascal-viewer-card-config.json` export was pasted into the manual card editor instead of being used as `scene_url`.

### The Card Is A Vertical Slice

The card is inside a narrow Home Assistant section or column.

Use a panel view for the Pascal dashboard, or widen the containing section/column.

### The Card Shows But Devices Do Not Work

The scene may not contain Home Assistant bindings.

Go back to Pascal, connect to Home Assistant, bind the devices/groups to Pascal controls, then export the Lovelace config again.

## Development

Build the package bundle:

```bash
bun run --cwd packages/lovelace-card build
```

Build and copy the HACS-facing bundle to the repository root `dist` folder:

```bash
bun run --cwd packages/lovelace-card build:hacs
```

HACS reads:

```text
hacs.json
dist/pascal-viewer-card.js
```
