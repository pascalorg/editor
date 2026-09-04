---
name: image-compare
description: Compare two images pixel-by-pixel and get a visual diff. Use when the user wants to compare their implementation against a design, spot differences between two screenshots, or verify visual regression.
metadata:
  author: pascalorg
  version: "1.0.0"
---

# Image Compare

Compare two images pixel-by-pixel. Returns a diff count, mismatch percentage, and generates a diff image highlighting the differences in red.

## When to Use

- Comparing an implementation screenshot against the original design
- Spotting visual regressions between two versions of a page
- Verifying that a UI matches a Figma export

## How It Works

1. Both images are loaded and resized to match dimensions (uses the smaller of the two)
2. `pixelmatch` compares every pixel and flags differences above a configurable threshold
3. Returns mismatch stats and writes a diff image showing changes in red

## Usage

```bash
bash <skill-path>/scripts/image-compare.sh <image1> <image2> [diff-output.png] [threshold]
```

**Arguments:**
- `image1` — First image path (required)
- `image2` — Second image path (required)
- `diff-output.png` — Path to write the diff image (optional, defaults to `./diff.png`)
- `threshold` — Pixel matching threshold 0-1, lower is stricter (optional, defaults to `0.1`)

**Examples:**

```bash
# Compare a design against implementation
bash <skill-path>/scripts/image-compare.sh design.png screenshot.png

# Compare with custom threshold and output path
bash <skill-path>/scripts/image-compare.sh before.png after.png ./changes.png 0.05
```

## Output

```json
{
  "totalPixels": 921600,
  "differentPixels": 4523,
  "mismatchPercentage": 0.49,
  "dimensions": { "width": 1280, "height": 720 },
  "diffImage": "./diff.png",
  "threshold": 0.1
}
```

| Field              | Type   | Description                                     |
|--------------------|--------|-------------------------------------------------|
| totalPixels        | Number | Total pixels compared                           |
| differentPixels    | Number | Number of pixels that differ                    |
| mismatchPercentage | Number | Percentage of pixels that differ                |
| dimensions         | Object | Width and height used for comparison             |
| diffImage          | String | Path to the generated diff image                |
| threshold          | Number | Sensitivity threshold used                      |

## Present Results to User

After comparing, present a summary:

```
Comparison: design.png vs screenshot.png

Mismatch: 0.49% (4,523 pixels out of 921,600)
Diff image saved to: ./diff.png

The images are nearly identical. Differences are highlighted in red in the diff image.
```

Interpret the percentage:
- **< 0.1%** — Essentially identical
- **0.1% - 1%** — Minor differences, likely anti-aliasing or sub-pixel rendering
- **1% - 5%** — Noticeable differences, worth reviewing
- **> 5%** — Significant visual changes

## Troubleshooting

**Different sized images** — The script automatically resizes both images to the smaller dimensions. For best results, use images of the same size.

**Too many false positives** — Increase the threshold (e.g., `0.2`). Anti-aliasing differences are common between browsers.
