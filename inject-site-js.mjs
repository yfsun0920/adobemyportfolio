#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const tag = '  <script src="site.js"></script>\n';

for (const file of fs.readdirSync(ROOT)) {
  if (!file.endsWith(".html") || file.startsWith("adobe-")) continue;
  let page = fs.readFileSync(path.join(ROOT, file), "utf8");
  page = page.replace(/\s*<script src="site\.js"><\/script>\n?/g, "");
  if (!page.includes('src="site.js"')) {
    page = page.replace(/(\s*)<script>\s*\n\s*function openMenu/, `${tag}$1<script>\n    function openMenu`);
    fs.writeFileSync(path.join(ROOT, file), page, "utf8");
    console.log("site.js:", file);
  }
}

console.log("Done.");
