#!/usr/bin/env node
/**
 * Full sync: media, text, play buttons, index thumbnails, about page
 * from https://yifeisun.myportfolio.com
 *
 * Usage: node sync_from_myportfolio.mjs
 *        FORCE=1 node sync_from_myportfolio.mjs  (re-download all images)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(ROOT, "images");
const BASE_URL = "https://yifeisun.myportfolio.com";
const FORCE = process.env.FORCE === "1";

const PAGES = [
  "a-photo-studio", "a-window", "allow-notifications", "bubble", "cura",
  "flower-ball", "found", "game-for-good", "in-the-mist",
  "lost-horizon", "moody-me", "night-at-the-museum", "pay-attention", "sincerely-me",
  "sleepless", "sunflower", "wheels",
];

const LIVE_SLUG = {
  "moody-me": "moodyme",
  "game-for-good": "project-gc",
  sleepless: "sleepless-in",
};

const INDEX_ORDER = [
  "a-photo-studio", "pay-attention", "lost-horizon", "allow-notifications",
  "night-at-the-museum", "flower-ball", "moody-me", "cura", "wheels",
  "a-window", "game-for-good", "sleepless",
];

function liveSlug(slug) {
  return LIVE_SLUG[slug] || slug;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: BASE_URL } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(new URL(res.headers.location, url).href).then(resolve, reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve) => {
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 500) {
      resolve(true);
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: BASE_URL } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(new URL(res.headers.location, url).href, dest).then(resolve);
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
  return base.replace(
    /^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    "$1"
  );
}

function cdnUrlsFromChunk(chunk) {
  const urls = [
    ...chunk.matchAll(/(?:src|data-src|data-srcset)="([^"]+)"/g),
    ...chunk.matchAll(/https:\/\/cdn\.myportfolio\.com\/[^\s"'<>]+/g),
  ].flatMap((m) => {
    const val = m[1] || m[0];
    return val.split(",").map((s) => s.trim().split(/\s+/)[0]);
  });
  return urls.filter(
    (u) => u.startsWith("https://cdn.myportfolio.com/") && !/\.css|data:image/i.test(u)
  );
}

function bestImageUrl(urls) {
  return (
    urls.find((u) => /\.gif/i.test(u) && !/_rw_/i.test(u)) ||
    urls.find((u) => /_rw_1920/i.test(u)) ||
    urls.find((u) => /\.gif/i.test(u) && /_rw_1200/i.test(u)) ||
    urls.find((u) => /\.gif/i.test(u) && !/_rw_600/i.test(u)) ||
    urls.find((u) => /_rw_1200/i.test(u)) ||
    urls.find((u) => /_rw_|_rwc_/i.test(u) && !/carw_1x1|_rw_600/i.test(u)) ||
    urls.find((u) => !/carw_1x1|_car_|car_\d/i.test(u))
  );
}

function parseModules(html) {
  const modules = [];
  const seen = new Set();
  const parts = html.split(/<div class="project-module module /);

  const addImage = (url) => {
    const key = localFilename(url);
    if (seen.has(key)) return;
    seen.add(key);
    modules.push({ type: "image", src: url });
  };

  for (const part of parts.slice(1)) {
    const modType = part.match(/^([^\s]+)/)?.[1] || "";
    if (modType === "button") continue;

    if (modType === "text") {
      const rich = part.match(/<div class="rich-text[^"]*">([\s\S]*?)<\/div>\s*<\/div>/);
      if (rich) modules.push({ type: "text", html: rich[1].trim() });
      continue;
    }

    const iframe = part.match(/<iframe[^>]+src="([^"]+)"/);
    if (iframe) {
      modules.push({ type: "embed", src: iframe[1] });
      continue;
    }

    const urls = cdnUrlsFromChunk(part);
    if (modType === "media_collection") {
      const byKey = new Map();
      for (const u of urls) {
        if (/carw_|_car_|car_\d|\.css/i.test(u)) continue;
        const fn = localFilename(u.split("?")[0]);
        const base = fn.replace(/_rw_\d+/i, "");
        const size = parseInt((fn.match(/_rw_(\d+)/i) || [0, "0"])[1], 10);
        const prev = byKey.get(base);
        if (!prev || size > prev.size) byKey.set(base, { url: u, size });
      }
      const ordered = [];
      const seenKeys = new Set();
      for (const m of part.matchAll(/data-src="(https:\/\/cdn\.myportfolio\.com\/[^"]+)"/g)) {
        const u = m[1];
        const base = localFilename(u.split("?")[0]).replace(/_rw_\d+/i, "");
        if (seenKeys.has(base)) continue;
        const pick = byKey.get(base);
        if (pick && pick.size >= 1200) {
          seenKeys.add(base);
          ordered.push(pick.url);
        }
      }
      for (const u of ordered.length ? ordered : [...byKey.values()].map((v) => v.url)) {
        addImage(u);
      }
      continue;
    }

    const best = bestImageUrl(urls);
    if (best) addImage(best);
  }
  return modules;
}

function parsePlayButton(html) {
  const m = html.match(
    /<div class="project-module module button[\s\S]*?<a href="([^"]+)"[^>]*class="[^"]*button-module[^"]*"[^>]*>([\s\S]*?)<\/a>/i
  );
  if (!m) return null;
  const href = m[1];
  const label = m[2].replace(/<[^>]+>/g, "").trim();
  if (!href || href === "#") return null;
  return { href, label };
}

function richTextToSections(html, opts = {}) {
  const sections = [];
  const blocks = html.split(/<div style="text-align:\s*left;" class="sub-title">/i);
  if (blocks.length > 1) {
    for (let i = 1; i < blocks.length; i++) {
      const [titlePart, ...rest] = blocks[i].split("</div>");
      const title = titlePart.replace(/<[^>]+>/g, "").trim();
      const body = rest.join("</div>").replace(/<div style="text-align:\s*left;"[^>]*>/gi, "");
      if (title) sections.push({ title, body: sanitizeBody(body), useAbout: false });
    }
    return sections;
  }
  const plain = sanitizeBody(html);
  if (plain.trim()) {
    sections.push({
      title: null,
      body: plain,
      useAbout: opts.firstText && !/sub-title/i.test(html),
    });
  }
  return sections;
}

function sanitizeBody(html) {
  let s = html
    .replace(/<div style="text-align:\s*left;"[^>]*>/gi, "")
    .replace(/<div class="sub-title"[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n");
  s = s.replace(/<a ([^>]+)>/gi, "<a $1>");
  const allowed = /^(p|ul|ol|li|a|strong|em|br)$/i;
  s = s.replace(/<(\/?)([\w]+)([^>]*)>/g, (match, slash, tag) => {
    return allowed.test(tag) ? match : "";
  });
  return s.trim();
}

function bodyToInner(body) {
  if (body.includes("<ul>") || body.includes("<li>")) return body;
  return body
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `        <p>${p.startsWith("<") ? p : escapeHtml(p)}</p>`)
    .join("\n");
}

function sectionsToHtml(sections) {
  if (!sections.length) return "";
  return (
    sections
      .map((sec) => {
        if (sec.title) {
          const inner = bodyToInner(sec.body);
          const label = sec.title.endsWith(":") ? sec.title : `${sec.title}:`;
          return (
            `      <div class="project-section">\n` +
            `        <p class="project-section-title">${escapeHtml(label.replace(/:$/, ""))}:</p>\n` +
            `        ${inner}\n` +
            `      </div>`
          );
        }
        const paras = bodyToInner(sec.body);
        if (sec.useAbout) {
          return `      <div class="project-section">\n        <p class="project-section-title">ABOUT:</p>\n${paras}\n      </div>`;
        }
        return `      <div class="project-section">\n${paras}\n      </div>`;
      })
      .join("\n\n") + "\n"
  );
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function heroBlock(mod, slug) {
  if (!mod) return `        <div class="hero-placeholder"></div>\n`;
  if (mod.type === "embed") {
    return (
      `        <div class="hero-video-wrap" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">\n` +
      `          <iframe title="Video Player" src="${mod.src}" frameborder="0" allowfullscreen\n` +
      `            style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe>\n` +
      `        </div>\n`
    );
  }
  const fn = localFilename(mod.src);
  return `        <img src="images/${slug}/${fn}" alt="" style="width:100%;display:block;" />\n`;
}

function galleryBlock(mods, slug, title) {
  if (!mods.length) return "\n";
  return (
    mods
      .map((mod, i) => {
        if (mod.type === "embed") {
          return (
            `        <div class="gallery-video-wrap" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin-bottom:1rem;">\n` +
            `          <iframe title="${title} video ${i + 1}" src="${mod.src}" frameborder="0" allowfullscreen\n` +
            `            style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe>\n` +
            `        </div>`
          );
        }
        const fn = localFilename(mod.src);
        return `        <img src="images/${slug}/${fn}" alt="${title} ${i + 1}" style="width:100%;display:block;" />`;
      })
      .join("\n") + "\n"
  );
}

function replaceHero(content, inner) {
  if (content.includes('class="play-btn-wrap"')) {
    return content.replace(
      /(<div class="project-hero">)[\s\S]*?(<\/div>\s*\n\s*<div class="play-btn-wrap">)/,
      `$1\n${inner}      $2`
    );
  }
  return content.replace(
    /(<div class="project-hero">)[\s\S]*?(<\/div>\s*\n+)(\s*<div class="project-section">)/,
    `$1\n${inner}      $2$3`
  );
}

function replaceGallery(content, inner) {
  return content.replace(
    /(<div class="project-media">)[\s\S]*?(<\/div>\s*\n\s*<\/main>)/,
    `$1\n${inner}      $2`
  );
}

function clearBodySections(content) {
  if (content.includes('class="play-btn-wrap"')) {
    return content.replace(
      /(<div class="play-btn-wrap">[\s\S]*?<\/div>\s*\n)([\s\S]*?)(?=\n*<div class="project-media">)/,
      "$1\n"
    );
  }
  return content.replace(
    /(<div class="project-hero">[\s\S]*?<\/div>\s*\n+)([\s\S]*?)(?=\n*<div class="project-media">)/,
    "$1\n"
  );
}

function replaceBodySections(content, sectionsHtml, playBtn) {
  const playBlock = playBtn
    ? (
      `      <div class="play-btn-wrap">\n` +
      `        <a class="play-btn" href="${playBtn.href}" target="_blank" rel="noopener noreferrer">${escapeHtml(playBtn.label)}</a>\n` +
      `      </div>\n\n`
    )
    : "";

  const anchor = content.includes('class="play-btn-wrap"')
    ? /<div class="play-btn-wrap">[\s\S]*?<\/div>\s*\n/
    : /<div class="project-hero">[\s\S]*?<\/div>\s*\n+/;

  const endMarker = /<div class="project-media">/;
  const startMatch = content.match(anchor);
  const endMatch = content.match(endMarker);
  if (!startMatch || !endMatch) return content;

  const before = content.slice(0, startMatch.index + startMatch[0].length);
  const after = content.slice(endMatch.index);
  const middle = playBtn ? playBlock + sectionsHtml : sectionsHtml;
  return before + middle + (after.startsWith("<div") ? "\n" : "") + after;
}

async function syncPage(slug, pageHtml) {
  const htmlPath = path.join(ROOT, `${slug}.html`);
  if (!fs.existsSync(htmlPath)) return false;

  const modules = parseModules(pageHtml);
  if (!modules.length) {
    console.log(`  [skip] ${slug}: no modules`);
    return false;
  }

  const folder = path.join(OUTPUT_DIR, slug);
  for (const mod of modules) {
    if (mod.type !== "image") continue;
    const fn = localFilename(mod.src);
    const dest = path.join(folder, fn);
    const ok = await downloadFile(mod.src, dest);
    console.log(`  [${ok ? "ok" : "fail"}] ${slug}/${fn}`);
  }

  let hero = modules.find((m) => m.type === "embed") || modules.find((m) => m.type === "image");
  let gallery = [];
  if (hero?.type === "embed") {
    gallery = modules.filter((m) => m.type === "image");
  } else if (hero) {
    gallery = modules.filter((m) => m !== hero && m.type === "image");
  }

  const textModules = modules.filter((m) => m.type === "text");
  let sectionsHtml = "";
  let firstText = true;
  for (const tm of textModules) {
    sectionsHtml += sectionsToHtml(richTextToSections(tm.html, { firstText }));
    firstText = false;
  }

  const playBtn = parsePlayButton(pageHtml);
  let content = fs.readFileSync(htmlPath, "utf8");
  const titleMatch = content.match(/class="project-title"[^>]*>([^<]+)</);
  const title = titleMatch ? titleMatch[1].trim() : slug;

  content = replaceHero(content, heroBlock(hero, slug));
  if (sectionsHtml.trim()) {
    content = replaceBodySections(content, sectionsHtml, playBtn);
  } else {
    content = clearBodySections(content);
  }
  if (!sectionsHtml.trim() && playBtn) {
    const playBlock =
      `      <div class="play-btn-wrap">\n` +
      `        <a class="play-btn" href="${playBtn.href}" target="_blank" rel="noopener noreferrer">${escapeHtml(playBtn.label)}</a>\n` +
      `      </div>\n\n`;
    if (content.includes('class="play-btn-wrap"')) {
      content = content.replace(
        /<div class="play-btn-wrap">[\s\S]*?<\/div>\s*\n/,
        playBlock
      );
    } else {
      content = content.replace(
        /(<div class="project-hero">[\s\S]*?<\/div>\s*\n+)/,
        `$1${playBlock}`
      );
    }
  }
  content = replaceGallery(content, galleryBlock(gallery, slug, title));
  fs.writeFileSync(htmlPath, content, "utf8");
  console.log(
    `  updated ${slug}.html: hero=${hero?.type || "none"}, gallery=${gallery.length}, text=${textModules.length}`
  );
  return true;
}

async function getThumbUrl(slug) {
  const html = await fetchText(`${BASE_URL}/${liveSlug(slug)}`);
  const og = html.match(/property="og:image" content="([^"]+)"/);
  if (og) return og[1];
  const img = parseModules(html).find((m) => m.type === "image");
  return img?.src || null;
}

async function syncIndexThumbs() {
  let index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (let i = 0; i < INDEX_ORDER.length; i++) {
    const slug = INDEX_ORDER[i];
    const url = await getThumbUrl(slug);
    if (!url) {
      console.log(`  [warn] no thumb for ${slug}`);
      continue;
    }
    const ext = path.extname(new URL(url.split("?")[0]).pathname) || ".jpg";
    const localName = `img_${String(i + 1).padStart(2, "0")}${ext}`;
    const dest = path.join(OUTPUT_DIR, localName);
    const ok = await downloadFile(url, dest);
    const htmlFile = `${slug}.html`;
    const re = new RegExp(
      `(<a href="${htmlFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" class="project-card"[^>]*>[\\s\\S]*?<img src=")images/[^"]+(")`,
      "i"
    );
    if (re.test(index)) {
      index = index.replace(re, `$1images/${localName}$2`);
      console.log(`  [${ok ? "ok" : "fail"}] thumb ${localName} <- ${slug}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fs.writeFileSync(path.join(ROOT, "index.html"), index, "utf8");
}

async function syncAbout() {
  const html = await fetchText(`${BASE_URL}/about`);
  const mods = parseModules(html);
  const img = mods.find((m) => m.type === "image");
  const text = mods.find((m) => m.type === "text");
  if (img) {
    const fn = localFilename(img.src);
    await downloadFile(img.src, path.join(OUTPUT_DIR, "about", fn));
  }
  const bio = text
    ? text.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : "";
  const links = [...html.matchAll(/<a href="(https?:\/\/[^"]+|mailto:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((m) => /instagram|linkedin|mailto/i.test(m[1]))
    .map((m) => ({ href: m[1], label: m[2].replace(/<[^>]+>/g, "").trim() || m[1] }));

  let about = fs.readFileSync(path.join(ROOT, "about.html"), "utf8");
  const imgTag = img
    ? `        <figure class="project-module project-module-image" style="width:30%">\n          <img src="images/about/${localFilename(img.src)}" alt="Yifei Sun" />\n        </figure>\n`
    : "";
  const bioPara = bio
    ? `        <div class="project-module project-module-text">\n          <p class="about-bio">${escapeHtml(bio)}</p>\n        </div>\n`
    : "";

  about = about.replace(
    /(<div class="project-modules standard-modules">)\s*[\s\S]*?(<\/div>\s*<\/div>\s*<section class="back-to-top">)/,
    `$1\n${imgTag}${bioPara}      $2`
  );
  fs.writeFileSync(path.join(ROOT, "about.html"), about, "utf8");
  console.log(`  updated about.html (photo=${!!img}, links=${links.length})`);
}

function copyNightToDigitalHumanities() {
  const nightPath = path.join(ROOT, "night-at-the-museum.html");
  const dhPath = path.join(ROOT, "digital-humanities.html");
  if (!fs.existsSync(nightPath) || !fs.existsSync(dhPath)) return;
  let dh = fs.readFileSync(dhPath, "utf8");
  const night = fs.readFileSync(nightPath, "utf8");

  const heroM = night.match(/<div class="project-hero">[\s\S]*?<\/div>\s*\n\s*<div class="play-btn-wrap">/);
  const sectionsM = night.match(
    /<div class="play-btn-wrap">[\s\S]*?(?=<div class="project-media">)/
  );
  const mediaM = night.match(/<div class="project-media">[\s\S]*?<\/div>\s*\n\s*<\/main>/);

  if (heroM) dh = dh.replace(/<div class="project-hero">[\s\S]*?<\/div>\s*\n\s*<div class="play-btn-wrap">/, heroM[0]);
  if (sectionsM) {
    dh = dh.replace(/<div class="play-btn-wrap">[\s\S]*?(?=<div class="project-media">)/, sectionsM[0]);
  }
  if (mediaM) dh = dh.replace(/<div class="project-media">[\s\S]*?<\/div>\s*\n\s*<\/main>/, mediaM[0]);

  dh = dh.replace(
    /href="https:\/\/yifeisun\.myportfolio\.com\/night-at-the-museum"/,
    'href="https://yifeisun.myportfolio.com/night-at-the-museum"'
  );
  fs.writeFileSync(dhPath, dh, "utf8");
  console.log("  synced digital-humanities.html from night-at-the-museum");
}

async function sync3dPage() {
  const src = path.join(ROOT, "a-photo-studio.html");
  const dest = path.join(ROOT, "3d-interactive-animation.html");
  if (!fs.existsSync(src) || !fs.existsSync(dest)) return;
  let html = fs.readFileSync(dest, "utf8");
  const studio = fs.readFileSync(src, "utf8");
  const heroM = studio.match(/<div class="project-hero">[\s\S]*?<\/div>\s*\n\s*<div class="play-btn-wrap">/);
  const mediaM = studio.match(/<div class="project-media">[\s\S]*?<\/div>\s*\n\s*<\/main>/);
  if (heroM) html = html.replace(/<div class="project-hero">[\s\S]*?<\/div>\s*\n\s*<div class="play-btn-wrap">/, heroM[0]);
  if (mediaM) html = html.replace(/<div class="project-media">[\s\S]*?<\/div>\s*\n\s*<\/main>/, mediaM[0]);
  fs.writeFileSync(dest, html, "utf8");
  console.log("  synced 3d-interactive-animation.html from a-photo-studio");
}

async function main() {
  console.log("=== Index thumbnails ===");
  await syncIndexThumbs();

  console.log("\n=== About ===");
  try {
    await syncAbout();
  } catch (e) {
    console.log("  [error]", e.message);
  }

  for (const slug of PAGES) {
    console.log(`\n=== ${slug} ===`);
    try {
      const pageHtml = await fetchText(`${BASE_URL}/${liveSlug(slug)}`);
      await syncPage(slug, pageHtml);
    } catch (e) {
      console.log(`  [error] ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  copyNightToDigitalHumanities();
  await sync3dPage();

  console.log("\nDone. Run audit: node audit.mjs");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
