# Folder structure

```
shopping-shorts-automation/
├── README.md            ← start here (what it is, how to run)
├── ARCHITECTURE.md      ← pipeline, modes, references, camera moves
├── STRUCTURE.md         ← this file
│
├── webapp/              ← the app
│   ├── package.json     ← scripts: dev (server+client), build
│   ├── .env             ← AMAZON_ASSOC_TAG, AMAZON_DOMAIN; HF_CREDENTIALS (off)
│   ├── data/app.db      ← SQLite (snapshots, reels, analyses, contents, settings)
│   ├── output/          ← generated media (content-<id>/scene-*.png, clip-*.mp4, vo-*.mp3, …)
│   ├── server/
│   │   ├── index.js         ← Express entry: all routes
│   │   ├── db.js            ← SQLite schema + migrations + settings(get/set)
│   │   ├── collect.js       ← ① Discover: IG hashtag reels via debug Chrome (CDP :9222)
│   │   ├── score.js         ← reel ranking (comments-weighted)
│   │   ├── extract.js       ← product identify from a reel (claude CLI)
│   │   ├── analyze.js       ← ② reel → frames → Claude-vision structure analysis
│   │   ├── match.js         ← vision product-match (reel frame vs Amazon candidate images)
│   │   ├── amazon.js        ← Amazon search / product / ASIN / affiliate URL (Chrome scrape)
│   │   ├── produce.js       ← overall + scene scripts, image-prompt, recommend (reads playbook)
│   │   ├── playbook.js      ← loads shorts-playbook/ (personas, hooks, camera-moves, banlist, rules)
│   │   ├── higgsfield.js    ← image/clip/VO via claude CLI → Higgsfield MCP (+ SDK path)
│   │   ├── preview.js       ← ffmpeg quick preview (clips/images + VO)
│   │   └── remotion-render.js ← Remotion final export (captions/transitions/VO/CTA)
│   ├── remotion/        ← Remotion composition (Short.jsx, Root.jsx, index.jsx)
│   └── src/             ← React UI
│       ├── App.jsx          ← tabs + global gen-language selector
│       ├── CollectView.jsx      ← ① Discover
│       ├── AnalysesView.jsx     ← ② Reel Analysis (+ Add from URL)
│       ├── AnalysisPanel.jsx    ← run analysis
│       ├── ProductSelectView.jsx← ③ Select Product
│       ├── ContentsView.jsx     ← ④ Content Production (the big one)
│       └── i18n.jsx             ← KO-key → EN dictionary (app label language)
│
├── shorts-playbook/     ← the craft skill (source of truth for "how it's written/shot")
│   ├── SKILL.md             ← the workflow + rules overview
│   ├── data/
│   │   ├── personas.yaml        ← VO voices (skeptic, tired_parent, honest_tester, …)
│   │   ├── hooks.yaml           ← story shapes (disbelief, price-shock, usage_review, …)
│   │   ├── camera-moves.yaml    ← image→video camera moves (push-in, orbit, …)
│   │   ├── banlist.txt          ← forbidden generic phrases
│   │   └── beat-sheet.schema.json
│   ├── references/          ← vo-rules, title-rules, storytelling, teardown, english-style (md)
│   ├── examples/            ← dash-my-pint (gadget), cosmetic.mov, camera-moves/ (12 ref images)
│   └── scripts/check_vo.py  ← deterministic ban-list + VO≠caption validator (not yet UI-wired)
│
└── _archive/            ← superseded prototypes (app/, tools/, reference/) + old planning docs
```
