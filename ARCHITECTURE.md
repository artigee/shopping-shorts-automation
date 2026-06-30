# Architecture

## Pipeline at a glance
```
ENTRY (either):
  ① Discover  — IG hashtag reels, ranked by comments
  ＋ Add URL   — paste any reel URL (+ optional product link)
        │
        ▼
  ② Reel Analysis ──────────────────────────────────────────────┐
     reel → frames → Claude-vision STRUCTURE analysis            │  (one Analyze run)
     + identify product → Amazon search → VISION product-match   │
        │                                                         │
        ▼                                                         │
  ③ Select Product  (vision-matched default · swap on Amazon)    │
        │
        ▼
  ④ Content Production
     💡 Recommend (voice + hook from product + analysis)
       → Overall script (rich persona monologue, the through-line)
       → Scene script   (Title + VO only, per scene)
       → Scene images   (✍ prompt → 🖼 image; product/character/env refs)
       → Scene clips     (image→video, ONE slow camera move)
       → Preview (ffmpeg) / Export (Remotion)
```
The downstream pipeline is **decoupled from how the analysis was created** — Discover and Add-from-URL produce the same `analyses` row.

## Data model (SQLite)
- **snapshots / reels** — one Discover run + its collected reels (metrics, score).
- **analyses** — a reusable structure asset: `reel_*`, `analysis` (JSON), and the matched `product`, `candidates`, `match_meta`.
- **contents** — a production card = one analysis × one product. Holds `overall`, `scenes` (JSON array), `persona`, `hook`, `style`, `character_ref`, `final_form`, `export_mp4`, etc. Each scene: `onScreenText` (title), `vo`, `imagePrompt`, `makeVideo`, `cameraMove`, `envRef`, `image`/`imageSrc`, `video`/`videoSrc`, `audio`.
- **settings** — global key/values (e.g. `genLang`).

## The two content modes
Picked automatically from the product/category (and selectable via persona/hook):
- **Story mode** (gadgets/home/finds) — persona monologue + arc (disbelief → reveal → payoff). Images = product in a setting; "no transformation" (don't show folding/assembling).
- **Review / UGC mode** (cosmetics/beauty — auto-detected by `isCosmeticContent`) — demo-driven (`usage_review` hook + `honest_tester` voice). Images = skin/lip/face close-ups, applying the product, holding it to the face; application *is* the content. Calibrated by `shorts-playbook/examples/cosmetic.mov`.

## Reference system (image generation)
Images generate from up to **3 role-labeled references** fed to Higgsfield `nano_banana_pro`:
- **PRODUCT** — `product.images` / per-scene picks → reproduce the exact product.
- **CHARACTER** — `content.character_ref` → same person in every scene.
- **ENVIRONMENT** — `scene.envRef` → that scene's space/mood.
Local files are uploaded to Higgsfield (`media_upload`); URLs are imported (`media_import_url`). Refs are stored as a plain URL or `hfmedia:<id>|/output/<local-copy>`.

## Camera moves (image→video clips)
From `shorts-playbook/data/camera-moves.yaml` (the director's-note reference in `examples/camera-moves/`). Rule: **one simple, slow move per shot** — never stack. Per scene you pick a move, or **✨ Auto** (push-in for the hook, static for the CTA, varied in between). Prompt format: `CAMERA: <move>`.

## Generation path (no API billing)
`backend → spawn("claude", "-p", …, --allowedTools mcp__higgsfield__*) → Higgsfield MCP`.
- **Image:** `generate_image` (`nano_banana_pro` with refs, else `marketing_studio_image`).
- **Clip:** `kling…` image→video.
- **VO:** `text2speech` (English; US market).
- **Vision product-match & analysis:** Claude vision via the CLI reading local frame/candidate images.
Uses the Max plan (Claude) + Plus credits (Higgsfield). The SDK path (`HF_CREDENTIALS`) is a separate paid account, off by default.

## Background jobs & save-safety
- "Generate all images/clips/VO" run as **server-side background jobs** (`/api/contents/:id/batch`), navigation/reload-safe; the UI polls.
- Editing a scene **never wipes generated assets** — the scenes-save route **merges**, preserving `image`/`video`/`audio` even if the frontend state is stale.

## Skills-based steps (direction)
The craft is being factored into discrete, independently-improvable skills with defined inputs/outputs, mirroring the user mental model **Product → Storytelling → Content**:
- **Product** — identify + vision-match (Amazon now; TikTok Shop / Olive Young / Coupang later). Lives in `extract.js` + `match.js`.
- **Storytelling** — `shorts-playbook/` (personas, hooks, rules) drives recommend + overall + scene scripts. This is the most formalized skill today.
- **Content generation** — image prompts, references, camera moves, clip/VO/export.
Future: separate cards/nodes per stage wired as a workflow (node-graph), each node taking LLM inputs. Deferred.
