const path = require("path");
const Tesseract = require("tesseract.js");

const imagePath = process.argv[2];
const language = process.argv[3] || "eng";

if (!imagePath) {
  console.error("Usage: node image-to-text.js <image-path> [language]");
  process.exit(1);
}

async function extractText() {
  const resolved = path.resolve(imagePath);

  const { data } = await Tesseract.recognize(resolved, language, {
    logger: (m) => {
      if (m.status === "recognizing text") {
        process.stderr.write(`\rOCR progress: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  process.stderr.write("\n");

  const words = data.words.map((w) => ({
    text: w.text,
    confidence: Math.round(w.confidence * 10) / 10,
    bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
  }));

  const lines = data.lines.map((l) => ({
    text: l.text.trim(),
    confidence: Math.round(l.confidence * 10) / 10,
    bbox: { x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 },
  }));

  console.log(JSON.stringify({
    text: data.text.trim(),
    confidence: Math.round(data.confidence * 10) / 10,
    words,
    lines,
  }, null, 2));
}

extractText().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
