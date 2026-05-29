import https from "https";
import fs from "fs";

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
  return new Promise((res, rej) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res(d));
    }).on("error", rej);
  });
}

function parseButtons(html) {
  const canvas = html.match(/id="project-modules"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  const chunk = canvas ? canvas[0] : html;
  return [...chunk.matchAll(
    /<a href="([^"]+)"[^>]*class="[^"]*button-module[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  )].map((m) => ({
    href: m[1],
    label: m[2].replace(/<[^>]+>/g, "").trim(),
  }));
}

function parseVideos(html) {
  const iframes = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter((u) => /ccv\.adobe|youtube|vimeo/i.test(u));
  return iframes;
}

const report = [];
for (const [local, live] of PAGES) {
  const html = await fetch(`https://yifeisun.myportfolio.com/${live}`);
  const buttons = parseButtons(html);
  const videos = parseVideos(html);
  report.push({ local, live, buttons, videos });
  console.log(`${local}: buttons=${buttons.length} videos=${videos.length}`);
  buttons.forEach((b) => console.log(`  BTN: "${b.label}" -> ${b.href}`));
  videos.forEach((v) => console.log(`  VID: ${v.slice(0, 100)}`));
}

fs.writeFileSync("audit-live.json", JSON.stringify(report, null, 2));
