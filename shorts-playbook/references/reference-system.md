# Reference system + keyframe prompt schema (shopping shorts)

How references are **named, stored, and attached**, and how a keyframe prompt is **assembled from swappable slots**. Source of truth for reference/prompt handling — edit here. (Companion to `image-rules.md`, which governs the visual rules themselves.)

Status: **spec / in progress.** References already exist on Higgsfield (see §1); the app is being brought to match this.

## 1. References = Higgsfield Elements (named, reusable)
Characters, environments and products are stored as **Higgsfield "Elements"** — reusable, per-workspace, each with a **user-assigned name** and one or more anchor images. They are the global variables of a prompt.

- **Call by name:** embed the element's id as `<<<ELEMENT_ID>>>` inside the `generate_image` / `generate_video` prompt; the Higgsfield backend auto-injects the reference and rewrites it to `@element_name`. **Multiple placeholders per prompt are allowed** (character + product + environment together).
- **Works with our models:** Elements support Nano Banana Pro (images) and **Kling 3.0 / Seedance 2.0** (video) — the models this project uses. So the same named element flows image → clip.
- Resolve `name → element_id` via `show_reference_elements(action:'list')` (cache the map).

**Elements vs Soul (decided):** Higgsfield also has "Soul" trained characters (`soul_id`), but Soul only works with Soul V2 / Cinema models and allows **one** character per generation. Elements are chosen because they work with our models (Nano/Kling/Seedance) and support **multiple** references per prompt. Do **not** use Soul here.

**Already uploaded (user's workspace):** `kpicks-model-a` (character, 5-photo anchor set), `kpicks-model-b` (character, 2-photo anchor set). Category is set per element (character / environment / prop).

## 2. Naming convention (confirmed)
Lowercase, `kebab-case`, no spaces — a name is a safe handle. **Pick once, never rename after use** (prompts depend on it).

- **Character:** `<project>-<who>` → `kpicks-model-a`, `kpicks-model-b`.
- **Environment:** `env-<place>-<time/mood>` → `env-bathroom-morning`, `env-bedroom-vanity`.
- **Product:** `prod-<name>` → `prod-retinol-tube`, `prod-lipgloss-pink`.
- **Variant look** (same person, different styling), only if needed: `kpicks-model-a--glam` (double-hyphen = variant).
- **Expression sheet (later):** numbered cells per character — `expression #5` etc.

## 3. Character = an anchor "set"
A named character element carries an **anchor set** of identity photos (e.g. model-a = 5). Give it enough angles (front / ¾ / profile) for a strong identity lock. To verify/expand: `show_reference_elements(action:'get', element_id)`.

## 4. Two reference layers per keyframe
- **WHO (identity):** the character element name → `<<<id>>>`. Locks face/hair/build.
- **HOW (look of THIS shot):** an additional reference to lock this shot's angle/mood/lighting — the closest existing final cut and/or an expression-sheet cell. Optional per shot.

## 5. Keyframe prompt schema — 7 swappable slots
Assembled so each slot swaps independently:

1. **[CHARACTER]** — character element (`<<<kpicks-model-a id>>>`) + optional HOW/mood reference
2. **[ACTION+PRODUCT]** — action + product position ("holding up the lip gloss next to her face at cheek level"); product may also be an element `<<<prod-…>>>`
3. **[EXPRESSION]** — expression-sheet cell + cue ("soft curious closed-lip smile, expression #2")
4. **[FRAMING]** — shot size + composition + background ("chest-up medium close-up, slightly off-center, mirror blurred behind")
5. **[LIGHTING/MOOD]** — light direction + "same warm color grade as the reference" + one-line mood
6. **[CAMERA/QUALITY]** — **PROJECT CONSTANT, identical every time:** 50mm/85mm full-frame, shallow DOF, realistic skin pore texture, ISO 200 subtle grain, photorealistic candid lifestyle
7. **[FORMAT]** — **CONSTANT:** vertical 9:16, headroom for caption text at the top

Slots 6–7 are stored constants injected on every keyframe so lens/DOF/grain/aspect never drift. Slots 1–5 vary per shot.

## 6. Project constants (edit once)
- Camera/quality: `50mm full-frame mirrorless, shallow depth of field, realistic skin pore texture, ISO 200 subtle grain, photorealistic candid lifestyle photography`
- Format: `vertical 9:16, headroom for caption text at the top`

## 7. Build notes (current gap → target)
- **Now:** the app uploads local reference images per generation and passes them as `medias` with roles; it uses only the FIRST character photo and a freeform prompt → weak consistency. It does not use Higgsfield Elements.
- **Target:** keep a `name → element_id` map (from `show_reference_elements`); the graph's reference nodes reference elements by name; generation embeds `<<<element_id>>>` placeholders in the prompt (character + product + environment) instead of uploading local refs; the prompt is assembled from the 7 slots with §6 constants.
- Phasing: **P1** wire character elements by name (`<<<id>>>`) into image + clip gen · **P2** 7-slot schema with constants · **P3** product/env as elements + per-shot HOW reference + expression sheet.
