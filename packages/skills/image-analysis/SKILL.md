---
name: image-analysis
description: Extract color palettes from images (screenshots, Figma exports, design mockups) to help implement matching UI. Use when the user shares a screenshot, design image, or asks to "match these colors", "extract colors from this image", "implement this design", or "get the color palette".
metadata:
  author: pascalorg
  version: "1.0.0"
---

# Image Analysis — Color Extraction

Extract dominant colors from any image file (PNG, JPG, WebP, BMP, GIF) and return a structured palette. Useful for implementing UIs that match a screenshot, Figma export, or design mockup.

## When to Use

- The user provides a screenshot or design image and wants to implement it
- The user asks to extract or identify colors from an image
- The user wants a color palette from a photo or mockup
- The user wants to match their code's colors to a reference image

## How It Works

1. Reads the image file using `get-pixels` to obtain raw pixel data
2. Passes pixel data to `extract-colors` to compute dominant colors
3. Returns a sorted palette (by area/prominence) with hex, RGB, HSL values, and area coverage

## Usage

Run the extraction script, passing the image path as the first argument:

```bash
bash <skill-path>/scripts/extract-colors.sh /path/to/image.png
```

**Arguments:**
- `$1` — Path to the image file (required). Supports PNG, JPG, WebP, BMP, GIF.

**Examples:**

```bash
# Extract colors from a screenshot
bash <skill-path>/scripts/extract-colors.sh ./screenshot.png

# Extract colors from a Figma export
bash <skill-path>/scripts/extract-colors.sh ~/Downloads/figma-design.jpg
```

## Output

The script outputs a JSON array of colors sorted by prominence:

```json
[
  {
    "hex": "#1a1a2e",
    "red": 26,
    "green": 26,
    "blue": 46,
    "hue": 0.6667,
    "saturation": 0.2778,
    "lightness": 0.1412,
    "area": 0.3241
  },
  {
    "hex": "#e94560",
    "red": 233,
    "green": 69,
    "blue": 96,
    "hue": 0.9724,
    "saturation": 0.7928,
    "lightness": 0.5922,
    "area": 0.1856
  }
]
```

| Field      | Type    | Description                              |
|------------|---------|------------------------------------------|
| hex        | String  | Color as hex string (e.g. `#1a1a2e`)     |
| red        | Integer | Red channel (0-255)                      |
| green      | Integer | Green channel (0-255)                    |
| blue       | Integer | Blue channel (0-255)                     |
| hue        | Number  | Hue (0-1)                                |
| saturation | Number  | Saturation (0-1)                         |
| lightness  | Number  | Lightness (0-1)                          |
| area       | Number  | Relative area/prominence (0-1)           |

## Present Results to User

After extracting colors, present them as a structured palette:

```
Color Palette (sorted by prominence):

1. #1a1a2e — 32.4% (dark navy) — Primary background
2. #e94560 — 18.6% (coral red) — Accent color
3. #f5f5f5 — 15.2% (light gray) — Secondary background
...
```

Then suggest how to use these colors in the user's codebase:
- CSS custom properties / variables
- Tailwind config theme colors
- Design token definitions
- Direct usage in component styles

## Troubleshooting

### "Cannot find module" errors
The script auto-installs dependencies (`extract-colors`, `get-pixels`) on first run. If this fails, install them manually:
```bash
cd <skill-path>/scripts && npm install
```

### Unsupported image format
The underlying `get-pixels` library supports PNG, JPG, GIF, and BMP. For other formats, convert the image first.

### Large images are slow
The `extract-colors` library automatically downsamples to 64,000 pixels by default. For very large images this is already fast, but you can adjust the `pixels` option in the script if needed.
