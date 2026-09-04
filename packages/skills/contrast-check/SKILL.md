---
name: contrast-check
description: Check color contrast ratios against WCAG AA and AAA accessibility standards. Use when the user wants to verify if their color combinations are accessible, check contrast between text and background colors, or audit a palette for accessibility.
metadata:
  author: pascalorg
  version: "1.0.0"
---

# Contrast Check

Check color pairs against WCAG 2.1 contrast requirements. Pass in hex colors and get contrast ratios with AA/AAA pass/fail results for both normal and large text.

## When to Use

- Checking if a text color is readable against a background color
- Auditing an entire color palette for accessibility compliance
- Verifying colors extracted from a design meet WCAG standards

## How It Works

1. Takes a list of hex colors as arguments
2. Computes the contrast ratio for every foreground/background pair
3. Tests each pair against WCAG 2.1 AA and AAA thresholds for normal and large text

WCAG thresholds:
- **AA normal text** — ratio >= 4.5:1
- **AA large text** — ratio >= 3:1
- **AAA normal text** — ratio >= 7:1
- **AAA large text** — ratio >= 4.5:1

## Usage

```bash
bash <skill-path>/scripts/contrast-check.sh <color1> <color2> [color3] [color4] ...
```

**Arguments:**
- Two or more hex colors (required). With or without `#` prefix.

**Examples:**

```bash
# Check a single pair
bash <skill-path>/scripts/contrast-check.sh "#1a1a2e" "#ffffff"

# Check all pairs in a palette
bash <skill-path>/scripts/contrast-check.sh "#1a1a2e" "#e94560" "#ffffff" "#3d83f7" "#bdbdbd"
```

## Output

```json
{
  "pairs": [
    {
      "foreground": "#1a1a2e",
      "background": "#ffffff",
      "ratio": 16.57,
      "aa": { "normal": true, "large": true },
      "aaa": { "normal": true, "large": true }
    },
    {
      "foreground": "#e94560",
      "background": "#ffffff",
      "ratio": 3.94,
      "aa": { "normal": false, "large": true },
      "aaa": { "normal": false, "large": false }
    }
  ],
  "summary": {
    "totalPairs": 2,
    "passAA": 1,
    "passAAA": 1,
    "failAA": 1
  }
}
```

| Field      | Type    | Description                                  |
|------------|---------|----------------------------------------------|
| foreground | String  | Foreground (text) color                       |
| background | String  | Background color                             |
| ratio      | Number  | Contrast ratio (e.g. 16.57 means 16.57:1)    |
| aa.normal  | Boolean | Passes WCAG AA for normal text (>= 4.5:1)    |
| aa.large   | Boolean | Passes WCAG AA for large text (>= 3:1)       |
| aaa.normal | Boolean | Passes WCAG AAA for normal text (>= 7:1)     |
| aaa.large  | Boolean | Passes WCAG AAA for large text (>= 4.5:1)    |

## Present Results to User

After checking, present a table:

```
Contrast Check Results:

  #1a1a2e on #ffffff — 16.57:1 — AA: Pass — AAA: Pass
  #e94560 on #ffffff —  3.94:1 — AA: Fail (normal) / Pass (large) — AAA: Fail

Summary: 1/2 pairs pass AA for normal text, 1/2 pass AAA.
```

Flag any failing pairs and suggest fixes (darken/lighten the color to reach the threshold).

## Troubleshooting

**Invalid color** — Colors must be valid hex values (3 or 6 digits, with or without `#`).

**Pairing with image-analysis** — Extract colors from a design with the `image-analysis` skill first, then pipe the hex values into this skill to audit accessibility.
