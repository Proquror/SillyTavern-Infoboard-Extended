# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] — 13 June 20206

### Changed

- **Removed 11 unused/dead functions** — codebase cleanup eliminating functions with zero callers or functionality absorbed elsewhere:
  - `HexToRgb()`, `RgbToHex()`, `BlendColors()` — color utility functions never called outside `BlendColors` itself (no theme or rendering code uses programmatic color blending).
  - `GetPinCharKey()`, `GetPinChatId()` — pin lookup helpers with zero callers; their resolution logic is inlined where needed.
  - `RenderUnifiedThoughts()` — superseded by per-NPC `RenderThoughtForNpc()` since v2.2.0, which renders thoughts inside individual relation cards rather than as a separate unified section.
  - `RenderCompactDeltaLine()` — unused compact delta renderer; compact mode uses `RenderCompactRelations()` directly.
  - `ShouldRenderPanelBoard()` — marked with a TODO comment ("use in RenderPanelBoard") but never actually called; the panel rendering path checks `gDisplayPanel` directly.
  - `GetDefaultBoardMode()` — never called; the default board mode selection logic is inlined at the call sites.
  - `ApplyParsedToState()` — its logic (PatchPinnedData → UpdateRollingState → AddTimelineEntry → CheckAndNotifyChanges) has been absorbed directly into the caller sites (`ReprocessChat` and `RebuildStateFromCurrentChat`), where each step is applied inline with more granular control over the pipeline.
  - `RegisterFallbackPromptInjection()` — legacy `GENERATION_STARTED` event handler that was superseded by the macro system and `setExtensionPrompt` auto-inject; no longer needed for SillyTavern 1.12+.

- **Floating board ResizeObserver simplified** — removed the `isResizing` flag and `ib-floating-resizing` CSS class toggling that disabled `backdrop-filter` during resize. The observer now only performs a debounced `SaveFloatingLayout()` call (debounce increased from 200 ms to 250 ms), eliminating unnecessary DOM class manipulation during resize.

- **`SaveFloatingLayout()` guard** — added `|| !host.isConnected` check to prevent saving layout data from a DOM element that has been detached from the document, which could produce invalid or zeroed coordinates.

- **Panel resize: removed `will-change: width`** — the `will-change: width` property on `#ib_panel_host.ib-panel-resizing` promoted the element to its own compositor layer during resize, causing unnecessary GPU memory allocation. Removed since the existing `transition: none !important` rule already prevents layout thrashing.

- **CSS whitespace normalization** — replaced tab characters with spaces in `#ib_sp_panel_position_row label`, `.ib-depth-input-compact`, and inline display mode selectors for consistent formatting.

### Fixed

- **Floating board resize visual glitch** — the `ib-floating-resizing` CSS class toggling could cause a visible flash when `backdrop-filter` was re-enabled after resize ended, particularly noticeable on themes with heavy blur. Removed the class toggling entirely; the simplified ResizeObserver avoids any visual side effects.

## [2.4.0] — 12 June 2026

### Added

- **Re-render from `msg.mes` (source of truth)** — new `RerenderMessageFromSource()` function always re-renders `.mes_text` from the original `msg.mes` instead of surgically cleaning up the existing DOM. This replaces the old `RerenderMessageWithoutInfoboard()` which was a one-way operation that permanently destroyed DOM content.
  - When `gHideRaw` is on: `<infoboard>` blocks are **stripped** before rendering, so the browser never sees `<thk>` — thought leaks are impossible at the root cause.
  - When `gHideRaw` is off: `<infoboard>` blocks are **escaped** (`<` → `&lt;`, `>` → `&gt;`) so the browser renders XML tags as visible text instead of creating invisible DOM elements. The user sees the raw XML the AI generated, formatted as readable text with no empty gaps.
  - `msg.mes` is never modified — only the DOM is affected.
  - Falls back to surgical cleanup when the message has no `<infoboard>` or `messageFormatting` is unavailable.

- **Render queue items carry `rawMes`** — each queue item now includes `rawMes: stMsg.mes || ""` so that `RerenderMessageFromSource()` always has access to the original message text, regardless of display mode.

- **Hide board mode dropdown during count confirm (popup)** — when ✓/✗ confirm/cancel buttons appear in the settings popup, the inline board mode dropdown is hidden to avoid visual clutter. It is restored on confirm or cancel.

### Changed

- **`_syncCleanupAll()` simplified** — surgical cleanup (`CleanupRawInfoboardDom`, `RemoveRawXmlFromText`, `RemoveThoughtLeaksInContainer`) is now a **fallback only**, used when `rawMes` is missing or `messageFormatting` is unavailable. When re-render succeeds, none of these functions are needed because the DOM is already clean (XML stripped or escaped to text).

- **`RemoveRawXmlFromText()` gated behind `gHideRaw`** — when the user has turned off "Hide raw XML", the escaped text-level XML patterns should not be stripped. Previously this function ran unconditionally and could remove content the user explicitly wanted to see.

- **TreeWalker optimization in `RemoveThoughtLeaksInContainer()`** — `IsLeakedThoughtLine()` is no longer called inside `acceptNode()`, which previously ran the most expensive function in the module during TreeWalker traversal and again in the processing loop — effectively 2× cost. Now `acceptNode` accepts all non-empty text nodes, and `IsLeakedThoughtLine` is called exactly once per line in the processing loop.

- **Conditional DOM write in thought-leak removal** — `node.textContent` is now only updated when the processed text actually differs from the original (`if (next !== raw)`), avoiding unnecessary layout invalidation for text nodes that contain no leaked content.

### Fixed

- **Raw XML not visible when "Hide raw XML" is toggled off** — the old `RerenderMessageWithoutInfoboard()` permanently replaced `.mes_text` with stripped content. Toggling "Hide raw XML" off caused a visual jerk (board widget re-rendered) but no XML appeared because the DOM had already been overwritten. Fixed by `RerenderMessageFromSource(hideRaw)` which always re-renders from `msg.mes`.

- **Empty gaps and scattered thought text when `gHideRaw` is off** — rendering `msg.mes` as-is caused the browser to parse XML tags (`<infoboard>`, `<chars>`, `<thk>`) as invisible DOM elements. These elements took up space but were not visible, resulting in blank indents with only the text content (including thoughts) showing through. Fixed by escaping XML blocks to visible text when `gHideRaw` is off.

- **`EscapeHtml()` was a no-op** — the function returned the same characters unchanged instead of producing HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`). This broke rendering and created potential XSS vectors.

- **Raw XML hiding robustness** — `RemoveRawXmlFromText()` and `HideRawXmlFromMessage()` now match against HTML-entity-encoded patterns (`&lt;infoboard`, `&lt;thk`, `&lt;nsfw`) as well as raw tags, catching cases where SillyTavern's message renderer escapes the XML before the extension processes it.

- **Debug toolbar button HTML** — the `</>` button title now uses `&lt;/&gt;` instead of raw `</>`, preventing the browser from interpreting it as a closing tag.

## [2.3.0] — 12 June 2026

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

- **`EscapeHtml()` now produces proper HTML entities** — `&`, `<`, `>`, `"` instead of the raw characters that were previously injected into `innerHTML`, which could break rendering and create XSS vectors.

- **Unclosed XML attribute values** — LLM sometimes forgets a closing quote on attributes (e.g. `age="55 tags="...`). A new regex pre-pass fixes these before parsing: `="value` followed by `\s+nextAttr=` gets the missing quote appended.

- **Raw XML hiding robustness** — the `RemoveRawXmlFromText()` and `HideRawXmlFromMessage()` functions now match against HTML-entity-encoded patterns (`&lt;infoboard`, `&lt;thk`, `&lt;nsfw`) as well as raw tags, catching cases where SillyTavern's message renderer escapes the XML before the extension processes it.

- **Debug toolbar button HTML** — the `</>` button title now uses `&lt;/&gt;` instead of raw `</>`, preventing the browser from interpreting it as a closing tag.

- **`ResizeObserver` cleanup on panel removal** — the observer is now explicitly disconnected and nulled when the panel is destroyed, preventing potential memory leaks and stale callbacks.

- **Old inline boards no longer show pinned NPCs** — only the latest (most recent) inline board receives patched pinned-NPC data; older boards display only what the AI originally returned, avoiding anachronistic state injection.

- **Sidebar inline board count visibility** — the count stepper now correctly shows/hides when the Inline display mode checkbox is toggled.

- **Popup inline board count input** — `addEventListener("input change", ...)` does not work with native `addEventListener` (it does not accept space-separated event names like jQuery's `on()`). Split into two separate listeners (`"input"` and `"change"`) so manual number entry in the settings popup actually triggers the handler.

- **Panel resize jerkiness** — panel resize now uses `requestAnimationFrame` throttling (`lastClientX` + rAF flag) so `host.style.width` updates at most once per frame instead of on every `pointermove` event. A CSS class `ib-panel-resizing` is added during resize to disable `transition`, `backdrop-filter`, and promote the element with `will-change: width`. The CSS variable `--ib-panel-width` is only updated on `pointerup` (not during drag), eliminating expensive full-document style recalculation.

- **Popup toggle cross-board bug** — clicking a toolbar button (settings, theme, pins, notifications) on one board while its popup was open on another board would close the popup instead of reopening it on the new board. Popups now track their source button via `__sourceBtn`; clicking the same button toggles off, clicking a different board's button closes the old popup and opens a new one.

- **Timeline milestones order** — milestones now display newest-first (reversed), matching the timeline event list order instead of showing oldest milestones at the top.

## [2.2.0] — 11 June 2026

### Added

- **Relationship timeline zoom** — magnifier button with slider (1x–10x), mouse wheel scroll, and pinch-to-zoom support. Zoom level and scroll position are preserved during interaction.

- **Additional status classifications** — relationships can now be classified as Positive / Neutral (beyond the existing categories), with corresponding visual indicators.

- **Inline settings popup from board toolbar** — `RenderSettingsPopup()` opens a floating settings panel directly from the board's toolbar buttons, providing quick access to all options without navigating to the sidebar. Includes injection position, depth, macro mode, notifications, display modes, and board count controls.

- **Expandable pins popup with Pin Here and navigation** — "Other pins" section expands to show pins from other chats and character cards. Each pin has a "Pin Here" button to transfer it to the current context and a navigation arrow (`→`) to jump to the source character card via `NavigateToCharacterCard()`.

- **Pin snapshots** — `UpdatePinSnapshot()`, `UpdateAllPinSnapshots()`, and `RemovePinSnapshot()` manage per-pin state snapshots. Pin data is preserved independently from active NPC state.

- **Orphaned snapshot cleanup** — a dedicated button and `cleanOrphanSnapshots` action removes snapshot data for pinned NPCs that are no longer pinned anywhere, without affecting active pins.

- **Accordion-style relation cards** — `WireAccordionControls()` adds collapsible relation sections to the board, reducing visual clutter when many NPCs are present.

- **Toast notifications** — `ShowToast()` displays temporary popups for pin actions, navigation errors, and other feedback (e.g. "Pinned in this chat", "Character card not found").

- **Floating board drag and resize improvements** — new `.ib-floating-shell` wrapper and `.ib-floating-dragging` / `.ib-floating-resizing` CSS classes provide smooth visual feedback during drag and resize operations.

- **Popup management** — `CloseOtherPopups()` ensures only one popup (settings, theme, pins, notifications, timeline) is open at a time across all boards.

- **Localization helper `T()`** — centralized translation function replaces direct `kLang` lookups, supporting both EN and RU with consistent fallback behavior.

- **`GetMergedStateForRendering()`** — merges current chat state with pinned NPC data for rendering, ensuring pinned characters always appear in the board even when not present in the latest XML.

- **Emoji removal from UI labels** — all button and label emojis (save, clear, export, import, reprocess, reset) are now appended programmatically instead of being embedded in translation strings, improving i18n consistency.

- **New localization strings** — added translations for `cleanOrphanSnapshots`, `pinEditor`, `allPins`, `pinHere`, `pinHereAlready`, `pinHereDone`, `pinsExpandOther`, `pinsCollapseOther`, `pinNavNotFound`, and all settings popup labels in both EN and RU.

### Changed

- **Pin system rewritten** — `LoadPinnedNpcs()`, `ResolveAllPins()`, `RemoveFromCurrentContext()`, `RemoveFromSpecificContext()`, `SetPinLevel()`, and `PinHere()` replace the simpler v2.1.0 pin functions, supporting multi-context pin management with proper snapshot handling.

- **Board context and mode functions rewritten** — `GetBoardContext()`, `GetCurrentBoardMode()`, `SetCurrentBoardMode()`, `SetBoardMode()`, and `WireAccordionControls()` reimplemented with improved rendering pipeline and settings popup integration.

- **Settings UI moved to popup** — theme, notification, and pin settings are now accessible from toolbar buttons on each board, not just the sidebar.

### Fixed

- **Popup positioning and lifecycle** — `PositionPopupNearButton()` reimplemented to correctly position popups near their source button across different board locations (inline, floating, panel).

- **Display mode change handling** — `OnDisplayModeChange()` rewritten to properly handle enabling/disabling multiple display modes simultaneously and cleaning up boards that are no longer visible.

## [2.1.0] — 10 June 2026

### Added

- **Extension renamed to SillyTavern-Infoboard-Extended** — the fork now carries a distinct identity from the original Infoboard by KanonMama.

- **Dynamic extension path detection** — `gExtUrlPath` uses `document.currentScript.src` to detect the actual extension folder at runtime, supporting installations in non-standard locations (default-user, etc.) instead of hardcoding `scripts/extensions/third-party/SillyTavern-Infoboard`.

- **Three-tier pin system (Per-Chat / Per-Character / Global) with registry** — new `PinRegistry` architecture replaces the old flat pinned-NPC list:
  - `GetDefaultPinRegistry()`, `LoadPinRegistry()`, `SavePinRegistry()` manage a structured registry with `characters` and `chats` sections.
  - `ResolveActivePins()` merges global, per-character, and per-chat pins to determine the active set.
  - `GetPinLevel()`, `SetPinLevel()`, `RemovePinCompletely()` provide tier-aware pin management.
  - `MigrateOldPinsToRegistry()` automatically migrates legacy flat pin data to the new registry format on first load.
  - `CleanPinRegistry()` removes stale entries with empty pin arrays.
  - Visual pin tier indicators: colored dots (global / per-character / per-chat) with tier number badges on each NPC row.

- **Macro mode `{{InfoBoard}}`** — alternative to auto-inject: when enabled, the `{{InfoBoard}}` macro (and `{{IB}}` alias) can be manually placed in the system prompt or Author's Note. The macro is always registered but only returns content when macro mode is on. Auto-inject is always registered but only activates when macro mode is off.

- **Configurable injection position and depth** — new settings for auto-inject mode:
  - `gInjectPosition`: 0 = after Story String, 1 = In Chat (depth), 2 = before Story String.
  - `gInjectDepth`: 0 = last message in context; higher values inject further up in chat history (max 999).
  - `UpdateInjectDepthVisibility()` shows/hides the depth input depending on the selected position.
  - ± stepper buttons for depth adjustment in both sidebar and settings.

- **New themes: Lockdown and Terminal** — two additional themes added to the existing 25-theme roster.

- **Minimum SillyTavern version raised to 1.12.0** — `manifest.json` updated from `1.10.0` to `1.12.0`.

### Changed

- **Pin storage architecture** — `gPinStorageMode` (single mode) and `kPinStorageModeKey` removed; tier pins now use multi-level resolution via the registry instead of a single storage mode flag.

- **`LoadPinnedNpcs()` rewritten** — loads from the new registry structure instead of the flat `kPinnedNpcsKey + chatId` localStorage keys.

- **`OnChatChanged()` rewritten** — properly resets and reloads pin state for the new chat context, including registry reload and old-pin migration.

### Fixed

- **Extension path resolution** — hardcoded `scripts/extensions/third-party/SillyTavern-Infoboard` path failed when the extension was installed in a non-default location. Fixed by dynamic detection from `document.currentScript.src`.

- **Old pin data migration** — existing pinned NPC data from the flat format is automatically migrated to the new registry on first load, preserving user pins across the upgrade.

## [2.0.0] — 9 June 2026

### Added

- **Forked from KanonMama's original SillyTavern-Infoboard** — major overhaul with new display modes, timeline, presence system, and panel mode.

- **Safe imports** — `macro-system.js` and `power-user.js` are imported with `try/catch` wrappers, making the extension resilient to missing or incompatible SillyTavern modules. The extension logs a warning and continues without macro registration or the experimental macro engine flag if these modules are unavailable.

- **Three display modes (inline, floating, panel)** — replaced the old single `gDisplayMode` toggle with three independent checkboxes:
  - **Inline** — boards rendered inside chat messages (default).
  - **Floating** — draggable and resizable floating board window.
  - **Panel** — side panel (left or right) with toggle button and auto-collapse on idle.
  - `MigrateDisplayMode()` automatically converts the legacy single-mode setting to the new three-toggle format.
  - Each mode has its own default board mode (full / compact / collapsed).

- **Timeline system** — per-NPC relationship history chart with SVG rendering:
  - `LoadTimeline()`, `SaveTimeline()`, `RebuildTimelineFromChat()` manage per-chat timeline data in localStorage.
  - `AddTimelineEntry()` records relationship snapshots when NPC state changes.
  - `RenderTimelinePopup()` displays an interactive popup with per-NPC tabs, metric filters (affection, trust, love), and milestone markers.

- **Panel mode** — full side-panel implementation:
  - `OpenPanel()`, `ClosePanel()`, `TogglePanel()` with animation.
  - `SchedulePanelToggleIdle()` auto-collapses the panel after inactivity.
  - `EnsurePanelContainer()` creates and manages the panel DOM element.
  - `RenderPanelBoard()` renders the full board inside the panel.
  - Configurable panel width (`gPanelWidth`) and position (`gPanelPosition`: left or right).

- **Notification system** — desktop-style notifications for relationship changes:
  - `ShowNotification()` displays browser notifications with title, body, and type.
  - `CheckAndNotifyChanges()` compares current and previous state, generating notifications when relationship metrics change beyond the configured threshold.
  - `gNotificationThreshold` controls the minimum change magnitude to trigger notifications.
  - Toggle to enable/disable notifications via `gNotificationsEnabled`.

- **Presence system** — NPC presence tracking with visual chips/tags:
  - Presence attributes (focus, active, absent, etc.) displayed as colored chips on NPC cards.
  - Presence priority sorting — NPCs with higher presence priority appear first in the board.

- **Theme system** — `GetThemeClassStr()` and `RenderThemePopup()` provide 25 built-in themes with live preview:
  - Nocturne, Burgundy, Ash Rose, Cold Steel, Frostwhite, Pixel Arcade, Pink Bite, Violet Glass, Verdant Grove, Sandalwood, Gengar, System Log, Terminal, Oracle Moon, Blood Moon, Case File, Obsidian Registry, Neon Quest, Gryffindor, Slytherin, Ravenclaw, Hufflepuff, Shockwave, Lockdown, Hot Rod.

- **Bar styles** — 16 visual styles for relationship meters: Classic, Deep Neon, Glass Needle, Soft Matte, Pixel Blocks, Candy Gloss, Prism Glass, Neon Rails, Terminal Segments, Heart Meter, Constellation Stars, Vials, Evidence Tape, Runic Shards, Sigil Bands, Energon.
  - `GetBarEmoji()`, `GetBarPattern()`, `GetCurrentBarHeight()` control bar appearance.
  - Configurable bar style heights, radii, metric methods, and color slots via `kBarStyle*` constants.

- **State injection** — `BuildStateInjection()` and `CalculateStateUpToMessage()` compute the rolling NPC state up to a given message and build a formatted prompt block for injection into the LLM context.

- **Floating board** — draggable and resizable floating window with layout persistence (`GetFloatingLayout`, `SaveFloatingLayout`, `RestoreFloatingLayout`).

- **Custom CSS overrides** — user-supplied CSS applied after built-in styles, allowing full visual customization.

- **Hover effects** — `gHoverFx` toggle for interactive hover animations on NPC cards and relationship meters.

- **Compact mode** — `gCompactMode` with options (top3, mini, etc.) for condensed display of NPC data.

- **Unified thoughts rendering** — `RenderUnifiedThoughts()` consolidates NPC thought display across all board modes.

- **Auto-scroll thoughts** — `AutoScrollThoughts()` keeps the thought panel scrolled to the latest entry.

- **Rolling state update** — `UpdateRollingState()` and `ApplyParsedToState()` incrementally update NPC state as new messages are processed, without reprocessing the entire chat.

- **Fallback prompt injection** — `RegisterFallbackPromptInjection()` registers a `GENERATION_STARTED` event handler to inject the infoboard prompt when the standard injection path is unavailable.

- **RU / EN language switch** — full bilingual support for Russian and English UI.

- **Debug XML editor** — inline editing of the raw infoboard XML for testing and troubleshooting.

- **Improved export / import** — state export and import with JSON validation and error handling.

- **Minimum SillyTavern version: 1.10.0** — declared in `manifest.json`.

### Changed

- **Complete rewrite of `RenderBoard()`** — the board rendering function was reimplemented from scratch to support the three display modes, presence chips, bar styles, and compact layouts.

- **`ProcessMessage()` and `InjectPrompt()` removed** — replaced by the new `CalculateStateUpToMessage()` / `BuildStateInjection()` pipeline and the `RegisterFallbackPromptInjection()` event handler.

- **`RenderRelationChangeSummary()` removed** — relationship change display is now handled inline within `RenderBoard()` and the notification system.

- **`EscapeRegex()` removed** — no longer needed after the parsing overhaul.

[2.5.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Proquror/SillyTavern-Infoboard-Extended/releases/tag/v2.0.0
