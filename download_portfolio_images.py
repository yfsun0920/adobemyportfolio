#!/usr/bin/env python3
"""
Run this script on your local machine to download all images from
yifeisun.myportfolio.com into the correct images/ subfolders.

Requirements:
    pip install requests beautifulsoup4
"""

import os
import re
import time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

BASE_URL = "https://yifeisun.myportfolio.com"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "images")

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

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE_URL,
}

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}


def is_media_url(url):
    path = urlparse(url).path.lower()
    ext = os.path.splitext(path)[1]
    return ext in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS


def sanitize_filename(url):
    path = urlparse(url).path
    filename = os.path.basename(path)
    # Strip query strings from filename
    return filename.split("?")[0]


def download_file(url, dest_path):
    if os.path.exists(dest_path):
        print(f"  [skip] already exists: {os.path.basename(dest_path)}")
        return
    try:
        r = requests.get(url, headers=HEADERS, timeout=30, stream=True)
        r.raise_for_status()
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"  [ok]   {os.path.basename(dest_path)}")
    except Exception as e:
        print(f"  [fail] {url} — {e}")


def scrape_page(slug):
    url = f"{BASE_URL}/{slug}"
    print(f"\n--- {slug} ({url}) ---")
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"  [error] Could not fetch page: {e}")
        return

    soup = BeautifulSoup(r.text, "html.parser")
    folder = os.path.join(OUTPUT_DIR, slug)
    found = set()

    # <img src> and <img data-src> (lazy loaded)
    for tag in soup.find_all("img"):
        for attr in ("src", "data-src", "data-original", "data-lazy-src"):
            val = tag.get(attr, "")
            if val and is_media_url(val):
                found.add(urljoin(url, val.split("?")[0]))

    # <source srcset> inside <picture> or <video>
    for tag in soup.find_all("source"):
        srcset = tag.get("srcset", "") or tag.get("src", "")
        for entry in srcset.split(","):
            part = entry.strip().split()[0]
            if part and is_media_url(part):
                found.add(urljoin(url, part.split("?")[0]))

    # <video src>
    for tag in soup.find_all("video"):
        val = tag.get("src", "")
        if val and is_media_url(val):
            found.add(urljoin(url, val.split("?")[0]))

    # Inline JSON / data attributes that embed CDN URLs
    cdn_urls = re.findall(
        r'https://cdn\.myportfolio\.com/[^\s"\'<>]+\.(?:jpg|jpeg|png|gif|webp|mp4|webm)',
        r.text,
        re.IGNORECASE,
    )
    for u in cdn_urls:
        found.add(u.split("?")[0])

    if not found:
        print("  [none] No media found on this page.")
        return

    for media_url in sorted(found):
        filename = sanitize_filename(media_url)
        dest = os.path.join(folder, filename)
        download_file(media_url, dest)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    session = requests.Session()
    session.headers.update(HEADERS)

    # Also grab homepage thumbnail images
    print("\n--- index (homepage) ---")
    try:
        r = session.get(BASE_URL, timeout=30)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup.find_all("img"):
            for attr in ("src", "data-src"):
                val = tag.get(attr, "")
                if val and is_media_url(val):
                    clean = urljoin(BASE_URL, val.split("?")[0])
                    filename = sanitize_filename(clean)
                    dest = os.path.join(OUTPUT_DIR, filename)
                    download_file(clean, dest)
    except Exception as e:
        print(f"  [error] {e}")

    for slug in PAGES:
        scrape_page(slug)
        time.sleep(0.5)  # be polite

    print("\nDone! Images saved to:", OUTPUT_DIR)


if __name__ == "__main__":
    main()
