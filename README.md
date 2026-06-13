# Infoboard for SillyTavern — Extended

**v2.5.0**

A state-aware XML infoboard extension for **SillyTavern**.

It injects a prompt, parses structured scene data from assistant replies, stores per-chat state, and renders a styled scene/relationship panel.

Built for roleplay, long scenes, and NPC-heavy chats.

**⚠️ Requires SillyTavern 1.12+. ⚠️**

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
- pinned NPCs stay on top in character and relationship lists
- relationship filters: Top 1 / Top 3 / Changed only / All
- inline / floating display modes
- draggable and resizable floating infoboard
- debug XML viewer
- export / import state
- custom CSS overrides

## Extended Features

- structured `<infoboard_rules>` prompt with 7 presence levels
- NPC age attribute
- 6 tags per NPC (up from 4)
- strict anti-user-action and anti-echo directives
- three-tier pin system (Per-Chat / Per-Character / Global) with snapshots
- expandable pins popup with `Pin Here` transfer option and `go to` navigation arrow
- additional status classifications (Positive / Neutral)
- relationship timeline with zoom, milestones, and persistence
- toast notifications for relationship changes and pin actions
- inline settings popup from the board toolbar
- resizable side panel mode (left or right)
- amount of rendered `inline` infoboards can be changed manually in options (default 5)
- macro prompt injection (`{{InfoBoard}}` / `{{IB}}`)
- configurable injection position and depth for autoinject
- themes and options accessible via toolbar buttons
- debug XML editor
- improved export / import
- swipe / regeneration state preservation
- chunked inline board rendering for long chats

### Prompt System

| Original | Extended |
|---|---|
| Simple auto-inject at fixed position/depth | Dual-mode: auto-inject **or** `{{InfoBoard}}`/`{{IB}}` macro placement |
| No position control | Configurable inject position: After Story String / In Chat / Before Story String |
| Fixed depth | Configurable depth (0–999) for In Chat mode |
| Prompt embedded in generation event | `power_user.experimental_macro_engine` forced on for macro support |
| No swipe awareness | Pre-swipe state preserved via `CalculateStateUpToMessage()` — correct prompt on regeneration |

The system prompt is now a structured `<infoboard_rules>` block that instructs the AI to:

- Include a `presence=""` attribute on every NPC with one of seven defined levels.
- Track offscreen pinned NPCs — they must think about their own affairs and cannot meta-game what the User is doing.
- Add `age=""` on `<c />` elements, displayed as a plate next to NPC names.
- Use up to 6 tags per NPC (up from 4).
- Never write User's actions or speech.
- Include all pinned NPCs, maintain logical progression, and never echo narrative.
- Delta range changed from −5..+5 to −2..+2.
- Thoughts must be first person, present tense.

### Presence System

| Original | Extended |
|---|---|
| 6 presence levels inferred from tags | 7 presence levels via dedicated `presence=""` attribute |
| `Array.includes()` lookup (O(n)) | `Set.has()` lookup (O(1)) with `ALL_PRESENCE_TAGS` union set |
| No offscreen concept | **`offscreen`** level added — pinned NPCs not in scene |
| Tag-based inference only | Attribute-based (primary), tag-based (deprecated fallback) |

Defined presence levels: `focus` → `active` → `near` → `watching` → `background` → `left` → `offscreen`.

### Pin System

| Original | Extended |
|---|---|
| Simple per-chat "stay on top" pin array | Three-tier registry: Per-Chat / Per-Character / Global |
| `localStorage` flat array | Structured `IB_PinRegistry` (v2) with version, snapshots, sources |
| No pin snapshots | Automatic snapshots (icon, age, tags, mood, rels, thought) on pin and update |
| No cross-chat persistence | Per-Character pins survive chat switches; Global pins survive character switches |
| Simple toggle on/off | Cycle: (unpinned) → Per-Chat → Per-Character → Global → (unpinned) |
| No pin management UI | Pins popup with radio-dot columns, `Pin Here`, `go to`, expand/collapse |
| No orphan cleanup | Auto garbage-collection for deleted characters, empty arrays, orphaned snapshots |
| No tier badges | Pin buttons display colored tier letter (`C`/`H`/`G` or `Ч`/`К`/`Г`) |
| No migration | Legacy per-chat pins auto-migrated to registry format |

### Display Modes

| Original | Extended |
|---|---|
| Dropdown: Inline / Floating / Both | Independent checkboxes: Inline / Floating / Panel |
| No panel mode | **Panel mode** — resizable side drawer (left or right), toggle + flip button |
| No board mode per context | Independent board mode defaults (Full / Compact / Collapsed) per context |
| All inline boards rendered | Configurable inline board count (1–99), older boards cleaned up only |
| No confirm/cancel for count | ✓/✗ confirm/cancel controls prevent `ReprocessChat` lag |
| Single render pass | Two-phase chunked rendering — synchronous cleanup batch + `requestAnimationFrame` chunks (8 per frame) |
| No panel flip | `⇄` flip button to swap panel side; auto-fades after 1.5 s |

### NPC Character Cards

| Original | Extended |
|---|---|
| No age display | **Age chip** parsed from `age=""` attribute |
| 4 tags per NPC | 6 tags per NPC |
| `space-between` horizontal layout | Vertical flex layout: icon → name+age+presence → tags |
| Pin button simple "stay on top" | Pin button with tier badge cycling with leveled persistance |

### Relationship Display

| Original | Extended |
|---|---|
| 4 status categories (Romantic / Complex / Negative / Neutral) | 5 categories — **Positive** added (`★` icon) |
| Hardcoded status chip colors | CSS custom properties (`--ib-st-*`) — fully themeable |
| No timeline | **Relationship timeline** — SVG polyline graph per NPC with milestones and zoom |
| No inline timeline access | Timeline button (`📈`) per relationship card |
| No change notifications | **Toast notifications** for relationship deltas above configurable threshold |
| Hardcoded mini-stat colors | 24 CSS custom properties (`--ib-ms-*`) for gradient mini-stats |

### Timeline System

Entirely new feature:

- **SVG mini-graph** — polyline chart showing affection (A), trust (T), and love (L) evolution over the chat history. Metric lines can be toggled on/off.
- **Milestone detection** — automatic marking of significant events: crossing 0, reaching ±50, reaching ±80, status changes, and sharp changes (±15 delta in a single step).
- **NPC tabs** — switch between tracked NPCs within the popup.
- **Inline timeline button** — compact button next to each relationship entry for direct access.
- **Smart tab switching** — clicking a timeline button while popup is open switches to that NPC's tab.
- **Go-to-message** — click any timeline entry or milestone to scroll to the corresponding chat message.
- **Horizontal zoom** — 1×–10× zoom via slider, ± buttons, Ctrl+scroll, pinch-zoom.
- **Clickable dots toggle** — enable/disable data-point dots on the graph.
- **Persistence** — timeline data saved to `localStorage` per chat.
- **Auto-rebuild** — rebuilt from chat history on first open if empty, capped at 200 entries.

### Notifications

Entirely new feature:

- **New character appeared** — notifies when a previously unseen NPC enters the scene.
- **Relationship change** — notifies when affection, trust, or love changes by a configurable threshold.
- **Threshold control** — adjustable from settings (3 / 5 / 10 / 20); larger changes trigger `warning`-style toasts.
- **Action toasts** — pin actions and navigation events display brief toast notifications with icons.
- **Enable/disable toggle** — notifications can be turned off entirely.

### Settings

| Original | Extended |
|---|---|
| Sidebar only | Sidebar + **Board Toolbar Popup** (⚙️ button) — bidirectional sync |
| No theme picker popup | **Visual theme popup** — grid with palette swatches, click to select |
| No inject position/depth | Macro mode toggle + inject position + depth controls |
| Single display mode dropdown | Three independent display checkboxes + per-context board modes |
| No inline board count | Inline board count (1–99) with confirm/cancel |
| No panel position | Panel side selector (left / right) |
| No notifications section | Notifications toggle + threshold selector |
| No orphan cleanup | 🧹 Clean Orphaned Snapshots button |
| Export State / Import State | **Export All / Import All** — full backup (state + settings + timeline + pin registry) |

### Debug & XML

| Original | Extended |
|---|---|
| Read-only XML viewer | **Editable XML editor** — Edit/Save/Cancel buttons; save writes back to `msg.mes` |
| Simple thought-leak cleanup | **Fallback thought-leak cleanup for broken XML** — `<thk>` caught even when main parser fails |
| Surgical DOM cleanup | **Message re-render from source** — uses ST's `messageFormatting()` for reliable cleanup |
| No HTML-entity handling | **HTML-entity-escaped XML** patterns (`&lt;infoboard`, `&lt;thk`) matched and removed |
| No XML repair | **Unclosed attribute values** (e.g. `age="55 tags="...`) auto-fixed before parsing |

### Performance

| Original | Extended |
|---|---|
| `new DOMParser()` per parse call | **Singleton `gDomParser`** — reused across all calls |
| `JSON.parse(JSON.stringify())` for cloning | **`structuredClone()`** for deep cloning |
| `Array.includes()` for presence/status lookups | **`Set.has()`** O(1) lookups |
| No alias caching | **`gAliasCache`** Map — invalidated on chat change |
| Synchronous render loop | **Chunked rendering** — 8 boards per `requestAnimationFrame` |
| Double-pass thought-leak scan | **Single-pass TreeWalker** with pre-built `softTextSet`/`fullSoftSet` |
| No render queue versioning | **`_renderQueueId`** — stale queues abandoned on new render |

### Toolbar

Original board had a simple header. Extended has a full **toolbar** with buttons:

| Button | Action |
|---|---|
| 🎨 | Theme popup |
| ⚙️ | Settings popup |
| 📍 | Pins popup |
| 🔔 | Notifications popup |
| 📈 | Timeline popup |
| 📤 | Export |
| 📥 | Import |
| `</>` | Debug XML editor |

### Themes (25, up from 18)

Nocturne · Burgundy · Ash Rose · Cold Steel · Frostwhite · Pixel Arcade · Pink Bite · Violet Glass · Verdant Grove · Sandalwood · Gengar · System Log · Terminal · Oracle Moon · Blood Moon · Case File · Obsidian Registry · Neon Quest · **Shockwave** · **Lockdown** · **Hot Rod** · Gryffindor · Slytherin · Ravenclaw · Hufflepuff

New themes: Shockwave (purple energy), Lockdown (sterile green), Hot Rod (orange/fire).

Each theme now defines 7 additional properties: `green`, `dim`, `--ib-chip-text`, and full presence/status/mini-stat CSS variables.

### Bar Styles (16, up from 13)

Classic · Deep Neon · Glass Needle · Soft Matte · Pixel Blocks · Candy Gloss · Prism Glass · Neon Rails · Terminal Segments · **Heart Meter** · Constellation Stars · **Vials** · Evidence Tape · Runic Shards · **Sigil Bands** · **Energon**

New bar styles: Heart Meter, Vials, Sigil Bands, Energon.

Bar system now supports:
- **Pattern fills** — repeating emoji/character patterns inside bar fills
- **Emoji heads** — positioned at the fill tip
- **Per-style height/radius/metric-method** configurations via `kBarStyleHeights`, `kBarStyleRadii`, `kBarStyleMetricMethod`, `kBarStyleColorSlots`

### CSS Architecture

| Original | Extended |
|---|---|
| Hardcoded colors in presence/status chips | **72 CSS custom properties** for deep theming |
| No `--ib-pres-*` variables | 21 presence chip variables per theme |
| No `--ib-st-*` variables | 15 status chip variables per theme |
| No `--ib-ms-*` variables | 24 mini-stat gradient variables per theme |
| No `--ib-delta-*` variables | 3 delta indicator variables |
| No `--ib-pin-tier-*` variables | 3 pin tier color variables |
| No `--ib-chip-text` | Per-theme chip text color |
| No `--ib-font` | Custom font family override |

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

### Inline Board Count

When inline mode is active, the number of rendered inline infoboards can be configured (1–99). The ± stepper appears next to the Inline checkbox in both the sidebar and the settings popup. Only the most recent `N` messages receive a rendered board; older messages are cleaned up but left without a board to reduce DOM weight.

Only the latest inline board shows pinned NPCs (patched data); older boards display only what the AI originally returned.

---

## Prompt

### Macro Prompt Injection

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

The pins popup (📍 button) shows all currently active pins in a structured grid with radio-dot columns (perChat / perChar / global), allowing one-click tier switching per NPC.

- **Pin Here** — pin an NPC directly into the current chat context. If the NPC is already pinned at any level, the operation is rejected to prevent duplicates.
- **Navigate to Character Card** — jump to the source character card of a pinned NPC.
- **Expanded view** — an expandable section shows pins from other chats and character cards that are not in the current context, with navigation and pin-here actions for each entry. Per-character pins display the character's display name instead of the avatar filename. The expand/collapse state is preserved across popup re-renders.

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
- **Threshold control** — adjustable from settings (3, 5, 10, 20); larger changes trigger `warning`-style toasts.
- **Action toasts** — pin actions and navigation events display brief toast notifications with icons for immediate feedback.
- **Enable/disable toggle** — notifications can be turned off entirely.

---

## Settings

Settings are available in two places:

### Extensions panel

- enable / disable toggle
- macro mode toggle with help text
- inject position and depth
- language switch (RU / EN)
- theme selector with palette preview
- bar style selector
- relationship filter (Top 1 / Top 3 / Changed only / All)
- display modes (inline / floating / panel) — independent toggles
- inline board count (1–99) — appears next to the Inline checkbox
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

Quick-access floating popup with the same controls, available directly from the board without opening the sidebar. Changes sync bidirectionally. The popup inherits the current theme's color palette.

---

## Themes (25)

Nocturne · Burgundy · Ash Rose · Cold Steel · Frostwhite · Pixel Arcade · Pink Bite · Violet Glass · Verdant Grove · Sandalwood · Gengar · System Log · Terminal · Oracle Moon · Blood Moon · Case File · Obsidian Registry · Neon Quest · Shockwave · Lockdown · Hot Rod · Gryffindor · Slytherin · Ravenclaw · Hufflepuff

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

### Key CSS variables for presence chips

```css
:root {
  --ib-pres-focus: ;
  --ib-pres-active: ;
  --ib-pres-near: ;
  --ib-pres-watch: ;
  --ib-pres-background: ;
  --ib-pres-left: ;
  --ib-pres-offscreen: ;
}
```

### Key CSS variables for mini-stats

```css
:root {
  --ib-ms-aff-pos: ;
  --ib-ms-aff-neg: ;
  --ib-ms-tr-pos: ;
  --ib-ms-tr-neg: ;
  --ib-ms-love-pos: ;
  --ib-ms-love-neg: ;
  --ib-ms-value: ;
}
```

### Key CSS variables for delta indicators

```css
:root {
  --ib-delta-pos: ;
  --ib-delta-neg: ;
  --ib-delta-zero: ;
}
```

### Key CSS variables for panel flip button

```css
.ib-panel-flip {
    /* position: absolute; top: calc(50% + 65px); */
    /* Inherits theme colors via var(--ib-bg-2), var(--ib-border), etc. */
}
```

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for a detailed history of changes.

---

## Credits

Forked from [KanonMama's original Infoboard](https://github.com/KanonMama/SillyTavern-Infoboard).
