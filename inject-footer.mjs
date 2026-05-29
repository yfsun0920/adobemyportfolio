#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PAGE_BOTTOM =
  fs.readFileSync(path.join(ROOT, "includes/back-to-top.html"), "utf8") +
  fs.readFileSync(path.join(ROOT, "includes/site-footer.html"), "utf8");

const htmlFiles = fs.readdirSync(ROOT).filter(
  (f) => f.endsWith(".html") && !f.startsWith("adobe-") && f !== "footer-snippet.html"
);

for (const file of htmlFiles) {
  let page = fs.readFileSync(path.join(ROOT, file), "utf8");

  page = page.replace(/<body([^>]*)>/i, (m, attrs) => {
    const clean = attrs.replace(/\s*id="top"/gi, "");
    return `<body id="top"${clean}>`;
  });

  page = page.replace(/\s*<section class="back-to-top">[\s\S]*?<\/section>/g, "");
  page = page.replace(/\s*<footer class="site-footer">[\s\S]*?<\/footer>/g, "");

  if (page.includes("</main>")) {
    page = page.replace(/<\/main>/i, `${PAGE_BOTTOM}    </main>`);
  }

  fs.writeFileSync(path.join(ROOT, file), page, "utf8");
  console.log("footer:", file);
}

console.log("Done.");
