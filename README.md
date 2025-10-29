## Setup

```bash
bun install
bun dev
```

## Stack

* Next.js 16
* Three.js
* R3F

## Features

### Dynamic Viewer

The application includes a dynamic viewer that can load and display building layouts from JSON files:

- **Main Viewer**: `/viewer` - Displays the current project saved in IndexedDB
- **Dynamic Viewer**: `/viewer/[id]` - Loads and displays demo layouts from `/public/demos/[id].json`

To add a new demo:
1. Export a layout from the editor (JSON format)
2. Save it in `/public/demos/` with a unique ID as filename (e.g., `[id].json`)
3. Access it at `/viewer/[id]`

Example: `/viewer/kV1ve8Sd` loads `/public/demos/kV1ve8Sd.json`
