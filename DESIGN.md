# DESIGN — node-graph direction

> The plan we agreed on for turning the linear 4-tab pipeline into a
> **node-graph** system: agent-driven discovery, a user-designed content
> workbench, and reusable/shareable references. This is the "where we're
> going" doc — [ARCHITECTURE.md](ARCHITECTURE.md) is "how it works today".
>
> Written 2026-06-30. Supersedes the "Skills-based steps (deferred)" note at
> the end of ARCHITECTURE.md.

---

## 1. The three zones

The pipeline splits into three zones by **who drives**:

```
[ZONE A: INPUT]              [ZONE B: CONTENT WORKBENCH]     [ZONE C: OUTPUT]
 auto-find  ─┐                user designs the node graph      CapCut setup
            ├→ Analysis+Product ──→  (save/reuse templates)  ──→  export
 supply  ───┘                 works off Zone-A data               (agent)
 (agent drives)               (you drive · node GUI)
```

- **Zone A — INPUT (agent drives).** Mechanical work: get a reel + a product.
  Two entrances, **same output**:
  - *Auto-find*: "find good products for this hashtag" → agent runs
    collect → analyze → vision-match.
  - *Supply*: "use this reel + this product" → agent **accepts** the given
    inputs and runs only analyze + match. (Today's "Add from URL" in tab ② is
    the seed of this entrance.)
  - Both produce one **`Analysis + Product`** bundle that flows into Zone B.
- **Zone B — CONTENT WORKBENCH (you drive · node GUI).** Taste + iteration.
  The agent is an assistant that drafts; you arrange the nodes, review, and
  re-roll. This is where the node GUI lives. See §3.
- **Zone C — OUTPUT (agent drives).** Mechanical again: final render, and
  **auto-handling the setup when sending to external tools** (e.g. CapCut
  project scaffold, asset layout, timing).

**The boundary is between ③ and ④** in today's pipeline: everything up to
"the product is decided" is automatable; everything from "make the content"
is human-led.

| Step (today)            | Driver            | Why |
|-------------------------|-------------------|-----|
| ① collect + rank reels  | 🤖 agent          | mechanical |
| ② structure analysis    | 🤖 agent          | fixed-answer extraction |
| ② product match (Amazon)| 🤖 agent          | "this reel's item = this product" |
| ③ product select        | 👤 semi (agent suggests #1, you OK/swap) |
| ④ recommend voice/hook  | 👤 you confirm    | taste starts here |
| ④ script (overall→scene)| 👤 iterative      | agent drafts, you edit |
| ④ images / clips        | 👤 you confirm    | re-roll until right |
| ④ export / send-out     | 🤖 agent          | mechanical |

---

## 2. Freeze the contracts (Phase 0 — the prerequisite for everything)

Today the data between steps is **unnamed JSON blobs**: `analyses.analysis`,
`analyses.product/candidates/match_meta`, `contents.overall/scenes`. The shape
lives in people's heads and in scattered code, so a producer can drift and a
consumer silently breaks.

**Freezing a contract = giving each blob a named, typed schema.** Example:

```
Analysis = {
  hook:      { shape: string, line: string },
  structure: Beat[],          // ≥1, always present
  scenes:    Scene[],
  assets:    { product?, character?, environment? }
}
```

Why this is the foundation for *everything* else:

- **Nodes connect only when output-type == input-type** → the GUI can refuse an
  invalid wire automatically.
- **Swappable implementations** — any node that emits a valid `Analysis` can
  replace `analyze.js` without breaking downstream (= real modularity).
- **Agent autonomy** — the agent can *reason* "I hold a `ProductMatch` but no
  `Content`, so I need a content-producing node." Without typed contracts the
  agent has no rails. **This is why "agent drives" depends on Phase 0.**

The four contracts to freeze (reverse-engineered from the real `app.db`):
`ReelRef`, `Analysis`, `ProductMatch`, `Content + Scene`. This is also the
moment to **kill the dual data model** (old `products`-centric vs. new
`contents = analysis × product`) that coexists in [db.js](webapp/server/db.js).

---

## 3. Zone B is a dataflow graph — references are first-class nodes

The big shift, and the thing the existing webapp does *not* do.

### Today: references are buried as properties

- `contents.character_ref` — one character, hidden in a column.
- `scene.refs[]` — each scene independently lists its product/character/env
  image URLs. **The same product image is duplicated across many scenes' `refs`
  arrays** (verified in content #27: the product image repeats in every scene).

### Target: references are nodes that fan out

A **reference node** (product / character / environment) is its own thing and
**connects out to multiple scene nodes**. Change the reference once → every
connected scene updates. This is the DCC mental model (a texture/material node
feeding many meshes; a skeleton shared across characters) — the same node
thinking in `dev_reference/` (Unreal AnimBP, character-variation graphs).

```
[product ref]──┐
[character ref]┼──→ [scene 1]
               ├──→ [scene 2]
[env A]────────┤    [scene 3]
[env B]────────┘
[style / persona]──(applies to all scenes)
```

This single change unlocks three things at once:

1. **Reuse** — make a reference node once, use it across scenes and across
   contents.
2. **Templates** — the *shape* of the graph ("1 character → 5 scenes, push-in
   hook, static CTA") saves as a reusable template.
3. **Sharing** — because a reference is now an independent object, it can be
   saved and **shared** (this is the answer to "I want to share my data").

### Node typology (not every node is an LLM node)

- **Deterministic** — collect, scrape, ffmpeg preview, Remotion export, CapCut
  scaffold. Pure functions, no LLM.
- **LLM-agent** — structure analysis, vision-match, recommend, scripts, image
  prompts. These are the **skill** candidates.
- **Human-gate** — filter, manual assignment, product select, scene confirm.
  The "confirm each step" philosophy = explicit approval nodes.

The LLM operates *inside* a node's contract; it doesn't replace it.

---

## 4. Two LLM modes (both, staged)

- **LLM inside a node (implementation)** — you click a node; the LLM fills that
  one node's output. Already partly true today. Safe, incremental.
- **LLM drives the graph (agent)** — you give a minimal goal ("make a short
  for this product") and the agent picks which nodes/skills to run, in what
  order, stopping at human-gates. Bigger, depends on Phase 0 contracts.

**Order: contracts first → node-internal LLM → agent driver on top.**

---

## 5. Skills vs. nodes vs. services

- **Skills** (`.md` + prompts/rules) wrap only the **craft / LLM-reasoning**
  layer. `shorts-playbook/` is already the model. Add: analysis, content-gen.
- **Services** (typed functions) are the deterministic plumbing — DB, ffmpeg,
  scraping. Do *not* wrap these as skills.
- **Nodes** are the graph units; each is backed by a skill, a service, or a
  human-gate.

---

## 6. Phasing (no big-bang)

| Phase | Deliverable | Risk |
|-------|-------------|------|
| 0 | Freeze the 4 contracts as schemas; kill the dual model | none (docs) |
| 1 | Refactor backend into typed step functions `(input, ctx) → output` | low, no UI change |
| 2 | Extract LLM craft into skills (analysis, content-gen) | low |
| 3 | **Node GUI** for Zone B (references fan-out, templates) | high — most work |
| 4 | Agent driver over the graph (Zone A auto + supply) | high |
| 5 | Zone C external send-out (CapCut auto-setup) | medium |

The node GUI (Phase 3) is the largest, least-reversible piece, so it comes
after the contracts are explicit.

---

## 7. Open questions

- Zone-B node GUI freedom: fixed step order with per-node customization vs. a
  fully free graph editor. (Leaning: fixed first, free later.)
- How far the agent is allowed to drive without a human-gate.
- Reference-node storage: extend `hfmedia:…|/output/…` convention, or a real
  `references` table so they're queryable/shareable.

---

## Visual reference

The node aesthetic to match lives in `dev_reference/Interview/htmls/pages/`
(colored nodes, node-rows with arrows: `character_variation_guide.html`,
`decorator_telemetry_pipeline.html`). User's prior technical-artist node-graph
tooling — the look and the dataflow mental model carry over directly.
