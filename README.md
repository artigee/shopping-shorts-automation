# Shopping Shorts Automation

A local, personal web app for producing **Amazon-affiliate shopping shorts** cheaply (Instagram-first, US market). It finds (or you supply) a high-performing reference reel, learns its *structure*, matches the product, and re-skins it into a fresh short — script → images → clips → export.

Core philosophy: **pick-and-assemble**, **minimize expensive video generation** (image-first), **confirm each step**.

> Updated 2026-06-30. Everything happens in the web app.

---

## Stack
- **Frontend:** Vite + React — `http://localhost:5173`
- **Backend:** Express — `http://localhost:5174`
- **Storage:** SQLite (`webapp/data/app.db`), generated media in `webapp/output/`
- **Craft skill:** `shorts-playbook/` (personas, hooks, camera moves, rules — the "how it's written" layer)

## The no-API-billing path (important)
Generation runs **backend → `claude` CLI → Higgsfield MCP**, which uses your **Claude Max plan** (no API billing) + your **Higgsfield Plus credits**. The Higgsfield **SDK** path (`HF_CREDENTIALS`) bills a *separate* paid account and is **off by default** (commented in `webapp/.env`).

## Prerequisites
1. **Debug Chrome on `:9222`, logged into Instagram** — used to collect/download reels and scrape Amazon. (`scripts/launch-chrome.sh`)
2. **`claude` CLI installed** with the **Higgsfield MCP connected** (✔ in `claude` MCP list) — image/clip/VO generation and product vision-matching go through it.
3. **ffmpeg / ffprobe** on PATH — preview stitching + durations.
4. (optional) `HF_CREDENTIALS=KEY_ID:KEY_SECRET` in `webapp/.env` only if you want the paid SDK path.

## Run
```bash
cd webapp
npm install
npm run dev        # server (5174, node --watch) + client (5173) via concurrently
```
Open http://localhost:5173. Make sure debug Chrome (logged into IG) is running first.

## The pipeline (4 tabs)
1. **① Discover** — pull Instagram Reels by hashtag (ranked by comments = purchase intent).
2. **② Reel Analysis** — Claude-vision analysis of a reel's structure **+** vision product-match to Amazon. Or **＋ Add from URL**: paste any reel URL (+ optional product link) and skip Discovery.
3. **③ Select Product** — the vision-matched product is the default; swap/confirm on Amazon (affiliate link).
4. **④ Content Production** — recommend voice + hook → overall script → scene script (Title + VO) → scene images → clips → preview / Remotion export.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full data/control flow, the two content modes (story vs. review/UGC), the reference system (product / character / environment), and camera moves. The writing craft lives in **[shorts-playbook/SKILL.md](shorts-playbook/SKILL.md)**.

## Layout
See **[STRUCTURE.md](STRUCTURE.md)**. Old prototypes and planning docs are in `_archive/`.
