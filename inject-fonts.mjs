#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FONT_LINKS = `  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet" />
`;

for (const file of fs.readdirSync(ROOT)) {
  if (!file.endsWith(".html") || file.startsWith("adobe-") || file.startsWith("_live")) continue;
  const filePath = path.join(ROOT, file);
  let page = fs.readFileSync(filePath, "utf8");
  page = page.replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"[^>]*>\n?/g, "");
  page = page.replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>\n?/g, "");
  page = page.replace(
    /\s*<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto\+Mono[^"]*" rel="stylesheet" \/>\n?/g,
    ""
  );
  if (!page.includes("fonts.googleapis.com/css2?family=Roboto+Mono")) {
    page = page.replace(/<link rel="stylesheet" href="styles\.css" \/>/, `${FONT_LINKS}  <link rel="stylesheet" href="styles.css" />`);
    fs.writeFileSync(filePath, page, "utf8");
    console.log("fonts:", file);
  }
}

console.log("Done.");
