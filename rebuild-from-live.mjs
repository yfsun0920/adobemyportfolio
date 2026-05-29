#!/usr/bin/env node
/**
 * Rebuild project pages to match MyPortfolio module order,
 * correct CTAs only where they exist on live site,
 * and self-hosted <video> instead of Adobe CCV iframes.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const IMAGES = path.join(ROOT, "images");
const VIDEOS = path.join(ROOT, "videos");
const BASE = "https://yifeisun.myportfolio.com";

const PAGES = [
  ["a-photo-studio", "a-photo-studio"],
  ["sincerely-me", "sincerely-me"],
  ["pay-attention", "pay-attention"],
  ["lost-horizon", "lost-horizon"],
  ["night-at-the-museum", "night-at-the-museum"],
  ["allow-notifications", "allow-notifications"],
  ["flower-ball", "flower-ball"],
  ["moody-me", "moodyme"],
  ["a-window", "a-window"],
  ["cura", "cura"],
  ["game-for-good", "project-gc"],
  ["wheels", "wheels"],
  ["bubble", "bubble"],
  ["sunflower", "sunflower"],
  ["found", "found"],
  ["in-the-mist", "in-the-mist"],
  ["sleepless", "sleepless-in"],
  ["3d-interactive-animation", "a-photo-studio"],
  ["digital-humanities", "night-at-the-museum"],
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: BASE } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(new URL(res.headers.location, url).href).then(resolve, reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
  });
}

function download(url, dest) {
  return new Promise((resolve) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) {
      resolve(true);
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: BASE } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(new URL(res.headers.location, url).href, dest).then(resolve);
      }
      if (res.statusCode !== 200) {
        res.resume();
        resolve(false);
        return;
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on("finish", () => resolve(true));
      ws.on("error", () => resolve(false));
    }).on("error", () => resolve(false));
  });
}

function localFilename(url) {
  const base = path.basename(new URL(url.split("?")[0]).pathname);
  return base.replace(/^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, "$1");
}

function cdnUrls(chunk) {
  return [
    ...chunk.matchAll(/(?:src|data-src|data-srcset)="([^"]+)"/g),
    ...chunk.matchAll(/https:\/\/cdn\.myportfolio\.com\/[^\s"'<>]+/g),
  ]
    .flatMap((m) => {
      const v = m[1] || m[0];
      return v.split(",").map((s) => s.trim().split(/\s+/)[0]);
    })
    .filter((u) => u.startsWith("https://cdn.myportfolio.com/") && !/\.css|data:image/i.test(u));
}

function bestImage(urls) {
  return (
    urls.find((u) => /_rw_1920/i.test(u)) ||
    urls.find((u) => /\.gif/i.test(u) && !/_rw_/i.test(u)) ||
    urls.find((u) => /\.gif/i.test(u) && /_rw_1200/i.test(u)) ||
    urls.find((u) => /_rw_1200/i.test(u)) ||
    urls.find((u) => /_rw_|_rwc_/i.test(u) && !/carw_1x1|_rw_600/i.test(u)) ||
    urls.find((u) => !/carw_1x1|_car_|car_\d/i.test(u))
  );
}

async function resolveCcvMp4(embedUrl) {
  const m = embedUrl.match(/ccv\/([^/]+)\/embed/);
  if (!m) return null;
  const id = m[1];
  const html = await fetch(
    `https://www-ccv.adobe.io/v1/player/ccv/${id}/embed?api_key=BehancePro2View`
  );
  const mp4s = [...html.matchAll(/https:\/\/cdn-prod-ccv\.adobe\.com\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi)].map(
    (x) => x[0]
  );
  if (!mp4s.length) return null;
  mp4s.sort((a, b) => {
    const na = parseInt(a.match(/_(\d+)\.mp4/)?.[1] || "0", 10);
    const nb = parseInt(b.match(/_(\d+)\.mp4/)?.[1] || "0", 10);
    return nb - na;
  });
  return { id, url: mp4s[0] };
}

const videoCache = new Map();

async function getLocalVideo(slug, embedUrl) {
  const key = embedUrl;
  if (videoCache.has(key)) return videoCache.get(key);

  const resolved = await resolveCcvMp4(embedUrl);
  if (!resolved) {
    videoCache.set(key, null);
    return null;
  }
  const dest = path.join(VIDEOS, `${slug}-${resolved.id}.mp4`);
  console.log(`  [video] downloading ${slug} (${resolved.id})...`);
  const ok = await download(resolved.url, dest);
  const rel = ok ? `videos/${slug}-${resolved.id}.mp4` : null;
  videoCache.set(key, rel);
  return rel;
}

function extractRichText(part) {
  const open = part.match(/<div class="rich-text[^"]*">/i);
  if (!open) return null;
  const start = part.indexOf(">", open.index) + 1;
  let depth = 1;
  let pos = start;
  while (pos < part.length && depth > 0) {
    const nextOpen = part.indexOf("<div", pos);
    const nextClose = part.indexOf("</div>", pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) return part.slice(start, nextClose).trim();
      pos = nextClose + 6;
    }
  }
  return null;
}

function cleanText(s) {
  return s.replace(/&nbsp;/g, " ").replace(/\u00a0/g, " ").trim();
}

function plainDivLines(html) {
  const lines = [];
  const re = /<div(?![^>]*class="sub-title")[^>]*>([\s\S]*?)<\/div>/gi;
  for (const m of html.trim().matchAll(re)) {
    const t = cleanText(m[1].replace(/<[^>]+>/g, ""));
    if (t && !/<div/i.test(m[1])) lines.push(t);
  }
  return lines;
}

function richTextAlign(html) {
  return /text-align:\s*left/i.test(html) ? "left" : "center";
}

function richToSections(html) {
  const sections = [];
  const tokenRe =
    /<div[^>]*class="sub-title"[^>]*>([\s\S]*?)<\/div>|<div style="text-align:\s*left;"(?![^>]*sub-title)[^>]*>([^<]*)<\/div>/gi;
  let current = null;
  for (const m of html.matchAll(tokenRe)) {
    if (m[1] !== undefined) {
      const title = cleanText(m[1].replace(/<[^>]+>/g, ""));
      if (title) {
        if (current?.title || current?.lines?.length) sections.push(current);
        current = { title, lines: [] };
      }
    } else if (current && m[2] !== undefined) {
      const line = cleanText(m[2]);
      if (line) current.lines.push(line);
    }
  }
  if (current?.title || current?.lines?.length) sections.push(current);
  if (sections.length) return sections;

  const plainLines = plainDivLines(html);
  if (plainLines.length) return [{ title: null, lines: plainLines }];

  const lines = [...html.matchAll(/<div style="text-align:\s*left;"[^>]*>([^<]*)<\/div>/gi)]
    .map((m) => cleanText(m[1]))
    .filter(Boolean);
  if (lines.length) return [{ title: null, lines }];

  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (plain) return [{ title: null, lines: [plain] }];
  return sections;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseModuleStyle(part) {
  const styleStr = part.match(/\bstyle="([^"]*)"/)?.[1] || "";
  const style = {};
  const width = styleStr.match(/\bwidth:\s*([\d.]+%)/i);
  const pt = styleStr.match(/padding-top:\s*(\d+)\s*px/i);
  const pb = styleStr.match(/padding-bottom:\s*(\d+)\s*px/i);
  if (width) style.width = width[1];
  if (pt) style.paddingTop = `${pt[1]}px`;
  if (pb) style.paddingBottom = `${pb[1]}px`;
  if (/float:\s*left/i.test(styleStr)) style.float = "left";
  else if (/float:\s*right/i.test(styleStr)) style.float = "right";
  if (/float:\s*center/i.test(styleStr)) style.center = true;
  return style;
}

function moduleStyleAttr(style) {
  if (!style) return "";
  const bits = [];
  if (style.width) bits.push(`width:${style.width}`);
  if (style.paddingTop) bits.push(`padding-top:${style.paddingTop}`);
  if (style.paddingBottom) bits.push(`padding-bottom:${style.paddingBottom}`);
  if (style.float === "left") {
    bits.push("float:left", "clear:both");
  } else if (style.float === "right") {
    bits.push("float:right", "clear:both");
  }
  return bits.length ? ` style="${bits.join(";")}"` : "";
}

function textModuleHtml(html) {
  const sections = richToSections(html);
  const align = richTextAlign(html);
  const bodyStyle = align === "left" ? ' style="text-align:left"' : "";
  const blocks = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.title) {
      const label = sec.title.endsWith(":") ? sec.title : `${sec.title}:`;
      blocks.push(`        <div class="sub-title">${esc(label)}</div>`);
      blocks.push(`        <div class="sub-title"><br></div>`);
    }
    for (const line of sec.lines || []) {
      blocks.push(`        <div>${esc(line)}</div>`);
    }
    if (i < sections.length - 1) {
      blocks.push(`        <div><br></div>`);
    }
  }
  if (!blocks.length) return { inner: "", align };
  const inner =
    `      <div class="rich-text module-text">\n` +
    `        <div class="rich-text-body"${bodyStyle}>\n` +
    `${blocks.join("\n")}\n` +
    `        </div>\n      </div>`;
  return { inner, align };
}

function parseOrderedModules(html) {
  const modules = [];
  const canvas = html.match(/id="project-modules"[\s\S]*?(?=<\/div>\s*<\/div>\s*<\/div>\s*<footer|<footer)/i);
  const chunk = canvas ? canvas[0] : html;
  const parts = chunk.split(/<div class="(?:js-project-module\s+)?project-module module /);
  const seenBtn = new Set();
  for (const part of parts.slice(1)) {
    const type = part.match(/^([^\s]+)/)?.[1] || "";
    const style = parseModuleStyle(part);

    if (type === "button") {
      const btn =
        part.match(
          /<a href="([^"]+)"[^>]*class="[^"]*button-module[^"]*"[^>]*>([\s\S]*?)<\/a>/i
        ) ||
        part.match(
          /<a[^>]*class="[^"]*button-module[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
        );
      if (btn) {
        const href = btn[1];
        const label = btn[2].replace(/<[^>]+>/g, "").trim();
        if (!seenBtn.has(href)) {
          seenBtn.add(href);
          modules.push({ type: "button", href, label, style });
        }
      }
      continue;
    }

    if (type === "text") {
      const rich = extractRichText(part);
      if (rich) modules.push({ type: "text", html: rich, style });
      continue;
    }

    if (type === "video") {
      const iframe = part.match(/<iframe[^>]+src="([^"]+)"/);
      if (iframe) modules.push({ type: "video", embed: iframe[1], style });
      continue;
    }

    if (type === "embed") {
      const iframe = part.match(/<iframe[^>]+src="([^"]+)"/);
      const dims = part.match(/embed-dimensions[^>]*style="[^"]*max-width:\s*(\d+px)/i);
      if (iframe && /youtube|vimeo/i.test(iframe[1])) {
        modules.push({
          type: "embed",
          embed: iframe[1],
          style,
          maxWidth: dims?.[1] || "560px",
        });
      }
      continue;
    }

    if (type === "media_collection") {
      const byKey = new Map();
      for (const u of cdnUrls(part)) {
        if (/carw_|_car_|car_\d/i.test(u)) continue;
        const fn = localFilename(u.split("?")[0]);
        const base = fn.replace(/_rw_\d+/i, "");
        const size = parseInt((fn.match(/_rw_(\d+)/i) || [0, "0"])[1], 10);
        const prev = byKey.get(base);
        if (!prev || size > prev.size) byKey.set(base, { url: u, size });
      }
      const images = [];
      const seen = new Set();
      for (const m of part.matchAll(/data-src="(https:\/\/cdn\.myportfolio\.com\/[^"]+)"/g)) {
        const base = localFilename(m[1].split("?")[0]).replace(/_rw_\d+/i, "");
        if (seen.has(base)) continue;
        const pick = byKey.get(base);
        if (pick && pick.size >= 1200) {
          seen.add(base);
          images.push(pick.url);
        }
      }
      if (!images.length) images.push(...[...byKey.values()].map((v) => v.url));
      const prevImage = [...modules].reverse().find((m) => m.type === "image");
      const singleColumn = /data-grid-max-images="\s*1/i.test(part);
      const galleryStyle = { ...style };
      if (singleColumn && prevImage) {
        galleryStyle.stackAsImages = true;
        galleryStyle.width = prevImage.style?.width || "100%";
        galleryStyle.itemPaddingBottom = "10px";
        galleryStyle.itemPaddingAfterFirst = style.paddingTop || "50px";
        if (!galleryStyle.paddingTop) galleryStyle.paddingTop = style.paddingTop || "50px";
      }
      modules.push({ type: "gallery", images, style: galleryStyle });
      continue;
    }

    if (type === "image") {
      const best = bestImage(cdnUrls(part));
      if (best) modules.push({ type: "image", url: best, style });
    }
  }
  return modules;
}

async function moduleToHtml(mod, slug, title) {
  const lines = [];
  let textCenter = false;
  const wrap = (className, inner) => {
    const centerCls = mod.style?.center || textCenter ? " project-module--center" : "";
    return `      <div class="project-module ${className}${centerCls}"${moduleStyleAttr(mod.style)}>\n${inner}\n      </div>`;
  };

  switch (mod.type) {
    case "button":
      lines.push(
        wrap(
          "project-module-button",
          `        <div class="play-btn-wrap">\n` +
            `          <a class="play-btn" href="${mod.href}" target="_blank" rel="noopener noreferrer">${esc(mod.label)}</a>\n` +
            `        </div>`
        )
      );
      break;
    case "text": {
      const { inner, align } = textModuleHtml(mod.html);
      textCenter = align === "center";
      if (inner) {
        lines.push(wrap("project-module-text", inner.replace(/^      /gm, "        ")));
      }
      break;
    }
    case "image": {
      const fn = localFilename(mod.url);
      const dest = path.join(IMAGES, slug, fn);
      await download(mod.url, dest);
      lines.push(
        `      <figure class="project-module project-module-image"${moduleStyleAttr(mod.style)}>\n` +
          `        <img src="images/${slug}/${fn}" alt="${esc(title)}" />\n` +
          `      </figure>`
      );
      break;
    }
    case "video": {
      let inner = "";
      if (/youtube|youtu\.be/i.test(mod.embed)) {
        inner =
          `        <div class="hero-video-wrap hero-video-wrap--embed">\n` +
          `          <iframe title="Video" src="${mod.embed}" frameborder="0" allowfullscreen></iframe>\n` +
          `        </div>`;
      } else if (/ccv\.adobe/i.test(mod.embed)) {
        const rel = await getLocalVideo(slug, mod.embed);
        if (rel) {
          inner =
            `        <div class="hero-video-wrap">\n` +
            `          <video controls playsinline src="${rel}"></video>\n` +
            `        </div>`;
        }
      }
      if (inner) lines.push(wrap("project-module-video", inner));
      break;
    }
    case "embed":
      if (/youtube/i.test(mod.embed)) {
        lines.push(
          wrap(
            "project-module-embed",
            `        <div class="hero-video-wrap hero-video-wrap--embed" style="max-width:${mod.maxWidth || "560px"}">\n` +
              `          <iframe title="Video" src="${mod.embed}" frameborder="0" allowfullscreen></iframe>\n` +
              `        </div>`
          )
        );
      }
      break;
    case "gallery": {
      if (mod.style?.stackAsImages) {
        const width = mod.style.width || "75%";
        const gap = mod.style.paddingTop || mod.style.itemPaddingAfterFirst || "50px";
        const bottom = mod.style.itemPaddingBottom || "10px";
        for (let i = 0; i < mod.images.length; i++) {
          const url = mod.images[i];
          const fn = localFilename(url);
          const dest = path.join(IMAGES, slug, fn);
          await download(url, dest);
          const figureStyle = {
            width,
            paddingTop: gap,
            paddingBottom: bottom,
          };
          lines.push(
            `      <figure class="project-module project-module-image"${moduleStyleAttr(figureStyle)}>\n` +
              `        <img src="images/${slug}/${fn}" alt="${esc(title)}" />\n` +
              `      </figure>`
          );
        }
        break;
      }
      const items = [];
      for (const url of mod.images) {
        const fn = localFilename(url);
        const dest = path.join(IMAGES, slug, fn);
        await download(url, dest);
        items.push(
          `          <figure class="collection-item">\n` +
            `            <img src="images/${slug}/${fn}" alt="${esc(title)}" />\n` +
            `          </figure>`
        );
      }
      if (items.length) {
        lines.push(
          `      <div class="project-module project-module-media-collection"${moduleStyleAttr(mod.style)}>\n` +
            `        <div class="media-collection-grid">\n` +
            items.join("\n") +
            `\n        </div>\n      </div>`
        );
      }
      break;
    }
  }
  return lines.join("\n\n") + (lines.length ? "\n" : "");
}

async function rebuildPage(localSlug, liveSlug) {
  const htmlPath = path.join(ROOT, `${localSlug}.html`);
  if (!fs.existsSync(htmlPath)) return;

  const liveHtml = await fetch(`${BASE}/${liveSlug}`);
  const modules = parseOrderedModules(liveHtml);
  let body = "";
  const title =
    fs
      .readFileSync(htmlPath, "utf8")
      .match(/class="project-title"[^>]*>([^<]+)</)?.[1]
      ?.trim() || localSlug;

  for (const mod of modules) {
    body += await moduleToHtml(mod, localSlug, title);
  }
  if (body.trim()) {
    body = `      <div class="project-modules standard-modules">\n${body}      </div>\n`;
  }

  let page = fs.readFileSync(htmlPath, "utf8");
  const pageBottom =
    fs.readFileSync(path.join(ROOT, "includes/back-to-top.html"), "utf8") +
    fs.readFileSync(path.join(ROOT, "includes/site-footer.html"), "utf8");
  page = page.replace(
    /(<div class="project-header">[\s\S]*?<\/div>)\s*([\s\S]*?)(<\/main>)/,
    `$1\n\n${body}${pageBottom}    $3`
  );
  page = page.replace(/\n{4,}/g, "\n\n\n");
  fs.writeFileSync(htmlPath, page, "utf8");
  const btns = modules.filter((m) => m.type === "button").length;
  const vids = modules.filter((m) => m.type === "video" || m.type === "embed").length;
  console.log(`  ${localSlug}: ${modules.length} modules, ${btns} CTA(s), ${vids} video(s)`);
}

async function main() {
  fs.mkdirSync(VIDEOS, { recursive: true });
  console.log("Rebuilding pages from MyPortfolio...\n");
  for (const [local, live] of PAGES) {
    try {
      await rebuildPage(local, live);
    } catch (e) {
      console.log(`  [error] ${local}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
