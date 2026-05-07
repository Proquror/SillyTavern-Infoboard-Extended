# Infoboard for SillyTavern - Extended

A state-aware XML infoboard extension for **SillyTavern**.

It injects a prompt, parses structured scene data from assistant replies, stores per-chat state, and renders a styled scene/relationship panel.

Built for roleplay, long scenes, and NPC-heavy chats.

---

## KanonMama's Original Features

- built-in prompt injection
- per-chat state memory
- XML infoboard parsing
- NPC scene tracking
- NPC mood and presence tags
- manual NPC pinning for crowded scenes
- relationship meters with **-100 to 100** range
- positive and negative affection / trust / love
- private NPC thoughts stored in `<thk>`
- optional NSFW context
- raw XML hiding from visible messages
- safer leaked-thought cleanup
- RU / EN language switch
- multiple themes
- multiple bar styles
- full / compact / collapsed panel modes
- pinned NPCs stay on top in character and relationship lists.
- relationship  filters: Top 1 / Top 3 / Changed only / All
- inline / floating / both display modes
- draggable and resizable floating infoboard
- debug XML viewer
- export / import state
- custom CSS overrides

### Added/Reworked Features

- infoboard's `kSystemPrompt` rework
- `tagsRaw` limit `4 -> 6`
- added `age plate` near NPCs names
- the `presence` is now defined and stored in a separate `presence=""`, not in `tags`
  - this is so because AI'd sometimes generate `gone for work` tag instead of `left`
- pins rework (gotta test more)
  - pinned NPCs will be injected
  - AI will track what they think while being away from User (hopefully without meta-gaming, check prompt)
  - added pop-up for pinned NPCs due to pins being stored locally for _ALL_ chats (so now you can un-pin them for other chats)
- **IMPORTANT:** prompt injection via `{{InfoBoard}}` macro ONLY
  - it allows you to place infoboard almost anywhere you want in the `context`
  - but I think you should encase `{{InfoBoard}}` in some kind of `<post_lore></post_lore>` tags that are separate from your char history and its tags (if you have any)
  - hopefully it should help AI avoid writing User's actions (not sure, gotta test)

### TODO
- rewrite pin logic, make them stored for each chat separately

---

## Installation

Install it like a regular **SillyTavern third-party extension**.

Folder name:

```
SillyTavern-Infoboard
```

*After installation, reload extensions/resources and enable Infoboard in the Extensions menu.*

## What it tracks

- time
- date
- weather
- location
- NPCs in scene
- NPC mood / presence
- NPC → user relationships
- NPC private thoughts
- optional NSFW context

---

## Relationship scale

Values use range:

```
-100 ... 0 ... 100
Affection

positive → affection
negative → aversion
Trust

positive → trust
negative → distrust
Love

positive → love
negative → hatred / destructive attachment
```

## Display modes

*Infoboard supports:*

- Inline — render panels under messages
- Floating — show the latest state in a floating window
- Both — use both modes

*Panel view modes:*

- Full — full sections and meters
- Compact — short stat chips
- Collapsed — minimal placeholder

## Settings

*Infoboard includes:*

- enable / disable toggle
- language switch
- theme selector
- bar style selector
- compact mode selector
- display mode selector
- stat hover effects toggle
- hide raw XML
- leaked-thought cleanup toggle
- show NSFW toggle
- reset state
- reprocess chat
- export / import state
- custom CSS overrides
- Custom CSS

## You can override the design without editing extension files.

*Example:*

```
.ib-board {
  border-radius: 20px;
}

.ib-theme-nocturne {
  --ib-bg-1: #101522;
  --ib-bg-2: #182033;
  --ib-bg-3: #0d1320;
}

.ib-bars-deep .ib-bar-love-pos {
  background: linear-gradient(90deg, #d08bff, #7c38ff);
}
```
