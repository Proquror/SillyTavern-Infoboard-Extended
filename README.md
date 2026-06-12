# Infoboard for SillyTavern — Extended

**v2.2.0**

A state-aware XML infoboard extension for **SillyTavern**.

It injects a prompt, parses structured scene data from assistant replies, stores per-chat state, and renders a styled scene/relationship panel.

Built for roleplay, long scenes, and NPC-heavy chats.

**Requires SillyTavern 1.12+.**

---

## KanonMama's Original Features

- built-in prompt injection
- per-chat state memory
- XML infoboard parsing
- NPC scene tracking
- NPC mood and presence tags
- manual NPC pinning for crowded scenes
- relationship meters with **−100 to 100** range
- positive and negative affection / trust / love
- private NPC thoughts stored in `<thk>`
- optional NSFW context
- raw XML hiding from visible messages
- safer leaked-thought cleanup
- RU / EN language switch
- 25 themes
- 16 bar styles
- full / compact / collapsed panel modes
- pinned NPCs stay on top in character and relationship lists
- relationship filters: Top 1 / Top 3 / Changed only / All
- inline / floating display modes
- draggable and resizable floating infoboard
- debug XML viewer
- export / import state
- custom CSS overrides

## Extended Features

- amount of rendered inline infoboards can be chaged in options
- structured `<infoboard_rules>` prompt with 7 presence levels
- NPC age attribute
- 6 tags per NPC (up from 4)
- strict anti-user-action and anti-echo directives
- three-tier pin system (Per-Chat / Per-Character / Global) with snapshots
- - expandable pins popup with `Pin Here` transfer option and `go to` navigation arrow
- additional status classifications (Positive / Neutral)
- relationship timeline with zoom, milestones, and persistence
- toast notifications for relationship changes and pin actions
- inline settings popup from the board toolbar
- resizable side panel mode (left or right)
- macro prompt injection (`{{InfoBoard}}` / `{{IB}}`)
- configurable injection position and depth for autoinject
- themes and options are now accessible via toolbar buttons
- debug XML editor
- improved export / import

---

## Installation

Install it like a regular **SillyTavern third-party extension**.

Folder name:

```
SillyTavern-Infoboard-Extended
```

*After installation, reload extensions/resources and enable Infoboard in the Extensions menu.*

---

## What it tracks

- time
- date
- weather
- location
- NPCs in scene
- NPC mood / presence
- NPC age
- NPC → user relationships (affection / trust / love)
- NPC private thoughts
- optional NSFW context
- relationship timeline (per-NPC, per-chat)

---

## Relationship scale

Values use range:

```
-100 ... 0 ... +100

Affection:  positive → affection  |  negative → aversion
Trust:      positive → trust      |  negative → distrust
Love:       positive → love       |  negative → hatred / destructive attachment
```

Per-message change is typically within −2..+2 unless a major event occurs.

---

## Display modes

Infoboard supports three display contexts:

| Mode | Description |
|---|---|
| **Inline** | Render panels under messages in the chat |
| **Floating** | Show the latest state in a draggable floating window |
| **Panel** | Resizable side panel (left or right), always accessible |

Each context has an independent board mode:

| Board mode | Description |
|---|---|
| **Full** | All sections, meters, and details |
| **Compact** | Short stat chips for quick overview |
| **Collapsed** | Minimal placeholder — click to expand |

---

## Prompt

The system prompt is a structured `<infoboard_rules>` block that instructs the AI to:

- Include a `presence=""` attribute on every NPC with one of seven defined levels: `focus`, `active`, `near`, `watching`, `background`, `left`, `offscreen`.
- Track offscreen pinned NPCs — they must think about their own affairs and cannot meta-game what the User is doing.
- Add `age=""` on `<c />` elements, displayed as a plate next to NPC names.
- Use up to 6 tags per NPC.
- Never write User's actions or speech.
- Include all pinned NPCs, maintain logical progression, and never echo narrative.

### ⚠️ Macro Prompt Injection ⚠️ — SillyTavern 1.12+ ONLY

Prompt injection can use the `{{InfoBoard}}` or `{{IB}}` macro instead of auto-inject. When enabled, the prompt is only injected where the macro appears in the system prompt.

- Place `{{InfoBoard}}` or `{{IB}}` inside `<post_lore></post_lore>` tags or similar wrapper inside your prompts.
- This allows manual prompt placement and helps the AI focus on the infoboard data as reference material rather than treating it as narrative to continue.
- When disabled, the macro still registers but returns empty — enabling it is optional.

### Injection Position and Depth

- **Position**: After Story String / In Chat (default) / Before Story String.
- **Depth** (In Chat only): `0` = last message in context; higher = further up in history. Range 0–999.

---

## Pin Tiers

NPCs can be pinned at three scope levels, resolved with priority **Global > Per-Character > Per-Chat**:

| Tier | Scope | Behavior |
|---|---|---|
| **Per-Chat** | Current chat only | NPC is injected into the state for this specific chat |
| **Per-Character** | All chats with this character card | NPC persists across different chats with the same character |
| **Global** | Every chat, every character | NPC is always injected regardless of context |

### How pinning works

Clicking the pin button cycles through tiers:

```
(unpinned) → Per-Chat → Per-Character → Global → (unpinned)
```

If the same NPC is pinned at multiple tiers, the highest tier takes priority.

Pin buttons display a small colored tier letter badge (`C`/`H`/`G` in English, `Ч`/`К`/`Г` in Russian) in the bottom-right corner for instant visual feedback.

### Pins Popup

The pins popup (📌 button) shows all currently active pins in a structured grid with radio-dot columns (perChat / perChar / global), allowing one-click tier switching per NPC.

- **Pin Here** — pin an NPC directly into the current chat context. If the NPC is already pinned at any level, the operation is rejected to prevent duplicates.
- **Navigate to Character Card** — jump to the source character card of a pinned NPC.
- **Expanded view** — an expandable section shows pins from other chats and character cards that are not in the current context, with navigation and pin-here actions for each entry.

### Pin Snapshots

When an NPC is pinned, a snapshot of their current state is saved automatically. This snapshot includes their icon, age, tags, mood, relation values, and private thought. Snapshots are used when:

- The NPC is not present in the current chat (injected as `offscreen, pinned`)
- The NPC appears in panel/floating board across chat switches
- Prompt injection needs accurate data for a cross-chat pinned NPC

Snapshots update automatically whenever the NPC is present in the active chat. They are removed only when the pin is completely deleted.

### Pin Registry

All pin data is stored in a single structured `IB_PinRegistry` object in `localStorage`:

```json
{
  "version": 2,
  "global": ["NPC Name"],
  "characters": {
    "avatar.png": { "name": "Character Name", "pins": ["NPC Name"] }
  },
  "chats": {
    "chat_id": ["NPC Name"]
  },
  "pinSnapshots": { ... },
  "pinSources": { ... }
}
```

The registry is:

- **Exported/imported fully** — backup and restore includes the complete pin registry alongside all other data.
- **Auto-migrated** — legacy per-chat pins are converted into `perChat` tier entries automatically.
- **Garbage-collected** — character entries whose avatars no longer exist, empty chat pin arrays, and orphaned snapshots are cleaned up automatically.
- **Orphan cleanup** — a 🧹 button in settings removes snapshot data for NPCs that are no longer pinned anywhere.

---

## Status Classification

Relationship statuses are semantically categorized into five groups with distinct colors and icons:

| Category | Icon | Examples |
|---|---|---|
| **Romantic** | ♥ | in love, devoted, obsessed |
| **Positive** | ★ | friendly, trusting, loyal |
| **Complex** | ✦ | conflicted, ambiguous, uncertain |
| **Negative** | ⚠ | hostile, distrustful, hateful |
| **Neutral** | • | indifferent, stranger, unknown |

Classification uses language-aware keyword matching (RU + EN). Colors are defined via CSS custom properties (`--ib-st-romantic`, `--ib-st-positive`, etc.) and adapt to the active theme.

---

## Relationship Timeline

Per-NPC relationship tracking over time with a dedicated popup:

- **SVG mini-graph** — polyline chart showing affection (A), trust (T), and love (L) evolution over the chat history. Metric lines can be toggled on/off.
- **Milestone detection** — automatic marking of significant events: crossing 0, reaching ±50, reaching ±80, status changes, and sharp changes (±15 delta in a single step).
- **NPC tabs** — switch between tracked NPCs within the popup.
- **Inline timeline button** — compact button next to each relationship entry for direct access to that NPC's timeline.
- **Smart tab switching** — clicking a timeline button while the popup is open switches to that NPC's tab instead of closing the popup.
- **Go-to-message** — click any timeline entry or milestone to scroll to the corresponding chat message.
- **Horizontal zoom** — 1×–10× zoom for inspecting dense data regions. A magnifier button toggles a slider panel; +/− buttons step by 0.5×. Ctrl+mouse-wheel zooms toward cursor on PC; pinch-zoom is supported on touch devices.
- **Clickable dots toggle** — a "Dots" checkbox in the legend area enables/disables the data-point dots on the graph (default: on). Disabling dots simplifies the graph at high zoom levels.
- **Persistence** — timeline data is saved to `localStorage` per chat and survives page reloads and browser restarts.
- **Auto-rebuild** — timeline is rebuilt from chat history on first open if empty, capped at 200 entries.

---

## Notifications

Toast-style notifications for relationship changes and pin actions:

- **New character appeared** — notifies when a previously unseen NPC enters the scene.
- **Relationship change** — notifies when affection, trust, or love changes by a configurable threshold.
- **Threshold control** — adjustable from settings; larger changes trigger `warning`-style toasts.
- **Action toasts** — pin actions and navigation events display brief toast notifications with icons for immediate feedback.
- **Enable/disable toggle** — notifications can be turned off entirely.

---

## Settings

Settings are available in two places:

### Sidebar (Extensions panel)

- enable / disable toggle
- macro mode toggle with help text
- inject position and depth
- language switch (RU / EN)
- theme selector with palette preview
- bar style selector
- relationship filter (Top 1 / Top 3 / Changed only / All)
- display modes (inline / floating / panel) — independent toggles
- per-mode board mode defaults
- panel position (left / right)
- stat hover effects toggle
- hide raw XML from messages
- leaked-thought cleanup toggle
- show NSFW toggle
- notifications toggle with configurable threshold
- reset state / reprocess chat
- export / import full backup
- custom CSS overrides

### Board Toolbar Popup (⚙️ button)

Quick-access floating popup with the same controls, available directly from the board without scrolling to the sidebar. Changes sync bidirectionally. The popup inherits the current theme's color palette.

---

## Themes (25)

Nocturne · Burgundy · Ash Rose · Cold Steel · Frostwhite · Pixel Arcade · Pink Bite · Violet Glass · Verdant Grove · Sandalwood · Gengar · System Log · Terminal · Oracle Moon · Blood Moon · Case File · Obsidian Registry · Neon Quest · Gryffindor · Slytherin · Ravenclaw · Hufflepuff · Shockwave · Lockdown · Hot Rod

## Bar Styles (16)

Classic · Deep Neon · Glass Needle · Soft Matte · Pixel Blocks · Candy Gloss · Prism Glass · Neon Rails · Terminal Segments · Heart Meter · Constellation Stars · Vials · Evidence Tape · Runic Shards · Sigil Bands · Energon

---

## Custom CSS

You can override the design without editing extension files.

*Example:*

```css
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

### Key CSS variables for pin tiers

```css
:root {
  --ib-pin-tier-1: <per-chat color>;
  --ib-pin-tier-2: <per-character color>;
  --ib-pin-tier-3: <global color>;
}
```

### Key CSS variables for status chips

```css
:root {
  --ib-st-romantic: ;
  --ib-st-positive: ;
  --ib-st-complex: ;
  --ib-st-negative: ;
  --ib-st-neutral: ;
}
```

---

## Credits

Forked from [KanonMama's original Infoboard](https://github.com/KanonMama/SillyTavern-Infoboard).