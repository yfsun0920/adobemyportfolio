#!/usr/bin/env python3
"""
Download all media from yifeisun.myportfolio.com and update local HTML pages
to match image/video order and hero content on each project page.
"""

import os
import re
import time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

BASE_URL = "https://yifeisun.myportfolio.com"
ROOT = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(ROOT, "images")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE_URL,
}

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
VIDEO_EXT = {".mp4", ".webm", ".mov"}

# slug -> local html filename (when different)
SLUG_TO_HTML = {
    "night-at-the-museum": "night-at-the-museum.html",
    "digital-humanities": "digital-humanities.html",
    "3d-interactive-animation": "3d-interactive-animation.html",
}

PAGES = [
    "a-photo-studio",
    "a-window",
    "allow-notifications",
    "bubble",
    "cura",
    "digital-humanities",
    "flower-ball",
    "found",
    "game-for-good",
    "in-the-mist",
    "lost-horizon",
    "moody-me",
    "night-at-the-museum",
    "pay-attention",
    "sincerely-me",
    "sleepless",
    "sunflower",
    "wheels",
    "3d-interactive-animation",
]

# work grid order on /work (slug -> index thumbnail uses img_XX)
WORK_GRID = [
    ("a-photo-studio", None),
    ("pay-attention", None),
    ("lost-horizon", None),
    ("allow-notifications", None),
    ("night-at-the-museum", None),
    ("flower-ball", None),
    ("moody-me", None),
    ("cura", None),
    ("wheels", None),
    ("a-window", None),
    ("game-for-good", None),
    ("sleepless", None),
]


def media_ext(url):
    return os.path.splitext(urlparse(url).path.lower())[1]


def is_media(url):
    return media_ext(url) in IMAGE_EXT | VIDEO_EXT


def clean_url(url):
    return url.split("?")[0]


def filename_from_url(url):
    return os.path.basename(urlparse(clean_url(url)).path)


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    try:
        r = requests.get(url, headers=HEADERS, timeout=60, stream=True)
        r.raise_for_status()
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)
        return True
    except Exception as e:
        print(f"    [fail] {url}: {e}")
        return False


def extract_ordered_media(html, page_url):
    """Return media items in DOM order: list of dicts {type, url, filename}."""
    soup = BeautifulSoup(html, "html.parser")
    items = []
    seen = set()

    def add(url, kind):
        if not url or not is_media(url):
            return
        full = clean_url(urljoin(page_url, url))
        if full in seen:
            return
        seen.add(full)
        items.append({"type": kind, "url": full, "filename": filename_from_url(full)})

    # Walk main content — portfolio uses module/gallery structure
    for el in soup.find_all(["img", "video", "source"]):
        if el.name == "img":
            for attr in ("src", "data-src", "data-original"):
                add(el.get(attr), "image")
        elif el.name == "video":
            add(el.get("src"), "video")
            for source in el.find_all("source"):
                add(source.get("src"), "video")
        elif el.name == "source":
            srcset = el.get("srcset") or el.get("src") or ""
            for part in srcset.split(","):
                add(part.strip().split()[0] if part.strip() else None, "image")

    # Also pick CDN URLs from inline JSON (order preserved by first appearance)
    for u in re.findall(
        r"https://cdn\.myportfolio\.com/[^\s\"'<>]+\.(?:jpg|jpeg|png|gif|webp|mp4|webm|mov)",
        html,
        re.I,
    ):
        add(u, "image" if media_ext(u) in IMAGE_EXT else "video")

    return items


def pick_hero_and_gallery(items):
    """First video (or first large image) = hero; rest = gallery. Skip tiny thumbs."""
    if not items:
        return None, []

    hero = None
    gallery = []
    for item in items:
        fn = item["filename"].lower()
        # skip obvious nav/logo assets
        if "logo" in fn or "favicon" in fn:
            continue
        if hero is None and item["type"] == "video":
            hero = item
        elif hero is None and "_rw_1920" in fn or item["type"] == "video":
            if hero is None:
                hero = item
                continue
        gallery.append(item)

    if hero is None and items:
        # first substantial asset as hero
        for item in items:
            fn = item["filename"].lower()
            if "logo" in fn:
                continue
            hero = item
            break
        gallery = [i for i in items if i is not hero and i not in gallery]
        gallery = [i for i in items if i != hero]

    if hero:
        gallery = [i for i in items if i != hero]
    else:
        gallery = list(items)

    # Prefer rw_1920 variants for gallery, dedupe by hash prefix
    def asset_key(fn):
        base = os.path.splitext(fn)[0]
        return base.split("_rw_")[0] if "_rw_" in base else base

    seen_keys = set()
    filtered = []
    for item in gallery:
        key = asset_key(item["filename"])
        if key in seen_keys:
            continue
        # prefer _rw_1920 when duplicates exist
        seen_keys.add(key)
        filtered.append(item)

    return hero, filtered if filtered else gallery


def rel_path(slug, filename):
    return f"images/{slug}/{filename}"


def hero_html(hero, slug):
    if not hero:
        return '        <div class="hero-placeholder"></div>\n'
    path = rel_path(slug, hero["filename"])
    if hero["type"] == "video":
        return (
            f'        <video class="project-hero-video" controls playsinline '
            f'style="width:100%;display:block;">\n'
            f'          <source src="{path}" type="video/mp4" />\n'
            f"        </video>\n"
        )
    return f'        <img src="{path}" alt="" style="width:100%;display:block;" />\n'


def gallery_html(gallery, slug, title):
    if not gallery:
        return '        <p class="media-empty">Media loading…</p>\n'
    lines = []
    for i, item in enumerate(gallery, 1):
        path = rel_path(slug, item["filename"])
        if item["type"] == "video":
            lines.append(
                f'        <video controls playsinline style="width:100%;display:block;">\n'
                f'          <source src="{path}" type="video/mp4" />\n'
                f"        </video>"
            )
        else:
            lines.append(
                f'        <img src="{path}" alt="{title} {i}" '
                f'style="width:100%;display:block;" />'
            )
    return "\n".join(lines) + "\n"


def update_html_file(html_path, slug, hero, gallery, title):
    with open(html_path, encoding="utf-8") as f:
        content = f.read()

    hero_block = hero_html(hero, slug)
    gallery_block = gallery_html(gallery, slug, title)

    # Replace project-hero inner content
    content = re.sub(
        r"(<div class=\"project-hero\">)\s*.*?\s*(</div>)",
        lambda m: m.group(1) + "\n" + hero_block + "      " + m.group(2),
        content,
        count=1,
        flags=re.DOTALL,
    )

    # Replace project-media inner content
    content = re.sub(
        r"(<div class=\"project-media\">)\s*.*?\s*(</div>)",
        lambda m: m.group(1) + "\n" + gallery_block + "      " + m.group(2),
        content,
        count=1,
        flags=re.DOTALL,
    )

    with open(html_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def sync_work_thumbnails(session):
    """Update index.html card images from /work page."""
    url = f"{BASE_URL}/work"
    r = session.get(url, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    thumbs = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if not href.startswith("/") and BASE_URL not in href:
            continue
        slug = href.strip("/").split("/")[-1] or href.replace(BASE_URL + "/", "").strip("/")
        img = a.find("img")
        if img:
            src = img.get("src") or img.get("data-src")
            if src and is_media(src):
                thumbs.append((slug, clean_url(urljoin(url, src))))

    index_path = os.path.join(ROOT, "index.html")
    with open(index_path, encoding="utf-8") as f:
        index = f.read()

    for i, (slug, thumb_url) in enumerate(thumbs[:12], 1):
        ext = media_ext(thumb_url) or ".jpg"
        local_name = f"img_{i:02d}{ext}"
        dest = os.path.join(OUTPUT_DIR, local_name)
        download(thumb_url, dest)
        # update index — match by href to slug html
        html_file = f"{slug}.html"
        pattern = rf'(<a href="{re.escape(html_file)}"[^>]*>.*?<img src=")images/[^"]+(")'
        index = re.sub(pattern, rf"\1images/{local_name}\2", index, count=1, flags=re.DOTALL)

    with open(index_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(index)
    print(f"  Updated index.html with {len(thumbs)} thumbnails")


def main():
    session = requests.Session()
    session.headers.update(HEADERS)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("=== Syncing /work thumbnails ===")
    try:
        sync_work_thumbnails(session)
    except Exception as e:
        print(f"  [warn] work thumbnails: {e}")

    for slug in PAGES:
        html_name = SLUG_TO_HTML.get(slug, f"{slug}.html")
        html_path = os.path.join(ROOT, html_name)
        if not os.path.isfile(html_path):
            print(f"\n[skip] no {html_name}")
            continue

        page_url = f"{BASE_URL}/{slug}"
        print(f"\n=== {slug} ===")
        try:
            r = session.get(page_url, timeout=30)
            r.raise_for_status()
        except Exception as e:
            print(f"  [error] fetch: {e}")
            continue

        items = extract_ordered_media(r.text, page_url)
        if not items:
            print("  [none] no media found")
            continue

        folder = os.path.join(OUTPUT_DIR, slug)
        for item in items:
            dest = os.path.join(folder, item["filename"])
            ok = download(item["url"], dest)
            status = "ok" if ok else "fail"
            print(f"  [{status}] {item['filename']}")

        hero, gallery = pick_hero_and_gallery(items)

        # Extract title from html
        soup = BeautifulSoup(open(html_path, encoding="utf-8").read(), "html.parser")
        h1 = soup.select_one(".project-title")
        title = h1.get_text(strip=True) if h1 else slug

        update_html_file(html_path, slug, hero, gallery, title)
        print(f"  Updated {html_name}: hero={'yes' if hero else 'no'}, gallery={len(gallery)}")

        time.sleep(0.4)

    print("\nDone.")


if __name__ == "__main__":
    main()
