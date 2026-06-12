# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] — 2025-06-12

### Added

- **Configurable inline board count** — choose how many inline infoboards (1–99) are rendered in chat, with ± stepper buttons in both sidebar and settings popup. Older messages beyond the limit are cleaned up but not rendered, reducing DOM weight in long chats.
- **Confirm/cancel controls for inline board count** — ✓/✗ buttons appear next to the count field when the value changes (manual input, +, or −). Pressing ✓ applies the new value and triggers `ReprocessChat`; pressing ✗ reverts to the last applied value. This prevents UI lag from reprocessing on every keystroke or button click. Available in both sidebar and settings popup.
- **Panel flip-side button** — a small `⇄` button on the panel edge that instantly moves the panel to the opposite side of the screen. The button auto-fades after 1.5 s of inactivity (like the existing panel toggle) and reappears on hover/touch.
- **Two-phase chunked rendering** — `ReprocessChat` now separates state computation (Phase 1, sync) from DOM manipulation (Phase 2). Cleanup runs as a single synchronous batch before any boards are rendered, eliminating cumulative layout shifts from "raw XML visible → removed" per-message shifts. Inline boards are rendered in reverse order (newest first) via `requestAnimationFrame` chunks of 8, so the visible area updates before off-screen messages.
- **Fallback thought-leak cleanup for broken XML** — new `ExtractRawThoughts()` and `RemoveLeakedThoughtsFromBrokenXml()` functions catch leaked `<thk>` content even when the main XML parser fails, using simple text matching as a fallback.
- **Character name resolution in pins popup** — per-character pins now display the character's display name (e.g. "Komac") instead of the raw avatar key ("Komac.png"), resolved via `GetCharNameByKey()`.
- **Pins popup expand/collapse state preservation** — the "other pins" section no longer collapses when the popup re-renders; its expanded/collapsed state is preserved across updates.
- **Localization strings for new features** — `panelFlipSide` ("Move to other side" / "Переместить на другую сторону") and `inlineBoardCount` ("Board count" / "Кол-во борд") added for both EN and RU.

### Changed

- **`structuredClone` replaces `JSON.parse(JSON.stringify())`** throughout the codebase — faster and more correct deep cloning for state objects, rolling states, and default state copies.
- **`RelsEqual()` replaces `JSON.stringify` comparison** for timeline rel arrays — direct field-by-field comparison (`source`, `a`, `tr`, `l`, `status`) is both faster and semantically correct (field order is irrelevant).
- **O(1) presence detection** — presence tag matching now uses pre-built `Set` objects (`PRESENCE_SET_FOCUS`, etc.) and a union `ALL_PRESENCE_TAGS` Set instead of `Array.includes()` / `.some()` scans. Presence attribute mapping is extracted into an immutable module constant `PRESENCE_ATTR_MAP`.
- **Singleton `DOMParser`** — one `gDomParser` instance is created at module load and reused across all `ParseInfoboardXml()` and NSFW parsing calls, eliminating per-call object allocation.
- **Alias name cache** — `GetNameAliases()` results are cached in `gAliasCache` (a `Map`) and invalidated on chat change via `InvalidateAliasCache()`, avoiding redundant SillyTavern API lookups during reprocess.
- **O(1) thought-leak fast path** — `RemoveThoughtLeaksInContainer()` now builds `Set`-based lookup tables for exact-match checks before falling back to the slower `.some()` scan, significantly reducing iteration for the common case.
- **Per-board XML editing** — the debug XML editor now uses `host.dataset.rawXml` (the original XML of the specific board being edited) instead of the global `gLastRawXml`, so editing works correctly for older inline boards. `gLastRawXml` is only updated when the edited board belongs to the latest message.
- **Inline display-mode layout** — settings HTML and CSS restructured to use CSS Grid, placing the inline checkbox, board count stepper, and default-mode dropdown on a single row for a more compact layout.

### Fixed

- **`EscapeHtml()` now produces proper HTML entities** — `&amp;`, `&lt;`, `&gt;`, `&quot;` instead of the raw characters that were previously injected into `innerHTML`, which could break rendering and create XSS vectors.
- **Unclosed XML attribute values** — LLM sometimes forgets a closing quote on attributes (e.g. `age="55 tags="...`). A new regex pre-pass fixes these before parsing: `="value` followed by `\s+nextAttr=` gets the missing quote appended.
- **Raw XML hiding robustness** — the `RemoveRawXmlFromText()` and `HideRawXmlFromMessage()` functions now match against HTML-entity-encoded patterns (`&lt;infoboard`, `&lt;thk`, `&lt;nsfw`) as well as raw tags, catching cases where SillyTavern's message renderer escapes the XML before the extension processes it.
- **Debug toolbar button HTML** — the `</>` button title now uses `&lt;/&gt;` instead of raw `</>`, preventing the browser from interpreting it as a closing tag.
- **`ResizeObserver` cleanup on panel removal** — the observer is now explicitly disconnected and nulled when the panel is destroyed, preventing potential memory leaks and stale callbacks.
- **Old inline boards no longer show pinned NPCs** — only the latest (most recent) inline board receives patched pinned-NPC data; older boards display only what the AI originally returned, avoiding anachronistic state injection.
- **Sidebar inline board count visibility** — the count stepper now correctly shows/hides when the Inline display mode checkbox is toggled.
- **Popup inline board count input** — `addEventListener("input change", ...)` does not work with native `addEventListener` (it does not accept space-separated event names like jQuery's `on()`). Split into two separate listeners (`"input"` and `"change"`) so manual number entry in the settings popup actually triggers the handler.
- **Panel resize jerkiness** — panel resize now uses `requestAnimationFrame` throttling (`lastClientX` + rAF flag) so `host.style.width` updates at most once per frame instead of on every `pointermove` event. A CSS class `ib-panel-resizing` is added during resize to disable `transition`, `backdrop-filter`, and promote the element with `will-change: width`. The CSS variable `--ib-panel-width` is only updated on `pointerup` (not during drag), eliminating expensive full-document style recalculation.
- **Popup toggle cross-board bug** — clicking a toolbar button (⚙️ settings, 🎨 theme, 📍 pins, 🔔 notifications) on one board while its popup was open on another board would close the popup instead of reopening it on the new board. Popups now track their source button via `__sourceBtn`; clicking the same button toggles off, clicking a different board's button closes the old popup and opens a new one.
- **Timeline milestones order** — milestones now display newest-first (reversed), matching the timeline event list order instead of showing oldest milestones at the top.

---

## [2.2.0] — 2025-05-18

### Added

- Structured `<infoboard_rules>` prompt with 7 presence levels.
- NPC age attribute.
- 6 tags per NPC (up from 4).
- Strict anti-user-action and anti-echo directives.
- Three-tier pin system (Per-Chat / Per-Character / Global) with snapshots.
- Expandable pins popup with Pin Here transfer option and go-to navigation arrow.
- Additional status classifications (Positive / Neutral).
- Relationship timeline with zoom, milestones, and persistence.
- Toast notifications for relationship changes and pin actions.
- Inline settings popup from the board toolbar.
- Resizable side panel mode (left or right).
- Macro prompt injection (`{{InfoBoard}}` / `{{IB}}`).
- Configurable injection position and depth for autoinject.
- Debug XML editor.
- Improved export / import.
- Themes and options accessible via toolbar buttons.
- Configurable inline infoboard count.

### Changed

- Amount of rendered inline infoboards can be changed in options.

---

## [2.1.0] — 2025-04-20

### Added

- 25 themes (Nocturne, Burgundy, Ash Rose, Cold Steel, Frostwhite, Pixel Arcade, Pink Bite, Violet Glass, Verdant Grove, Sandalwood, Gengar, System Log, Terminal, Oracle Moon, Blood Moon, Case File, Obsidian Registry, Neon Quest, Gryffindor, Slytherin, Ravenclaw, Hufflepuff, Shockwave, Lockdown, Hot Rod).
- 16 bar styles (Classic, Deep Neon, Glass Needle, Soft Matte, Pixel Blocks, Candy Gloss, Prism Glass, Neon Rails, Terminal Segments, Heart Meter, Constellation Stars, Vials, Evidence Tape, Runic Shards, Sigil Bands, Energon).
- Full / compact / collapsed panel modes.
- Draggable and resizable floating infoboard.
- Custom CSS overrides.
- RU / EN language switch.

---

## [2.0.0] — 2025-03-15

### Added

- Forked from KanonMama's original Infoboard.
- Per-chat state memory.
- XML infoboard parsing.
- NPC scene tracking.
- NPC mood and presence tags.
- Manual NPC pinning for crowded scenes.
- Relationship meters with −100 to 100 range.
- Positive and negative affection / trust / love.
- Private NPC thoughts stored in `<thk>`.
- Optional NSFW context.
- Raw XML hiding from visible messages.
- Safer leaked-thought cleanup.

[2.3.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/releases/tag/v2.0.0
