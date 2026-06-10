# Infoboard for SillyTavern — Extended

**v2.1.0**

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
- relationship meters with **−100 to 100** range
- positive and negative affection / trust / love
- private NPC thoughts stored in `<thk>`
- optional NSFW context
- raw XML hiding from visible messages
- safer leaked-thought cleanup
- RU / EN language switch
- multiple themes
- multiple bar styles
- full / compact / collapsed panel modes
- pinned NPCs stay on top in character and relationship lists
- relationship filters: Top 1 / Top 3 / Changed only / All
- inline / floating display modes
- draggable and resizable floating infoboard
- debug XML viewer
- export / import state
- custom CSS overrides

---

## Installation

Install it like a regular **SillyTavern third-party extension**.

Folder name:

```
SillyTavern-Infoboard-Extended
```

*After installation, reload extensions/resources and enable Infoboard in the Extensions menu.*

---

## Extended Features

### System Prompt Rework

The `kSystemPrompt` was completely rewritten into `<infoboard_rules>` — a structured rules block inside the prompt that defines:

- **Presence keywords** as a first-class `presence=""` attribute (no longer mixed into `tags`). Seven defined levels: `focus`, `active`, `near`, `watching`, `background`, `left`, `offscreen`.
- **Offscreen NPCs** — pinned NPCs that left the scene are tracked with their own presence value. They must think about their own affairs and cannot meta-game what the User is doing.
- **Age attribute** — `age=""` on `<c />` elements, displayed as a plate next to NPC names.
- **Tag limit** increased from 4 to 6.
- **Strict anti-user-action rules** — the prompt explicitly forbids writing User's actions or speech.
- **CRITICAL directives** for including all pinned NPCs, maintaining logical progression, and never echoing narrative.

### Three-Tier Pin System

NPCs can now be pinned at three distinct scope levels, resolved with priority **Global > Per-Character > Per-Chat**:

| Tier | Scope | Behavior |
|---|---|---|
| **Per-Chat** | Current chat only | NPC is injected into the state for this specific chat |
| **Per-Character** | All chats with this character card | NPC persists across different chats with the same character |
| **Global** | Every chat, every character | NPC is always injected regardless of context |

- **Pin toggle cycles through tiers**: clicking the pin button cycles `null → perChat → perChar → global → null`. Tooltips update contextually to indicate the next action.
- **Tier badge indicators**: pin buttons display a small colored tier letter badge (`C`/`H`/`G` in English, `Ч`/`К`/`Г` in Russian) in the bottom-right corner for instant visual feedback.
- **Tier radio table in pins popup**: the pins popup is a structured grid with three radio-dot columns (perChat / perChar / global), allowing one-click tier switching per NPC.

### Pin Registry Architecture

All pin data is stored in a single structured `IB_PinRegistry` object in `localStorage`:

```json
{
  "version": 1,
  "global": ["NPC Name"],
  "characters": {
    "avatar.png": { "name": "Character Name", "pins": ["NPC Name"] }
  },
  "chats": {
    "chat_id": ["NPC Name"]
  }
}
```

This replaces the previous per-chat flat-array model (`IB_PinnedNpcs_<chatId>`). The registry is:

- **Exported/imported fully** — backup and restore includes the complete pin registry alongside all other data.
- **Auto-migrated** — `MigrateOldPinsToRegistry()` converts legacy per-chat pins into `perChat` tier entries on chat change and initialization.
- **Garbage-collected** — `CleanPinRegistry()` removes character entries whose avatars no longer exist and prunes empty chat pin arrays.

### Relationship Timeline

Per-NPC relationship tracking over time with a dedicated popup:

- **SVG mini-graph** — polyline chart showing affection (A), trust (T), and love (L) evolution over the chat history. Metric lines can be toggled on/off.
- **Milestone detection** — automatic marking of significant events: crossing 0, reaching ±50, reaching ±80, and status changes.
- **NPC tabs** — switch between tracked NPCs within the popup.
- **Inline timeline button** — compact button next to each relationship entry for direct access to that NPC's timeline.
- **Smart tab switching** — clicking a timeline button while the popup is open switches to that NPC's tab instead of closing the popup.
- **Go-to-message** — click any timeline entry or milestone to scroll to the corresponding chat message.
- **Auto-rebuild** — timeline is rebuilt from chat history on first open if empty, capped at 200 entries.

### Panel Mode

A third display mode alongside inline and floating:

- **Side panel** — renders the infoboard as a resizable side panel (left or right), always accessible without scrolling through messages.
- **Drag-to-resize** — grab the panel edge to resize between 280px and 600px.
- **Toggle button** — slides with the panel, auto-hides on narrow screens after idle.
- **Per-mode board modes** — independent full/compact/collapsed defaults for inline, floating, and panel contexts.
- **Mobile-friendly** — toggle button fades out on idle for screens ≤760px wide.

### Notifications

Toast-style notifications for relationship changes:

- **New character appeared** — notifies when a previously unseen NPC enters the scene.
- **Relationship change** — notifies when affection, trust, or love changes by a configurable threshold.
- **Threshold control** — adjustable from settings; larger changes trigger `warning`-style toasts.
- **Enable/disable toggle** — notifications can be turned off entirely.

### Dynamic Extension Path

The extension folder path is now auto-detected from `document.currentScript.src` via `gExtUrlPath`, making the extension portable across different installation directories (third-party, default-user, custom) without hardcoded paths.

### ⚠️ Macro Prompt Injection ⚠️ - SillyTavern 1.12+ ONLY

Prompt injection uses the `{{InfoBoard}}` or `{{IB}}` macro exclusively. This allows placing the infoboard state almost anywhere in the context:

- Place `{{InfoBoard}}` or `{{IB}}` inside `<post_lore></post_lore>` tags or similar wrapper inside your prompts.
- This allows manual prompt placement and helps the AI focus on the infoboard data as reference material rather than treating it as narrative to continue.
- Requires SillyTavern 1.12+ macro system (optional import, gracefully skipped if unavailable).

### Other Changes

- **Pre-swipe state protection** — during swipe/regeneration, the previously parsed state is preserved for prompt injection instead of being cleared.
- **Nocturne theme** pin icon changed from `★` to `☪︎`; Burgundy theme received custom pin icons (`●` / `❣︎`).
- **Terminal and Lockdown themes** — tier-3 pin color override using `--ib-danger` instead of green for readable badges.
- **Settings export format v3** — full backup includes state, settings, timeline, pinnedNpcs (legacy), and pinRegistry (new). Import performs two-stage restoration with legacy migration.
- **Debug XML editor** — editable textarea for raw XML with save/cancel, improved sizing with `box-sizing: border-box`.
- **New themes**: Shockwave (violet techno), Lockdown (gray steel + green neon), Hot Rod (black + fire).

### New Themes (total: 22)

Nocturne · Burgundy · Ash Rose · Cold Steel · Frostwhite · Pixel Arcade · Pink Bite · Violet Glass · Verdant Grove · Sandalwood · Gengar · System Log · Terminal · Oracle Moon · Blood Moon · Case File · Obsidian Registry · Neon Quest · Gryffindor · Slytherin · Ravenclaw · Hufflepuff · Shockwave · Lockdown · Hot Rod

### Bar Styles (total: 16)

Classic · Deep Neon · Glass Needle · Soft Matte · Pixel Blocks · Candy Gloss · Prism Glass · Neon Rails · Terminal Segments · Heart Meter · Constellation Stars · Vials · Evidence Tape · Runic Shards · Sigil Bands · Energon

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

## Pin Tiers Explained

When you pin an NPC, the pin button cycles through tiers:

```
(unpinned) → Per-Chat → Per-Character → Global → (unpinned)
```

**Resolution priority**: Global → Per-Character → Per-Chat

An NPC pinned at Global level will appear in the injected state for every chat with every character. An NPC pinned at Per-Chat level only appears in the current chat. If the same NPC is pinned at multiple tiers, the highest tier takes priority.

The pins popup (📌 button) shows all currently active pins in a table with radio-dot columns, letting you switch tiers or remove pins with one click.

---

## Settings

- enable / disable toggle
- language switch (RU / EN)
- theme selector with palette preview
- bar style selector
- relationship filter (Top 1 / Top 3 / Changed only / All)
- display modes (inline / floating / panel) — independent toggles
- panel position (left / right) and width
- default board mode per display context (full / compact / collapsed)
- stat hover effects toggle
- hide raw XML from messages
- leaked-thought cleanup toggle
- show NSFW toggle
- notifications toggle with configurable threshold
- reset state / reprocess chat
- export / import full backup (v3 format)
- custom CSS overrides

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

---

## Upgrade from 2.0.0

Upgrading is seamless — no manual steps required:

1. Legacy per-chat pins (`IB_PinnedNpcs_<chatId>`) are automatically migrated to the new registry as `perChat` tier entries on first chat change.
2. The old `ib_pin_storage_mode` dropdown is removed — tier selection is now handled via the cycling button and the pins popup radio table.
3. All existing settings, themes, and states are preserved.
4. Export format is now v3 (backward-compatible — v1/v2 imports still work).
