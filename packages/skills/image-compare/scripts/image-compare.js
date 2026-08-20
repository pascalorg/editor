const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");

const image1Path = process.argv[2];
const image2Path = process.argv[3];
const diffOutput = process.argv[4] || "./diff.png";
const threshold = parseFloat(process.argv[5]) || 0.1;

if (!image1Path || !image2Path) {
  console.error("Usage: node image-compare.js <image1> <image2> [diff-output.png] [threshold]");
  process.exit(1);
}

async function compare() {
  const meta1 = await sharp(path.resolve(image1Path)).metadata();
  const meta2 = await sharp(path.resolve(image2Path)).metadata();

  const width = Math.min(meta1.width, meta2.width);
  const height = Math.min(meta1.height, meta2.height);

  const [buf1, buf2] = await Promise.all([
    sharp(path.resolve(image1Path)).resize(width, height, { fit: "cover" }).ensureAlpha().raw().toBuffer(),
    sharp(path.resolve(image2Path)).resize(width, height, { fit: "cover" }).ensureAlpha().raw().toBuffer(),
  ]);

  const diffBuf = Buffer.alloc(width * height * 4);
  const differentPixels = pixelmatch(buf1, buf2, diffBuf, width, height, { threshold });
  const totalPixels = width * height;
  const mismatchPercentage = Math.round((differentPixels / totalPixels) * 10000) / 100;

  const diffPng = new PNG({ width, height });
  diffPng.data = diffBuf;
  const diffStream = fs.createWriteStream(path.resolve(diffOutput));
  diffPng.pack().pipe(diffStream);

  await new Promise((resolve, reject) => {
    diffStream.on("finish", resolve);
    diffStream.on("error", reject);
  });

  console.log(JSON.stringify({
    totalPixels,
    differentPixels,
    mismatchPercentage,
    dimensions: { width, height },
    diffImage: diffOutput,
    threshold,
  }, null, 2));
}

compare().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
