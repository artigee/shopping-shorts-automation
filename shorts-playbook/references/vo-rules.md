# VO Rules

The voiceover is the product. The structure is interchangeable; the voice is what makes a re-skinned short original instead of a clone. Treat the VO with more care than anything else in the pipeline.

## Rule 1 — React, don't narrate

The caption states the claim or spec. The VO must do something the caption *can't*: reaction, the mechanism "aha," sensory texture, or a personal stake.

**Test:** Delete the VO line. If the caption still delivers the same information, the VO failed. Rewrite it.

- ❌ Caption "Pour. Snap. One button." / VO "Pour in your cream base, snap the lid, and press one button." (narrates — adds nothing)
- ✅ Caption "Pour. Snap. One button." / VO "Cream in, lid on, and… that's the part where I kept waiting for it to get hard." (reacts — adds the feeling)

## Rule 1.5 — Spoken TO the viewer (actor → viewer, not a diary)
The VO is an actor on camera talking to ONE person: the viewer. It is a conversation, not narration into the void.
- "you/your" shows up naturally and early — the viewer's skin, their routine, their doubt.
- Anticipate and react to what the viewer is thinking ("I know what you're thinking — another cream." / "You've done this too, right?").
- Questions and small commands to the viewer are welcome ("look at the texture", "wait for it").
- ❌ Inner-diary: "Every routine I looked into had it. I went and checked."  (talking to herself)
- ✅ To-viewer: "You've seen this cream everywhere too, right? I finally checked why."

## Rule 1.7 — The chosen SPEAKING STYLE owns the cadence
말투·어감·pace의 다양성이 우선이다. The vo-style (punchy_short / flowing_conversational / story_driven / quickfire_hype / calm_authority / confiding_friend …) decides rhythm, sentence length, and energy — generic rhythm advice is only the fallback when no style is set.
- story_driven or flowing_conversational may have ZERO clipped fragments — long, warm, connected sentences are correct for them.
- quickfire_hype / punchy_short lean hard into fragments.
- Two scripts with different styles must NOT sound like the same person. If every generation converges on the same clipped deadpan cadence, the style is being ignored — that is a failure.

## Rule 2 — Continuous monologue first, THEN split

Write the full-duration VO as one person thinking out loud — a single flowing thought across the whole video. Use connective tissue ("but," "and then," "so," "this is where…") so it reads as continuous speech. Only after it sounds like one human talking do you split it onto the beats.

Writing VO beat-by-beat is what produces choppy, flat, caption-narrating output. This ordering is the single most important rule in the skill.

## Rule 3 — The energy arc

The lines are not flat equal beats. They escalate along an emotional arc. A reliable default:

`disbelief → mechanism reveal → anti-climax / "that's it?" → earned payoff → casual close`

Each line sits at a different energy level. If every line is the same pitch of excited, it reads as generic hype.

## Rule 4 — Specificity is the anti-generic lever

Generic scripts have no point of view, so they can't produce specifics. Concrete, personal, slightly odd detail is what generic output never invents.

- ❌ "It's thick, creamy, way better than store-bought."
- ✅ "Scoops clean, tastes like the real thing, not sad frozen milk."
- ❌ "Add your favorite toppings."
- ✅ "Throw in whatever you've got. I did strawberries."

Numbers, named choices ("I did strawberries"), and small confessions ("I timed it, because of course I did") carry the voice.

## Rule 5 — Obey the ban-list

Never emit a line containing a phrase in `data/banlist.txt`. These are the LLM-creator default vocabulary — the instant generic tell. This is enforced by `scripts/check_vo.py`, not left to judgment.

## Rule 6 — Author natively in US English

VO is written in US English from the start, never translated from working notes. Translation flattens persona, idiom, and rhythm. If the teardown/analysis was done in another language, that's internal scaffolding only — the VO is composed fresh in English. See `english-style.md`.
