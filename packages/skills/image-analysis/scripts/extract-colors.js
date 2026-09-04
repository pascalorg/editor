const path = require("path");
const getPixels = require("get-pixels");
const { extractColors } = require("extract-colors");

const imagePath = process.argv[2];

if (!imagePath) {
  console.error("Usage: node extract-colors.js <image-path>");
  process.exit(1);
}

const resolved = path.resolve(imagePath);

getPixels(resolved, (err, pixels) => {
  if (err) {
    console.error("Error reading image:", err.message);
    process.exit(1);
  }

  const data = [...pixels.data];
  const [width, height] = pixels.shape;

  extractColors({ data, width, height })
    .then((colors) => {
      const sorted = colors.sort((a, b) => b.area - a.area);
      console.log(JSON.stringify(sorted, null, 2));
    })
    .catch((error) => {
      console.error("Error extracting colors:", error.message);
      process.exit(1);
    });
});
