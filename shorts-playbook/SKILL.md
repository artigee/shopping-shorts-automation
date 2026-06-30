---
name: shorts-playbook
description: "Use when writing or revising voiceover (VO) scripts, on-screen titles/captions, or scene scripts for short-form shopping/affiliate videos (Reels, TikTok, Shorts) — especially K-beauty and Amazon Associates product shorts for the US market. Also use when tearing down a reference reel into a reusable structure and re-skinning that structure onto a new, related product. Triggers: 'write the VO', 'fix this script', 'the voiceover sounds generic', 'turn this reel into a template', 'apply this structure to a new product', 'scene script', 'beat sheet'."
---

# shorts-playbook — Shopping Short Voice & Structure

## What this skill is for

Producing short-form product videos where the **structure is reused** across many products but the **voice is regenerated** every time. The #1 failure mode this skill exists to prevent: **VO that narrates the caption** and comes out generic. The fix is enforced by the workflow ORDER below — do not reorder it.

## The keep / regenerate line (the core principle)

Every reel splits into two layers:

- **Skeleton (reusable, language-neutral, KEEP when tearing down):** hook archetype, beat count, beat durations, pacing curve, CTA mechanic, and per-beat SEALCaM footage specs.
- **Skin (regenerate every time, author natively in US English):** the VO and the on-screen captions.

When you tear down a reference reel, extract the skeleton. **Never lift the source reel's VO as a template** — it carries the source's generic tone. Captions and VO are always authored fresh.

## Workflow ORDER (do not skip or reorder)

1. **Teardown** — extract the skeleton from the reference reel. See `references/teardown.md`. Output a skeleton object (structure + pacing + SEALCaM specs). Discard the source VO.
2. **Re-skin** — map the skeleton onto the new product. This is data: fill the beat sheet per `data/beat-sheet.schema.json`. Captions = the *claim/spec* for each beat.
3. **Pick a persona** — choose one from `data/personas.yaml`. The persona is a required parameter, not a default. "Enthusiastic creator" is banned — that's the absence of a persona.
4. **Write VO as ONE continuous monologue** for the full duration, in that persona — one person thinking out loud, NOT N separate headlines. See `references/vo-rules.md`. Only AFTER it reads as continuous speech, split it to the beats.
5. **Write/confirm titles** per `references/title-rules.md`. Title carries the claim; VO carries the reaction. They must never say the same thing.
6. **Validate** — run `scripts/check_vo.py <beatsheet.json>`. It must PASS the ban-list and the VO≠caption redundancy test before the script is considered done. Fix and re-run on failure.

## Non-negotiables (the short list)

- VO is written as a continuous monologue first, then split. Never authored beat-by-beat.
- VO reacts; the caption states. If deleting the VO loses no information, the VO failed — rewrite it.
- VO and captions are authored natively in US English. Never translated from working notes in another language.
- Every persona is a named voice with its own idiom. Pass it as a parameter.
- `scripts/check_vo.py` must pass before output. The ban-list is enforced, not advisory.

## Files

- `references/vo-rules.md` — react-don't-narrate, the energy arc, monologue-first
- `references/title-rules.md` — compression + the title≠VO split test
- `references/storytelling.md` — impact/ear-catching rules: cold open, open loop, time budget, no-transformation, no signature-phrase reuse, casual-CTA
- `references/teardown.md` — original → skeleton, the keep/regenerate procedure + worked transform
- `references/english-style.md` — US idiom, register, dollar references, FTC disclosure
- `data/personas.yaml` — the VO voice library (skeptic_won_over, tired_parent, broke_foodie, lazy_genius, honest_tester)
- `data/hooks.yaml` — story shapes (disbelief_reveal, price_shock, social_proof, usage_review, …) — the second lever beside persona
- `data/camera-moves.yaml` — image→video camera moves; one slow move per shot
- `data/banlist.txt` — forbidden phrases (the generic tells)
- `data/beat-sheet.schema.json` — the data contract
- `examples/dash-my-pint.md` — worked gadget example: flat VO vs good VO, side by side
- `examples/cosmetic.mov` — calibration for review/UGC (cosmetics) mode
- `examples/camera-moves/` — the 12 director's-note camera-move reference images
- `scripts/check_vo.py` — enforces ban-list + VO≠caption; returns pass/fail (not yet UI-wired)
