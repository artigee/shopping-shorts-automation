# Image / Clip generation rules (shopping shorts)

These govern the visuals (image prompt → image → clip), not the VO. They exist because a shopping short's job is to make the viewer **reach out** (comment / DM for the affiliate link), and because AI image models garble text.

## 1. Product visibility — tease it, don't showcase it
On Instagram we do **not** hand the viewer a clean, readable product shot — that removes the reason to DM. So:

- The product is **present but secondary**. The **person, skin, reaction, or result** is the focus.
- **No tight, legible close-up of the product or its label.** Keep it held casually, partially cropped, turned so the label faces away, or softly out of focus.
- Use product close-ups **sparingly**, and **never** on readable label text.
- Goal: the viewer wants it but has to **comment / DM for the link** — don't let them read everything off the label on screen.

(Cosmetics exception: application on skin *is* the demo, so the product can be near the face — but the **label still stays non-legible**.)

## 2. No readable text on anything
AI renders label text **garbled and mirrored** (e.g. a retinol tube reading backwards). So:

- **No overlay captions** in the image, AND **no legible letters / logos / label text** on the product or any object.
- Keep every product label **turned away, cropped, or out of focus** so no text is readable.
- If a brand name would be legible, **angle or blur** it out of legibility.
- Every image prompt ends with: `vertical 9:16, photorealistic, no text, no letters, no readable labels, no captions`.

## 3. Ground each shot in its scene
- The image depicts **this scene's** Title + VO beat — not a generic "product beautifully assembled, problem solved" beauty shot.
- Show, don't tell: only what the camera literally sees (subject, setting, action, framing, light) — no emotional narration.
- True real-world product size; clean/light tone; tension beats read as tension, not the solved finale.

These are enforced in `webapp/server/produce.js` `generateImagePrompt`.
