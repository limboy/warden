// Refresh sha512/size in an electron-builder update feed (latest-mac.yml) for
// files that were modified after the build, e.g. recompressed DMGs.
//
// Usage: node scripts/update-feed-checksums.cjs release/latest-mac.yml

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const yaml = require("js-yaml");

const feedPath = process.argv[2];
if (!feedPath) {
  console.error("Usage: update-feed-checksums.cjs <latest-mac.yml>");
  process.exit(1);
}

const dir = path.dirname(feedPath);
const feed = yaml.load(fs.readFileSync(feedPath, "utf8"));

function describe(file) {
  const data = fs.readFileSync(path.join(dir, file));
  return {
    sha512: crypto.createHash("sha512").update(data).digest("base64"),
    size: data.length,
  };
}

for (const entry of feed.files) {
  const { sha512, size } = describe(entry.url);
  if (entry.sha512 !== sha512) {
    console.log(`updated ${entry.url}`);
    entry.sha512 = sha512;
    entry.size = size;
  }
}
feed.sha512 = describe(feed.path).sha512;

fs.writeFileSync(feedPath, yaml.dump(feed, { lineWidth: -1 }));
