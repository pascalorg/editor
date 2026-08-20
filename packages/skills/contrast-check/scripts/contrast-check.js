const wcagContrast = require("wcag-contrast");

const colors = process.argv.slice(2).map((c) => (c.startsWith("#") ? c : `#${c}`));

if (colors.length < 2) {
  console.error("Usage: node contrast-check.js <color1> <color2> [color3] ...");
  console.error("Pass two or more hex colors to check all pairs.");
  process.exit(1);
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h;
  return [
    parseInt(full.substring(0, 2), 16),
    parseInt(full.substring(2, 4), 16),
    parseInt(full.substring(4, 6), 16),
  ];
}

const pairs = [];

for (let i = 0; i < colors.length; i++) {
  for (let j = i + 1; j < colors.length; j++) {
    const fg = colors[i];
    const bg = colors[j];
    const ratio = Math.round(wcagContrast.hex(fg, bg) * 100) / 100;

    pairs.push({
      foreground: fg,
      background: bg,
      ratio,
      aa: { normal: ratio >= 4.5, large: ratio >= 3 },
      aaa: { normal: ratio >= 7, large: ratio >= 4.5 },
    });
  }
}

const passAA = pairs.filter((p) => p.aa.normal).length;
const passAAA = pairs.filter((p) => p.aaa.normal).length;

console.log(JSON.stringify({
  pairs,
  summary: {
    totalPairs: pairs.length,
    passAA,
    passAAA,
    failAA: pairs.length - passAA,
  },
}, null, 2));
