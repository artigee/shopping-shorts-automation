# Image / Clip generation rules (shopping shorts)

These govern the visuals (image prompt → image → clip), not the VO. They are **injected into every image prompt as the source of truth** — edit this file to change the output.

## 0. A reference IS the description — use only the reference (no invented details)
When a reference image is provided (character, product, or environment), **the reference itself is the full description of how that thing looks.** Reproduce it faithfully and add **NO extra, invented, or "unrecognized" description** on top of it — nothing that isn't actually in the reference.
- The prompt describes **only** what the reference does NOT fix: the **action, expression, framing, camera, and light** for this scene.
- It must **never** add appearance/design details for a referenced subject: for the **character**, no hair/face/skin/age/body/clothing words; for the **product**, no invented colors, parts, text, or features not visible in the reference.
- If a detail is defined by the reference, it comes 100% from the reference — describing it in words only makes the model drift away from the reference.
- **ONE exception — wardrobe/modesty (see 3c):** she must ALWAYS wear a simple casual top. If the character reference is cropped at the shoulders or bare, still put her in a top — never reproduce bare shoulders/chest.
Reproduce the product's REAL design, shape, color and proportions faithfully from the reference so it looks like the actual product — NOT a generic unbranded blob. Its identity must be recognizable.

BUT it is **never** a clean, readable hero shot — that's what kills the DM:
- **DO NOT hold the product up centered, facing the camera, with its label readable.** No catalog / "presenting the product to camera" shot. This is the #1 mistake.
- Keep it **secondary and at a natural distance** — held low or to the side, in the middle of being applied/used, partially cropped, angled, or turned — so the viewer **recognizes the product's shape and brand at a glance but CANNOT read the full label** off the screen.
- The **person / skin / reaction / result is the subject**; the product supports the moment, it isn't the moment.
- The brand mark may be *glimpsed*, but the full label/text is NOT presented legible to the camera.

Sweet spot: instantly recognizable as the real product, yet the viewer still has to comment / DM to get the link.

## 2. Text
- Reproduce the product's real design from the reference — but frame it (angle / crop / distance) so the label does **NOT** read as clean legible text to the camera.
- **No overlay captions, subtitles, or added on-screen text.**
- **No random or garbled signage / paragraph text** on background objects.

## 3. The person (creator)
- Do **NOT** specify ethnicity, nationality, or regional features. Keep the person neutral.
- If a **character reference** is provided, the person is EXACTLY that individual — describe only action / pose / expression, never appearance.
- **HAIR LOCK:** when a character reference exists, keep her **hairstyle EXACTLY as the reference** (same length, cut, parting, color, texture). **Never describe the hair in words** ("unstyled", "hair down", "natural hair", "tousled" …) — any hair wording makes the model restyle it and it stops matching the reference. Hair comes 100% from the reference photo, nothing else.
- If **no** character reference, keep **one consistent look** across every shot (same young woman, same hair, same face) — she must NOT change scene to scene.

## 3b. Hands & gesture
- The product is held in **ONE hand**; the **OTHER hand stays free** to gesture naturally — do not use both hands to clutch/present the product.
- The finger-point-down + "welcoming, happy, satisfied" smile is **EXCLUSIVELY the final CTA scene** (the last shot). Only there: hold the product in one hand and **point a single finger DOWN** toward the lower frame (the on-screen link/comment area).
- **In every OTHER scene: do NOT point down and do NOT do any CTA / call-to-action gesture.** Use a natural gesture that fits THAT beat (applying, examining, reacting) — the pointing-down pose must never appear in a hook, problem, or middle scene.

## 3c. Wardrobe (stick with the reference)
- Her outfit is **whatever the character reference wears** (e.g. a **spa / skincare towel wrap** — that's correct). Do NOT invent, swap, or change it to a t-shirt or any other garment. Only use a different outfit if the creator has **explicitly asked** for a specific wardrobe — until then, stick with the reference.
- Keep the **SAME outfit in every scene and in both the start and end frame** — identical for continuity.
- Only floor: no **explicit nudity** (no exposed chest/breasts, topless). A towel or spa wrap that covers the chest is perfectly fine.

## 4. Emotion & beat — ONE frozen expression, not a sequence
- Render **this scene's** emotion / expression (provided per scene), in the creator's **persona register** — do NOT default every shot to the same expression (e.g. the same skeptical squint on every frame).
- Describe **ONE frozen facial expression — a single held instant.** A still can only show one moment, so **never write a sequence of movements**: no "gaze drifts up **then returns**", no "mouth **settling into** a wry turn". Those average out into a generic soft face. Describe it as a static held pose: e.g. ✅ "one brow slightly raised, a small wry half-smile held" (not "her eyes drift then return").
- **Which instant to freeze depends on the image's FRAME ROLE** (a clip renders motion between a start frame and an end frame):
  - **start frame** = the ONSET of the beat — the reaction just beginning (first flicker of doubt, gaze just landing, mouth about to move).
  - **end frame** = the RESOLVED / peak moment — the settled payoff look (the "oh, that's why", the earned half-smile).
  - The two frames are the two ends of the SAME micro-reaction, so the clip can animate smoothly between them. If a scene has only one frame, freeze the resolved/peak.
- The emotion must match the beat: a doubt beat reads as doubt, a value-reveal reads as a small realization, the CTA reads as warm/inviting.
- **Show, don't tell:** only what the camera literally sees (subject, setting, action, framing, light) — no emotional narration ("quiet triumph", "relief").

## 5. NEVER show a phone / camera / recording device
"Selfie", "UGC", "front camera", "mirror", "phone held at chest height / angled up" and similar describe the **camera PERSPECTIVE only** (a first-person, arm's-length POV) — they are NOT a phone or camera held in the shot. **Never render a phone, camera, tripod, or any recording device in frame, and never show her holding a phone.** If a shot note mentions a phone or selfie angle, treat it purely as the camera position and show her face / hands / the product — no device. Her hands hold the product or gesture, never a phone.

## 6. Framing
- Ground the shot in this scene's Title + VO — not a generic "product beautifully placed, problem solved" beauty shot.
- Depict the product at its TRUE real-world size.
- Vary framing / angle / distance per scene (the shot type is provided) — no two shots share the same composition or setting.
- Tone stays clean and light (never distressing); a tension beat reads as tension, not the solved finale.
