---
name: image-to-text
description: Extract text from images using OCR. Use when the user shares a screenshot and you need to read the text content, copy UI labels, or extract copy from a design mockup.
metadata:
  author: pascalorg
  version: "1.0.0"
---

# Image to Text

Extract all readable text from an image using OCR (Tesseract). Returns the full text content along with word-level bounding boxes and confidence scores.

## When to Use

- Reading text content from a screenshot or design mockup
- Extracting UI copy (labels, buttons, headings) so you don't have to retype it
- Getting text positions and bounding boxes from a design image

## How It Works

1. The image is passed to Tesseract.js for optical character recognition
2. Tesseract segments the image into lines and words
3. Returns the full text plus word-level details (position, confidence)

## Usage

```bash
bash <skill-path>/scripts/image-to-text.sh <image-path> [language]
```

**Arguments:**
- `image-path` — Path to the image file (required)
- `language` — OCR language code (optional, defaults to `eng`). Common: `eng`, `fra`, `deu`, `spa`, `chi_sim`, `jpn`

**Examples:**

```bash
# Extract text from a screenshot
bash <skill-path>/scripts/image-to-text.sh ./screenshot.png

# Extract French text
bash <skill-path>/scripts/image-to-text.sh ./mockup.png fra
```

## Output

```json
{
  "text": "Request work\nSuggestions\nPlumbing\nHVAC\nCleaning\nElectrical",
  "confidence": 87.4,
  "words": [
    {
      "text": "Request",
      "confidence": 94.2,
      "bbox": { "x0": 142, "y0": 180, "x1": 268, "y1": 204 }
    },
    {
      "text": "work",
      "confidence": 96.1,
      "bbox": { "x0": 274, "y0": 180, "x1": 332, "y1": 204 }
    }
  ],
  "lines": [
    {
      "text": "Request work",
      "confidence": 95.1,
      "bbox": { "x0": 142, "y0": 180, "x1": 332, "y1": 204 }
    }
  ]
}
```

| Field      | Type   | Description                                      |
|------------|--------|--------------------------------------------------|
| text       | String | Full extracted text, newline-separated            |
| confidence | Number | Overall confidence score (0-100)                  |
| words      | Array  | Each word with text, confidence, and bounding box |
| lines      | Array  | Each line with text, confidence, and bounding box |

## Present Results to User

After extracting text, present the content grouped by lines:

```
Extracted text (87.4% confidence):

  Request work
  Suggestions
  Plumbing
  HVAC
  Cleaning
  Electrical

Found 6 lines, 6 words.
```

Use the extracted text directly when implementing UI copy from a design.

## Troubleshooting

**Low confidence / garbled text** — Tesseract works best with clean, high-contrast text. Screenshots of rendered UI work well. Photos of text at angles or with noise may produce poor results.

**Wrong language** — Pass the correct language code as the second argument. Tesseract needs the right language model to recognize characters.

**First run is slow** — Tesseract downloads language data (~4MB for English) on the first run. Subsequent runs are faster.
