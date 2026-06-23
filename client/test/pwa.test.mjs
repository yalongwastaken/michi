// pwa.test.mjs — guard the installability contract: a valid manifest with real icon
// files, the PWA <head> tags, and a service worker. Cheap insurance against a rename
// or typo silently breaking "Add to Home Screen".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pub = join(dirname(fileURLToPath(import.meta.url)), "../public");
const read = (p) => readFileSync(join(pub, p), "utf8");

test("manifest has the required installable fields", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  for (const key of [
    "name",
    "short_name",
    "start_url",
    "scope",
    "display",
    "theme_color",
    "icons",
  ]) {
    assert.ok(m[key] != null, `manifest missing ${key}`);
  }
  assert.equal(m.display, "standalone");
  assert.ok(Array.isArray(m.icons) && m.icons.length >= 2, "need ≥2 icons");
});

test("manifest icons exist on disk, cover 192+512, and include a maskable", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  const sizes = new Set();
  let maskable = false;
  for (const icon of m.icons) {
    assert.ok(icon.src && icon.sizes && icon.type, "icon missing src/sizes/type");
    assert.ok(existsSync(join(pub, icon.src.replace(/^\//, ""))), `missing icon file ${icon.src}`);
    sizes.add(icon.sizes);
    if ((icon.purpose || "").includes("maskable")) {
      maskable = true;
    }
  }
  assert.ok(sizes.has("192x192") && sizes.has("512x512"), "need 192 and 512 icons");
  assert.ok(maskable, "need a maskable icon");
});

test("index.html wires the PWA head tags", () => {
  const html = readFileSync(join(pub, "../index.html"), "utf8");
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /name="theme-color"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /apple-mobile-web-app-capable/);
});

test("service worker exists and never caches the API", () => {
  const sw = read("sw.js");
  assert.match(sw, /addEventListener\(["']fetch["']/);
  assert.match(sw, /\/api\//); // it explicitly skips /api/
});
