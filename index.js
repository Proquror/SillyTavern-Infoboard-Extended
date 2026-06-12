// Safe imports — SillyTavern 1.12+ macro system, optional in 1.13+
let macros = null;
let power_user = null;

try {
    const macroModule = await import('../../../macros/macro-system.js');
    macros = macroModule.macros || macroModule.default || macroModule;
} catch (e) {
    console.warn("[IB] macro-system.js not available — macro registration will be skipped", e?.message);
}

try {
    const puModule = await import('../../../power-user.js');
    power_user = puModule.power_user || puModule.default || puModule;
} catch (e) {
    console.warn("[IB] power-user.js not available — experimental_macro_engine flag will be skipped", e?.message);
}

const kExtensionName = "SillyTavern-Infoboard-Extended";

// Detect extension folder path dynamically from script URL
// Works regardless of physical location (third-party, default-user, etc.)
const gExtUrlPath = (() => {
    try {
        const src = document.currentScript?.src || '';
        const url = new URL(src);
        return url.pathname.replace(/\/[^/]+$/, '');
    } catch { return `/scripts/extensions/third-party/${kExtensionName}`; }
})();
const kSettingsFile = `${gExtUrlPath}/settings.html`;

const kStorageKeyPrefix = "IB_State_";
const kEnabledKey = "IB_Enabled";
const kThemeKey = "IB_Theme";
const kHideRawKey = "IB_HideRaw";
const kShowNsfwKey = "IB_ShowNsfw";
const kLangKey = "IB_Lang";
const kBarStyleKey = "IB_BarStyle";
const kCustomCssKey = "IB_CustomCss";
const kHoverFxKey = "IB_HoverFx";
const kHideThoughtLeaksKey = "IB_HideThoughtLeaks";
const kCompactModeKey = "IB_CompactMode";
const kDisplayModeKey = "IB_DisplayMode"; // legacy
const kDisplayInlineKey = "IB_DisplayInline";
const kDisplayFloatingKey = "IB_DisplayFloating";
const kDisplayPanelKey = "IB_DisplayPanel";
const kFloatingLayoutKey = "IB_FloatingLayout";
const kPinnedNpcsKey = "IB_PinnedNpcs";
// kPinStorageModeKey removed — tier pins no longer use a single mode
const kTimelineKey = "IB_Timeline_";
const kNotificationsEnabledKey = "IB_NotificationsEnabled";
const kNotificationThresholdKey = "IB_NotificationThreshold";
const kPanelWidthKey = "IB_PanelWidth";
const kPanelPositionKey = "IB_PanelPosition";
const kDefaultBoardModeInlineKey = "IB_DefaultBoardMode_Inline";
const kDefaultBoardModeFloatingKey = "IB_DefaultBoardMode_Floating";
const kDefaultBoardModePanelKey = "IB_DefaultBoardMode_Panel";
const kUseMacroKey = "IB_UseMacro";
const kInjectPositionKey = "IB_InjectPosition";
const kInjectDepthKey = "IB_InjectDepth";
const kInlineBoardCountKey = "IB_InlineBoardCount";

let gEnabled = false;
let gTheme = "nocturne";
let gHideRaw = true;
let gShowNsfw = true;
let gLang = "ru";
let gBarStyle = "deep";
let gCustomCss = "";
let gHoverFx = true;
let gHideThoughtLeaks = true;
let gCompactMode = "top3";
let gDisplayMode = "inline"; // legacy, kept for migration
let gDisplayInline = true;
let gDisplayFloating = false;
let gDisplayPanel = false;
let gLastRawXml = "";
let gPinnedNpcs = [];
// gPinStorageMode removed — tier pins use multi-level resolution
let gPinRegistry = null; // cached registry, loaded once
let gTimeline = [];
let gPreSwipeState = null; // State to use for prompt injection during swipe+regeneration
let gNotificationsEnabled = true;
let gNotificationThreshold = 5;
let gPanelWidth = 380;
let gPanelPosition = "right";
let gPanelOpen = false;
let gDefaultBoardModeInline = "full";
let gDefaultBoardModeFloating = "full";
let gDefaultBoardModePanel = "full";
let gUseMacro = false; // false = auto-inject (default), true = macro mode {{InfoBoard}}
let gInjectPosition = 1;  // 0=after story string, 1=in-chat, 2=before story string
let gInjectDepth = 0;     // depth for IN_CHAT position (0 = last message)
let gInlineBoardCount = 5; // how many inline boards to render in chat
let gInlineBoardCountSaved = 5; // last confirmed value for confirm/cancel pattern

// --- Singleton DOMParser (reused across all ParseInfoboard calls, per W3C spec it's stateless) ---
const gDomParser = new DOMParser();

// --- Presence attribute map (immutable, shared across all ParseInfoboard calls) ---
const PRESENCE_ATTR_MAP = {
    "focus":      { key: "focus",      cls: "ib-presence-focus" },
    "active":     { key: "activeHere", cls: "ib-presence-active" },
    "near":       { key: "nearby",     cls: "ib-presence-near" },
    "nearby":     { key: "nearby",     cls: "ib-presence-near" },
    "watching":   { key: "watching",   cls: "ib-presence-watch" },
    "background": { key: "background", cls: "ib-presence-background" },
    "offscreen":  { key: "offscreen",  cls: "ib-presence-offscreen" },
    "left":       { key: "leftScene",  cls: "ib-presence-left" }
};

// --- Presence tag sets (O(1) lookup instead of Array.includes) ---
const PRESENCE_SET_FOCUS      = new Set(["focus", "в фокусе", "главный", "active focus"]);
const PRESENCE_SET_ACTIVE     = new Set(["active", "активен", "говорит", "ведёт сцену"]);
const PRESENCE_SET_NEAR       = new Set(["near", "рядом", "nearby", "close"]);
const PRESENCE_SET_WATCH      = new Set(["watching", "наблюдает", "смотрит", "следит"]);
const PRESENCE_SET_OFFSCREEN  = new Set(["offscreen", "за кадром", "вне сцены", "not present"]);
const PRESENCE_SET_BACKGROUND = new Set(["background", "на периферии", "в фоне", "пассивен"]);
const PRESENCE_SET_LEFT       = new Set(["left", "вышел", "ушёл", "out"]);

/** Union of all presence sets — built once at module load for IsPresenceTag */
const ALL_PRESENCE_TAGS = new Set([
    ...PRESENCE_SET_FOCUS, ...PRESENCE_SET_ACTIVE, ...PRESENCE_SET_NEAR,
    ...PRESENCE_SET_WATCH, ...PRESENCE_SET_OFFSCREEN, ...PRESENCE_SET_BACKGROUND,
    ...PRESENCE_SET_LEFT
]);

// --- Alias cache for GetNameAliases (invalidated on chat change) ---
const gAliasCache = new Map();

/** Invalidate alias cache — call when chat changes or characters reload */
function InvalidateAliasCache() {
    gAliasCache.clear();
}

function GetThemeClassStr(theme) {
    theme = theme || gTheme;
    return `ib-theme-${theme}`;
}

// Runtime board modes — persist during session, reset on reinit to settings defaults
let gCurrentBoardModeInline = "full";
let gCurrentBoardModeFloating = "full";
let gCurrentBoardModePanel = "full";

// No default emojis

let gLastRawXmlMsgIndex = -1;

const kThemePreviewMap = {
    nocturne: {
        label: { ru: "🌙 Nocturne", en: "🌙 Nocturne" },
        bg: "#141824",
        bg2: "#1c2232",
        accent: "#8fb4ff",
        accent2: "#c09cff",
        text: "#dbe3ff",
        danger: "#ff8f9f",
        green: "#7ce6a8",
        dim: "#6b7899"
    },
    burgundy: {
        label: { ru: "🍷 Burgundy", en: "🍷 Burgundy" },
        bg: "#221419",
        bg2: "#311c24",
        accent: "#ff9bb3",
        accent2: "#e0a7ff",
        text: "#ffe2ea",
        danger: "#ff9bb3",
        green: "#7ce6a8",
        dim: "#936977"
    },
    ashrose: {
        label: { ru: "🌸 Ash Rose", en: "🌸 Ash Rose" },
        bg: "#211a20",
        bg2: "#2d242c",
        accent: "#f0a8c4",
        accent2: "#caa8ff",
        text: "#f3dfe8",
        danger: "#f0a8c4",
        green: "#7ce6a8",
        dim: "#8f7380"
    },
    coldsteel: {
        label: { ru: "🩶 Cold Steel", en: "🩶 Cold Steel" },
        bg: "#15191c",
        bg2: "#20272d",
        accent: "#9ec7d9",
        accent2: "#b3b9df",
        text: "#dde6eb",
        danger: "#c89292",
        green: "#7ce6a8",
        dim: "#71828d"
    },
    frostwhite: {
        label: { ru: "🧊 Frostwhite", en: "🧊 Frostwhite" },
        bg: "#253446",
        bg2: "#2d4158",
        accent: "#7fb8ff",
        accent2: "#a8bfff",
        text: "#e3eefc",
        danger: "#e06c84",
        green: "#5fe0a0",
        dim: "#7489a5"
    },
    pixel: {
        label: { ru: "🕹 Pixel Arcade", en: "🕹 Pixel Arcade" },
        bg: "#17132b",
        bg2: "#221b3f",
        accent: "#a6ff78",
        accent2: "#7de8ff",
        text: "#d8ffd0",
        danger: "#ff7f9f",
        green: "#98ff9d",
        dim: "#6e8d67"
    },
    pinkbite: {
        label: { ru: "💗 Pink Bite", en: "💗 Pink Bite" },
        bg: "#2a1526",
        bg2: "#3a1d35",
        accent: "#ff8fc7",
        accent2: "#ffc2e6",
        text: "#ffe6f4",
        danger: "#ff7ba5",
        green: "#90e2b3",
        dim: "#9d718b"
    },
    violetglass: {
        label: { ru: "🟣 Violet Glass", en: "🟣 Violet Glass" },
        bg: "#1b1830",
        bg2: "#2a2344",
        accent: "#b69cff",
        accent2: "#8fd4ff",
        text: "#efeaff",
        danger: "#ff92b2",
        green: "#7ff0c2",
        dim: "#8478aa"
    },
    verdantgrove: {
        label: { ru: "🌿 Verdant Grove", en: "🌿 Verdant Grove" },
        bg: "#162019",
        bg2: "#223126",
        accent: "#9fcb8f",
        accent2: "#d6c68b",
        text: "#e7f1e4",
        danger: "#d97f87",
        green: "#7fdb9f",
        dim: "#73856f"
    },
    sandalwood: {
        label: { ru: "🟤 Sandalwood", en: "🟤 Sandalwood" },
        bg: "#2a221b",
        bg2: "#3a2f25",
        accent: "#ddb27a",
        accent2: "#cfa98e",
        text: "#f5eadc",
        danger: "#d98b7d",
        green: "#9dd0ab",
        dim: "#9a836b"
    },

    gengar: {
    label: { ru: "👻 Gengar", en: "👻 Gengar" },
    bg: "#14091f",
    bg2: "#25103d",
    accent: "#b86cff",
    accent2: "#ff5fd7",
    text: "#f3e7ff",
    danger: "#ff5d8f",
    green: "#77ffc7",
    dim: "#8762a8"
},

systemlog: {
    label: { ru: "💠 System Log", en: "💠 System Log" },
    bg: "#07090c",
    bg2: "#101820",
    accent: "#6bd6ff",
    accent2: "#ff6f9f",
    text: "#d8e7ee",
    danger: "#ff5e6c",
    green: "#55ff9a",
    dim: "#5e7480"
},

    terminal: {
    label: { ru: "🟩 Terminal", en: "🟩 Terminal" },
    bg: "#020b06",
    bg2: "#06160c",
    accent: "#38ff7a",
    accent2: "#b6ff6a",
    text: "#c8ffd2",
    danger: "#ff9b4a",
    green: "#38ff7a",
    dim: "#4f7a55"
},

oraclemoon: {
    label: { ru: "🌙 Oracle Moon", en: "🌙 Oracle Moon" },
    bg: "#171122",
    bg2: "#261a35",
    accent: "#d8b86a",
    accent2: "#b98cff",
    text: "#f2e8ff",
    danger: "#ff7fa8",
    green: "#79c894",
    dim: "#7d668f"
},

bloodmoon: {
    label: { ru: "🩸 Blood Moon", en: "🩸 Blood Moon" },
    bg: "#1a080d",
    bg2: "#2a1017",
    accent: "#b84552",
    accent2: "#d6a35f",
    text: "#f4e1dc",
    danger: "#e05a67",
    green: "#c98078",
    dim: "#81545a"
},

    casefile: {
    label: { ru: "🕵️ Case File", en: "🕵️ Case File" },
    bg: "#151412",
    bg2: "#25221d",
    accent: "#e0b84f",
    accent2: "#b7afa1",
    text: "#eee5d8",
    danger: "#d65f4f",
    green: "#9ab47a",
    dim: "#787061"
},

obsidianregistry: {
    label: { ru: "🗝 Obsidian Registry", en: "🗝 Obsidian Registry" },
    bg: "#07130f",
    bg2: "#10231b",
    accent: "#d7c28a",
    accent2: "#77b68c",
    text: "#e4eee5",
    danger: "#d9876f",
    green: "#77d09b",
    dim: "#61766a"
},
    
    neonquest: {
    label: { ru: "🤖 Neon Quest", en: "🤖 Neon Quest" },
    bg: "#020817",
    bg2: "#061a33",
    accent: "#00d9ff",
    accent2: "#2f7cff",
    text: "#d8f7ff",
    danger: "#ff4f9a",
    green: "#20ff9a",
    dim: "#446f91"
},
    
    gryffindor: {
        label: { ru: "🦁 Gryffindor", en: "🦁 Gryffindor" },
        bg: "#2a1114",
        bg2: "#4a161b",
        accent: "#d4a94e",
        accent2: "#f0d28a",
        text: "#f9e8db",
        danger: "#ff8b7f",
        green: "#9ad5a7",
        dim: "#9e775d"
    },
    slytherin: {
        label: { ru: "🐍 Slytherin", en: "🐍 Slytherin" },
        bg: "#0f1b16",
        bg2: "#173027",
        accent: "#7dc8a2",
        accent2: "#c7d2cf",
        text: "#e6f2ed",
        danger: "#c98f98",
        green: "#92ddb3",
        dim: "#74897f"
    },
    ravenclaw: {
        label: { ru: "🦅 Ravenclaw", en: "🦅 Ravenclaw" },
        bg: "#121c2f",
        bg2: "#1b2d4a",
        accent: "#8da8d8",
        accent2: "#b8894f",
        text: "#edf2fb",
        danger: "#d58d86",
        green: "#93c9bf",
        dim: "#7886a4"
    },
    hufflepuff: {
        label: { ru: "🦡 Hufflepuff", en: "🦡 Hufflepuff" },
        bg: "#241d13",
        bg2: "#3a2b14",
        accent: "#e0b94a",
        accent2: "#f3d889",
        text: "#f8eed5",
        danger: "#d69a62",
        green: "#b9d39b",
        dim: "#9d8758"
    },

    shockwave: {
    label: { ru: "🟣 Shockwave", en: "🟣 Shockwave" },
    bg: "#120b18",
    bg2: "#261534",
    accent: "#cc7cff",
    accent2: "#ff71c8",
    text: "#f3ebff",
    danger: "#ff6a9d",
    green: "#78ffd0",
    dim: "#726382"
},

lockdown: {
    label: { ru: "🎯 Lockdown", en: "🎯 Lockdown" },
    bg: "#0d1114",
    bg2: "#1c2327",
    accent: "#86c98a",
    accent2: "#a6b2b8",
    text: "#e6ecef",
    danger: "#d9876f",
    green: "#86c98a",
    dim: "#718186"
},

hotrod: {
    label: { ru: "🔥 Hot Rod", en: "🔥 Hot Rod" },
    bg: "#120b08",
    bg2: "#2a1208",
    accent: "#ff8a2a",
    accent2: "#ffcf63",
    text: "#fff1d8",
    danger: "#ff6f4f",
    green: "#a6d39a",
    dim: "#8e5d3d"
}
};

const kLang = {
    ru: {
        enable: "Enable Infoboard",
        language: "Язык",
        theme: "Тема",
        barStyle: "Стиль полос",
        hideRaw: "Скрывать сырой XML из сообщений",
        showNsfw: "Показывать NSFW блок",
        hoverFx: "Включить hover-эффекты статов",
        active: "✦ Расширение активно",
        inactive: "Расширение отключено",
        currentState: "Текущее состояние:",
        noRecentUpdates: "Нет недавних изменений.",
        disabledPrompt: "Отключено — промт не инжектится.",
        chars: "Персонажи в сцене",
        rels: "Отношения к тебе",
        nsfw: "Интимный контекст",
        affection: "💚 Симпатия",
        trust: "💙 Доверие",
                age: "♦ Возраст",
        love: "💜 Любовь",
        aversion: "❤️‍🩹 Неприязнь",
        distrust: "🧡 Недоверие",
        hatred: "🩸 Ненависть",
        fetishes: "Фетиши",
        positions: "Позиции",
        resetState: "Сбросить состояние",
        reprocess: "Перепарсить чат",
        exportState: "Экспорт состояния",
        importState: "Импорт состояния",
        importFail: "Импорт не удался. Невалидный JSON.",
        resetConfirm: "Сбросить состояние Infoboard для этого чата?",
        stateNpcLabel: "NPCs",
        title: "INFOBOARD",
        noStatus: "не определено",
        customCssLabel: "Пользовательский CSS",
        customCssHelp: "Применяется после встроенных стилей. Можно переопределять цвета, отступы, полосы и любые классы Infoboard.",
        saveCustomCss: "Сохранить CSS",
        clearCustomCss: "Очистить CSS",
        clearCustomCssConfirm: "Очистить пользовательский CSS?",
        cleanOrphanSnapshots: "Очистить осиротевшие снимки",
        cleanOrphanSnapshotsConfirm: "Удалить снимки данных закреплённых NPC, которые больше нигде не закреплены? Сами активные закрепы не затрагиваются.",
        pinEditor: "Редактор",
        allPins: "Все закрепы",
        allPinsUnpin: "Открепить",
        allPinsNavigate: "Перейти к источнику: {source}",
        pinNavNotFound: "Карточка персонажа не найдена",
        pinHere: "Закрепить в этом чате",
        pinHereAlready: "Уже закреплён в этом контексте",
        pinHereDone: "Закреплён в этом чате",
        pinsExpandOther: "Ещё в других чатах и карточках",
        pinsCollapseOther: "Свернуть",
        compactMore: "ещё",
        focus: "в фокусе",
        activeHere: "активен",
        nearby: "рядом",
        watching: "наблюдает",
        background: "на периферии",
                offscreen: "за кадром",
        leftScene: "вышел",
        openNpc: "Открыть NPC",
        closeNpc: "Скрыть NPC",
        palettePreview: "Палитра темы",
        paletteMissing: "Превью палитры недоступно",
        hideThoughtLeaks: "Скрывать утёкшие мысли NPC из текста",
                pinnedList: "Закреплённые",
                noPinned: "Нет закреплённых персонажей",
                unpinFromList: "Открепить",
compactMode: "Фильтр отношений",
pinStorageMode: "Хранилище закрепов",
pinStoragePerChar: "В карточке",
pinStoragePerChat: "В чате",
pinStorageGlobal: "Глобально",
pinToChat: "Закрепить (чат)",
pinToChar: "Закрепить (карточка)",
pinToGlobal: "Закрепить (глобально)",
pinTierChat: "Ч",
pinTierChar: "К",
pinTierGlobal: "Г",
compactTop3: "Топ 3",
compactTop1: "Топ 1",
compactChanged: "Только изменившиеся",
compactAll: "Все",
debugXml: "Показать сырой XML",
noCompactChanges: "Изменений нет",
mood: "Настроение",
editXml: "Редактировать",
saveXml: "Сохранить",
cancelEdit: "Отмена",
xmlSaved: "XML сохранён",
xmlSaveFailed: "Ошибка сохранения",
defaultBoardMode: "По умолчанию",
boardModeFull: "Полный",
boardModeCompact: "Компактный",
boardModeCollapsed: "Свёрнутый",
        displayMode: "Режим отображения",
displayModes: "Режимы отображения",
displayInline: "В сообщениях",
displayFloating: "Плавающее окно",
displayPanel: "Панель",
panelPosition: "Сторона панели",
panelLeft: "Слева",
panelRight: "Справа",
panelOpen: "Открыть",
panelClose: "Закрыть",
panelFlipSide: "Переместить на другую сторону",
displayBoth: "Оба",
floatingTitle: "Infoboard",
        copyXml: "Копировать XML",
copiedXml: "Скопировано",
        pinNpc: "Закрепить NPC",
unpinNpc: "Открепить NPC",
        timeline: "Таймлайн",
        pins: "Закрепы",
        notifications: "Уведомления",
        enableNotif: "Включить уведомления",
        threshold: "Порог",
        notifSensitive: "Чувствительный",
        notifDefault: "По умолчанию",
        notifMajor: "Только крупные",
        notifDramatic: "Только критические",
        export: "Экспорт",
        import: "Импорт",
        debug: "XML",
        compact: "Компактный",
        collapse: "Свернуть",
        full: "Полный",
        open: "Открыть",
        locations: "Локации",
        privateThoughts: "Личные мысли",
        locationsHeader: "Локации",
        noSignificantChanges: "Нет значимых изменений",
        newCharacter: "🆕 Новый персонаж",
        appearedInScene: "появился в сцене",
        relationshipChange: "💫 Изменение отношений",
        relationshipTimeline: "Таймлайн отношений",
        noChangeHistory: "Нет истории изменений. Данные появятся после новых сообщений.",
        currentRelationships: "Текущие отношения",
        noTimelineData: "Нет данных для таймлайна. Отправьте сообщение для начала отслеживания.",
        tlGoToMessage: "Перейти к сообщению",
        tlMilestoneZero: "переход через 0",
        tlMilestone50: "±50",
        tlMilestone80: "±80",
        tlMilestoneSharpUp: "резкий рост",
        tlMilestoneSharpDown: "резкое падение",
        tlMilestoneStatus: "смена статуса",
        tlMetricAffection: "Привязанность",
        tlMetricTrust: "Доверие",
        tlMetricLove: "Любовь",
        tlMetricDots: "Точки",
        offscreenTag: "за кадром",
        exportComplete: "📤 Экспорт завершён",
        allDataExported: "Все данные экспортированы",
        importComplete: "📥 Импорт завершён",
        dataRestored: "Данные восстановлены",
        panelMode: "Панель",
        settingsTitle: "Настройки",
        useMacroMode: "Режим макроса {{InfoBoard}}",
        useMacroHelp: "Если вкл.: промт инжектится через макрос {{InfoBoard}}, который нужно вручную разместить в системном промте. Если выкл. (по умолчанию): автоинжект, как в оригинальном Infoboard.",
        injectPosition: "Позиция инжекта",
        injectPosAfter: "После Story String",
        injectPosChat: "В чате (глубина)",
        injectPosBefore: "Перед Story String",
        injectDepth: "Глубина",
        injectDepthHelp: "0 = последнее сообщение в контексте. Чем больше число, тем выше в истории чата.",
        inlineBoardCount: "Кол-во борд",
    },
    en: {
        enable: "Enable Infoboard",
        language: "Language",
        theme: "Theme",
        barStyle: "Bar Style",
        hideRaw: "Hide raw XML from messages",
        showNsfw: "Show NSFW section",
        hoverFx: "Enable stat hover effects",
        active: "✦ Extension is active",
        inactive: "Extension is inactive",
        currentState: "Current State:",
        noRecentUpdates: "No recent updates.",
        disabledPrompt: "Disabled — not injecting prompts.",
        chars: "Characters in Scene",
        rels: "Feelings Toward You",
        nsfw: "Intimate Context",
        affection: "💚 Affection",
                age: "♦ Age",
        trust: "💙 Trust",
        love: "💜 Love",
        aversion: "❤️‍🩹 Aversion",
        distrust: "🧡 Distrust",
        hatred: "🩸 Hatred",
        fetishes: "Fetishes",
        positions: "Positions",
        resetState: "Reset State",
        reprocess: "Reprocess Chat",
        exportState: "Export State",
        importState: "Import State",
        importFail: "Import failed. Invalid JSON.",
        resetConfirm: "Reset Infoboard state for this chat?",
        stateNpcLabel: "NPCs",
        title: "INFOBOARD",
        noStatus: "undefined",
        customCssLabel: "Custom CSS Overrides",
        customCssHelp: "Applied after built-in styles. Use to override colors, spacing, bars, or any Infoboard classes.",
        saveCustomCss: "Save Custom CSS",
        clearCustomCss: "Clear Custom CSS",
        clearCustomCssConfirm: "Clear custom CSS?",
        cleanOrphanSnapshots: "Clean Orphaned Snapshots",
        cleanOrphanSnapshotsConfirm: "Remove snapshot data for pinned NPCs that are no longer pinned anywhere? Active pins are not affected.",
        pinEditor: "Editor",
        allPins: "All Pins",
        allPinsUnpin: "Unpin",
        allPinsNavigate: "Go to source: {source}",
        pinNavNotFound: "Character card not found",
        pinHere: "Pin in this chat",
        pinHereAlready: "Already pinned in this context",
        pinHereDone: "Pinned in this chat",
        pinsExpandOther: "More in other chats and cards",
        pinsCollapseOther: "Collapse",
        compactMore: "more",
        focus: "focus",
        activeHere: "active",
        nearby: "nearby",
        watching: "watching",
        background: "background",
                offscreen: "offscreen",
        leftScene: "left",
        openNpc: "Open NPC",
        closeNpc: "Hide NPC",
        palettePreview: "Theme palette",
        paletteMissing: "Palette preview unavailable",
        hideThoughtLeaks: "Hide leaked NPC thoughts from visible text",
                pinnedList: "Pinned",
                noPinned: "No pinned characters",
                unpinFromList: "Unpin",
compactMode: "Relationship Filter",
pinStorageMode: "Pin Storage",
pinStoragePerChar: "In Card",
pinStoragePerChat: "In Chat",
pinStorageGlobal: "Global",
pinToChat: "Pin (chat)",
pinToChar: "Pin (character)",
pinToGlobal: "Pin (globally)",
pinTierChat: "C",
pinTierChar: "H",
pinTierGlobal: "G",
compactTop3: "Top 3",
compactTop1: "Top 1",
compactChanged: "Changed only",
compactAll: "All",
debugXml: "Show raw XML",
noCompactChanges: "No changes",
mood: "Mood",
editXml: "Edit",
saveXml: "Save",
cancelEdit: "Cancel",
xmlSaved: "XML saved",
xmlSaveFailed: "Save failed",
defaultBoardMode: "Default",
boardModeFull: "Full",
boardModeCompact: "Compact",
boardModeCollapsed: "Collapsed",
        displayMode: "Display Mode",
displayModes: "Display Modes",
displayInline: "Inline",
displayFloating: "Floating",
displayPanel: "Panel",
panelPosition: "Panel side",
panelLeft: "Left",
panelRight: "Right",
panelOpen: "Open",
panelClose: "Close",
panelFlipSide: "Move to other side",
displayBoth: "Both",
floatingTitle: "Infoboard",
        copyXml: "Copy XML",
copiedXml: "Copied",
        pinNpc: "Pin NPC",
unpinNpc: "Unpin NPC",
        timeline: "Timeline",
        pins: "Pins",
        notifications: "Notifications",
        enableNotif: "Enable notifications",
        threshold: "Threshold",
        notifSensitive: "Sensitive",
        notifDefault: "Default",
        notifMajor: "Major only",
        notifDramatic: "Dramatic only",
        export: "Export",
        import: "Import",
        debug: "XML",
        compact: "Compact",
        collapse: "Collapse",
        full: "Full",
        open: "Open",
        locations: "Locations",
        privateThoughts: "Private Thoughts",
        locationsHeader: "Location",
        noSignificantChanges: "No significant changes",
        newCharacter: "🆕 New Character",
        appearedInScene: "appeared in the scene",
        relationshipChange: "💫 Relationship Change",
        relationshipTimeline: "Relationship Timeline",
        noChangeHistory: "No change history yet. Data will appear after new messages.",
        currentRelationships: "Current Relationships",
        noTimelineData: "No timeline data. Send a message to start tracking.",
        tlGoToMessage: "Go to message",
        tlMilestoneZero: "crossed 0",
        tlMilestone50: "±50",
        tlMilestone80: "±80",
        tlMilestoneSharpUp: "sharp rise",
        tlMilestoneSharpDown: "sharp drop",
        tlMilestoneStatus: "status change",
        tlMetricAffection: "Affection",
        tlMetricTrust: "Trust",
        tlMetricLove: "Love",
        tlMetricDots: "Dots",
        offscreenTag: "offscreen",
        exportComplete: "📤 Export Complete",
        allDataExported: "All data exported",
        importComplete: "📥 Import Complete",
        dataRestored: "Data restored",
        panelMode: "Panel",
        settingsTitle: "Settings",
        useMacroMode: "Macro mode {{InfoBoard}}",
        useMacroHelp: "When on: prompt is injected via {{InfoBoard}} macro, which you must manually place in your system prompt. When off (default): auto-inject like the original Infoboard.",
        injectPosition: "Inject position",
        injectPosAfter: "After Story String",
        injectPosChat: "In Chat (depth)",
        injectPosBefore: "Before Story String",
        injectDepth: "Depth",
        injectDepthHelp: "0 = last message in context. Higher values inject further up in chat history.",
        inlineBoardCount: "Board count",
    }
};

const kSystemPromptRu = `Infoboard:
Append exactly one XML block at the end of every assistant response. Fill all values in Russian. Keep it concise, accurate, and updated every message.

Format:
<infoboard time="" date="" weather="" loc="">
<chars>
<c icon="" name="" age="" tags="" mood="" presence="" />
</chars>
<rels>
<rel source="" target="{{user}}" a="" ac="" tr="" tc="" l="" lc="" status="" />
</rels>
<thk></thk>
</infoboard>

Optional only for explicitly intimate scenes:
<nsfw f="" p="" />

<infoboard_rules>
- CRITICAL: Output exactly one <infoboard> block in every message
- Fill all values in Russian except of presence
- CRITICAL: You MUST include ALL NPCs listed in the [INFOBOARD STATE]
- Add one <c /> for each NPC currently present
- Use the exact same full NPC name in <chars name="">, <rel source="">, and <thk>
- Never shorten NPC names in <rel> or <thk>
- Never include User's character as NPC in infoboard
- age: age of the character (e.g., "24")
- tags: 1-6 short tags separated by |
- time: per-message change, usually +5
- date: DD.MM.YY only

- Never put presence info in "tags" attribute
- presence: Use one of these EXACT ENGLISH KEYWORDS to indicate present NPCs:
  1. "focus": means NPC is in the conversation AND physically touching {{user}}.
  2. "active": means NPC is in the room, within {{user}}'s physical reach AND participating in {{user}}'s conversation or action REGARDLESS of distance.
  3. "near": means NPC is in the room, within {{user}}'s physical reach, but passive and minding their own business (e.g., interacting with other NPCs, just being nearby).
  4. "watching": means NPC is not actively participating, but intently paying attention and observing the scene.
  5. "background": means NPC is not observing and not participating in {{user}}'s interactions; visible or audible (crowd, servants, patrons) but irrelevant to the current action (eg. on a balcony, far away in the room, around the corner or in another room).
  6. "left": ALWAYS used ONLY for NPCs that are LEAVING the scene in your current output; NEVER use "left" for NPCs who left in previous turn.
  7. "offscreen": means NPC's not physically present in the scene AND is STRICTLY RESERVED for NPCs in [INFOBOARD STATE].

- "offscreen" NPCs must focus on THEIR OWN tasks and plans independent from {{user}}'s
- "offscreen" NPCs CAN NOT know what {{user}} says or does; their thoughts MUST NOT reflect on what {{user}} is doing right now in the scene
- "offscreen" NPCs are NPCs that left the scene and are pinned in [INFOBOARD STATE]
- "(pinned)" рядом с presence НПЦ в [INFOBOARD STATE] — это системная метка, никогда не включай её в атрибут tags

- CRITICAL: If an NPC is NOT in [INFOBOARD STATE] and is about to leave the scene -> mark them as "left" in the next output
- CRITICAL: If an NPC is NOT in [INFOBOARD STATE] and labeled as "left" and/or is labeled as "offscreen" -> OMIT them completely from the next output

- Add one <rel /> per present NPC describing feelings toward {{user}} only
- Add <rel /> only for the 1-3 most relevant present NPCs
- a, tr, l: from -100 to 100
- ac, tc, lc: per-message change, usually within -2..+2 unless major event
- Negative affection = aversion/dislike
- Negative trust = distrust/suspicion/fear
- Negative love = hatred/destructive obsession/anti-attachment
- Relationship values must evolve logically
- status: 1-3 words only, relationship phase/status only
- status: must not describe events, thoughts, explanations, or causes
- Never write full sentences in status
- Good status examples: заинтересована | доверяет | тянется | защитная привязанность | сложное влечение
- Bad status examples: её слова о душе пробили защитные слои | впервые не знает что сказать | привязанность перешла в новую фазу
- Put all NPC private thoughts (first person, present tense) into one <thk> block
- One NPC per line in <thk>
- Never include {{user}}'s thoughts in <thk>
- Never decide for {{user}} in character's thoughts; only character's opinions on {{user}}, on {{user}}'s previous actions and appearance

- Private NPC thoughts: max 1 sentence and max 30 words per NPC
- Do not explain feelings in <thk>; write only the immediate private thought
- Never output private NPC thoughts in the visible narrative text
- Private thoughts must appear only inside <thk>
- Never write <thk> thoughts as visible lines before the infoboard
- No "Имя: мысль" thought list in narrative
- Omit <nsfw /> if the scene is not intimate
- No extra XML tags or commentary
- Never output private NPC thoughts in the visible narrative text; private thoughts must appear only inside <thk>
- Never write <thk> thoughts as visible lines before the infoboard; no "Имя: мысль" thought list in narrative
- mood: 1-3 words, visible current emotional state only; leave empty if unclear
- Do not duplicate mood inside tags
- Always generate <thk> thoughts for ALL pinned characters listed in the state, even if they are silent or in the offscreen
- Maintain logical progression of relationship values (a, tr, l) for all present characters based on the conversation context

- CRITICAL: NEVER perceive the location as a call to action - User stay where they said they are
- CRITICAL: If it's not DIRECTLY asked by {{user}} - NEVER decide for {{user}} and NEVER describe or rewrite {{user}}'s speech or actions, it's User's character to play!

<thk> strict format:
- Use the exact full NPC name exactly as in <chars>
- Always write the name before the thought
- Never shorten names
- No markdown, quotes, asterisks, or brackets
- No thoughts of NPCs that are not listed in [INFOBOARD STATE]
- No echo of what's happened
- Format only: Полное Имя: мысль
</infoboard_rules>`;

const kSystemPromptEn = `Infoboard:
Append exactly one XML block at the end of every assistant response. Fill all values in English. Keep it concise, accurate, and updated every message.

Format:
<infoboard time="" date="" weather="" loc="">
<chars>
<c icon="" name="" age="" tags="" mood="" presence="" />
</chars>
<rels>
<rel source="" target="{{user}}" a="" ac="" tr="" tc="" l="" lc="" status="" />
</rels>
<thk></thk>
</infoboard>

Optional only for explicitly intimate scenes:
<nsfw f="" p="" />

<infoboard_rules>
- CRITICAL: Output exactly one <infoboard> block in every message
- Fill all values in English
- CRITICAL: You MUST include ALL NPCs listed in the [INFOBOARD STATE]
- Add one <c /> for each NPC currently present
- Use the exact same full NPC name in <chars name="">, <rel source="">, and <thk>
- Never shorten NPC names in <rel> or <thk>
- Never include User's character as NPC in infoboard
- age: age of the character (e.g., "24")
- tags: 1-6 short tags separated by |
- time: per-message change, usually +5
- date: DD.MM.YY only

- Never put presence info in "tags" attribute
- presence: Use one of these EXACT ENGLISH KEYWORDS to indicate present NPCs:
  1. "focus": means NPC is in the conversation AND physically touching {{user}}.
  2. "active": means NPC is in the room, within {{user}}'s physical reach AND participating in {{user}}'s conversation or action REGARDLESS of distance.
  3. "near": means NPC is in the room, within {{user}}'s physical reach, but passive and minding their own business (e.g., interacting with other NPCs, just being nearby).
  4. "watching": means NPC is not actively participating, but intently paying attention and observing the scene.
  5. "background": means NPC is not observing and not participating in {{user}}'s interactions; visible or audible (crowd, servants, patrons) but irrelevant to the current action (eg. on a balcony, far away in the room, around the corner or in another room).
  6. "left": ALWAYS used ONLY for NPCs that are LEAVING the scene in your current output; NEVER use "left" for NPCs who left in previous turn.
  7. "offscreen": means NPC's not physically present in the scene AND is STRICTLY RESERVED for NPCs in [INFOBOARD STATE].

- "offscreen" NPCs must focus on THEIR OWN tasks and plans independent from {{user}}'s
- "offscreen" NPCs CAN NOT know what {{user}} says or does; their thoughts MUST NOT reflect on what {{user}} is doing right now in the scene
- "offscreen" NPCs are NPCs that left the scene and are pinned in [INFOBOARD STATE]
- "(pinned)" next to NPC presence in [INFOBOARD STATE] is a system label — never include it in tags attribute

- CRITICAL: If an NPC is NOT in [INFOBOARD STATE] and is about to leave the scene -> mark them as "left" in the next output
- CRITICAL: If an NPC is NOT in [INFOBOARD STATE] and labeled as "left" and/or is labeled as "offscreen" -> OMIT them completely from the next output

- Add one <rel /> per present NPC describing feelings toward {{user}} only
- Add <rel /> only for the 1-3 most relevant present NPCs
- a, tr, l: from -100 to 100
- ac, tc, lc: per-message change, usually within -2..+2 unless major event
- Negative affection = aversion/dislike
- Negative trust = distrust/suspicion/fear
- Negative love = hatred/destructive obsession/anti-attachment
- Relationship values must evolve logically
- status: 1-3 words only, relationship phase/status only
- status: must not describe events, thoughts, explanations, or causes
- Never write full sentences in status
- Good status examples: interested | trusts you | drawn in | protective attachment | complicated attraction
- Bad status examples: her words pierced his defenses | he does not know what to say | attachment moved into a new phase
- Put all NPC private thoughts (first person, present tense) into one <thk> block
- One NPC per line in <thk>
- Never include {{user}}'s thoughts in <thk>
- Never decide for {{user}} in character's thoughts; only character's opinions on {{user}}, on {{user}}'s previous actions and appearance

- Private NPC thoughts: max 1 sentence and max 20 words per NPC
- Do not explain feelings in <thk>; write only the immediate private thought
- Never output private NPC thoughts in the visible narrative text
- Private thoughts must appear only inside <thk>
- Never write <thk> thoughts as visible lines before the infoboard
- No "Name: thought" thought list in narrative
- Omit <nsfw /> if the scene is not intimate
- No extra XML tags or commentary
- Never output private NPC thoughts in the visible narrative text; private thoughts must appear only inside <thk>
- Never write <thk> thoughts as visible lines before the infoboard; no "Имя: мысль" thought list in narrative
- mood: 1-3 words, visible current emotional state only; leave empty if unclear
- Do not duplicate mood inside tags
- Always generate <thk> thoughts for ALL pinned characters listed in the state, even if they are silent or in the offscreen
- Maintain logical progression of relationship values (a, tr, l) for all present characters based on the conversation context

- CRITICAL: NEVER perceive the location as a call to action - User stay where they said they are
- CRITICAL: If it's not DIRECTLY asked by {{user}} - NEVER decide for {{user}} and NEVER describe or rewrite {{user}}'s speech or actions, it's User's character to play!

<thk> strict format:
- Use the exact full NPC name exactly as in <chars>
- Always write the name before the thought
- Never shorten names
- No markdown, quotes, asterisks, or brackets
- No thoughts of NPCs that are not listed in [INFOBOARD STATE]
- No echo of what's happened
- Format only: Full Name: thought
</infoboard_rules>`;

const kDefaultState = {
    time: "???",
    date: "???",
    weather: "???",
    loc: "???",
    chars: [],
    rels: [],
    thoughts: [],
    nsfw: null
};

let gState = structuredClone(kDefaultState);

/**
 * Returns a merged state object that includes pinned NPCs from snapshots
 * even when they're not in the current chat's gState.
 * Used for panel/floating board rendering so globally pinned NPCs remain visible.
 */
function GetMergedStateForRendering() {
    const merged = structuredClone(gState);

    if (!gPinRegistry?.pinSnapshots || !gPinnedNpcs.length) return merged;

    // Build set of NPC names already in current state (normalized)
    const stateCharNames = new Set(merged.chars.map(c => NormalizeName(c.name)));

    for (const pinnedName of gPinnedNpcs) {
        const normalized = NormalizeName(pinnedName);
        if (stateCharNames.has(normalized)) continue;

        const snap = gPinRegistry.pinSnapshots[normalized];
        if (!snap) continue;

        // Add character with offscreen presence
        merged.chars.push({
            icon: snap.icon || "•",
            name: snap.name,
            age: snap.age || "",
            tags: snap.tags || [],
            mood: snap.mood || "",
            presence: { key: "offscreen", cls: "ib-presence-offscreen" }
        });

        // Add relation from snapshot
        if (snap.rel) {
            merged.rels.push({ ...snap.rel });
        }

        // Add thought from snapshot
        if (snap.thought) {
            merged.thoughts.push({ ...snap.thought });
        }
    }

    return merged;
}

function T(key, params = {}) {
    let str = kLang[gLang]?.[key] ?? key;
    for (const [k, v] of Object.entries(params)) {
        str = str.replaceAll(`{${k}}`, v);
    }
    return str;
}

function GetThemeTitleData(theme = gTheme) {
    const map = {
        gryffindor: {
            main: "𓃬 𝔊𝔯𝔶𝔣𝔣𝔦𝔫𝔡𝔬𝔯 𓃬",
            sub: "✩₊˚.⋆🦁⋆⁺₊✧"
        },
        slytherin: {
            main: "𓆙 𝔖𝔩𝔶𝔱𝔥𝔢𝔯𝔦𝔫 𓆙",
            sub: "⊹₊˚‧︵‿₊🐍₊‿︵‧˚₊⊹"
        },
        ravenclaw: {
            main: "𓄿 ℜ𝔞𝔳𝔢𝔫𝔠𝔩𝔞𝔴 𓄿",
            sub: "✦•┈๑⋅⋯🦅⋯⋅๑┈•✦"
        },
        hufflepuff: {
            main: "𓃮 ℌ𝔲𝔣𝔣𝔩𝔢𝔭𝔲𝔣𝔣 𓃮",
            sub: "-ˋˏ ༻❁🦡❀༺ ˎˊ-"
        },
        gengar: {
    main: "☠ 𝔊𝔢𝔫𝔤𝔞𝔯 ☠",
    sub: "𖦹 ⋆ ˚｡🩻｡˚ ⋆ 𖦹"
},
        systemlog: {
    main: "▾ SYSTEM LOG // ACCESS GRANTED 🖳",
    sub: "↳ task issued · signal stable · archive open ✔"
},

terminal: {
    main: "INFOBOARD // USER ACCESS",
    sub: "> relationship data loaded"
},

oraclemoon: {
    main: "ORACLE BOARD // SPREAD OPENED",
    sub: "omens aligned · hidden motive revealed"
},

        bloodmoon: {
    main: "𝐵𝐿𝒪𝒪𝒟 𝑀𝒪𝒪𝒩",
    sub: ""
},

casefile: {
    main: "CASE FILE // SUBJECT RELATIONS",
    sub: "˖⌕ ۫ . . . .𖥔"
},

obsidianregistry: {
    main: "Infoboard",
    sub: ""
},
        
        neonquest: {
    main: "𝄃𝄃𝄂𝄂𝄀RP BOARD𝄁𝄃𝄂𝄂𝄃",
    sub: "█Err⃟⃤r⁴⁰⁴"
},
        
        shockwave: {
    main: "☣..𝚁𝚎𝚊𝚌𝚝𝚒𝚘𝚗 𝚝𝚛𝚊𝚌𝚔𝚒𝚗𝚐..☣",
    sub: ""
},
        
lockdown: {
    main: "𝕋𝕒𝕣𝕘𝕖𝕥 𖦏 𝕕𝕖𝕥𝕖𝕔𝕥𝕖𝕕",
    sub: ""
},
        
hotrod: {
    main: "▶Infoboard◀",
    sub: "🏁...........🏎.."
}
    };

    return map[theme] || {
        main: T("title"),
        sub: ""
    };
}

function GetThemeLocationIcon(theme = gTheme) {
    const facultyThemes = ["gryffindor", "slytherin", "ravenclaw", "hufflepuff"];
    if (theme === "gengar") return "🕯️";
    if (theme === "systemlog") return "💾";
        if (theme === "terminal") return "▣";
    if (theme === "oraclemoon") return "🌙";
    if (theme === "bloodmoon") return "🦇";
        if (theme === "casefile") return "🔍";
    if (theme === "obsidianregistry") return "⟡";
    if (theme === "neonquest") return "⚙️";
    if (theme === "shockwave") return "⚛︎";
if (theme === "lockdown") return "⌖";
if (theme === "hotrod") return "▰";
     return facultyThemes.includes(theme) ? "📜" : "📍";
}

function GetThemeCharsIcon(theme = gTheme) {
    const facultyThemes = ["gryffindor", "slytherin", "ravenclaw", "hufflepuff"];
    if (theme === "gengar") return "👻";
    if (theme === "systemlog") return "📊";
    if (theme === "terminal") return ">";
    if (theme === "oraclemoon") return "✨";
    if (theme === "bloodmoon") return "✟";
    if (theme === "casefile") return "ID";
    if (theme === "obsidianregistry") return "᯽";
    if (theme === "neonquest") return "👤";
    if (theme === "shockwave") return "⚙";
if (theme === "lockdown") return "◎";
if (theme === "hotrod") return "▣";
        return facultyThemes.includes(theme) ? "🪶" : "💖";
}

function GetThemeRelationsIcon(theme = gTheme) {
    const map = {
        gryffindor: "❤️",
        slytherin: "💚",
        ravenclaw: "💙",
        hufflepuff: "💛",
        gengar: "💜",
        systemlog: "🔗",
        oraclemoon: "💫",
        terminal: "♡",
        bloodmoon: "🥀",
        casefile: "𖦏",
        obsidianregistry: "✶",
        neonquest: "🤖",
        shockwave: "🧪",
lockdown: "💥",
hotrod: "➤",
    };

    return map[theme] || "🤍";
}

function GetThemePreview(theme = gTheme) {
    return kThemePreviewMap[theme] || kThemePreviewMap.nocturne;
}

function UpdateThemePreview(theme = gTheme) {
    const preview = GetThemePreview(theme);

    const $wrap = $("#ib_theme_preview");
    if (!$wrap.length) return;

    const setSwatch = (selector, color) => {
        const $el = $wrap.find(selector);
        if ($el.length) {
            $el.css("background", color || "#555");
        }
    };

    setSwatch(".ib-swatch-bg", preview.bg);
    setSwatch(".ib-swatch-bg2", preview.bg2);
    setSwatch(".ib-swatch-accent", preview.accent);
    setSwatch(".ib-swatch-accent2", preview.accent2);
    setSwatch(".ib-swatch-text", preview.text);
    setSwatch(".ib-swatch-danger", preview.danger);
    setSwatch(".ib-swatch-green", preview.green);
    setSwatch(".ib-swatch-dim", preview.dim);

    const text = preview?.label?.[gLang] || T("paletteMissing");
    $("#ib_theme_preview_label").text(`${T("palettePreview")}: ${text}`);
}

function GetUserName() {
    try {
        const stContext = SillyTavern.getContext();
        return (
            stContext.name1 ||
            stContext.chatMetadata?.persona ||
            stContext.user?.name ||
            "User"
        );
    } catch {
        return "User";
    }
}

function ApplyCustomCss() {
    let styleEl = document.getElementById("ib_custom_css_style");
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "ib_custom_css_style";
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = gCustomCss || "";
}

function GetChatId() {
    try {
        const ctx = SillyTavern.getContext();
        if (ctx.chatId) return String(ctx.chatId);
        const char = ctx.characters?.[ctx.characterId];
        if (char) {
            const charName = String(char.name || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_');
            const chatFile = String(char.chat || '');
            if (chatFile) {
                return `${charName}_${chatFile}`;
            }
        }
        if (ctx.chatMetadata?.chat_id) return String(ctx.chatMetadata.chat_id);
        if (char && Array.isArray(ctx.chat) && ctx.chat.length > 0) {
            const charName = String(char.name || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_');
            const firstMsg = ctx.chat[0]?.mes || '';
            let hash = 0;
            for (let i = 0; i < Math.min(firstMsg.length, 100); i++) {
                hash = ((hash << 5) - hash + firstMsg.charCodeAt(i)) | 0;
            }
            return `${charName}_msg${Math.abs(hash)}`;
        }
    } catch (e) {
        console.warn('[IB] GetChatId failed:', e);
    }
    return 'default';
}

function GetStorageKey() {
    return kStorageKeyPrefix + GetChatId();
}

// ============== Timeline ==============
function GetTimelineKey() {
    return kTimelineKey + GetChatId();
}

function LoadTimeline() {
    try {
        const raw = localStorage.getItem(GetTimelineKey());
        gTimeline = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(gTimeline)) gTimeline = [];
    } catch {
        gTimeline = [];
    }
}

function SaveTimeline() {
    try {
        localStorage.setItem(GetTimelineKey(), JSON.stringify(gTimeline));
    } catch (e) {
        console.warn("[IB] Save timeline failed:", e);
    }
}

function RebuildTimelineFromChat() {
    try {
        const ctx = SillyTavern.getContext();
        if (!Array.isArray(ctx.chat) || !ctx.chat.length) return;

        gTimeline = [];

        for (let i = 0; i < ctx.chat.length; i++) {
            const msg = ctx.chat[i];
            if (!msg || msg.is_user) continue;

            const parsed = ParseInfoboard(msg.mes || "");
            if (!parsed?.rels?.length) continue;

            const entry = {
                ts: Date.now() - (ctx.chat.length - i) * 60000,
                msgIndex: i,
                gameTime: parsed.time || "",
                gameDate: parsed.date || "",
                rels: parsed.rels.map(r => ({
                    source: r.source,
                    a: r.a, tr: r.tr, l: r.l,
                    status: r.status
                }))
            };

            const last = gTimeline[gTimeline.length - 1];
            const same = last && RelsEqual(last.rels, entry.rels);
            if (!same) {
                gTimeline.push(entry);
            }
        }

        if (gTimeline.length > 200) gTimeline = gTimeline.slice(-200);
        SaveTimeline();
    } catch (e) {
        console.warn("[IB] RebuildTimelineFromChat failed:", e);
    }
}

function AddTimelineEntry(rels) {
    if (!rels?.length) return;
    const entry = {
        ts: Date.now(),
        msgIndex: (SillyTavern.getContext().chat?.length || 0) - 1,
        gameTime: gState.time || "",
        gameDate: gState.date || "",
        rels: rels.map(r => ({
            source: r.source,
            a: r.a, tr: r.tr, l: r.l,
            status: r.status
        }))
    };
    // Only add if something changed compared to last entry
    const last = gTimeline[gTimeline.length - 1];
    if (last) {
        const same = RelsEqual(last.rels, entry.rels);
        if (same) return;
    }
    gTimeline.push(entry);
    // Keep max 200 entries
    if (gTimeline.length > 200) gTimeline = gTimeline.slice(-200);
    SaveTimeline();
}

/** Close all toolbar popups except timeline (theme, settings, pins, notifications). */
function CloseOtherPopups(exceptSelector) {
    const popupSelectors = [".ib-theme-popup", ".ib-settings-popup", ".ib-pins-popup", ".ib-notifications-popup"];
    for (const sel of popupSelectors) {
        if (sel !== exceptSelector) {
            document.querySelectorAll(sel).forEach(p => p.remove());
        }
    }
}

function RenderThemePopup(btn) {
    let existing = document.querySelector(".ib-theme-popup");
    if (existing) {
        const sameBtn = existing.__sourceBtn === btn;
        CloseOtherPopups(".ib-theme-popup");
        existing.remove();
        if (sameBtn) return;
    } else {
        CloseOtherPopups(".ib-theme-popup");
    }

    const popup = document.createElement("div");
    popup.className = `ib-theme-popup ib-popup-fixed ${GetThemeClassStr()}`;
    popup.__sourceBtn = btn;

    let content = `<div class="ib-theme-popup-grid">`;

    const themeKeys = Object.keys(kThemePreviewMap);
    themeKeys.forEach(key => {
        const p = kThemePreviewMap[key];
        const label = p?.label?.[gLang] || key;
        const isActive = key === gTheme;
        content += `
        <div class="ib-theme-popup-item${isActive ? " ib-theme-popup-active" : ""}" data-ib-theme="${key}">
            <div class="ib-theme-popup-palette">
                <span class="ib-theme-popup-swatch" style="background:${p.bg}"></span>
                <span class="ib-theme-popup-swatch" style="background:${p.bg2}"></span>
                <span class="ib-theme-popup-swatch" style="background:${p.accent}"></span>
                <span class="ib-theme-popup-swatch" style="background:${p.accent2}"></span>
                <span class="ib-theme-popup-swatch" style="background:${p.text}"></span>
                <span class="ib-theme-popup-swatch" style="background:${p.danger}"></span>
            </div>
            <div class="ib-theme-popup-label">${EscapeHtml(label)}</div>
        </div>`;
    });

    content += `</div>`;
    popup.innerHTML = content;
    document.body.appendChild(popup);

    PositionPopupNearButton(popup, btn);

    // Scroll active theme item into center of the grid (after position is computed)
    requestAnimationFrame(() => {
        const activeItem = popup.querySelector(".ib-theme-popup-active");
        if (activeItem) {
            activeItem.scrollIntoView({ block: "center", behavior: "instant" });
        }
    });

    // Click handlers — mirror the settings <select> behaviour
    popup.querySelectorAll(".ib-theme-popup-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            const themeKey = item.dataset.ibTheme;
            if (!themeKey) return;

            // Just set the hidden select & trigger its change handler
            // (the handler saves to localStorage, updates preview, and reprocesses)
            $("#ib_theme").val(themeKey).trigger("change");

            // Close popup after selection
            popup.remove();
        });
    });

    const closeHandler = (ev) => {
        if (!ev.target.closest(".ib-theme-popup") && !ev.target.closest(".ib-btn-theme")) {
            document.querySelectorAll(".ib-theme-popup").forEach(p => p.remove());
            document.removeEventListener("click", closeHandler);
        }
    };
    setTimeout(() => { document.addEventListener("click", closeHandler); }, 10);
}

function RenderTimelinePopup(preselectNpc) {
    let existing = document.getElementById("ib_timeline_popup");
    document.querySelectorAll(".ib-settings-popup").forEach(p => p.remove());
    if (existing) {
        // If popup is already open and a specific NPC is requested, switch to that NPC tab
        if (preselectNpc) {
            const tab = existing.querySelector(`.ib-tl-npc-tab[data-npc="${CSS.escape(preselectNpc)}"]`);
            if (tab) {
                tab.click();
                return;
            }
        }
        // Otherwise toggle OFF (e.g. clicking the same toolbar button again)
        existing.remove();
        return;
    }

    const popup = document.createElement("div");
    popup.id = "ib_timeline_popup";
    popup.className = `ib-timeline-popup ${GetThemeClassStr()}`;

    const allNpcNames = [...new Set(gTimeline.flatMap(e => (e.rels || []).map(r => r.source)))];

    // Rebuild timeline from chat if it's empty
    if (!gTimeline.length) {
        RebuildTimelineFromChat();
    }

    // Also include current state rels for NPCs not in timeline
    if (!allNpcNames.length && gState.rels?.length) {
        popup.innerHTML = `<div class="ib-tl-header">
            <div class="ib-tl-title">📈 ${EscapeHtml(T("relationshipTimeline"))}</div>
            <button class="ib-tl-close" type="button">×</button>
        </div>
        <div class="ib-tl-empty">${EscapeHtml(T("noChangeHistory"))}</div>
        <div class="ib-tl-current-state">
            <div class="ib-tl-current-title">${EscapeHtml(T("currentRelationships"))}</div>
            ${gState.rels.map(r => `<div class="ib-tl-entry">
                <span class="ib-tl-stat-name">${EscapeHtml(r.source)}</span>
                <span class="ib-tl-stat ib-tl-a">A:${r.a}</span>
                <span class="ib-tl-stat ib-tl-tr">T:${r.tr}</span>
                <span class="ib-tl-stat ib-tl-l">L:${r.l}</span>
                <span class="ib-tl-status">${EscapeHtml(r.status || '')}</span>
            </div>`).join('')}
        </div>`;
        document.body.appendChild(popup);
        popup.querySelector('.ib-tl-close').addEventListener('click', () => popup.remove());
        return;
    }
    
    if (!allNpcNames.length) {
        popup.innerHTML = `<div class="ib-tl-empty">${EscapeHtml(T("noTimelineData"))}</div>`;
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 3000);
        return;
    }

    // Pre-select the NPC that was clicked, or fall back to first
    let selectedNpc = allNpcNames[0];
    if (preselectNpc) {
        const match = allNpcNames.find(n => NamesLikelyMatch(n, preselectNpc));
        if (match) selectedNpc = match;
    }

    // Metric filter state
    let showA = true, showTr = true, showL = true;

    // Zoom state
    let zoomLevel = 1;
    let showDots = true;
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 10;
    const ZOOM_STEP = 0.5;
    const ZOOM_WHEEL_STEP = 0.2;
    const ZOOM_MIN_ENTRIES = 0;
    // Pinch-zoom tracking
    let pinchStartDist = 0;
    let pinchStartZoom = 1;

    function computeMilestones(npcEntries) {
        const milestones = [];
        for (let i = 1; i < npcEntries.length; i++) {
            const prev = npcEntries[i - 1].rel;
            const cur = npcEntries[i].rel;
            const idx = npcEntries[i].msgIndex;
            const labels = [];

            // Crossed 0
            for (const key of ['a', 'tr', 'l']) {
                if ((prev[key] < 0 && cur[key] >= 0) || (prev[key] >= 0 && cur[key] < 0)) {
                    const metricLabel = key === 'a' ? 'A' : key === 'tr' ? 'T' : 'L';
                    labels.push(`${metricLabel} ${T("tlMilestoneZero")}`);
                }
            }
            // Crossed ±50
            for (const key of ['a', 'tr', 'l']) {
                if ((Math.abs(prev[key]) < 50 && Math.abs(cur[key]) >= 50)) {
                    const metricLabel = key === 'a' ? 'A' : key === 'tr' ? 'T' : 'L';
                    labels.push(`${metricLabel} ${T("tlMilestone50")}`);
                }
            }
            // Crossed ±80
            for (const key of ['a', 'tr', 'l']) {
                if ((Math.abs(prev[key]) < 80 && Math.abs(cur[key]) >= 80)) {
                    const metricLabel = key === 'a' ? 'A' : key === 'tr' ? 'T' : 'L';
                    labels.push(`${metricLabel} ${T("tlMilestone80")}`);
                }
            }
            // Sharp change (±15 delta)
            for (const key of ['a', 'tr', 'l']) {
                const delta = cur[key] - prev[key];
                if (delta >= 15) {
                    const metricLabel = key === 'a' ? 'A' : key === 'tr' ? 'T' : 'L';
                    labels.push(`${metricLabel} ${T("tlMilestoneSharpUp")} (+${delta})`);
                } else if (delta <= -15) {
                    const metricLabel = key === 'a' ? 'A' : key === 'tr' ? 'T' : 'L';
                    labels.push(`${metricLabel} ${T("tlMilestoneSharpDown")} (${delta})`);
                }
            }

            // Status change
            if (prev.status && cur.status && prev.status !== cur.status) {
                labels.push(`${EscapeHtml(prev.status)} → ${EscapeHtml(cur.status)}`);
            }

            if (labels.length) {
                milestones.push({ index: i, msgIndex: idx, labels });
            }
        }
        return milestones;
    }

    function buildContent() {
        const entries = gTimeline.filter(e => e.rels?.some(r => NamesLikelyMatch(r.source, selectedNpc)));
        const npcEntries = entries.map(e => {
            const r = e.rels.find(r => NamesLikelyMatch(r.source, selectedNpc));
            return r ? { ...e, rel: r } : null;
        }).filter(Boolean);

        const milestones = computeMilestones(npcEntries);

        let graphHtml = '';
        const canZoom = npcEntries.length >= ZOOM_MIN_ENTRIES;
        if (npcEntries.length > 1) {
            const baseW = 100;
            const h = 40;
            const w = baseW * zoomLevel;
            const step = w / Math.max(1, npcEntries.length - 1);

            function makePoints(key) {
                return npcEntries.map((e, i) => {
                    const x = (i * step).toFixed(1);
                    const val = Clamp(e.rel[key] || 0, -100, 100);
                    const y = h - ((val + 100) / 200 * h);
                    return `${x},${y.toFixed(1)}`;
                }).join(' ');
            }

            // Milestone markers on graph
            let milestoneSvg = '';
            milestones.forEach(m => {
                const x = (m.index * step).toFixed(1);
                milestoneSvg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="rgba(255,200,80,0.3)" stroke-width="0.4" stroke-dasharray="1,1"/>`;
            });

            // Data point circles for click interaction
            let dotsSvg = '';
            if (showDots) {
                const metricKeys = [];
                if (showA) metricKeys.push({ key: 'a', cls: 'ib-tl-dot-a' });
                if (showTr) metricKeys.push({ key: 'tr', cls: 'ib-tl-dot-tr' });
                if (showL) metricKeys.push({ key: 'l', cls: 'ib-tl-dot-l' });

                metricKeys.forEach(mk => {
                    npcEntries.forEach((e, i) => {
                        const x = (i * step).toFixed(1);
                        const val = Clamp(e.rel[mk.key] || 0, -100, 100);
                        const y = h - ((val + 100) / 200 * h);
                        dotsSvg += `<circle cx="${x}" cy="${y.toFixed(1)}" r="1.2" class="ib-tl-dot ${mk.cls}" data-idx="${i}" fill="currentColor"/>`;
                    });
                });
            }

            graphHtml = `<div class="ib-tl-graph-viewport">
                <div class="ib-tl-graph-canvas" style="min-width:100%;">
                    <div class="ib-tl-graph-wrap">
                        <svg viewBox="0 0 ${w.toFixed(1)} ${h}" class="ib-tl-svg" data-base-w="${baseW}" data-h="${h}" data-zoom="${zoomLevel}">
                            <line x1="0" y1="${h/2}" x2="${w.toFixed(1)}" y2="${h/2}" stroke="var(--ib-tl-grid, rgba(255,255,255,0.1))" stroke-width="0.3"/>
                            ${milestoneSvg}
                            ${showA ? `<polyline points="${makePoints('a')}" fill="none" stroke="#5dc98a" stroke-width="1" class="ib-tl-line-a"/>` : ''}
                            ${showTr ? `<polyline points="${makePoints('tr')}" fill="none" stroke="#6ea8e0" stroke-width="1" class="ib-tl-line-tr"/>` : ''}
                            ${showL ? `<polyline points="${makePoints('l')}" fill="none" stroke="#b07ce8" stroke-width="1" class="ib-tl-line-l"/>` : ''}
                            ${dotsSvg}
                        </svg>
                    </div>
                </div>
            </div>
            <div class="ib-tl-controls">
                <div class="ib-tl-legend">
                    <label class="ib-tl-filter"><input type="checkbox" ${showA ? 'checked' : ''} data-metric="a"/><span class="ib-tl-legend-a">A — ${EscapeHtml(T("tlMetricAffection"))}</span></label>
                    <label class="ib-tl-filter"><input type="checkbox" ${showTr ? 'checked' : ''} data-metric="tr"/><span class="ib-tl-legend-tr">T — ${EscapeHtml(T("tlMetricTrust"))}</span></label>
                    <label class="ib-tl-filter"><input type="checkbox" ${showL ? 'checked' : ''} data-metric="l"/><span class="ib-tl-legend-l">L — ${EscapeHtml(T("tlMetricLove"))}</span></label>
                    <label class="ib-tl-filter"><input type="checkbox" ${showDots ? 'checked' : ''} data-metric="dots"/><span class="ib-tl-legend-dots">⬤ ${EscapeHtml(T("tlMetricDots"))}</span></label>
                </div>
                ${canZoom ? `<button class="ib-tl-magnifier-btn" type="button" title="Zoom">🔍</button>` : ''}
            </div>
            ${canZoom ? `<div class="ib-tl-magnifier-panel" style="display:none;">
                <button class="ib-tl-zoom-btn ib-zoom-out" type="button" ${zoomLevel <= ZOOM_MIN ? 'disabled' : ''}>−</button>
                <input type="range" class="ib-tl-zoom-slider" min="${ZOOM_MIN}" max="${ZOOM_MAX}" step="${ZOOM_STEP}" value="${zoomLevel}"/>
                <button class="ib-tl-zoom-btn ib-zoom-in" type="button" ${zoomLevel >= ZOOM_MAX ? 'disabled' : ''}>+</button>
                <span class="ib-tl-zoom-level">${zoomLevel.toFixed(1)}x</span>
            </div>` : ''}`;
        }

        // Build log entries with game time + message link
        const visibleEntries = npcEntries.slice(-30).reverse();
        let listHtml = visibleEntries.map(e => {
            const r = e.rel;
            const gameTimeStr = e.gameTime || e.gameDate ? `${[e.gameDate, e.gameTime].filter(Boolean).join(' ')}` : '';
            const msgIdx = e.msgIndex;
            return `<div class="ib-tl-entry" data-msg-index="${msgIdx !== undefined ? msgIdx : ''}">
                <span class="ib-tl-game-time"${gameTimeStr ? '' : ' style="opacity:0.3"'}>${gameTimeStr || '—'}</span>
                <span class="ib-tl-stat ib-tl-a">A:${r.a}</span>
                <span class="ib-tl-stat ib-tl-tr">T:${r.tr}</span>
                <span class="ib-tl-stat ib-tl-l">L:${r.l}</span>
                <span class="ib-tl-status">${EscapeHtml(r.status || '')}</span>
                <span class="ib-tl-goto" title="${EscapeHtml(T("tlGoToMessage"))}">↗</span>
            </div>`;
        }).join('');

        // Milestone list
        let milestoneHtml = '';
        if (milestones.length) {
            milestoneHtml = `<div class="ib-tl-milestones">${milestones.slice().reverse().map(m => {
                const e = npcEntries[m.index];
                if (!e) return '';
                const gameTimeStr = e.gameTime || e.gameDate ? `${[e.gameDate, e.gameTime].filter(Boolean).join(' ')}` : '';
                return `<div class="ib-tl-milestone" data-msg-index="${m.msgIndex !== undefined ? m.msgIndex : ''}">
                    <span class="ib-tl-milestone-icon">⭐</span>
                    <span class="ib-tl-game-time"${gameTimeStr ? '' : ' style="opacity:0.3"'}>${gameTimeStr || '—'}</span>
                    <span class="ib-tl-milestone-labels">${m.labels.join(', ')}</span>
                    <span class="ib-tl-goto" title="${EscapeHtml(T("tlGoToMessage"))}">↗</span>
                </div>`;
            }).join('')}</div>`;
        }

        return `<div class="ib-tl-header">
            <div class="ib-tl-title">📈 ${EscapeHtml(T("relationshipTimeline"))}</div>
            <button class="ib-tl-close" type="button">×</button>
        </div>
        <div class="ib-tl-npc-tabs">
            ${allNpcNames.map(n => `<button class="ib-tl-npc-tab ${NamesLikelyMatch(n, selectedNpc) ? 'active' : ''}" data-npc="${EscapeHtml(n)}">${EscapeHtml(n)}</button>`).join('')}
        </div>
        <div class="ib-tl-graph">${graphHtml}</div>
        ${milestoneHtml}
        <div class="ib-tl-list">${listHtml}</div>`;
    }

    function bindEvents(tooltipEl) {
        popup.querySelector('.ib-tl-close')?.addEventListener('click', () => popup.remove());

        // ── rebuildGraph: efficient partial rebuild on zoom change ──
        function rebuildGraph() {
            const svgEl = popup.querySelector('.ib-tl-svg');
            const viewport = popup.querySelector('.ib-tl-graph-viewport');
            const canvas = popup.querySelector('.ib-tl-graph-canvas');
            if (!svgEl || !viewport || !canvas) return;

            const entries = gTimeline.filter(e => e.rels?.some(r => NamesLikelyMatch(r.source, selectedNpc)));
            const npcEntriesLocal = entries.map(e => {
                const r = e.rels.find(r => NamesLikelyMatch(r.source, selectedNpc));
                return r ? { ...e, rel: r } : null;
            }).filter(Boolean);

            const baseW = parseFloat(svgEl.dataset.baseW) || 100;
            const h = parseFloat(svgEl.dataset.h) || 40;
            const w = baseW * zoomLevel;
            const step = w / Math.max(1, npcEntriesLocal.length - 1);

            svgEl.setAttribute('viewBox', `0 0 ${w.toFixed(1)} ${h}`);
            svgEl.dataset.zoom = zoomLevel;

            // Recompute polyline points
            function makePointsLocal(key) {
                return npcEntriesLocal.map((e, i) => {
                    const x = (i * step).toFixed(1);
                    const val = Clamp(e.rel[key] || 0, -100, 100);
                    const y = h - ((val + 100) / 200 * h);
                    return `${x},${y.toFixed(1)}`;
                }).join(' ');
            }

            if (showA) {
                const pl = svgEl.querySelector('.ib-tl-line-a');
                if (pl) pl.setAttribute('points', makePointsLocal('a'));
            }
            if (showTr) {
                const pl = svgEl.querySelector('.ib-tl-line-tr');
                if (pl) pl.setAttribute('points', makePointsLocal('tr'));
            }
            if (showL) {
                const pl = svgEl.querySelector('.ib-tl-line-l');
                if (pl) pl.setAttribute('points', makePointsLocal('l'));
            }

            // Recompute milestone lines
            svgEl.querySelectorAll('line[stroke="rgba(255,200,80,0.3)"]').forEach(line => {
                // Remove old milestone lines
                line.remove();
            });
            const milestoneEntries = computeMilestones(npcEntriesLocal);
            const zeroLine = svgEl.querySelector('line[stroke*="ib-tl-grid"], line:first-child');
            milestoneEntries.forEach(m => {
                const x = (m.index * step).toFixed(1);
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x);
                line.setAttribute('y1', '0');
                line.setAttribute('x2', x);
                line.setAttribute('y2', h);
                line.setAttribute('stroke', 'rgba(255,200,80,0.3)');
                line.setAttribute('stroke-width', '0.4');
                line.setAttribute('stroke-dasharray', '1,1');
                svgEl.insertBefore(line, svgEl.querySelector('.ib-tl-line-a') || svgEl.querySelector('.ib-tl-dot'));
            });

            // Update zero line
            const zeroLn = svgEl.querySelector('line[stroke*="ib-tl-grid"], line:first-child');
            if (zeroLn) {
                zeroLn.setAttribute('x2', w.toFixed(1));
            }

            // Recompute dot positions
            svgEl.querySelectorAll('.ib-tl-dot').forEach(dot => {
                const idx = parseInt(dot.dataset.idx);
                if (isNaN(idx)) return;
                const mk = dot.classList.contains('ib-tl-dot-a') ? 'a' : dot.classList.contains('ib-tl-dot-tr') ? 'tr' : 'l';
                const entry = npcEntriesLocal[idx];
                if (!entry) return;
                const x = (idx * step).toFixed(1);
                const val = Clamp(entry.rel[mk] || 0, -100, 100);
                const y = h - ((val + 100) / 200 * h);
                dot.setAttribute('cx', x);
                dot.setAttribute('cy', y.toFixed(1));
            });

            // Update canvas width
            const viewportWidth = viewport.clientWidth;
            canvas.style.width = `${viewportWidth * zoomLevel}px`;

            // Update zoom controls state
            const levelEl = popup.querySelector('.ib-tl-zoom-level');
            if (levelEl) levelEl.textContent = `${zoomLevel.toFixed(1)}x`;
            const outBtn = popup.querySelector('.ib-zoom-out');
            const inBtn = popup.querySelector('.ib-zoom-in');
            if (outBtn) outBtn.disabled = zoomLevel <= ZOOM_MIN;
            if (inBtn) inBtn.disabled = zoomLevel >= ZOOM_MAX;
            const slider = popup.querySelector('.ib-tl-zoom-slider');
            if (slider) slider.value = zoomLevel;
        }

        // ── Fix oval dots: adjust viewBox for aspect ratio ──
        requestAnimationFrame(() => {
            const svgEl = popup.querySelector('.ib-tl-svg');
            if (svgEl) {
                const rect = svgEl.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    const containerAspect = rect.width / rect.height;
                    const currentViewBox = svgEl.getAttribute('viewBox');
                    if (currentViewBox) {
                        const [, , oldW, oldH] = currentViewBox.split(' ').map(Number);
                        const oldAspect = oldW / oldH;
                        if (containerAspect > oldAspect) {
                            const newW = oldH * containerAspect;
                            const scaleX = newW / oldW;
                            svgEl.setAttribute('viewBox', `0 0 ${newW.toFixed(1)} ${oldH}`);
                            // Update data-base-w so rebuildGraph uses correct base
                            svgEl.dataset.baseW = newW.toFixed(1);
                            svgEl.querySelectorAll('polyline').forEach(pl => {
                                const pts = pl.getAttribute('points');
                                if (pts) {
                                    const newPts = pts.split(' ').map(pt => {
                                        const [x, y] = pt.split(',').map(Number);
                                        return `${(x * scaleX).toFixed(1)},${y}`;
                                    }).join(' ');
                                    pl.setAttribute('points', newPts);
                                }
                            });
                            svgEl.querySelectorAll('.ib-tl-dot').forEach(dot => {
                                const cx = parseFloat(dot.getAttribute('cx'));
                                if (!isNaN(cx)) dot.setAttribute('cx', (cx * scaleX).toFixed(1));
                            });
                            svgEl.querySelectorAll('line').forEach(line => {
                                const x1 = parseFloat(line.getAttribute('x1'));
                                const x2 = parseFloat(line.getAttribute('x2'));
                                if (!isNaN(x1)) line.setAttribute('x1', (x1 * scaleX).toFixed(1));
                                if (!isNaN(x2)) line.setAttribute('x2', (x2 * scaleX).toFixed(1));
                            });
                        }
                    }
                }
            }

            // Set initial canvas width after layout
            const viewport = popup.querySelector('.ib-tl-graph-viewport');
            const canvas = popup.querySelector('.ib-tl-graph-canvas');
            if (viewport && canvas && zoomLevel > 1) {
                canvas.style.width = `${viewport.clientWidth * zoomLevel}px`;
            }
        });

        // ── NPC tab clicks ──
        popup.querySelectorAll('.ib-tl-npc-tab').forEach(tab => {
            tab.addEventListener('click', (ev) => {
                ev.stopPropagation();
                selectedNpc = tab.dataset.npc;
                zoomLevel = 1; // reset zoom on tab switch
                popup.innerHTML = buildContent();
                bindEvents(tooltip);
            });
        });

        // ── Metric filter checkboxes ──
        popup.querySelectorAll('.ib-tl-filter input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (ev) => {
                ev.stopPropagation();
                const metric = cb.dataset.metric;
                if (metric === 'a') showA = cb.checked;
                else if (metric === 'tr') showTr = cb.checked;
                else if (metric === 'l') showL = cb.checked;
                else if (metric === 'dots') {
                    showDots = cb.checked;
                    // Toggle dot visibility without full rebuild
                    popup.querySelectorAll('.ib-tl-dot').forEach(dot => {
                        dot.style.display = showDots ? '' : 'none';
                    });
                    return; // skip full rebuild
                }
                popup.innerHTML = buildContent();
                bindEvents(tooltip);
            });
        });

        // ── Magnifier button toggle ──
        const magBtn = popup.querySelector('.ib-tl-magnifier-btn');
        const magPanel = popup.querySelector('.ib-tl-magnifier-panel');
        if (magBtn && magPanel) {
            magBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const isVisible = magPanel.style.display !== 'none';
                magPanel.style.display = isVisible ? 'none' : 'flex';
                magBtn.classList.toggle('ib-active', !isVisible);
                // Reset zoom when closing the panel
                if (isVisible && zoomLevel !== 1) {
                    zoomLevel = 1;
                    rebuildGraph();
                }
            });
        }

        // ── Zoom slider ──
        const zoomSlider = popup.querySelector('.ib-tl-zoom-slider');
        if (zoomSlider) {
            zoomSlider.addEventListener('input', (ev) => {
                ev.stopPropagation();
                zoomLevel = parseFloat(zoomSlider.value);
                rebuildGraph();
            });
        }

        // ── Zoom +/- buttons ──
        popup.querySelectorAll('.ib-tl-zoom-btn').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (btn.classList.contains('ib-zoom-out')) {
                    zoomLevel = Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP);
                } else if (btn.classList.contains('ib-zoom-in')) {
                    zoomLevel = Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP);
                }
                rebuildGraph();
            });
        });

        // ── Ctrl + Mouse wheel zoom ──
        const viewport = popup.querySelector('.ib-tl-graph-viewport');
        if (viewport) {
            viewport.addEventListener('wheel', (ev) => {
                if (!ev.ctrlKey && !ev.metaKey) return;
                ev.preventDefault();
                const delta = ev.deltaY > 0 ? -ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP;
                const oldZoom = zoomLevel;
                zoomLevel = Clamp(zoomLevel + delta, ZOOM_MIN, ZOOM_MAX);
                if (zoomLevel !== oldZoom) {
                    // Zoom toward cursor position
                    const rect = viewport.getBoundingClientRect();
                    const mouseXRatio = (ev.clientX - rect.left + viewport.scrollLeft)
                                        / (rect.width * oldZoom);
                    rebuildGraph();
                    const newScrollLeft = mouseXRatio * rect.width * zoomLevel
                                          - (ev.clientX - rect.left);
                    viewport.scrollLeft = Math.max(0, newScrollLeft);
                }
            }, { passive: false });
        }

        // ── Pinch zoom (touch) ──
        if (viewport) {
            viewport.addEventListener('touchstart', (ev) => {
                if (ev.touches.length !== 2) return;
                const dx = ev.touches[0].clientX - ev.touches[1].clientX;
                const dy = ev.touches[0].clientY - ev.touches[1].clientY;
                pinchStartDist = Math.sqrt(dx * dx + dy * dy);
                pinchStartZoom = zoomLevel;
            }, { passive: true });

            viewport.addEventListener('touchmove', (ev) => {
                if (ev.touches.length !== 2) return;
                ev.preventDefault();
                const dx = ev.touches[0].clientX - ev.touches[1].clientX;
                const dy = ev.touches[0].clientY - ev.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (pinchStartDist <= 0) return;
                const scale = dist / pinchStartDist;
                zoomLevel = Clamp(pinchStartZoom * scale, ZOOM_MIN, ZOOM_MAX);
                rebuildGraph();
            }, { passive: false });
        }

        // ── Graph dot hover/click — show tooltip ──
        const tooltip = tooltipEl;
        const svgEl = popup.querySelector('.ib-tl-svg');
        if (svgEl && tooltip && showDots) {
            const entries = gTimeline.filter(e => e.rels?.some(r => NamesLikelyMatch(r.source, selectedNpc)));
            const npcEntries = entries.map(e => {
                const r = e.rels.find(r => NamesLikelyMatch(r.source, selectedNpc));
                return r ? { ...e, rel: r } : null;
            }).filter(Boolean);

            popup.querySelectorAll('.ib-tl-dot').forEach(dot => {
                dot.addEventListener('mouseenter', (ev) => {
                    const idx = parseInt(dot.dataset.idx);
                    const entry = npcEntries[idx];
                    if (!entry) return;
                    const r = entry.rel;
                    const gameTimeStr = entry.gameTime || entry.gameDate ? `${[entry.gameDate, entry.gameTime].filter(Boolean).join(' ')}` : '—';
                    const metricKey = dot.classList.contains('ib-tl-dot-a') ? 'A' : dot.classList.contains('ib-tl-dot-tr') ? 'T' : 'L';
                    tooltip.innerHTML = `<b>${gameTimeStr}</b><br>${metricKey}: ${r[metricKey === 'A' ? 'a' : metricKey === 'T' ? 'tr' : 'l']}`;
                    tooltip.style.display = 'block';

                    // Position relative to viewport (tooltip is position:fixed)
                    const dotRect = dot.getBoundingClientRect();
                    const ttW = tooltip.offsetWidth;
                    const ttH = tooltip.offsetHeight;
                    // Center horizontally above the dot
                    let tx = dotRect.left + dotRect.width / 2 - ttW / 2;
                    let ty = dotRect.top - ttH - 4;
                    // Clamp: don't overflow left/right edges of popup
                    const popupRect = popup.getBoundingClientRect();
                    tx = Math.max(popupRect.left + 2, Math.min(tx, popupRect.right - ttW - 2));
                    // If above would clip top, show below the dot instead
                    if (ty < popupRect.top + 2) ty = dotRect.bottom + 4;
                    tooltip.style.left = `${tx}px`;
                    tooltip.style.top = `${ty}px`;
                });
                dot.addEventListener('mouseleave', () => {
                    tooltip.style.display = 'none';
                });
                dot.addEventListener('click', (ev) => {
                    const idx = parseInt(dot.dataset.idx);
                    const entry = npcEntries[idx];
                    if (!entry || entry.msgIndex === undefined) return;
                    popup.remove();
                    const mesNode = document.querySelector(`.mes[mesid="${entry.msgIndex}"]`);
                    if (mesNode) mesNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
            });
        }

        // ── Click on goto button → scroll to message ──
        popup.querySelectorAll('.ib-tl-goto').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const row = btn.closest('.ib-tl-entry, .ib-tl-milestone');
                if (!row) return;
                const msgIndex = parseInt(row.dataset.msgIndex);
                if (isNaN(msgIndex)) return;
                popup.remove();
                const mesNode = document.querySelector(`.mes[mesid="${msgIndex}"]`);
                if (mesNode) mesNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
    }

    popup.innerHTML = buildContent();
    document.body.appendChild(popup);

    // Create tooltip as a separate body element (not inside popup)
    // because popup's transform breaks position:fixed for children
    const tooltip = document.createElement('div');
    tooltip.className = 'ib-tl-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);

    // Clean up tooltip when popup is removed
    const origRemove = popup.remove.bind(popup);
    popup.remove = () => {
        tooltip.remove();
        origRemove();
    };

    bindEvents(tooltip);

    // Close on outside click
    const closeOnOutside = (ev) => {
        if (!ev.target.closest(".ib-timeline-popup") && !ev.target.closest(".ib-btn-timeline") && !ev.target.closest(".ib-rel-timeline-btn")) {
            const p = document.getElementById("ib_timeline_popup");
            if (p) p.remove();
            document.removeEventListener("click", closeOnOutside);
        }
    };
    setTimeout(() => { document.addEventListener("click", closeOnOutside); }, 10);
}

// ============== Notifications ==============
/** Show a toast notification that always appears, regardless of gNotificationsEnabled. */
function ShowToast(icon, body, type = "info") {
    let container = document.getElementById("ib_toast_container");
    if (!container) {
        container = document.createElement("div");
        container.id = "ib_toast_container";
        container.className = "ib-toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `ib-toast ib-toast-${type}`;
    toast.innerHTML = `<div class="ib-toast-title">${icon}</div><div class="ib-toast-body">${EscapeHtml(body)}</div>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("ib-toast-show"));

    setTimeout(() => {
        toast.classList.remove("ib-toast-show");
        toast.classList.add("ib-toast-hide");
        setTimeout(() => toast.remove(), 400);
    }, 2500);
}

function ShowNotification(title, body, type = "info") {
    if (!gNotificationsEnabled) return;

    let container = document.getElementById("ib_toast_container");
    if (!container) {
        container = document.createElement("div");
        container.id = "ib_toast_container";
        container.className = "ib-toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `ib-toast ib-toast-${type}`;
    toast.innerHTML = `<div class="ib-toast-title">${EscapeHtml(title)}</div><div class="ib-toast-body">${EscapeHtml(body)}</div>`;
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => toast.classList.add("ib-toast-show"));

    // Auto-remove
    setTimeout(() => {
        toast.classList.remove("ib-toast-show");
        toast.classList.add("ib-toast-hide");
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

function CheckAndNotifyChanges(prevRels, newRels) {
    if (!gNotificationsEnabled || !prevRels || !newRels) return;

    for (const nr of newRels) {
        const pr = prevRels.find(r => NamesLikelyMatch(r.source, nr.source));
        if (!pr) {
            ShowNotification(
                T("newCharacter"),
                `${nr.source} ${T("appearedInScene")}`,
                'info'
            );
            continue;
        }

        const da = Math.abs((nr.a || 0) - (pr.a || 0));
        const dt = Math.abs((nr.tr || 0) - (pr.tr || 0));
        const dl = Math.abs((nr.l || 0) - (pr.l || 0));

        if (da >= gNotificationThreshold || dt >= gNotificationThreshold || dl >= gNotificationThreshold) {
            const parts = [];
            if (da >= gNotificationThreshold) parts.push(`A ${pr.a}→${nr.a}`);
            if (dt >= gNotificationThreshold) parts.push(`T ${pr.tr}→${nr.tr}`);
            if (dl >= gNotificationThreshold) parts.push(`L ${pr.l}→${nr.l}`);

            ShowNotification(
                T("relationshipChange"),
                `${nr.source}: ${parts.join(', ')}`,
                da >= gNotificationThreshold * 2 ? 'warning' : 'info'
            );
        }
    }
}

// ============== Panel Mode ==============
// Pattern inspired by hud.js from VNE extension:
// - Toggle button is INSIDE the panel host, moves with it naturally
// - Panel IS the infoboard — theme styles applied directly to panel host
// - No backdrop overlay (panel is always-open friendly)
// - Panel starts collapsed (slides in from screen edge)

function RemovePanelMode() {
    const panel = document.getElementById("ib_panel_host");
    if (panel) panel.remove();
    // No backdrop to remove anymore
    document.body.classList.remove("ib-panel-active", "ib-panel-left", "ib-panel-right");
    gPanelOpen = false;
}

function OpenPanel() {
    gPanelOpen = true;
    const host = document.getElementById("ib_panel_host");
    if (host) host.classList.add("ib-panel-open");
    // No backdrop manipulation
    document.body.style.setProperty('--ib-panel-width', gPanelWidth + 'px');
    document.body.classList.add("ib-panel-active");
    // Update toggle icon direction
    const icon = host?.querySelector(".ib-toggle-icon");
    if (icon) {
        icon.textContent = gPanelPosition === "right" ? "‹" : "›";
    }
    const toggle = host?.querySelector(".ib-panel-toggle");
    if (toggle) toggle.title = T("panelClose");
    // Re-render board content when opening
    if (host) {
        const body = host.querySelector(".ib-panel-body");
        if (body) {
            body.innerHTML = RenderBoard(GetMergedStateForRendering(), false, null, "panel");
            const boardEl = body.querySelector(".ib-board");
            if (boardEl) {
                WireBoardControls(boardEl, null);
                AutoScrollThoughts(boardEl);
            }
        }
    }
}

function ClosePanel() {
    gPanelOpen = false;
    // Clear idle timer on close
    if (_panelToggleIdleTimer) {
        clearTimeout(_panelToggleIdleTimer);
        _panelToggleIdleTimer = null;
    }
    const host = document.getElementById("ib_panel_host");
    if (host) host.classList.remove("ib-panel-open");
    // No backdrop manipulation
    document.body.classList.remove("ib-panel-active");
    // Update toggle icon direction
    const icon = host?.querySelector(".ib-toggle-icon");
    if (icon) {
        icon.textContent = gPanelPosition === "right" ? "›" : "‹";
    }
    const toggle = host?.querySelector(".ib-panel-toggle");
    if (toggle) toggle.title = T("panelOpen");
}

function TogglePanel(open) {
    if (typeof open === 'boolean') {
        if (open) { OpenPanel(); } else { ClosePanel(); }
    } else {
        if (gPanelOpen) { ClosePanel(); } else { OpenPanel(); }
    }
}

function FlipPanelSide() {
    gPanelPosition = gPanelPosition === "right" ? "left" : "right";
    localStorage.setItem(kPanelPositionKey, gPanelPosition);
    // Sync settings dropdown if open
    const sel = document.getElementById("ib_panel_position");
    if (sel) sel.value = gPanelPosition;
    // Re-render panel on the new side
    if (gDisplayPanel) RenderPanelBoard();
}

// Mobile idle behavior: toggle button auto-hides on narrow screens
let _panelToggleIdleTimer = null;
function SchedulePanelToggleIdle() {
    const host = document.getElementById("ib_panel_host");
    if (!host) return;
    const toggle = host.querySelector(".ib-panel-toggle");
    const flip = host.querySelector(".ib-panel-flip");
    if (!toggle) return;
    if (_panelToggleIdleTimer) clearTimeout(_panelToggleIdleTimer);
    toggle.classList.remove("ib-toggle-idle");
    if (flip) flip.classList.remove("ib-toggle-idle");
    if (window.innerWidth <= 760 && !gPanelOpen) {
        _panelToggleIdleTimer = setTimeout(() => {
            toggle.classList.add("ib-toggle-idle");
            if (flip) flip.classList.add("ib-toggle-idle");
        }, 1500);
    }
}

function EnsurePanelContainer() {
    let host = document.getElementById("ib_panel_host");
    if (host) return host;

    // Set body position class
    document.body.classList.toggle("ib-panel-left", gPanelPosition === "left");
    document.body.classList.toggle("ib-panel-right", gPanelPosition !== "left");

    // No backdrop — panel is always-open friendly

    // Create panel host with toggle button INSIDE (like hud.js pattern)
    host = document.createElement("div");
    host.id = "ib_panel_host";
    host.style.width = gPanelWidth + 'px';
    // Apply theme + bar style directly to panel so it IS the infoboard
    host.className = `ib-panel-pos-${gPanelPosition} ${GetThemeClassStr()} ib-bars-${gBarStyle} ${gHoverFx ? "ib-hoverfx" : ""}`;
    if (gPanelOpen) host.classList.add("ib-panel-open");

    // Toggle button is a child of the panel — it slides with it naturally
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = `ib-panel-toggle ib-toggle-${gPanelPosition}`;
    toggleBtn.title = gPanelOpen ? T("panelClose") : T("panelOpen");
    toggleBtn.innerHTML = `<span class="ib-toggle-icon">${gPanelPosition === "right" ? "›" : "‹"}</span><span class="ib-toggle-label">${EscapeHtml(T("floatingTitle"))}</span>`;
    toggleBtn.addEventListener("click", () => TogglePanel());

    // Wire idle behavior
    ['pointerdown', 'touchstart', 'mouseenter', 'focus'].forEach(ev => {
        toggleBtn.addEventListener(ev, SchedulePanelToggleIdle);
    });

    host.appendChild(toggleBtn);

    // Flip side button — sits below the toggle, swaps panel to the other side
    const flipBtn = document.createElement("button");
    flipBtn.type = "button";
    flipBtn.className = `ib-panel-flip ib-flip-${gPanelPosition}`;
    flipBtn.title = T("panelFlipSide");
    flipBtn.innerHTML = `<span class="ib-flip-icon">⇄</span>`;
    flipBtn.addEventListener("click", () => FlipPanelSide());

    // Wire idle behavior for flip button too
    ['pointerdown', 'touchstart', 'mouseenter', 'focus'].forEach(ev => {
        flipBtn.addEventListener(ev, SchedulePanelToggleIdle);
    });

    host.appendChild(flipBtn);

    document.body.appendChild(host);

    SchedulePanelToggleIdle();
    return host;
}

function RenderPanelBoard() {
    if (!gEnabled || !gDisplayPanel) {
        RemovePanelMode();
        return;
    }

    const host = EnsurePanelContainer();

    // Update position classes
    host.classList.toggle("ib-panel-pos-right", gPanelPosition !== "left");
    host.classList.toggle("ib-panel-pos-left", gPanelPosition === "left");
    document.body.classList.toggle("ib-panel-left", gPanelPosition === "left");
    document.body.classList.toggle("ib-panel-right", gPanelPosition !== "left");

    // Update theme + bar style classes on panel host (panel IS the infoboard)
    // Use spread [...classList] to snapshot before iterating — mutating during
    // live DOMTokenList.forEach skips items due to index shifting.
    [...host.classList].forEach(cls => {
        if (cls.startsWith("ib-theme-") || cls.startsWith("ib-bars-") || cls === "ib-hoverfx") {
            host.classList.remove(cls);
        }
    });
    // Clear any stale inline CSS variables left by the old theme editor
    // (ApplyCustomThemeVars used to set them on the panel host)
    const staleVars = [
        '--ib-bg-1','--ib-bg-2','--ib-bg-3','--ib-accent','--ib-accent-2',
        '--ib-text','--ib-danger','--ib-green','--ib-dim','--ib-muted',
        '--ib-border','--ib-border-neon','--ib-soft-border',
        '--ib-chip-bg','--ib-chip-border','--ib-chip-text',
        '--ib-neon','--ib-header-glow',
        '--ib-delta-pos','--ib-delta-neg','--ib-delta-zero',
        '--ib-ms-value',
        '--ib-heading','--ib-pill-text',
        '--ib-mood-text','--ib-mood-bg','--ib-mood-border',
        '--ib-age-text','--ib-age-bg','--ib-age-border',
        '--ib-location-text','--ib-char-name',
        '--ib-rel-label','--ib-thought-name','--ib-thought-text',
        '--ib-meter-value'
    ];
    staleVars.forEach(v => host.style.removeProperty(v));
    GetThemeClassStr().split(' ').forEach(cls => host.classList.add(cls));
    host.classList.add(`ib-bars-${gBarStyle}`);
    if (gHoverFx) host.classList.add("ib-hoverfx");

    // Force browser to recompute pseudo-element styles (::before/::after)
    // after theme class change — prevents ghost overlays from the previous theme
    void host.offsetHeight;

    // Update toggle button position class
    const toggle = host.querySelector(".ib-panel-toggle");
    if (toggle) {
        toggle.classList.toggle("ib-toggle-right", gPanelPosition !== "left");
        toggle.classList.toggle("ib-toggle-left", gPanelPosition === "left");
        const label = toggle.querySelector(".ib-toggle-label");
        if (label) label.textContent = T("floatingTitle");
    }

    // Update flip button position class
    const flip = host.querySelector(".ib-panel-flip");
    if (flip) {
        flip.classList.toggle("ib-flip-right", gPanelPosition !== "left");
        flip.classList.toggle("ib-flip-left", gPanelPosition === "left");
    }

    host.dataset.rawXml = gLastRawXml || '';

    // Panel inner shell (only rendered when panel exists)
    let shell = host.querySelector(".ib-panel-shell");
    if (!shell) {
        shell = document.createElement("div");
        shell.className = "ib-panel-shell";
        host.appendChild(shell);
    }

    // No separate panel header — infoboard's own toolbar/title serves as the header
    shell.innerHTML = `
        <div class="ib-panel-resize-handle"></div>
        <div class="ib-panel-body">
            ${gPanelOpen ? RenderBoard(GetMergedStateForRendering(), false, null, "panel") : ""}
        </div>
    `;

    if (gPanelOpen) {
        const boardEl = shell.querySelector(".ib-board");
        if (boardEl) {
            WireBoardControls(boardEl, null);
            AutoScrollThoughts(boardEl);
            // Force repaint to flush any stale pseudo-element styles
            ForceRepaint(boardEl);
        }
    }

    // Resize handle
const handle = shell.querySelector('.ib-panel-resize-handle');
if (handle) {
    let startX, startW, lastClientX, rAFScheduled = false;
    const onMove = (e) => {
        lastClientX = e.clientX;
        if (rAFScheduled) return;
        rAFScheduled = true;
        requestAnimationFrame(() => {
            const dx = lastClientX - startX;
            let newW;
            if (gPanelPosition === "right") {
                newW = Clamp(startW - dx, 280, 600);
            } else {
                newW = Clamp(startW + dx, 280, 600);
            }
            host.style.width = newW + 'px';
            gPanelWidth = newW;
            rAFScheduled = false;
        });
    };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
			host.classList.remove("ib-panel-resizing");
			document.body.style.setProperty('--ib-panel-width', gPanelWidth + 'px');
            localStorage.setItem(kPanelWidthKey, String(gPanelWidth));
        };
        handle.addEventListener('pointerdown', (e) => {
			host.classList.add("ib-panel-resizing");
            e.preventDefault();
            startX = e.clientX;
            startW = host.offsetWidth;
            document.body.style.userSelect = 'none';
            document.body.style.webkitUserSelect = 'none';
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });
    }

    // Apply open/closed state
    if (gPanelOpen) {
        host.classList.add("ib-panel-open");
        document.body.style.setProperty('--ib-panel-width', gPanelWidth + 'px');
        document.body.classList.add("ib-panel-active");
    }
}

function SaveState() {
    try {
        localStorage.setItem(GetStorageKey(), JSON.stringify(gState));
        // Update pin snapshots so pinned NPC data persists across chat switches
        UpdateAllPinSnapshots();
    } catch (e) {
        console.error("[IB] SaveState failed:", e);
    }
}

function LoadState() {
    try {
        const raw = localStorage.getItem(GetStorageKey());
        if (raw) {
            gState = JSON.parse(raw);
            if (!Array.isArray(gState.thoughts)) gState.thoughts = [];
            if (!Array.isArray(gState.chars)) gState.chars = [];
            if (!Array.isArray(gState.rels)) gState.rels = [];
            return true;
        }
    } catch (e) {
        console.error("[IB] LoadState failed:", e);
    }
    gState = structuredClone(kDefaultState);
    return false;
}

function Clamp(num, min, max) {
    return Math.max(min, Math.min(num, max));
}

/** Direct field-by-field comparison of two rel arrays (timeline format).
 *  Each rel has exactly: { source, a, tr, l, status }.
 *  Returns true if arrays are identical in length and all fields match.
 *  NOTE: If new fields are added to timeline rels, update this function. */
function RelsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const ra = a[i], rb = b[i];
        if (ra.source !== rb.source ||
            ra.a !== rb.a ||
            ra.tr !== rb.tr ||
            ra.l !== rb.l ||
            ra.status !== rb.status) {
            return false;
        }
    }
    return true;
}

function HexToRgb(hex) {
    const m = String(hex || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function RgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => Math.round(Clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('');
}

function BlendColors(hex1, hex2, ratio) {
    const c1 = HexToRgb(hex1);
    const c2 = HexToRgb(hex2);
    if (!c1) return hex2 || '#888888';
    if (!c2) return hex1;
    const r = Math.round(c1.r + (c2.r - c1.r) * ratio);
    const g = Math.round(c1.g + (c2.g - c1.g) * ratio);
    const b = Math.round(c1.b + (c2.b - c1.b) * ratio);
    return RgbToHex(r, g, b);
}

function EscapeHtml(str) {
    return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function LimitWords(str, maxWords = 8, maxChars = 120) {
    const clean = String(str ?? "")
        .replace(/\s+/g, " ")
        .trim();

    if (!clean) return "";

    const words = clean.split(" ");
    let out = words.slice(0, maxWords).join(" ");

    if (out.length > maxChars) {
        out = out.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
    }

    return out;
}

function NormalizeName(str) {
    return String(str ?? "").trim().toLowerCase();
}

function NormalizeLooseText(str) {
    return String(str ?? "")
        .toLowerCase()
        .replace(/[«»„“”"']/g, "")
        .replace(/[…]+/g, "...")
        .replace(/\.\.\.+/g, "...")
        .replace(/[—–]/g, ":")
        .replace(/[*_~`]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function NormalizeThoughtText(str) {
    return NormalizeLooseText(str)
        .replace(/[,:;!?]/g, "")
        .replace(/\.\.\./g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function LooksLikeStandaloneThoughtFragment(rawText, thoughtEntries = []) {
    const raw = String(rawText || "").trim();
    if (!raw) return false;
    const normalized = NormalizeLooseText(raw);
    const soft = NormalizeThoughtText(raw);
    // Не трогаем короткие слова и короткие реплики.
    // "Нет", "Да", "Ладно", "Что?" и прочее не должны исчезать.
    if (!normalized || soft.length < 12) return false;

    // Check if the text closely matches any known thought entry
    // This catches: quoted text, italic/bold fragments, bare thought text
    return thoughtEntries.some(t => {
        if (!t?.softText) return false;

        // Exact or near-exact match of the thought text
        if (soft === t.softText) return true;

        // The fragment contains or is contained in a known thought
        if (soft.length >= 12) {
            const minLen = Math.min(soft.length, t.softText.length);
            const maxLen = Math.max(soft.length, t.softText.length);

            if (t.softText.includes(soft) || soft.includes(t.softText)) {
                return minLen / maxLen >= 0.65;
            }
        }

        // Also check if the full "Name: thought" normalized form matches
        if (normalized.length >= 12 && t.fullSoft.includes(normalized)) return true;

        return false;
    });
}
function StripNameDecorators(str) {
    return String(str ?? "")
        .replace(/[*_~`"“”„]/g, "")
        .replace(/[(){}\[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function GetNameAliases(name) {
    const raw = String(name ?? "").trim();
    if (!raw) return [];

    const cacheKey = raw.toLowerCase();
    if (gAliasCache.has(cacheKey)) return gAliasCache.get(cacheKey);

    const clean = StripNameDecorators(raw);
    const lower = clean.toLowerCase();
    const parts = clean.split(/\s+/).filter(Boolean);

    const aliases = new Set();
    aliases.add(lower);

    if (parts.length > 1) {
        aliases.add(parts[0].toLowerCase());
        aliases.add(parts[parts.length - 1].toLowerCase());
        aliases.add(parts.slice(-2).join(" ").toLowerCase());
    }

    const noPunct = lower.replace(/[^\p{L}\p{N}\s-]/gu, "").trim();
    if (noPunct) aliases.add(noPunct);

    const result = [...aliases].filter(Boolean);
    gAliasCache.set(cacheKey, result);
    return result;
}

function NamesLikelyMatch(a, b) {
    const aAliases = GetNameAliases(a);
    const bAliases = GetNameAliases(b);

    for (const x of aAliases) {
        for (const y of bAliases) {
            if (!x || !y) continue;
            if (x === y) return true;

            const minLen = Math.min(x.length, y.length);
            const maxLen = Math.max(x.length, y.length);

            if (minLen >= 4) {
                if (x.includes(y) || y.includes(x)) {
                    if (minLen / maxLen >= 0.65) {
                        return true;
                    }
                }
            }
        }
    }

    return false;
}

function ThoughtOwnerMatchesNpc(thoughtName, npcName, allNpcNames = []) {
    const thought = StripNameDecorators(thoughtName).toLowerCase().trim();
    const npc = StripNameDecorators(npcName).toLowerCase().trim();

    if (!thought || !npc) return false;
    if (thought === npc) return true;

    const thoughtParts = thought.split(/\s+/).filter(Boolean);
    const npcParts = npc.split(/\s+/).filter(Boolean);

    if (!thoughtParts.length || !npcParts.length) return false;

    const thoughtFirst = thoughtParts[0];
    const thoughtLast = thoughtParts[thoughtParts.length - 1];
    const npcFirst = npcParts[0];
    const npcLast = npcParts[npcParts.length - 1];

    if (thought === npcFirst || thought === npcLast) {
        if (thought === npcLast) {
            const sameLastCount = allNpcNames.filter(name => {
                const parts = StripNameDecorators(name).toLowerCase().trim().split(/\s+/).filter(Boolean);
                return parts.length && parts[parts.length - 1] === npcLast;
            }).length;

            return sameLastCount <= 1;
        }

        return true;
    }

    if (thought.includes(npc) || npc.includes(thought)) {
        const minLen = Math.min(thought.length, npc.length);
        const maxLen = Math.max(thought.length, npc.length);
        return minLen >= 4 && (minLen / maxLen >= 0.65);
    }

    if (thoughtFirst === npcFirst && thoughtLast === npcLast) return true;

    return false;
}

function IsUserLikeName(name) {
    const n = NormalizeName(name);
    return !n ||
        n === "{{user}}" ||
        n === "user" ||
        n === "ты" ||
        n === "вы" ||
        n === "твой персонаж" ||
        n === "героиня" ||
        n === "герой" ||
        n === "you" ||
        n === NormalizeName(GetUserName());
}

function IsUnknownValue(val) {
    const v = NormalizeName(val);
    return v === "???" || v === "неизвестно" || v === "n/a" || v === "none" || v === "unknown" || v === "н/д";
}

function RenderMaybeUnknown(val) {
    const escaped = EscapeHtml(val);
    if (IsUnknownValue(val)) {
        return `<span class="ib-unknown">${escaped}</span>`;
    }
    return escaped;
}

function ParseThoughtLine(line) {
    let cleaned = String(line || "").trim();
    if (!cleaned) return null;

    cleaned = cleaned
        .replace(/^\s*[*_~`\-–—]+/, "")
        .replace(/[*_~`]+\s*$/, "")
        .trim();

    // Only try standard "Name: thought" format (colon separator)
    // NOTE: Dash separators (—, –, -) are intentionally NOT supported
    // because they cause false positives with narrative text like " — Арсений обернулся"
    let match = cleaned.match(/^([^:]+?)\s*[:]\s*(.+)$/u);
    if (!match) {
        // Try "Name thought" if the first word looks like a name (capitalized, 2+ chars)
        const firstWord = cleaned.match(/^([A-ZА-ЯЁ][a-zа-яёA-ZА-ЯЁ]{1,25})\s+(.+)$/u);
        if (firstWord && firstWord[2] && firstWord[2].length > 5) {
            match = firstWord;
        }
    }

    if (!match) {
        return { name: "__UNASSIGNED__", text: cleaned };
    }

    const name = StripNameDecorators(match[1]);
    const text = String(match[2] || "")
        .replace(/^\s*[*_~`]+/, "")
        .replace(/[*_~`]+\s*$/, "")
        .trim();

    if (!text) return null;

return {
    name: name || "__UNASSIGNED__",
    text: LimitWords(text, 30, 220)
};
}

/** @deprecated Legacy — presence is now set via the dedicated `presence` XML attribute.
 *  Kept for backward compat with older LLM outputs that put presence info in tags.
 *  ParseInfoboard prefers the `presence` attribute and falls back to this only when absent. */
function ParseFocusState(tags = []) {
    for (const raw of tags) {
        const t = NormalizeName(raw);
        if (PRESENCE_SET_FOCUS.has(t))      return { key: "focus",      cls: "ib-presence-focus" };
        if (PRESENCE_SET_ACTIVE.has(t))     return { key: "activeHere", cls: "ib-presence-active" };
        if (PRESENCE_SET_NEAR.has(t))       return { key: "nearby",     cls: "ib-presence-near" };
        if (PRESENCE_SET_WATCH.has(t))      return { key: "watching",   cls: "ib-presence-watch" };
        if (PRESENCE_SET_OFFSCREEN.has(t))  return { key: "offscreen",  cls: "ib-presence-offscreen" };
        if (PRESENCE_SET_BACKGROUND.has(t)) return { key: "background", cls: "ib-presence-background" };
        if (PRESENCE_SET_LEFT.has(t))       return { key: "leftScene",  cls: "ib-presence-left" };
    }
    return null;
}

function IsPresenceTag(tag) {
    return ALL_PRESENCE_TAGS.has(NormalizeName(tag));
}

function NormalizeThoughtOwners(result) {
    if (!result?.thoughts?.length) return;

    const singleRelName = result.rels?.length === 1 ? result.rels[0].source : "";
    const singleCharName = result.chars?.length === 1 ? result.chars[0].name : "";

    result.thoughts = result.thoughts
        .map(t => {
            let thoughtName = t.name;

            const isUnassigned =
                NormalizeName(thoughtName) === "__unassigned__" ||
                NormalizeName(thoughtName) === "npc";

            if (isUnassigned) {
                if (singleRelName || singleCharName) {
                    thoughtName = singleRelName || singleCharName;
                } else {
                    return {
                        ...t,
                        name: "__UNASSIGNED__"
                    };
                }
            }

const allNpcNames = [
    ...result.rels.map(r => r.source),
    ...result.chars.map(c => c.name)
];

const relMatches = result.rels.filter(r => ThoughtOwnerMatchesNpc(thoughtName, r.source, allNpcNames));
const charMatches = result.chars.filter(c => ThoughtOwnerMatchesNpc(thoughtName, c.name, allNpcNames));

            const canonicalName =
                relMatches.length === 1 ? relMatches[0].source :
                charMatches.length === 1 ? charMatches[0].name :
                thoughtName;

            return {
                ...t,
                name: canonicalName
            };
        })
        .filter(t => !IsUserLikeName(t.name));

    if (result.chars.length > 0 || result.rels.length > 0) {
        result.thoughts = result.thoughts.filter(t => {
            const n = NormalizeName(t.name);
            // Keep unassigned thoughts if there's only one NPC - they likely belong to that NPC
            if (n === "npc") return false;
            if (n === "__unassigned__") {
                // If there's only 1 char/rel, assign the thought to them
                const singleName = singleRelName || singleCharName;
                if (singleName) {
                    t.name = singleName;
                    return true;
                }
                return false;
            }

            const byChar = result.chars.some(c => NamesLikelyMatch(c.name, t.name));
            const byRel = result.rels.some(r => NamesLikelyMatch(r.source, t.name));

            // Also try fuzzy matching: check if any char/rel name is contained in the thought name or vice versa
            if (!byChar && !byRel) {
                const byCharFuzzy = result.chars.some(c => {
                    const cn = NormalizeName(c.name);
                    const tn = NormalizeName(t.name);
                    return cn.length >= 3 && tn.length >= 3 && (cn.includes(tn) || tn.includes(cn));
                });
                const byRelFuzzy = result.rels.some(r => {
                    const rn = NormalizeName(r.source);
                    const tn = NormalizeName(t.name);
                    return rn.length >= 3 && tn.length >= 3 && (rn.includes(tn) || tn.includes(rn));
                });
                if (byCharFuzzy) return true;
                if (byRelFuzzy) return true;
            }

            return byChar || byRel;
        });
    }
}

function RepairInfoboardXml(xml) {
    let fixed = String(xml || "");

    // XML не любит голый &, а модель иногда его суёт в status/thoughts/etc.
    fixed = fixed.replace(
        /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g,
        "&amp;"
    );

    // Fix unclosed attribute values: LLM sometimes forgets a closing quote
    // e.g. age="55 tags="..." → age="55" tags="..."
    // Matches ="value (without closing quote) followed by space+nextAttribute=
    // Normal properly-quoted attributes won't match because " ends [^"]*
    fixed = fixed.replace(/="([^"]*?)(?=\s[a-zA-Z_]+=)/g, '="$1"');

    return fixed;
}

/** Extract raw thought text lines from a message whose XML couldn't be parsed.
 *  Used as a fallback so thought leaks are still removed even when ParseInfoboard fails. */
function ExtractRawThoughts(text) {
    const src = String(text || "");
    // Try to find <thk>...</thk> content
    const thkMatch = src.match(/<thk[^>]*>([\s\S]*?)<\/thk>/i);
    if (!thkMatch) return null;

    const lines = thkMatch[1]
        .replace(/\r/g, "\n")
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    return lines.length ? lines : null;
}

/** Remove leaked thought text from DOM when XML parsing failed.
 *  Uses simple text matching — less precise than RemoveThoughtLeaksInContainer,
 *  but catches the most common case of exact thought text appearing in the message. */
function RemoveLeakedThoughtsFromBrokenXml(messageTextEl, rawThoughts) {
    if (!messageTextEl || !rawThoughts?.length) return;

    // Normalize thoughts for comparison
    const normalizedThoughts = rawThoughts
        .map(t => NormalizeThoughtText(t))
        .filter(t => t.length >= 5);

    if (!normalizedThoughts.length) return;

    const thoughtSet = new Set(normalizedThoughts);

    // Walk text nodes and remove lines that match known thoughts
    const walker = document.createTreeWalker(
        messageTextEl,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                if (!node?.parentElement) return NodeFilter.FILTER_REJECT;
                if (node.parentElement.closest(".ib-board-host, .ib-board")) {
                    return NodeFilter.FILTER_REJECT;
                }
                const raw = node.textContent || "";
                if (!raw.trim()) return NodeFilter.FILTER_SKIP;
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    const targets = [];
    let current = walker.nextNode();
    while (current) {
        targets.push(current);
        current = walker.nextNode();
    }

    for (const node of targets) {
        const raw = node.textContent || "";
        const lines = raw.split(/\r?\n/);

        const kept = lines.filter(line => {
            const soft = NormalizeThoughtText(line);
            if (soft.length < 5) return true;
            return !thoughtSet.has(soft);
        });

        const next = kept.join("\n").replace(/\n{3,}/g, "\n\n");
        if (next.trim() !== raw.trim()) {
            node.textContent = next;
        }
    }

    // Also remove block elements that only contain a leaked thought
    messageTextEl.querySelectorAll("p, div, li").forEach(el => {
        if (el.closest(".ib-board-host, .ib-board")) return;
        const text = (el.textContent || "").trim();
        if (!text) return;
        const soft = NormalizeThoughtText(text);
        if (soft.length >= 5 && thoughtSet.has(soft)) {
            el.remove();
        }
    });
}

function ParseInfoboard(text) {
    const boardMatch = String(text || "").match(/<infoboard[\s\S]*?<\/infoboard>/i);
    if (!boardMatch) return null;

const xmlBlock = boardMatch[0];
const xmlForParsing = RepairInfoboardXml(xmlBlock);

const doc = gDomParser.parseFromString(xmlForParsing, "text/xml");

    if (doc.querySelector("parsererror")) {
        console.warn("[IB] XML parser error");
        return null;
    }

    const root = doc.querySelector("infoboard");
    if (!root) return null;

    const result = {
        time: root.getAttribute("time") || "???",
        date: root.getAttribute("date") || "???",
        weather: root.getAttribute("weather") || "???",
        loc: root.getAttribute("loc") || "???",
        chars: [],
        rels: [],
        thoughts: [],
        nsfw: null,
rawXml: xmlBlock
    };

  doc.querySelectorAll("chars > c").forEach(c => {
    const name = c.getAttribute("name") || "???";
    if (IsUserLikeName(name)) return;

    const tagsRaw = c.getAttribute("tags") || "";
    const tags = tagsRaw
        .split("|")
        .map(t => t.trim())
        .filter(Boolean)
        .slice(0, 6);
    
    const age = c.getAttribute("age") || "";
    const mood = LimitWords(c.getAttribute("mood") || "", 3, 40);
    
    // --- ОБРАБОТКА PRESENCE ---
    const rawPresence = c.getAttribute("presence") || "";
    let presence = null;

    // If the dedicated `presence` attribute is present, parse it (preferred path)
    if (rawPresence) {
        const p = NormalizeName(rawPresence);

        // Карта соответствия вынесена в модульную константу PRESENCE_ATTR_MAP
        if (PRESENCE_ATTR_MAP[p]) {
            presence = PRESENCE_ATTR_MAP[p];
        }
    }

    // Legacy fallback: if no valid `presence` attribute, try to infer from tags
    if (!presence) {
        presence = ParseFocusState(tags);
    }

    result.chars.push({
        icon: c.getAttribute("icon") || "•",
        name,
        age,
        tags,
        mood,
        presence
    });
});

const pushRel = (rel) => {
        const source = rel.getAttribute("source") || "???";
        if (IsUserLikeName(source)) return;

        result.rels.push({
            source,
            target: GetUserName(),
            a: Clamp(parseInt(rel.getAttribute("a")) || 0, -100, 100),
            ac: Clamp(parseInt(rel.getAttribute("ac")) || 0, -100, 100),
            tr: Clamp(parseInt(rel.getAttribute("tr")) || 0, -100, 100),
            tc: Clamp(parseInt(rel.getAttribute("tc")) || 0, -100, 100),
            l: Clamp(parseInt(rel.getAttribute("l")) || 0, -100, 100),
            lc: Clamp(parseInt(rel.getAttribute("lc")) || 0, -100, 100),
 status: LimitWords(rel.getAttribute("status") || T("noStatus"), 3, 48)
        });
    };

    const relNodes = doc.querySelectorAll("rels > rel");
    relNodes.forEach(pushRel);

    if (!result.rels.length) {
        doc.querySelectorAll("rel").forEach(pushRel);
    }

    if (result.rels.length && result.chars.length) {
    result.rels = result.rels.map(r => {
        const matches = result.chars.filter(c => NamesLikelyMatch(c.name, r.source));

        if (matches.length === 1) {
            return {
                ...r,
                source: matches[0].name,
                age: matches[0].age || "" // <--- Передаем возраст в rel
            };
        }

        return r;
    });
}

    const thk = doc.querySelector("thk");
    if (thk) {
        const rawThoughts = (thk.textContent || "").replace(/\r/g, "\n");
        const lines = rawThoughts
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean);

        result.thoughts = lines
            .map(ParseThoughtLine)
            .filter(Boolean)
            .filter(t => !IsUserLikeName(t.name));
    }

    NormalizeThoughtOwners(result);

    const src = String(text || "");
    const tailText = src.slice(src.indexOf(xmlBlock) + xmlBlock.length);
    const nsfwDoc = gDomParser.parseFromString(`<root>${tailText}</root>`, "text/xml");
    const nsfwNode = nsfwDoc.querySelector("nsfw");

    if (nsfwNode) {
        result.nsfw = {
            f: nsfwNode.getAttribute("f") || "",
            p: nsfwNode.getAttribute("p") || ""
        };
    } else {
        const nsfwMatch = src.match(/<nsfw\s+f="(.*?)"\s+p="(.*?)"\s*\/?>/i);
        if (nsfwMatch) {
            result.nsfw = {
                f: nsfwMatch[1] || "",
                p: nsfwMatch[2] || ""
            };
        }
    }

    return result;
}

/**
 * Calculate infoboard state up to (but NOT including) a specific message index.
 * Used when swiping: the prompt injection must reflect the state BEFORE the swiped message.
 */
function CalculateStateUpToMessage(maxMsgId) {
    const stContext = SillyTavern.getContext();
    let rollingState = structuredClone(kDefaultState);

    const mesNodes = document.querySelectorAll(".mes");
    for (const node of mesNodes) {
        const msgId = Number(node.getAttribute("mesid"));
        if (isNaN(msgId)) continue;
        if (msgId >= maxMsgId) break; // Stop before the swiped message

        const stMsg = stContext.chat[msgId];
        if (!stMsg || stMsg.is_user) continue;

        const parsed = ParseInfoboard(stMsg.mes || "");
        if (!parsed) continue;

        const patchedParsed = PatchPinnedData(parsed, rollingState);
        UpdateRollingState(rollingState, patchedParsed);
    }

    return rollingState;
}

function BuildStateInjection() {
    // During swipe+regeneration, use the pre-swipe state (before the swiped message).
    // Consume it immediately — one-time override, then revert to gState.
    const state = gPreSwipeState || gState;
    if (gPreSwipeState) {
        console.log("[IB] Using pre-swipe state for injection (one-time)");
        gPreSwipeState = null;
    }

    const lines = [];
    lines.push("[INFOBOARD STATE]");

    // Build a set of NPC names already present in current state (normalized)
    const stateCharNames = new Set(state.chars.map(c => NormalizeName(c.name)));

    // --- Collect pinned NPCs that are NOT in the current chat state ---
    // These come from pinSnapshots (saved when the NPC was last seen in any chat)
    const missingPinnedNpcs = [];
    if (gPinRegistry?.pinSnapshots && gPinnedNpcs.length) {
        for (const pinnedName of gPinnedNpcs) {
            const normalized = NormalizeName(pinnedName);
            if (!stateCharNames.has(normalized)) {
                const snapshot = gPinRegistry.pinSnapshots[normalized];
                if (snapshot) {
                    missingPinnedNpcs.push(snapshot);
                }
            }
        }
    }

    const hasAnyChars = state.chars.length > 0 || missingPinnedNpcs.length > 0;

    if (hasAnyChars) {
        lines.push("NPCs:");
        for (const c of state.chars) {
            const isPinned = IsPinnedNpc(c.name);
            const isGone = ["offscreen", "leftScene"].includes(c.presence?.key);

            if (!isPinned && isGone) {
                continue;
            }

            const tags = (c.tags || []).join(", ");
            const currentPresence = c.presence?.key || "unknown";
            const pinnedMarker = isPinned ? ", pinned" : "";
            lines.push(`- ${c.name} (${currentPresence}${pinnedMarker})${tags ? ` [${tags}]` : ""}`);
        }

        // Add pinned NPCs from snapshots that aren't in current state
        for (const snap of missingPinnedNpcs) {
            const tags = (snap.tags || []).join(", ");
            // Force offscreen presence — this NPC is from another chat
            const presence = "offscreen";
            lines.push(`- ${snap.name} (${presence}, pinned)${tags ? ` [${tags}]` : ""}`);
        }
    }

    if (state.rels.length) {
        lines.push("Relations:");
        for (const r of state.rels) {
            const charData = state.chars.find(c => NamesLikelyMatch(c.name, r.source));
            
            if (charData) {
                const isPinned = IsPinnedNpc(charData.name);
                const isGone = ["offscreen", "leftScene"].includes(charData.presence?.key);
                
                if (!isPinned && isGone) {
                    continue;
                }
            }

            lines.push(`- ${r.source}: A ${r.a} (${SignedText(r.ac)}), T ${r.tr} (${SignedText(r.tc)}), L ${r.l} (${SignedText(r.lc)}), ${r.status}`);
        }

        // Add relations from snapshots for pinned NPCs not in current state
        for (const snap of missingPinnedNpcs) {
            if (snap.rel) {
                const r = snap.rel;
                lines.push(`- ${r.source}: A ${r.a} (${SignedText(r.ac)}), T ${r.tr} (${SignedText(r.tc)}), L ${r.l} (${SignedText(r.lc)}), ${r.status}`);
            }
        }
    } else if (missingPinnedNpcs.length) {
        // Current state has no rels but we have snapshot rels
        const snapshotRels = missingPinnedNpcs.filter(s => s.rel);
        if (snapshotRels.length) {
            lines.push("Relations:");
            for (const snap of snapshotRels) {
                const r = snap.rel;
                lines.push(`- ${r.source}: A ${r.a} (${SignedText(r.ac)}), T ${r.tr} (${SignedText(r.tc)}), L ${r.l} (${SignedText(r.lc)}), ${r.status}`);
            }
        }
    }

    const hasStateThoughts = state.thoughts.length > 0;
    const snapshotThoughts = missingPinnedNpcs.filter(s => s.thought);

    if (hasStateThoughts || snapshotThoughts.length) {
        lines.push("PRIVATE NPC THOUGHTS - internal memory only, never write these in visible narrative:");
        for (const t of state.thoughts) {
            const charData = state.chars.find(c => NamesLikelyMatch(c.name, t.name));
            if (charData) {
                const isPinned = IsPinnedNpc(charData.name);
                const isGone = ["offscreen", "leftScene"].includes(charData.presence?.key);
                if (!isPinned && isGone) {
                    continue;
                }
            }
            
            lines.push(`- ${t.name}: ${t.text}`);
        }

        // Add thoughts from snapshots for pinned NPCs not in current state
        for (const snap of snapshotThoughts) {
            lines.push(`- ${snap.thought.name}: ${snap.thought.text}`);
        }
    }

    if (state.nsfw) {
        lines.push(`NSFW: F ${state.nsfw.f} | P ${state.nsfw.p}`);
    }

    lines.push("[/INFOBOARD STATE]");
    return lines.join("\n");
}

function SignedText(num) {
    const n = parseInt(num) || 0;
    return n >= 0 ? `+${n}` : `${n}`;
}

function RenderDelta(num) {
    const n = parseInt(num) || 0;
    const cls = n > 0 ? "ib-delta-pos" : n < 0 ? "ib-delta-neg" : "ib-delta-zero";
    const txt = n >= 0 ? `+${n}` : `${n}`;
    return `<span class="${cls}">${txt}</span>`;
}

function RenderBarWidth(value) {
    const v = Math.abs(Clamp(parseInt(value) || 0, -100, 100));
    if (v <= 0) return "0%";
    return `${Math.max(v, 4)}%`;
}

function GetStatusClass(status) {
    const s = NormalizeName(status);

    const romantic = ["роман", "любов", "влюб", "пара", "отношен", "свидан", "любовники", "муж", "жена", "соулмейт", "dating", "lover", "romantic", "married", "soulmate", "romance"];
    const negative = ["враг", "ненав", "токс", "абьюз", "сопер", "rival", "enemy", "abusive", "toxic", "ex-", "бывш", "hostile", "hatred", "hate"];
    const complex = ["сложн", "одерж", "защит", "ментор", "учен", "family", "нераздел", "complicated", "protective", "mentor", "unrequited", "obsession", "obsessed"];
    const positive = ["близк", "друг", "союзник", "товарищ", "приятел", "друзья", "доверен", "верн", "предан", "забот", "родствен", "брат", "сестр", "close friend", "best friend", "ally", "companion", "trusted", "loyal", "devoted", "caring", "bonded", "friend"];

    if (romantic.some(k => s.includes(k))) return "ib-status-romantic";
    if (negative.some(k => s.includes(k))) return "ib-status-negative";
    if (complex.some(k => s.includes(k))) return "ib-status-complex";
    if (positive.some(k => s.includes(k))) return "ib-status-positive";
    return "ib-status-neutral";
}

function GetStatusIcon(status) {
    const cls = GetStatusClass(status);
    if (cls === "ib-status-romantic") return "♥";
    if (cls === "ib-status-negative") return "⚠";
    if (cls === "ib-status-complex") return "✦";
    if (cls === "ib-status-positive") return "★";
    return "•";
}

function GetMetricMeta(type, value) {
    const v = Clamp(parseInt(value) || 0, -100, 100);
    const abs = Math.abs(v);
    const saturation = 0.88 + abs / 420;
    const brightness = 0.95 + abs / 700;
    const glow = 2 + abs / 36;
    const alpha = 0.06 + abs / 900;

    if (type === "a") {
        return v >= 0
            ? { key: "a", metricKey: "affPos", label: T("affection"), barClass: "ib-bar-affection-pos", style: `filter:saturate(${saturation}) brightness(${brightness}); box-shadow:0 0 ${glow}px rgba(45, 169, 111, ${alpha});` }
            : { key: "a", metricKey: "affNeg", label: T("aversion"), barClass: "ib-bar-affection-neg", style: `filter:saturate(${saturation}) brightness(${brightness}); box-shadow:0 0 ${glow}px rgba(181, 82, 82, ${alpha});` };
    }

    if (type === "tr") {
        return v >= 0
            ? { key: "tr", metricKey: "trPos", label: T("trust"), barClass: "ib-bar-trust-pos", style: `filter:saturate(${saturation}) brightness(${brightness}); box-shadow:0 0 ${glow}px rgba(74, 135, 216, ${alpha});` }
            : { key: "tr", metricKey: "trNeg", label: T("distrust"), barClass: "ib-bar-trust-neg", style: `filter:saturate(${saturation}) brightness(${brightness}); box-shadow:0 0 ${glow}px rgba(184, 116, 66, ${alpha});` };
    }

    return v >= 0
        ? { key: "l", metricKey: "lovePos", label: T("love"), barClass: "ib-bar-love-pos", style: `filter:saturate(${saturation}) brightness(${brightness}); box-shadow:0 0 ${glow}px rgba(138, 88, 212, ${alpha});` }
        : { key: "l", metricKey: "loveNeg", label: T("hatred"), barClass: "ib-bar-love-neg", style: `filter:saturate(${saturation}) brightness(${brightness}); box-shadow:0 0 ${glow}px rgba(169, 59, 88, ${alpha});` };
}

function GetBarEmoji(metricKey) {
    return '';
}

function GetBarPattern(metricKey) {
    return '';
}

function GetCurrentBarHeight() {
    return kBarStyleHeights[gBarStyle] || 7;
}

// Default bar heights per bar style preset (must match CSS)
const kBarStyleHeights = {
    classic: 7, deep: 8, glass: 6, soft: 6, pixel: 8, candy: 8,
    prism: 8, neon: 8, terminal: 11, hearts: 17, constellation: 18,
    vials: 14, evidence: 13, runic: 18, sigil: 9, energon: 11
};

// Default bar border-radius per bar style preset (must match CSS)
const kBarStyleRadii = {
    classic: 999, deep: 999, glass: 999, soft: 999, pixel: 0, candy: 999,
    prism: 999, neon: 2, terminal: 2, hearts: 0, constellation: 0,
    vials: 999, evidence: 2, runic: 0, sigil: 999, energon: 999
};

// How each bar style sets metric colors:
//   'background' — fill uses background property (safe to override with background)
//   'color'      — fill uses currentColor in gradients/shadows (must set color, NOT background)
//   'vars'       — fill uses CSS custom properties (must override the specific vars)
const kBarStyleMetricMethod = {
    classic: 'background',
    deep: 'background',
    glass: 'background',
    soft: 'background',
    pixel: 'background',
    candy: 'background',
    prism: 'background',
    neon: 'color',        // box-shadow uses currentColor
    terminal: 'color',    // repeating-linear-gradient uses currentColor
    hearts: 'color',      // background-color: currentColor
    constellation: 'vars', // --ib-star-fill, --ib-star-glow
    vials: 'vars',        // --ib-vial-1, --ib-vial-2, --ib-vial-glow
    evidence: 'vars',     // --ib-tape-a, --ib-tape-b, --ib-tape-glow
    runic: 'vars',        // --ib-shard-1, --ib-shard-2, --ib-shard-3, --ib-shard-glow
    sigil: 'background',
    energon: 'vars',      // --ib-energon-a1, --ib-energon-a2
};

// CSS variable names used by 'vars'-method bar styles
// Maps metric color key → list of CSS custom properties to override
const kBarStyleMetricVars = {
    evidence: {
        affPos: ['--ib-tape-a', '--ib-tape-glow'],
        affNeg: ['--ib-tape-a', '--ib-tape-glow'],
        trPos:  ['--ib-tape-a', '--ib-tape-glow'],
        trNeg:  ['--ib-tape-a', '--ib-tape-glow'],
        lovePos:['--ib-tape-a', '--ib-tape-glow'],
        loveNeg:['--ib-tape-a', '--ib-tape-glow'],
    },
    vials: {
        affPos: ['--ib-vial-1', '--ib-vial-glow'],
        affNeg: ['--ib-vial-1', '--ib-vial-glow'],
        trPos:  ['--ib-vial-1', '--ib-vial-glow'],
        trNeg:  ['--ib-vial-1', '--ib-vial-glow'],
        lovePos:['--ib-vial-1', '--ib-vial-glow'],
        loveNeg:['--ib-vial-1', '--ib-vial-glow'],
    },
    constellation: {
        affPos: ['--ib-star-fill', '--ib-star-glow'],
        affNeg: ['--ib-star-fill', '--ib-star-glow'],
        trPos:  ['--ib-star-fill', '--ib-star-glow'],
        trNeg:  ['--ib-star-fill', '--ib-star-glow'],
        lovePos:['--ib-star-fill', '--ib-star-glow'],
        loveNeg:['--ib-star-fill', '--ib-star-glow'],
    },
    runic: {
        affPos: ['--ib-shard-1', '--ib-shard-glow'],
        affNeg: ['--ib-shard-1', '--ib-shard-glow'],
        trPos:  ['--ib-shard-1', '--ib-shard-glow'],
        trNeg:  ['--ib-shard-1', '--ib-shard-glow'],
        lovePos:['--ib-shard-1', '--ib-shard-glow'],
        loveNeg:['--ib-shard-1', '--ib-shard-glow'],
    },
    energon: {
        affPos: ['--ib-energon-a1', '--ib-energon-a2'],
        affNeg: ['--ib-energon-a1', '--ib-energon-a2'],
        trPos:  ['--ib-energon-a1', '--ib-energon-a2'],
        trNeg:  ['--ib-energon-a1', '--ib-energon-a2'],
        lovePos:['--ib-energon-a1', '--ib-energon-a2'],
        loveNeg:['--ib-energon-a1', '--ib-energon-a2'],
    },
};

// Multi-color slot configuration per bar style.
// count: how many color inputs per metric
// labels: short labels for each slot (RU i18n keys)
// gradientTpl: for 'background' method styles, template with {0},{1},{2} placeholders
// slotVars: for 'vars' method styles, CSS custom property names per slot
// glowVar: for 'vars' method styles, the glow CSS var (derived as color+alpha)
const kBarStyleColorSlots = {
    classic:     { count: 1, labels: ['teSlot1'] },
    deep:        { count: 3, labels: ['teSlot1','teSlot2','teSlot3'], gradientTpl: 'linear-gradient(90deg, {0}, {1} 58%, {2})' },
    glass:       { count: 1, labels: ['teSlot1'] },
    soft:        { count: 1, labels: ['teSlot1'] },
    pixel:       { count: 1, labels: ['teSlot1'] },
    candy:       { count: 3, labels: ['teSlot1','teSlot2','teSlot3'], gradientTpl: 'linear-gradient(90deg, {0}, {1} 45%, {2})' },
    prism:       { count: 3, labels: ['teSlot1','teSlot2','teSlot3'], gradientTpl: 'linear-gradient(90deg, {0}, {1} 45%, {2})' },
    neon:        { count: 1, labels: ['teSlot1'] },
    terminal:    { count: 1, labels: ['teSlot1'] },
    hearts:      { count: 1, labels: ['teSlot1'] },
    constellation:{ count: 1, labels: ['teSlot1'], slotVars: ['--ib-star-fill'], glowVar: '--ib-star-glow' },
    vials:       { count: 2, labels: ['teSlot1','teSlot3'], slotVars: ['--ib-vial-1', '--ib-vial-2'], glowVar: '--ib-vial-glow' },
    evidence:    { count: 2, labels: ['teSlot1','teSlot3'], slotVars: ['--ib-tape-a', '--ib-tape-b'], glowVar: '--ib-tape-glow' },
    runic:       { count: 3, labels: ['teSlot1','teSlot2','teSlot3'], slotVars: ['--ib-shard-1', '--ib-shard-2', '--ib-shard-3'], glowVar: '--ib-shard-glow' },
    sigil:       { count: 3, labels: ['teSlot1','teSlot2','teSlot3'], gradientTpl: 'linear-gradient(90deg, {0}, {1} 46%, {2})' },
    energon:     { count: 2, labels: ['teSlot1','teSlot3'], slotVars: ['--ib-energon-a1', '--ib-energon-a2'] },
};

function SortRelationsByPriority(rels) {
    return [...rels].sort((a, b) => {
        const ap = IsPinnedNpc(a.source) ? 0 : 1;
        const bp = IsPinnedNpc(b.source) ? 0 : 1;
        if (ap !== bp) return ap - bp;

        const aa = Math.abs(a.a || 0) + Math.abs(a.tr || 0) + Math.abs(a.l || 0);
        const bb = Math.abs(b.a || 0) + Math.abs(b.tr || 0) + Math.abs(b.l || 0);
        return bb - aa;
    });
}

function GetChangedMetrics(prevState, rel) {
    if (!prevState?.rels?.length || !rel?.source) return { a: false, tr: false, l: false };

    const prev = prevState.rels.find(r => NamesLikelyMatch(r.source, rel.source));
    if (!prev) return { a: true, tr: true, l: true };

    return {
        a: parseInt(prev.a) !== parseInt(rel.a) || parseInt(rel.ac) !== 0,
        tr: parseInt(prev.tr) !== parseInt(rel.tr) || parseInt(rel.tc) !== 0,
        l: parseInt(prev.l) !== parseInt(rel.l) || parseInt(rel.lc) !== 0
    };
}

function GetCompactMetricMeta(type, value, delta = 0) {
    const v = Clamp(parseInt(value) || 0, -100, 100);
    const abs = Math.abs(v);
    const width = Math.max(6, Math.round((abs / 100) * 100));

    const highCls = abs >= 70 ? " ib-mini-stat-high" : "";
    const extremeCls = abs >= 90 ? " ib-mini-stat-extreme" : "";

    if (type === "a") {
        return {
            cls: `${v >= 0 ? "ib-mini-stat-aff-pos" : "ib-mini-stat-aff-neg ib-mini-stat-neg"}${highCls}${extremeCls}`,
            label: "A",
            value: `${v}`,
            delta: parseInt(delta) || 0,
            fill: width
        };
    }

    if (type === "tr") {
        return {
            cls: `${v >= 0 ? "ib-mini-stat-tr-pos" : "ib-mini-stat-tr-neg ib-mini-stat-neg"}${highCls}${extremeCls}`,
            label: "T",
            value: `${v}`,
            delta: parseInt(delta) || 0,
            fill: width
        };
    }

    return {
        cls: `${v >= 0 ? "ib-mini-stat-love-pos" : "ib-mini-stat-love-neg ib-mini-stat-neg"}${highCls}${extremeCls}`,
        label: "L",
        value: `${v}`,
        delta: parseInt(delta) || 0,
        fill: width
    };
}

function RenderMiniStat(meta, changed = false) {
    const deltaHtml = meta.delta !== 0
        ? `<span class="ib-mini-stat-delta ${meta.delta > 0 ? "ib-delta-pos" : "ib-delta-neg"}">${EscapeHtml(SignedText(meta.delta))}</span>`
        : "";

    return `
    <div class="ib-mini-stat ${meta.cls} ${changed ? "ib-mini-stat-changed" : ""}" style="--ib-mini-fill:${meta.fill}%;">
        <span class="ib-mini-stat-progress" aria-hidden="true"></span>
        <span class="ib-mini-stat-label">${meta.label}</span>
        <span class="ib-mini-stat-value">${EscapeHtml(meta.value)}</span>
        ${deltaHtml}
        ${meta.cls.includes("ib-mini-stat-neg") ? `<span class="ib-mini-stat-cracks" aria-hidden="true"></span>` : ""}
    </div>`;
}

// ============== Pin Navigation ==============

/**
 * Navigate to a character card by avatar key (e.g. "Komac.png").
 * Finds the character in the SillyTavern character list and opens it.
 */
function NavigateToCharacterCard(avatarKey) {
    try {
        const ctx = SillyTavern.getContext();
        const chars = ctx.characters || [];
        const idx = chars.findIndex(c => c.avatar === avatarKey);
        if (idx >= 0 && typeof ctx.selectCharacterById === "function") {
            ctx.selectCharacterById(idx);
        } else if (idx < 0) {
            ShowToast("📍", T("pinNavNotFound"), "warning");
        }
    } catch (e) {
        console.warn("[IB] NavigateToCharacterCard failed:", e?.message);
    }
}

/**
 * Get the avatar key (e.g. "Komac.png") for a pinned NPC at a given level.
 * Returns null if not found.
 */
function GetPinCharKey(name) {
    if (!gPinRegistry || !name) return null;
    const normalized = NormalizeName(name);

    // Check perChar — find which character has this pin
    if (gPinRegistry.characters) {
        for (const [key, entry] of Object.entries(gPinRegistry.characters)) {
            const pins = Array.isArray(entry?.pins) ? entry.pins : (Array.isArray(entry) ? entry : []);
            if (pins.some(n => NormalizeName(n) === normalized)) {
                return key; // avatar key like "Komac.png"
            }
        }
    }

    // Check global — use snapshot to find the character card
    if ((gPinRegistry.global || []).some(n => NormalizeName(n) === normalized)) {
        // Try to find the character by NPC name in the character list
        try {
            const ctx = SillyTavern.getContext();
            const chars = ctx.characters || [];
            const match = chars.find(c => NamesLikelyMatch(c.name, name));
            if (match?.avatar) return match.avatar;
        } catch {}
    }

    return null;
}

/**
 * Get the chat ID where a pinned NPC is stored at perChat level.
 * Returns null if the NPC is not pinned per-chat.
 */
function GetPinChatId(name) {
    if (!gPinRegistry || !name) return null;
    const normalized = NormalizeName(name);

    if (gPinRegistry.chats) {
        for (const [chatId, pins] of Object.entries(gPinRegistry.chats)) {
            if (Array.isArray(pins) && pins.some(n => NormalizeName(n) === normalized)) {
                return chatId;
            }
        }
    }
    return null;
}

/**
 * Get the avatar key for a chat ID by parsing the chat ID format.
 * SillyTavern chat IDs are like "Komac - 2025-06-03@16h52m23s410ms"
 * The avatar can be found by matching the character name prefix.
 */
function GetCharKeyForChatId(chatId) {
    if (!chatId) return null;
    try {
        const ctx = SillyTavern.getContext();
        const chars = ctx.characters || [];
        // Chat ID format: "CharacterName - datetime"
        const chatPrefix = chatId.split(" - ")[0]?.trim();
        if (chatPrefix) {
            const match = chars.find(c => {
                const charName = String(c.name || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
                return charName === chatPrefix || NamesLikelyMatch(c.name, chatPrefix);
            });
            if (match?.avatar) return match.avatar;
        }
    } catch {}
    return null;
}

// ============== Pin Registry System ==============

function GetCurrentCharKey() {
    try {
        const ctx = SillyTavern.getContext();
        const char = ctx.characters?.[ctx.characterId];
        if (char?.avatar) return char.avatar;
        if (char?.name) return char.name;
    } catch {}
    return "default";
}

function GetDefaultPinRegistry() {
    return {
        version: 2,
        global: [],
        characters: {},
        chats: {},
        pinSources: {}, // normalized NPC name -> charKey (avatar key of the card that pinned it globally)
        pinSnapshots: {} // normalized NPC name -> { name, icon, age, tags, mood, presence, rel, thought }
    };
}

function LoadPinRegistry() {
    try {
        const raw = localStorage.getItem("IB_PinRegistry");
        if (raw) {
            const data = JSON.parse(raw);
            if (data && typeof data === "object") {
                return { ...GetDefaultPinRegistry(), ...data };
            }
        }
    } catch {}
    return GetDefaultPinRegistry();
}

function SavePinRegistry(registry) {
    try {
        localStorage.setItem("IB_PinRegistry", JSON.stringify(registry));
    } catch (e) {
        console.warn("[IB] Failed to save pin registry:", e?.message);
    }
}

function LoadPinnedNpcs(forceReload = false) {
    // Load registry if not cached, or if forced (e.g. on chat change
    // to recover from any in-memory corruption that happened during init)
    if (!gPinRegistry || forceReload) {
        gPinRegistry = LoadPinRegistry();
        // Migration: remove legacy `mode` field if present
        if (gPinRegistry.mode) {
            delete gPinRegistry.mode;
            SavePinRegistry(gPinRegistry);
        }
    }

    gPinnedNpcs = ResolveActivePins();
}

function ResolveActivePins() {
    if (!gPinRegistry) return [];

    const result = [];
    const seen = new Set();

    const addUnique = (names) => {
        for (const n of names) {
            const norm = NormalizeName(n);
            if (!seen.has(norm)) {
                seen.add(norm);
                result.push(n);
            }
        }
    };

    // 1. Global pins first
    addUnique(gPinRegistry.global || []);

    // 2. Per-character pins
    const charKey = GetCurrentCharKey();
    const charEntry = gPinRegistry.characters?.[charKey];
    if (charEntry) {
        if (Array.isArray(charEntry.pins)) addUnique(charEntry.pins);
        else if (Array.isArray(charEntry)) addUnique(charEntry); // legacy migration
    }

    // 3. Per-chat pins
    const chatId = GetChatId();
    const chatEntry = gPinRegistry.chats?.[chatId];
    if (chatEntry) {
        if (Array.isArray(chatEntry)) addUnique(chatEntry); // legacy format
        else if (Array.isArray(chatEntry.pins)) addUnique(chatEntry.pins); // new format
    }

    return result;
}

/**
 * Resolve ALL pinned NPCs from the entire registry, regardless of current context.
 * Returns array of { name, level, charKey, chatId } objects.
 * Used by the Pin Editor to show all pins across all characters/chats.
 */
function ResolveAllPins() {
    if (!gPinRegistry) return [];
    const result = [];

    // 1. Global pins
    (gPinRegistry.global || []).forEach(n => {
        const charKey = gPinRegistry.pinSources?.[NormalizeName(n)] || null;
        result.push({ name: n, level: "global", charKey: charKey, chatId: null });
    });

    // 2. Per-character pins
    if (gPinRegistry.characters) {
        for (const [key, entry] of Object.entries(gPinRegistry.characters)) {
            const pins = Array.isArray(entry?.pins) ? entry.pins : (Array.isArray(entry) ? entry : []);
            pins.forEach(n => result.push({ name: n, level: "perChar", charKey: key, chatId: null }));
        }
    }

    // 3. Per-chat pins
    if (gPinRegistry.chats) {
        for (const [chatId, entry] of Object.entries(gPinRegistry.chats)) {
            if (Array.isArray(entry)) {
                // Legacy format: chatId -> [names]
                const charKey = GetCharKeyForChatId(chatId);
                entry.forEach(n => result.push({ name: n, level: "perChat", charKey: charKey, chatId: chatId }));
            } else if (entry?.pins) {
                // New format: chatId -> { charKey, pins: [names] }
                entry.pins.forEach(n => result.push({ name: n, level: "perChat", charKey: entry.charKey || GetCharKeyForChatId(chatId) || null, chatId: chatId }));
            }
        }
    }

    return result;
}

function SortPinsByName(names = []) {
    return [...names].sort((a, b) => String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" }));
}

// SavePinnedNpcs() removed — use SetPinLevel/RemovePinCompletely instead

function GetCurrentCharName() {
    try {
        const ctx = SillyTavern.getContext();
        const char = ctx.characters?.[ctx.characterId];
        return char?.name || "Unknown";
    } catch {}
    return "Unknown";
}

/**
 * Resolve a character's display name from an avatar key (e.g. "Komac.png").
 * Returns null if not found.
 */
function GetCharNameByKey(charKey) {
    if (!charKey) return null;
    try {
        const ctx = SillyTavern.getContext();
        const chars = ctx.characters || [];
        // Standard path: match by avatar filename
        const byAvatar = chars.find(c => c.avatar === charKey);
        if (byAvatar?.name) return byAvatar.name;
        // Fallback: match by name (if charKey is a name, not a .png)
        const byName = chars.find(c => NamesLikelyMatch(c.name, charKey));
        if (byName?.name) return byName.name;
    } catch {}
    return null;
}

function IsPinnedNpc(name) {
    const normalized = NormalizeName(name);
    return gPinnedNpcs.some(pinned => NormalizeName(pinned) === normalized);
}

/**
 * GetPinLevel(name) → "perChat" | "perChar" | "global" | null
 * Returns the highest tier at which the NPC is pinned.
 * Priority: global > perChar > perChat
 */
function GetPinLevel(name) {
    if (!gPinRegistry || !name) return null;
    const normalized = NormalizeName(name);

    // 1. Check global
    if ((gPinRegistry.global || []).some(n => NormalizeName(n) === normalized)) {
        return "global";
    }

    // 2. Check per-character
    const charKey = GetCurrentCharKey();
    const charEntry = gPinRegistry.characters?.[charKey];
    if (charEntry) {
        const pins = Array.isArray(charEntry.pins) ? charEntry.pins : (Array.isArray(charEntry) ? charEntry : []);
        if (pins.some(n => NormalizeName(n) === normalized)) {
            return "perChar";
        }
    }

    // 3. Check per-chat
    const chatId = GetChatId();
    const chatEntry = gPinRegistry.chats?.[chatId];
    const chatPins = Array.isArray(chatEntry) ? chatEntry : (chatEntry?.pins || []);
    if (chatPins.some(n => NormalizeName(n) === normalized)) {
        return "perChat";
    }

    return null;
}

/**
 * Remove a pin from the CURRENT context only (current chat/character/global).
 * Used by SetPinLevel and the ✕ unpin button for active pins.
 * Unlike RemovePinCompletely, this does NOT touch pins in other chats/characters.
 */
function RemoveFromCurrentContext(name, level) {
    if (!gPinRegistry || !name) return;
    const normalized = NormalizeName(name);

    if (level === "perChat") {
        const chatId = GetChatId();
        if (gPinRegistry.chats?.[chatId]) {
            const entry = gPinRegistry.chats[chatId];
            if (Array.isArray(entry)) {
                gPinRegistry.chats[chatId] = entry.filter(n => NormalizeName(n) !== normalized);
                if (gPinRegistry.chats[chatId].length === 0) delete gPinRegistry.chats[chatId];
            } else if (entry?.pins) {
                entry.pins = entry.pins.filter(n => NormalizeName(n) !== normalized);
                if (entry.pins.length === 0) delete gPinRegistry.chats[chatId];
            }
        }
    } else if (level === "perChar") {
        const charKey = GetCurrentCharKey();
        if (gPinRegistry.characters?.[charKey]) {
            const entry = gPinRegistry.characters[charKey];
            if (Array.isArray(entry?.pins)) {
                entry.pins = entry.pins.filter(n => NormalizeName(n) !== normalized);
                if (entry.pins.length === 0) delete gPinRegistry.characters[charKey];
            } else if (Array.isArray(entry)) {
                gPinRegistry.characters[charKey] = entry.filter(n => NormalizeName(n) !== normalized);
                if (gPinRegistry.characters[charKey].length === 0) delete gPinRegistry.characters[charKey];
            }
        }
    } else if (level === "global") {
        if (gPinRegistry.global) {
            gPinRegistry.global = gPinRegistry.global.filter(n => NormalizeName(n) !== normalized);
        }
        if (gPinRegistry.pinSources) {
            delete gPinRegistry.pinSources[normalized];
        }
    }
}

/**
 * Remove a pin from a SPECIFIC context (given level, charKey, chatId).
 * Used by the ✕ button in the "other" section of the pins popup.
 * If the pin no longer exists in any context after removal, also removes the snapshot.
 */
function RemoveFromSpecificContext(name, level, charKey, chatId) {
    if (!gPinRegistry || !name) return;
    const normalized = NormalizeName(name);

    if (level === "perChat" && chatId) {
        if (gPinRegistry.chats?.[chatId]) {
            const entry = gPinRegistry.chats[chatId];
            if (Array.isArray(entry)) {
                gPinRegistry.chats[chatId] = entry.filter(n => NormalizeName(n) !== normalized);
                if (gPinRegistry.chats[chatId].length === 0) delete gPinRegistry.chats[chatId];
            } else if (entry?.pins) {
                entry.pins = entry.pins.filter(n => NormalizeName(n) !== normalized);
                if (entry.pins.length === 0) delete gPinRegistry.chats[chatId];
            }
        }
    } else if (level === "perChar" && charKey) {
        if (gPinRegistry.characters?.[charKey]) {
            const entry = gPinRegistry.characters[charKey];
            if (Array.isArray(entry?.pins)) {
                entry.pins = entry.pins.filter(n => NormalizeName(n) !== normalized);
                if (entry.pins.length === 0) delete gPinRegistry.characters[charKey];
            } else if (Array.isArray(entry)) {
                gPinRegistry.characters[charKey] = entry.filter(n => NormalizeName(n) !== normalized);
                if (gPinRegistry.characters[charKey].length === 0) delete gPinRegistry.characters[charKey];
            }
        }
    } else if (level === "global") {
        if (gPinRegistry.global) {
            gPinRegistry.global = gPinRegistry.global.filter(n => NormalizeName(n) !== normalized);
        }
        if (gPinRegistry.pinSources) {
            delete gPinRegistry.pinSources[normalized];
        }
    }

    // Check if pin still exists in any context — if not, clean up snapshot
    const stillExists = ResolveAllPins().some(p => NormalizeName(p.name) === normalized);
    if (!stillExists) {
        RemovePinSnapshot(name);
    }

    gPinnedNpcs = ResolveActivePins();
    SavePinRegistry(gPinRegistry);
}

function RemovePinCompletely(name) {
    if (!gPinRegistry || !name) return;
    const normalized = NormalizeName(name);

    // Remove from global
    if (gPinRegistry.global) {
        gPinRegistry.global = gPinRegistry.global.filter(n => NormalizeName(n) !== normalized);
    }

    // Remove from ALL characters
    if (gPinRegistry.characters) {
        for (const key of Object.keys(gPinRegistry.characters)) {
            const entry = gPinRegistry.characters[key];
            if (Array.isArray(entry?.pins)) {
                entry.pins = entry.pins.filter(n => NormalizeName(n) !== normalized);
                // Clean up empty character entries
                if (entry.pins.length === 0) {
                    delete gPinRegistry.characters[key];
                }
            } else if (Array.isArray(entry)) {
                gPinRegistry.characters[key] = entry.filter(n => NormalizeName(n) !== normalized);
                // Clean up empty character entries (legacy format)
                if (gPinRegistry.characters[key].length === 0) {
                    delete gPinRegistry.characters[key];
                }
            }
        }
    }

    // Remove from ALL chats
    if (gPinRegistry.chats) {
        for (const chatId of Object.keys(gPinRegistry.chats)) {
            const entry = gPinRegistry.chats[chatId];
            if (Array.isArray(entry)) {
                // Legacy format
                gPinRegistry.chats[chatId] = entry.filter(n => NormalizeName(n) !== normalized);
                if (gPinRegistry.chats[chatId].length === 0) {
                    delete gPinRegistry.chats[chatId];
                }
            } else if (entry?.pins) {
                // New format
                entry.pins = entry.pins.filter(n => NormalizeName(n) !== normalized);
                if (entry.pins.length === 0) {
                    delete gPinRegistry.chats[chatId];
                }
            }
        }
    }

    // Remove from pinSources (global source tracking)
    if (gPinRegistry.pinSources) {
        delete gPinRegistry.pinSources[normalized];
    }

    // NOTE: Do NOT remove snapshot here — callers (e.g. CleanPinRegistry) may
    // still need it. Snapshots are cleaned up by CleanPinRegistry() or
    // RemoveFromSpecificContext when the pin is confirmed gone from all contexts.

    gPinnedNpcs = ResolveActivePins();
    SavePinRegistry(gPinRegistry);
}

function SetPinLevel(name, level) {
    if (!gPinRegistry || !name) return;
    if (!gPinRegistry.global) gPinRegistry.global = [];
    if (!gPinRegistry.characters) gPinRegistry.characters = {};
    if (!gPinRegistry.chats) gPinRegistry.chats = {};

    // Preserve existing snapshot BEFORE removing — for safety during level-change.
    const normalized = NormalizeName(name);
    const savedSnapshot = gPinRegistry.pinSnapshots?.[normalized]
        ? structuredClone(gPinRegistry.pinSnapshots[normalized])
        : null;

    // Remove from CURRENT context only (not from all contexts like RemovePinCompletely).
    // This preserves pins created by PinHere in other chats/characters.
    const currentLevel = GetPinLevel(name);
    RemoveFromCurrentContext(name, currentLevel);

    // Re-add at the specified level
    if (level === "global") {
        gPinRegistry.global.push(name);
        // Track which character card this was pinned from
        if (!gPinRegistry.pinSources) gPinRegistry.pinSources = {};
        gPinRegistry.pinSources[normalized] = GetCurrentCharKey();
    } else if (level === "perChar") {
        const charKey = GetCurrentCharKey();
        const existing = gPinRegistry.characters[charKey];
        const charName = (typeof existing === 'object' && existing.name) ? existing.name : GetCurrentCharName();
        gPinRegistry.characters[charKey] = { name: charName, pins: [...(existing?.pins || []), name] };
    } else if (level === "perChat") {
        const chatId = GetChatId();
        const charKey = GetCurrentCharKey();
        const existing = gPinRegistry.chats[chatId];
        if (!existing) {
            gPinRegistry.chats[chatId] = { charKey: charKey, pins: [name] };
        } else if (Array.isArray(existing)) {
            // Migrate legacy format
            gPinRegistry.chats[chatId] = { charKey: charKey, pins: [...existing, name] };
        } else {
            // New format — update charKey if needed
            if (!existing.charKey) existing.charKey = charKey;
            existing.pins.push(name);
        }
    }
    // level === null → already removed by RemoveFromCurrentContext above

    // If completely unpinning (level === null), check if pin still exists elsewhere.
    // Only remove snapshot if the pin is completely gone from all contexts.
    if (level === null) {
        const stillExists = ResolveAllPins().some(p => NormalizeName(p.name) === normalized);
        if (!stillExists) {
            RemovePinSnapshot(name);
        }
    } else {
        // Restore snapshot if it was lost during removal (safety net)
        // and UpdatePinSnapshot below won't find the NPC (e.g. empty chat).
        if (savedSnapshot && !gPinRegistry.pinSnapshots?.[normalized]) {
            if (!gPinRegistry.pinSnapshots) gPinRegistry.pinSnapshots = {};
            gPinRegistry.pinSnapshots[normalized] = savedSnapshot;
            console.log(`[IB] SetPinLevel: restored preserved snapshot for "${name}" (level → ${level})`);
        }
    }

    gPinnedNpcs = ResolveActivePins();
    // Save snapshot of pinned NPC data from current gState (only if NPC is present)
    if (level !== null) {
        UpdatePinSnapshot(name);
    }

    gPinnedNpcs = ResolveActivePins();
    SavePinRegistry(gPinRegistry);

    console.log(`[IB] SetPinLevel: "${name}" → ${level}, gPinnedNpcs=[${gPinnedNpcs.join(",")}], snapshotExists=${!!gPinRegistry.pinSnapshots?.[normalized]}`);
}

/**
 * Pin an NPC to the current chat (perChat) WITHOUT removing it from other levels.
 * If already pinned in this chat, does nothing. Returns true if added.
 */
function PinHere(name) {
    if (!gPinRegistry || !name) return false;
    if (!gPinRegistry.chats) gPinRegistry.chats = {};

    // Already pinned in current context at ANY level? Don't create a shadow duplicate.
    if (GetPinLevel(name)) return false;

    const chatId = GetChatId();
    const charKey = GetCurrentCharKey();
    const existing = gPinRegistry.chats[chatId];

    // Already pinned in this chat?
    if (existing) {
        const pins = Array.isArray(existing) ? existing : (existing.pins || []);
        if (pins.some(p => NormalizeName(p) === NormalizeName(name))) return false;
    }

    // Add to current chat
    if (!existing) {
        gPinRegistry.chats[chatId] = { charKey: charKey, pins: [name] };
    } else if (Array.isArray(existing)) {
        // Migrate legacy format
        gPinRegistry.chats[chatId] = { charKey: charKey, pins: [...existing, name] };
    } else {
        if (!existing.charKey) existing.charKey = charKey;
        existing.pins.push(name);
    }

    // Preserve/restore snapshot if available
    const normalized = NormalizeName(name);
    if (gPinRegistry.pinSnapshots?.[normalized]) {
        // Snapshot already exists from the source context — keep it
    } else {
        // Try to create one from current gState
        UpdatePinSnapshot(name);
    }

    gPinnedNpcs = ResolveActivePins();
    SavePinRegistry(gPinRegistry);
    console.log(`[IB] PinHere: "${name}" added to chat ${chatId}`);
    return true;
}

/**
 * Save a snapshot of an NPC's current state data into the pin registry.
 * This allows the NPC to appear in prompt injection even when their
 * original chat is not active (e.g. globally pinned NPC in a new character card).
 */
function UpdatePinSnapshot(name) {
    if (!gPinRegistry || !name) return;
    if (!gPinRegistry.pinSnapshots) gPinRegistry.pinSnapshots = {};

    const normalized = NormalizeName(name);

    // Find NPC data in current gState
    const charData = gState.chars.find(c => NamesLikelyMatch(c.name, name));
    const relData = gState.rels.find(r => NamesLikelyMatch(r.source, name));
    const thoughtData = gState.thoughts.find(t => NamesLikelyMatch(t.name, name));

    // Only update snapshot if we have at least char data
    if (!charData) return;

    // Check if current data is a placeholder (created by PatchPinnedData fallback)
    // If so, don't overwrite an existing richer snapshot
    const existing = gPinRegistry.pinSnapshots[normalized];
    const isPlaceholder = charData.icon === "📌" && (!charData.age && !charData.mood);
    if (isPlaceholder && existing) {
        // Only update rel/thought if we have real data; preserve existing otherwise
        if (relData) {
            existing.rel = {
                source: relData.source,
                a: relData.a, ac: relData.ac,
                tr: relData.tr, tc: relData.tc,
                l: relData.l, lc: relData.lc,
                status: relData.status
            };
        }
        if (thoughtData) {
            existing.thought = { name: thoughtData.name, text: thoughtData.text };
        }
        SavePinRegistry(gPinRegistry);
        return;
    }

    gPinRegistry.pinSnapshots[normalized] = {
        name: charData.name,
        icon: charData.icon || "•",
        age: charData.age || "",
        tags: charData.tags || [],
        mood: charData.mood || "",
        presence: charData.presence || { key: "offscreen", cls: "ib-presence-offscreen" },
        rel: relData ? {
            source: relData.source,
            a: relData.a, ac: relData.ac,
            tr: relData.tr, tc: relData.tc,
            l: relData.l, lc: relData.lc,
            status: relData.status
        } : (existing?.rel || null),
        thought: thoughtData ? { name: thoughtData.name, text: thoughtData.text } : (existing?.thought || null)
    };

    SavePinRegistry(gPinRegistry);
}

/**
 * Update snapshots for ALL currently pinned NPCs from current gState.
 * Called after each state update (new message parsed, reprocess, etc.)
 */
function UpdateAllPinSnapshots() {
    if (!gPinRegistry || !gPinnedNpcs.length) return;
    let changed = false;
    for (const name of gPinnedNpcs) {
        const charData = gState.chars.find(c => NamesLikelyMatch(c.name, name));
        if (charData) {
            const normalized = NormalizeName(name);
            if (!gPinRegistry.pinSnapshots) gPinRegistry.pinSnapshots = {};

            const relData = gState.rels.find(r => NamesLikelyMatch(r.source, name));
            const thoughtData = gState.thoughts.find(t => NamesLikelyMatch(t.name, name));
            const existing = gPinRegistry.pinSnapshots[normalized];

            // Check if current data is a placeholder (created by PatchPinnedData fallback)
            // If so, don't overwrite an existing richer snapshot
            const isPlaceholder = charData.icon === "📌" && (!charData.age && !charData.mood);
            if (isPlaceholder && existing) {
                // Only update rel/thought if we have real data; preserve existing otherwise
                if (relData) {
                    existing.rel = {
                        source: relData.source,
                        a: relData.a, ac: relData.ac,
                        tr: relData.tr, tc: relData.tc,
                        l: relData.l, lc: relData.lc,
                        status: relData.status
                    };
                    changed = true;
                }
                if (thoughtData) {
                    existing.thought = { name: thoughtData.name, text: thoughtData.text };
                    changed = true;
                }
                continue;
            }

            gPinRegistry.pinSnapshots[normalized] = {
                name: charData.name,
                icon: charData.icon || "•",
                age: charData.age || "",
                tags: charData.tags || [],
                mood: charData.mood || "",
                presence: charData.presence || { key: "offscreen", cls: "ib-presence-offscreen" },
                rel: relData ? {
                    source: relData.source,
                    a: relData.a, ac: relData.ac,
                    tr: relData.tr, tc: relData.tc,
                    l: relData.l, lc: relData.lc,
                    status: relData.status
                } : (existing?.rel || null),
                thought: thoughtData ? { name: thoughtData.name, text: thoughtData.text } : (existing?.thought || null)
            };
            changed = true;
        }
    }
    if (changed) SavePinRegistry(gPinRegistry);
}

/**
 * Remove a pin snapshot when an NPC is completely unpinned.
 */
function RemovePinSnapshot(name) {
    if (!gPinRegistry || !name) return;
    if (!gPinRegistry.pinSnapshots) return;
    const normalized = NormalizeName(name);
    delete gPinRegistry.pinSnapshots[normalized];
    SavePinRegistry(gPinRegistry);
}

function TogglePinnedNpc(name) {
    if (!name) return;
    const level = GetPinLevel(name);

    // Cycle: null → perChat → perChar → global → null
    const nextLevel = !level          ? "perChat"
                   : level === "perChat" ? "perChar"
                   : level === "perChar" ? "global"
                   : null;

    SetPinLevel(name, nextLevel);
}

// SetPinStorageMode() removed — tier pins use multi-level cycle instead

// Migrate old perChat localStorage pins into the registry
function MigrateOldPinsToRegistry() {
    try {
        const oldKey = kPinnedNpcsKey + "_" + GetChatId();
        const raw = localStorage.getItem(oldKey);
        if (!raw) return false;

        const oldPins = JSON.parse(raw);
        if (!Array.isArray(oldPins) || oldPins.length === 0) return false;

        // Only migrate if current mode slot is empty
        const currentPins = ResolveActivePins();
        if (currentPins.length > 0) return false;

        // Migrate old perChat pins to perChat tier in registry
        const chatId = GetChatId();
        if (!gPinRegistry.chats) gPinRegistry.chats = {};
        gPinRegistry.chats[chatId] = [...oldPins];
        gPinnedNpcs = ResolveActivePins();
        SavePinRegistry(gPinRegistry);

        // Remove old key
        localStorage.removeItem(oldKey);
        console.log(`[IB] Migrated ${oldPins.length} pins from old perChat key to registry`);
        return true;
    } catch (e) {
        console.warn("[IB] Pin migration failed:", e?.message);
        return false;
    }
}

// Clean up dead entries (deleted characters and chats)
function CleanPinRegistry() {
    if (!gPinRegistry) return;

    try {
        const ctx = SillyTavern.getContext();

        // Clean characters — but ONLY if ctx.characters is actually loaded.
        // If it's empty (e.g. extension init before character list is fetched),
        // we can't tell which characters are valid, so we skip the cleanup
        // to avoid accidentally deleting all per-character pins.
        if (gPinRegistry.characters) {
            // Remove entries with empty pins arrays (orphaned character slots)
            for (const key of Object.keys(gPinRegistry.characters)) {
                const entry = gPinRegistry.characters[key];
                const pins = Array.isArray(entry?.pins) ? entry.pins : (Array.isArray(entry) ? entry : []);
                if (pins.length === 0) {
                    delete gPinRegistry.characters[key];
                    continue;
                }
            }
            // Remove entries for characters that no longer exist in ST
            const charList = ctx.characters || [];
            if (charList.length > 0) {
                const validAvatars = new Set(
                    charList.map(c => c.avatar).filter(Boolean)
                );
                for (const key of Object.keys(gPinRegistry.characters)) {
                    if (!validAvatars.has(key)) {
                        delete gPinRegistry.characters[key];
                    }
                }
            }
        }

        // Clean chats — keep entries that match existing chat files
        if (gPinRegistry.chats) {
            for (const [key, entry] of Object.entries(gPinRegistry.chats)) {
                if (Array.isArray(entry)) {
                    // Legacy format: migrate to new format with charKey
                    const charKey = GetCharKeyForChatId(key);
                    if (entry.length === 0) {
                        delete gPinRegistry.chats[key];
                    } else {
                        gPinRegistry.chats[key] = { charKey: charKey || null, pins: entry };
                    }
                } else if (entry?.pins) {
                    // New format
                    if (entry.pins.length === 0) {
                        delete gPinRegistry.chats[key];
                    }
                } else {
                    delete gPinRegistry.chats[key];
                }
            }
        }

        // Clean pinSources — remove entries for NPCs no longer pinned globally
        if (gPinRegistry.pinSources) {
            const globalNames = new Set((gPinRegistry.global || []).map(n => NormalizeName(n)));
            for (const key of Object.keys(gPinRegistry.pinSources)) {
                if (!globalNames.has(key)) {
                    delete gPinRegistry.pinSources[key];
                }
            }
            if (Object.keys(gPinRegistry.pinSources).length === 0) {
                delete gPinRegistry.pinSources;
            }
        }

        // Clean pinSnapshots — remove snapshots for NPCs that are no longer pinned anywhere
        if (gPinRegistry.pinSnapshots) {
            const allPinnedNames = new Set();
            (gPinRegistry.global || []).forEach(n => allPinnedNames.add(NormalizeName(n)));
            Object.values(gPinRegistry.characters || {}).forEach(entry => {
                const pins = Array.isArray(entry?.pins) ? entry.pins : (Array.isArray(entry) ? entry : []);
                pins.forEach(n => allPinnedNames.add(NormalizeName(n)));
            });
            Object.values(gPinRegistry.chats || {}).forEach(entry => {
                const pins = Array.isArray(entry) ? entry : (entry?.pins || []);
                pins.forEach(n => allPinnedNames.add(NormalizeName(n)));
            });
            for (const key of Object.keys(gPinRegistry.pinSnapshots)) {
                if (!allPinnedNames.has(key)) {
                    delete gPinRegistry.pinSnapshots[key];
                }
            }
            if (Object.keys(gPinRegistry.pinSnapshots).length === 0) {
                delete gPinRegistry.pinSnapshots;
            }
        }

        // Persist any cleanup changes immediately so in-memory and localStorage stay in sync
        SavePinRegistry(gPinRegistry);
    } catch (e) {
        console.warn("[IB] Clean pin registry failed:", e?.message);
    }
}

function GetPresencePriority(c) {
    const key = c?.presence?.key || "";

    const map = {
        focus: 0,
        activeHere: 1,
        nearby: 2,
        watching: 3,
        background: 4,
        offscreen: 5,
        leftScene: 6
    };

    return map[key] ?? 10;
}

function SortCharsByPriority(chars = []) {
    return [...chars].sort((a, b) => {
        const ap = IsPinnedNpc(a.name) ? 0 : 1;
        const bp = IsPinnedNpc(b.name) ? 0 : 1;
        if (ap !== bp) return ap - bp;

        const apres = GetPresencePriority(a);
        const bpres = GetPresencePriority(b);
        if (apres !== bpres) return apres - bpres;

        return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
            sensitivity: "base"
        });
    });
}

function RenderChars(chars) {
    if (!chars.length) return "";

    return `
    <div class="ib-section ib-section-chars">
        <div class="ib-section-title">${GetThemeCharsIcon()} ${T("chars")}</div>
        <div class="ib-chars">
${SortCharsByPriority(chars).map(c => {
                const visibleTags = (c.tags || []).filter(tag => !IsPresenceTag(tag));
                const mood = String(c.mood || "").trim();
                const ageHtml = c.age ? `<span class="ib-age-chip">${EscapeHtml(c.age)}</span>` : "";
                const iconHtml = c.icon ? EscapeHtml(c.icon) : "👤";

                const presenceHtml = c.presence ? `<span class="ib-presence-chip ${c.presence.cls}">${EscapeHtml(T(c.presence.key))}</span>` : "";
                const moodPill = mood ? `<span class="ib-tag ib-mood-tag">${EscapeHtml(mood)}</span>` : "";

                // Tier pin rendering
                const level = GetPinLevel(c.name);
                const pinnedCls = level ? "ib-pinned" : "";
                const tierCls = level ? `ib-pin-${level}` : "";
                const tierNum = level === "perChat" ? T("pinTierChat")
                              : level === "perChar" ? T("pinTierChar")
                              : level === "global"  ? T("pinTierGlobal")
                              : "";
                const pinTitle = !level           ? T("pinToChat")
                              : level === "perChat" ? T("pinToChar")
                              : level === "perChar" ? T("pinToGlobal")
                              : T("unpinNpc");

                return `
                <div class="ib-char">
                    <div class="ib-char-left">
                        <span class="ib-char-icon-wrap"><span class="ib-char-icon">${iconHtml}</span></span>
                    </div>
                    <div class="ib-char-info">
                        <div class="ib-char-name-row">
                            <span class="ib-char-name">${RenderMaybeUnknown(c.name)}</span>
                            ${ageHtml}
                            ${presenceHtml}
                        </div>
                        ${(visibleTags.length || moodPill) ? `<div class="ib-char-tags">${moodPill}${visibleTags.map(tag => `<span class="ib-tag">${EscapeHtml(tag)}</span>`).join("")}</div>` : ""}
                    </div>
                    <button
                        type="button"
                        class="ib-pin-btn ${pinnedCls} ${tierCls}"
                        data-ib-pin="${EscapeHtml(c.name)}"
                        title="${EscapeHtml(pinTitle)}"
                        aria-label="${EscapeHtml(pinTitle)}"
                    ><span class="ib-pin-tier">${tierNum}</span></button>
                </div>`;
            }).join("")}
        </div>
    </div>`;
}

function RenderRelMeter(type, value, delta, changed) {
    const meta = GetMetricMeta(type, value);
    const emoji = GetBarEmoji(meta.metricKey);
    const pattern = GetBarPattern(meta.metricKey);
    const barH = GetCurrentBarHeight();
    const barW = RenderBarWidth(value);
    // Pattern: repeats to fill bar fill width, clipped by .ib-bar-fill overflow:hidden
    const patternSpan = pattern ? `<span class="ib-bar-pattern" style="font-size:${barH}px;line-height:${barH}px;height:${barH}px">${pattern.repeat(50)}</span>` : '';
    // Head emoji: positioned inside .ib-bar at the fill tip, not inside .ib-bar-fill
    const emojiSpan = emoji ? `<span class="ib-bar-emoji" style="font-size:${barH}px;line-height:${barH}px;height:${barH}px;left:${barW}">${emoji}</span>` : '';
    return `
    <div class="ib-meter ${changed ? "ib-meter-changed" : ""}" data-metric="${meta.key}">
        <div class="ib-meter-top">
            <span class="ib-meter-label">${meta.label}</span>
            <span class="ib-meter-value">${value}/100 (${RenderDelta(delta)})</span>
        </div>
        <div class="ib-bar">
            <div class="ib-bar-fill ${meta.barClass}" style="width:${barW}; ${meta.style}">${patternSpan}</div>${emojiSpan}
        </div>
    </div>`;
}

function RenderThoughtForNpc(thoughts, npcName, rels = []) {
    if (!Array.isArray(thoughts) || !npcName) return "";

    const allNpcNames = rels.map(r => r.source);
    const matches = thoughts.filter(t => ThoughtOwnerMatchesNpc(t.name, npcName, allNpcNames));

    if (!matches.length) return "";

    const text = matches[0].text || "";
    if (!text) return "";

    return `
    <div class="ib-rel-thought">
        <div class="ib-rel-subtitle">💭</div>
        <div class="ib-rel-thought-text">${EscapeHtml(text)}</div>
    </div>`;
}

function RenderRelCard(r, thoughts = [], prevState = null, rels = []) {
    const statusClass = GetStatusClass(r.status);
    const statusIcon = GetStatusIcon(r.status);
    const changed = GetChangedMetrics(prevState, r);
    
    const ageHtml = r.age ? `<span class="ib-age-chip">${EscapeHtml(r.age)}</span>` : "";

    return `
    <div class="ib-rel-card ib-rel-accordion ${changed.a || changed.tr || changed.l ? "ib-rel-updated" : ""}">
        <div class="ib-rel-toggle" role="button" tabindex="0" aria-expanded="true" title="${EscapeHtml(T("closeNpc"))}">
            <div class="ib-rel-name-row">
                <span class="ib-rel-timeline-btn" data-ib-timeline="${EscapeHtml(r.source)}" title="📈 ${EscapeHtml(T('timeline'))}">📈</span>
                <span class="ib-rel-name">${EscapeHtml(r.source)}</span>
                ${ageHtml}
                <span class="ib-status-chip ${statusClass}">
                    <span class="ib-status-icon">${EscapeHtml(statusIcon)}</span>
                    <span>${EscapeHtml(r.status)}</span>
                </span>
            </div>

            <div class="ib-rel-toggle-preview">
                <div class="ib-rel-toggle-miniwrap">
                    ${RenderMiniStat(GetCompactMetricMeta("a", r.a, r.ac), changed.a)}
                    ${RenderMiniStat(GetCompactMetricMeta("tr", r.tr, r.tc), changed.tr)}
                    ${RenderMiniStat(GetCompactMetricMeta("l", r.l, r.lc), changed.l)}
                </div>
                <span class="ib-rel-toggle-arrow" aria-hidden="true"></span>
            </div>
        </div>

        <div class="ib-rel-body">
            <div class="ib-rel-bars">
                ${RenderRelMeter("a", r.a, r.ac, changed.a)}
                ${RenderRelMeter("tr", r.tr, r.tc, changed.tr)}
                ${RenderRelMeter("l", r.l, r.lc, changed.l)}
            </div>
            ${RenderThoughtForNpc(thoughts, r.source, rels)}
        </div>
    </div>`;
}

function GetFilteredRelationsForDisplay(rels = []) {
    let sorted = SortRelationsByPriority(rels);

    if (gCompactMode === "changed") {
        const changed = sorted.filter(RelationHasDelta);

        // Если изменений нет, не делаем пустую яму. Показываем top3.
        return changed.length ? changed : sorted.slice(0, 3);
    }

    if (gCompactMode === "top1") {
        return sorted.slice(0, 1);
    }

    if (gCompactMode === "top3") {
        return sorted.slice(0, 3);
    }

    return sorted;
}

function RenderRelations(rels, thoughts = [], prevState = null) {
    if (!rels.length) return "";

    const sorted = SortRelationsByPriority(rels);
    const filtered = GetFilteredRelationsForDisplay(rels);

    const noChangedNote =
        gCompactMode === "changed" &&
        !sorted.some(RelationHasDelta)
            ? `<div class="ib-filter-note">${EscapeHtml(T("noCompactChanges"))}</div>`
            : "";

    return `
    <div class="ib-section ib-section-rels">
        <div class="ib-section-title">${GetThemeRelationsIcon()} ${T("rels")}</div>
        ${noChangedNote}
        ${filtered.map(r => RenderRelCard(r, thoughts, prevState, rels)).join("")}
    </div>`;
}

function RenderNsfw(nsfw) {
    if (!gShowNsfw || !nsfw) return "";

    return `
    <div class="ib-section ib-nsfw">
        <div class="ib-section-title">${T("nsfw")}</div>
        <div class="ib-nsfw-line"><b>${T("fetishes")}:</b> ${EscapeHtml(nsfw.f)}</div>
        <div class="ib-nsfw-line"><b>${T("positions")}:</b> ${EscapeHtml(nsfw.p)}</div>
    </div>`;
}

function RenderUnifiedThoughts(thoughts) {
    if (!Array.isArray(thoughts) || !thoughts.length) return "";

    const thoughtsIcon = GetThemeRelationsIcon() === "🤍" ? "💭" : GetThemeRelationsIcon();
    const thoughtsLabel = T("privateThoughts");

    const items = thoughts.map(t => {
        const name = EscapeHtml(t.name || "");
        const text = EscapeHtml(t.text || "");
        if (!text) return "";
        // Show thoughts even if name is __UNASSIGNED__ - just label them differently
        if (!name || name === "__UNASSIGNED__") {
            return `<div class="ib-thought-item"><span class="ib-thought-name">💭</span> <span class="ib-thought-text">${text}</span></div>`;
        }
        return `<div class="ib-thought-item"><span class="ib-thought-name">${name}:</span> <span class="ib-thought-text">${text}</span></div>`;
    }).filter(Boolean).join("");

    if (!items) return "";

    return `
    <div class="ib-section ib-section-thoughts">
        <div class="ib-section-title">💭 ${thoughtsLabel}</div>
        <div class="ib-thoughts-list" data-ib-autoscroll="true">${items}</div>
    </div>`;
}

function RelationHasDelta(r) {
    return (
        (parseInt(r.ac) || 0) !== 0 ||
        (parseInt(r.tc) || 0) !== 0 ||
        (parseInt(r.lc) || 0) !== 0
    );
}

function RenderCompactDeltaLine(r) {
    const parts = [];

    const ac = parseInt(r.ac) || 0;
    const tc = parseInt(r.tc) || 0;
    const lc = parseInt(r.lc) || 0;

    if (ac !== 0) parts.push(`<span class="${ac > 0 ? "ib-delta-pos" : "ib-delta-neg"}">A ${EscapeHtml(SignedText(ac))}</span>`);
    if (tc !== 0) parts.push(`<span class="${tc > 0 ? "ib-delta-pos" : "ib-delta-neg"}">T ${EscapeHtml(SignedText(tc))}</span>`);
    if (lc !== 0) parts.push(`<span class="${lc > 0 ? "ib-delta-pos" : "ib-delta-neg"}">L ${EscapeHtml(SignedText(lc))}</span>`);

    return parts.join(`<span class="ib-compact-dot">·</span>`);
}

function RenderCompactRelations(state, prevState = null) {
    const allRels = SortRelationsByPriority(state?.rels || []);
    if (!allRels.length) return "";

    let rels = allRels;
    let noChangedNote = "";

    if (gCompactMode === "changed") {
        const changed = allRels.filter(RelationHasDelta);

        if (changed.length) {
            rels = changed;
        } else {
            noChangedNote = `<div class="ib-compact-empty">${EscapeHtml(T("noCompactChanges"))}</div>`;
            rels = allRels.slice(0, 3);
        }
    }

    if (gCompactMode === "top1") {
        rels = rels.slice(0, 1);
    } else if (gCompactMode === "top3") {
        rels = rels.slice(0, 3);
    }

    const more = gCompactMode === "top3" ? Math.max(0, allRels.length - rels.length) : 0;

    return `
    <div class="ib-compact-rel-list ib-compact-mode-${EscapeHtml(gCompactMode)}">
        ${noChangedNote}
        ${rels.map(r => {
            const changed = GetChangedMetrics(prevState, r);
            const ageHtml = r.age ? `<span class="ib-age-chip">${EscapeHtml(r.age)}</span>` : "";
            const charData = (state?.chars || []).find(c => NamesLikelyMatch(c.name, r.source));
            const presenceHtml = charData?.presence ? `<span class="ib-presence-chip ib-presence-chip-sm ${charData.presence.cls}">${EscapeHtml(T(charData.presence.key))}</span>` : "";
            const cLevel = GetPinLevel(r.source);
            const cPinnedCls = cLevel ? "ib-pinned" : "";
            const cTierCls = cLevel ? `ib-pin-${cLevel}` : "";
            const cTierNum = cLevel === "perChat" ? T("pinTierChat") : cLevel === "perChar" ? T("pinTierChar") : cLevel === "global" ? T("pinTierGlobal") : "";
            const cPinTitle = !cLevel ? T("pinToChat") : cLevel === "perChat" ? T("pinToChar") : cLevel === "perChar" ? T("pinToGlobal") : T("unpinNpc");

            return `
            <div class="ib-compact-rel-item">
                <div class="ib-compact-rel-name-row">
                    <span class="ib-rel-timeline-btn ib-rel-timeline-btn-sm" data-ib-timeline="${EscapeHtml(r.source)}" title="📈 ${EscapeHtml(T('timeline'))}">📈</span>
                    <span class="ib-compact-rel-name">${EscapeHtml(r.source)}</span>
                    ${ageHtml}${presenceHtml}
                    <span class="ib-compact-rel-status ${GetStatusClass(r.status)}">${EscapeHtml(GetStatusIcon(r.status))}</span>
                </div>

                <div class="ib-compact-rel-bottom">
                    <div class="ib-compact-minirow">
                        ${RenderMiniStat(GetCompactMetricMeta("a", r.a, r.ac), changed.a)}
                        ${RenderMiniStat(GetCompactMetricMeta("tr", r.tr, r.tc), changed.tr)}
                        ${RenderMiniStat(GetCompactMetricMeta("l", r.l, r.lc), changed.l)}
                    </div>
                    <button
                        type="button"
                        class="ib-pin-btn ib-pin-btn-sm ${cPinnedCls} ${cTierCls}"
                        data-ib-pin="${EscapeHtml(r.source)}"
                        title="${EscapeHtml(cPinTitle)}"
                        aria-label="${EscapeHtml(cPinTitle)}"
                    ><span class="ib-pin-tier">${cTierNum}</span></button>
                </div>
            </div>`;
        }).join("")}
        ${more > 0 ? `<div class="ib-compact-more">+${more} ${EscapeHtml(T("compactMore"))}</div>` : ""}
    </div>`;
}

function RenderBoard(state, isFresh = false, prevState = null, renderContext = null) {
    const themeTitle = GetThemeTitleData();

    // Theme button — top-left
    const toolbarLeft = `
<div class="ib-control-btn ib-btn-theme" title="${EscapeHtml(T("theme"))}">🎨</div>
<div class="ib-control-btn ib-btn-settings" title="${EscapeHtml(T("settingsTitle"))}">⚙️</div>`;

    // Shared toolbar buttons (pins, notifications, timeline, export, import, debug)
    const toolbarRight = `
<div class="ib-control-btn ib-btn-pins" title="${EscapeHtml(T("pinnedList"))}">📍</div>
<div class="ib-control-btn ib-btn-notifications" title="${EscapeHtml(T("notifications"))}">🔔</div>
<div class="ib-control-btn ib-btn-timeline" title="${EscapeHtml(T("timeline"))}">📈</div>
<div class="ib-control-btn ib-btn-export" title="${EscapeHtml(T("exportState"))}">📤</div>
<div class="ib-control-btn ib-btn-import" title="${EscapeHtml(T("importState"))}">📥</div>
<div class="ib-control-btn ib-btn-debug" title="${EscapeHtml(T("debugXml"))}">&lt;/&gt;</div>`;

    const controlsFull = `${toolbarRight}
<div class="ib-control-btn ib-btn-compact" title="${EscapeHtml(T("compact"))}">▤</div>
<div class="ib-control-btn ib-btn-collapse" title="${EscapeHtml(T("collapse"))}">—</div>`;

    return `
    <div class="ib-board ${GetThemeClassStr()} ib-bars-${EscapeHtml(gBarStyle)} ${gHoverFx ? "ib-hoverfx" : ""} ib-mode-${GetCurrentBoardMode(renderContext)} ${isFresh ? "ib-fresh" : ""}">
        <div class="ib-toolbar">
            <div class="ib-toolbar-left ib-panel-controls">
                ${toolbarLeft}
            </div>
            <div class="ib-toolbar-right ib-panel-controls">
                ${controlsFull}
            </div>
        </div>
        <div class="ib-title-wrap">
            <div class="ib-title">${EscapeHtml(themeTitle.main)}</div>
            ${themeTitle.sub ? `<div class="ib-title-sub">${EscapeHtml(themeTitle.sub)}</div>` : ""}
        </div>

        <div class="ib-collapsed-wrap">
            <div class="ib-collapsed-tag">
                <span></span>
                <span class="ib-collapsed-title">✦ ${EscapeHtml(T("title"))}</span>
                <span class="ib-collapsed-action">${EscapeHtml(T("open"))}</span>
            </div>
        </div>

        <div class="ib-compact-wrap">
            <div class="ib-compact-main">
                <div class="ib-compact-content">
                    ${RenderCompactRelations(state, prevState)}
                </div>


            </div>
            <div class="ib-compact-loc">${GetThemeLocationIcon()} ${RenderMaybeUnknown(state.loc)}</div>
        </div>

        <div class="ib-full-wrap">
            <div class="ib-header">
                <div class="ib-header-main">
                    <div class="ib-header-location">
                        <span class="ib-header-location-icon">${GetThemeLocationIcon()}</span>
                        <span class="ib-header-location-text">${RenderMaybeUnknown(state.loc)}</span>
                    </div>
                </div>

                <div class="ib-header-meta">
                    <span class="ib-meta-pill">⏰ ${RenderMaybeUnknown(state.time)}</span>
                    <span class="ib-meta-pill">📅 ${RenderMaybeUnknown(state.date)}</span>
                    <span class="ib-meta-pill">☁ ${RenderMaybeUnknown(state.weather)}</span>
                </div>
            </div>

            <div class="ib-content">
                ${RenderChars(state.chars)}
                ${RenderRelations(state.rels, state.thoughts, prevState)}
                ${RenderNsfw(state.nsfw)}
            </div>
        </div>
    </div>`;
}

function GetBoardContext(boardEl) {
    if (boardEl.closest("#ib_panel_host")) return "panel";
    if (boardEl.closest("#ib_floating_host")) return "floating";
    return "inline";
}

function GetCurrentBoardMode(renderContext) {
    const ctx = renderContext || "inline";
    switch (ctx) {
        case "panel": return gCurrentBoardModePanel;
        case "floating": return gCurrentBoardModeFloating;
        default: return gCurrentBoardModeInline;
    }
}

function SetCurrentBoardMode(renderContext, mode) {
    const ctx = renderContext || "inline";
    switch (ctx) {
        case "panel": gCurrentBoardModePanel = mode; break;
        case "floating": gCurrentBoardModeFloating = mode; break;
        default: gCurrentBoardModeInline = mode; break;
    }
}

function SetBoardMode(boardEl, mode) {
    boardEl.classList.remove("ib-mode-full", "ib-mode-compact", "ib-mode-collapsed");
    boardEl.classList.add(`ib-mode-${mode}`);

    // Save runtime mode so re-renders preserve user's choice during session
    const ctx = GetBoardContext(boardEl);
    SetCurrentBoardMode(ctx, mode);

    boardEl.querySelectorAll(".ib-btn-compact, .ib-btn-collapse, .ib-btn-full").forEach(btn => {
        btn.classList.remove("ib-active");
    });

    if (mode === "compact") {
        boardEl.querySelectorAll(".ib-btn-compact").forEach(btn => btn.classList.add("ib-active"));
    }

    if (mode === "collapsed") {
        boardEl.querySelectorAll(".ib-btn-collapse").forEach(btn => btn.classList.add("ib-active"));
    }
}

function WireAccordionControls(boardEl) {
    boardEl.querySelectorAll(".ib-rel-toggle").forEach(toggle => {
        const card = toggle.closest(".ib-rel-accordion");
        const body = card?.querySelector(".ib-rel-body");
        const miniwrap = card?.querySelector(".ib-rel-toggle-miniwrap");

        if (!card || !body) return;

        const apply = (open) => {
            card.classList.toggle("ib-open", open);
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
            toggle.setAttribute("title", open ? T("closeNpc") : T("openNpc"));
            if (miniwrap) miniwrap.style.display = open ? "none" : "flex";
        };

        apply(true);

        const handle = () => apply(!card.classList.contains("ib-open"));
        toggle.addEventListener("click", handle);
        toggle.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handle();
            }
        });
    });
}

function PositionPopupNearButton(popup, btn) {
    const btnRect = btn.getBoundingClientRect();
    popup.style.position = "fixed";
    popup.style.left = `${btnRect.left}px`;

    // Place below the button by default
    popup.style.top = `${btnRect.bottom + 4}px`;
    popup.style.bottom = "auto";

    // After the browser has laid out the popup, clamp it into the viewport
    requestAnimationFrame(() => {
        const rect = popup.getBoundingClientRect();
        const popupHeight = rect.height;

        // Clamp horizontal
        if (rect.right > window.innerWidth - 8) {
            popup.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
        }
        if (rect.left < 8) {
            popup.style.left = "8px";
        }

        // Clamp vertical
        const spaceBelow = window.innerHeight - btnRect.bottom - 8;
        const spaceAbove = btnRect.top - 8;

        if (rect.bottom > window.innerHeight - 8) {
            if (spaceAbove >= popupHeight) {
                // Fits above — flip
                popup.style.top = "auto";
                popup.style.bottom = `${window.innerHeight - btnRect.top + 4}px`;
            } else {
                // Doesn't fully fit above either — pin to whichever side has more room
                if (spaceAbove > spaceBelow) {
                    popup.style.top = "8px";
                    popup.style.bottom = "auto";
                } else {
                    popup.style.top = "auto";
                    popup.style.bottom = "8px";
                }
            }
        }
    });
}

// ============== Settings Popup ==============
function RenderSettingsPopup(btn) {
    // Close any existing settings popup (toggle)
    const existing = document.querySelector(".ib-settings-popup");
    if (existing) {
        const sameBtn = existing.__sourceBtn === btn;
        CloseOtherPopups(".ib-settings-popup");
        existing.remove();
        if (sameBtn) return;
    } else {
        CloseOtherPopups(".ib-settings-popup");
    }

    const popup = document.createElement("div");
    popup.className = `ib-settings-popup ib-popup-fixed ${GetThemeClassStr()}`;
    popup.__sourceBtn = btn;

    // Theme options list (same as settings.html)
    const themeOptions = [
        ["nocturne","🌙 Nocturne"],["burgundy","🍷 Burgundy"],["ashrose","🌸 Ash Rose"],
        ["coldsteel","🩶 Cold Steel"],["frostwhite","🧊 Frostwhite"],["pixel","🕹 Pixel Arcade"],
        ["pinkbite","💗 Pink Bite"],["violetglass","🟣 Violet Glass"],["verdantgrove","🌿 Verdant Grove"],
        ["sandalwood","🟤 Sandalwood"],["gengar","👻 Gengar"],["systemlog","💠 System Log"],
        ["terminal","🟩 Terminal"],["oraclemoon","🌙 Oracle Moon"],["bloodmoon","🩸 Blood Moon"],
        ["casefile","🕵️ Case File"],["obsidianregistry","🗝 Obsidian Registry"],
        ["neonquest","🤖 Neon Quest"],["shockwave","🟣 Shockwave"],["lockdown","🎯 Lockdown"],
        ["hotrod","🔥 Hot Rod"],["gryffindor","🦁 Gryffindor"],["slytherin","🐍 Slytherin"],
        ["ravenclaw","🦅 Ravenclaw"],["hufflepuff","🦡 Hufflepuff"]
    ];

    const barOptions = [
        ["classic","Classic"],["deep","Deep Neon"],["glass","Glass Needle"],["soft","Soft Matte"],
        ["pixel","Pixel Blocks"],["candy","Candy Gloss"],["prism","Prism Glass"],["neon","Neon Rails"],
        ["terminal","Terminal Segments"],["hearts","Heart Meter"],["constellation","Constellation Stars"],
        ["vials","Vials"],["evidence","Evidence Tape"],["runic","Runic Shards"],
        ["sigil","Sigil Bands"],["energon","Energon"]
    ];

    const compactOptions = [["top3","top3"],["top1","top1"],["changed","changed"],["all","all"]];
    const boardModes = [["full","full"],["compact","compact"],["collapsed","collapsed"]];
    const notifThresholds = [["3","3"],["5","5"],["10","10"],["20","20"]];

    const sel = (arr, current) => arr.map(([v,l]) =>
        `<option value="${v}"${v===current?' selected':''}>${l}</option>`
    ).join('');

    const chk = (id, val) => ` type="checkbox" id="${id}"${val?' checked':''}`;

    // Build sections
    popup.innerHTML = `
    <div class="ib-sp-header">
        <span class="ib-sp-title">⚙️ ${EscapeHtml(T("settingsTitle"))}</span>
        <button type="button" class="ib-sp-close" id="ib_sp_close">×</button>
    </div>
    <div class="ib-sp-body">

        <!-- Inject section -->
        <div class="ib-sp-section">
            <div class="ib-sp-row">
                <input${chk("ib_sp_use_macro", gUseMacro)} />
                <label for="ib_sp_use_macro" id="ib_sp_use_macro_label"><b>${T("useMacroMode")}</b></label>
            </div>
            <div class="ib-sp-subhelp" id="ib_sp_use_macro_help">${T("useMacroHelp")}</div>

            <div class="ib-sp-row" id="ib_sp_inject_position_row">
                <label for="ib_sp_inject_position"><b id="ib_sp_inject_position_label">${T("injectPosition")}</b></label>
                <select id="ib_sp_inject_position">
                    <option value="0"${gInjectPosition===0?' selected':''}>${T("injectPosAfter")}</option>
                    <option value="1"${gInjectPosition===1?' selected':''}>${T("injectPosChat")}</option>
                    <option value="2"${gInjectPosition===2?' selected':''}>${T("injectPosBefore")}</option>
                </select>
            </div>

            <div class="ib-sp-row" id="ib_sp_inject_depth_row">
                <label for="ib_sp_inject_depth"><b id="ib_sp_inject_depth_label">${T("injectDepth")}</b></label>
                <div class="ib-depth-input-wrap">
                    <button type="button" class="ib-depth-btn ib-depth-minus" id="ib_sp_depth_minus">−</button>
                    <input type="number" id="ib_sp_inject_depth" min="0" max="999" value="${gInjectDepth}" class="ib-depth-field" />
                    <button type="button" class="ib-depth-btn ib-depth-plus" id="ib_sp_depth_plus">+</button>
                </div>
            </div>
            <div class="ib-sp-subhelp" id="ib_sp_inject_depth_help">${T("injectDepthHelp")}</div>
        </div>

        <!-- Language & Theme -->
        <div class="ib-sp-section">
            <div class="ib-sp-row">
                <label for="ib_sp_lang"><b>${T("language")}</b></label>
                <select id="ib_sp_lang">
                    <option value="ru"${gLang==='ru'?' selected':''}>Русский</option>
                    <option value="en"${gLang==='en'?' selected':''}>English</option>
                </select>
            </div>
            <div class="ib-sp-row">
                <label for="ib_sp_theme"><b>${T("theme")}</b></label>
                <select id="ib_sp_theme">${sel(themeOptions, gTheme)}</select>
            </div>
            <div class="ib-sp-row">
                <label for="ib_sp_bar_style"><b>${T("barStyle")}</b></label>
                <select id="ib_sp_bar_style">${sel(barOptions, gBarStyle)}</select>
            </div>
        </div>

        <!-- Relationship Filter -->
        <div class="ib-sp-section">
            <div class="ib-sp-row">
                <label for="ib_sp_compact_mode"><b>${T("compactMode")}</b></label>
                <select id="ib_sp_compact_mode">${sel(compactOptions, gCompactMode)}</select>
            </div>
        </div>

        <!-- Display Modes -->
        <div class="ib-sp-section">
            <div class="ib-sp-section-title">${T("displayModes")}</div>
            <div class="ib-sp-row">
                <input${chk("ib_sp_display_inline", gDisplayInline)} />
                <label for="ib_sp_display_inline">${T("displayInline")}</label>
                <span class="ib-inline-count-wrap" id="ib_sp_inline_board_count_row" style="display:${gDisplayInline?'':'none'}">
                    <div class="ib-depth-input-wrap ib-depth-input-compact">
                        <button type="button" class="ib-depth-btn ib-depth-btn-compact ib-depth-minus" id="ib_sp_board_count_minus">−</button>
                        <input type="number" id="ib_sp_inline_board_count" min="1" max="99" value="${gInlineBoardCount}" class="ib-depth-field ib-depth-field-compact" />
                        <button type="button" class="ib-depth-btn ib-depth-btn-compact ib-depth-plus" id="ib_sp_board_count_plus">+</button>
                    </div>
                    <span class="ib-count-confirm" id="ib_sp_count_confirm" style="display:none">
                        <button type="button" class="ib-count-confirm-btn ib-count-ok" id="ib_sp_count_ok">✓</button>
                        <button type="button" class="ib-count-confirm-btn ib-count-cancel" id="ib_sp_count_cancel">✗</button>
                    </span>
                </span>
                <select id="ib_sp_board_mode_inline" class="ib-sp-inline-select" style="display:${gDisplayInline?'':'none'}">${sel(boardModes, gDefaultBoardModeInline)}</select>
            </div>
            <div class="ib-sp-row">
                <input${chk("ib_sp_display_floating", gDisplayFloating)} />
                <label for="ib_sp_display_floating">${T("displayFloating")}</label>
                <select id="ib_sp_board_mode_floating" class="ib-sp-inline-select">${sel(boardModes, gDefaultBoardModeFloating)}</select>
            </div>
            <div class="ib-sp-row">
                <input${chk("ib_sp_display_panel", gDisplayPanel)} />
                <label for="ib_sp_display_panel">${T("displayPanel")}</label>
                <select id="ib_sp_board_mode_panel" class="ib-sp-inline-select">${sel(boardModes, gDefaultBoardModePanel)}</select>
            </div>
            <div class="ib-sp-row" id="ib_sp_panel_position_row">
                <label for="ib_sp_panel_position"><b>${T("panelPosition")}</b></label>
                <select id="ib_sp_panel_position">
                    <option value="left"${gPanelPosition==='left'?' selected':''}>${T("panelLeft")}</option>
                    <option value="right"${gPanelPosition==='right'?' selected':''}>${T("panelRight")}</option>
                </select>
            </div>
        </div>

        <!-- Toggles -->
        <div class="ib-sp-section">
            <div class="ib-sp-row">
                <input${chk("ib_sp_hover_fx", gHoverFx)} />
                <label for="ib_sp_hover_fx">${T("hoverFx")}</label>
            </div>
            <div class="ib-sp-row">
                <input${chk("ib_sp_hide_raw", gHideRaw)} />
                <label for="ib_sp_hide_raw">${T("hideRaw")}</label>
            </div>
            <div class="ib-sp-row">
                <input${chk("ib_sp_hide_thought_leaks", gHideThoughtLeaks)} />
                <label for="ib_sp_hide_thought_leaks">${T("hideThoughtLeaks")}</label>
            </div>
            <div class="ib-sp-row">
                <input${chk("ib_sp_show_nsfw", gShowNsfw)} />
                <label for="ib_sp_show_nsfw">${T("showNsfw")}</label>
            </div>
        </div>

        <!-- Notifications -->
        <div class="ib-sp-section">
            <div class="ib-sp-section-title">🔔 ${T("notifications")}</div>
            <div class="ib-sp-row">
                <input${chk("ib_sp_notifications_enabled", gNotificationsEnabled)} />
                <label for="ib_sp_notifications_enabled">${T("enableNotif")}</label>
            </div>
            <div class="ib-sp-row">
                <label for="ib_sp_notification_threshold"><b>${T("threshold")}</b></label>
                <select id="ib_sp_notification_threshold">${sel(notifThresholds, String(gNotificationThreshold))}</select>
            </div>
        </div>

        <!-- Custom CSS -->
        <div class="ib-sp-section">
            <div class="ib-sp-section-title">${T("customCssLabel")}</div>
            <textarea id="ib_sp_custom_css" class="ib-sp-textarea" rows="5" placeholder=".ib-board { border-radius: 20px; }">${EscapeHtml(gCustomCss)}</textarea>
            <div class="ib-sp-btn-row">
                <div class="menu_button ib-sp-btn" id="ib_sp_save_css">💾 ${T("saveCustomCss")}</div>
                <div class="menu_button ib-sp-btn" id="ib_sp_clear_css">🧹 ${T("clearCustomCss")}</div>
            </div>
        </div>

        <!-- Actions -->
        <div class="ib-sp-section">
            <div class="ib-sp-btn-row">
                <div class="menu_button ib-sp-btn ib-sp-btn-danger" id="ib_sp_reset_state">🗑 ${T("resetState")}</div>
                <div class="menu_button ib-sp-btn" id="ib_sp_reprocess">🔄 ${T("reprocess")}</div>
            </div>
            <div class="ib-sp-btn-row" style="margin-top:4px">
                <div class="menu_button ib-sp-btn ib-sp-btn-danger" id="ib_sp_clean_orphan_snapshots">🧹 ${T("cleanOrphanSnapshots")}</div>
            </div>
        </div>
    </div>`;

    document.body.appendChild(popup);
    PositionPopupNearButton(popup, btn);

    // ---- Visibility helpers ----
    function updateDepthVisibility() {
        if (gUseMacro) {
            popup.querySelector("#ib_sp_inject_position_row").style.display = "none";
            popup.querySelector("#ib_sp_inject_depth_row").style.display = "none";
            popup.querySelector("#ib_sp_inject_depth_help").style.display = "none";
        } else {
            popup.querySelector("#ib_sp_inject_position_row").style.display = "";
            const showDepth = gInjectPosition === 1;
            popup.querySelector("#ib_sp_inject_depth_row").style.display = showDepth ? "" : "none";
            popup.querySelector("#ib_sp_inject_depth_help").style.display = showDepth ? "" : "none";
        }
    }
    updateDepthVisibility();

    // ---- Sync sidebar helper ----
    function syncSidebar() {
        const sb = (id) => document.getElementById(id);
        if (sb("ib_use_macro")) $(sb("ib_use_macro")).prop("checked", gUseMacro);
        if (sb("ib_inject_position")) $(sb("ib_inject_position")).val(String(gInjectPosition));
        if (sb("ib_inject_depth")) $(sb("ib_inject_depth")).val(gInjectDepth);
        if (sb("ib_lang")) $(sb("ib_lang")).val(gLang);
        if (sb("ib_theme")) $(sb("ib_theme")).val(gTheme);
        if (sb("ib_bar_style")) $(sb("ib_bar_style")).val(gBarStyle);
        if (sb("ib_compact_mode")) $(sb("ib_compact_mode")).val(gCompactMode);
        if (sb("ib_display_inline")) $(sb("ib_display_inline")).prop("checked", gDisplayInline);
        if (sb("ib_display_floating")) $(sb("ib_display_floating")).prop("checked", gDisplayFloating);
        if (sb("ib_display_panel")) $(sb("ib_display_panel")).prop("checked", gDisplayPanel);
        if (sb("ib_board_mode_inline")) $(sb("ib_board_mode_inline")).val(gDefaultBoardModeInline);
        if (sb("ib_inline_board_count")) $(sb("ib_inline_board_count")).val(gInlineBoardCount);
        const countConfirm = sb("ib_count_confirm");
        if (countConfirm) countConfirm.style.display = "none";
        gInlineBoardCountSaved = gInlineBoardCount;
        if (sb("ib_board_mode_floating")) $(sb("ib_board_mode_floating")).val(gDefaultBoardModeFloating);
        if (sb("ib_board_mode_panel")) $(sb("ib_board_mode_panel")).val(gDefaultBoardModePanel);
        if (sb("ib_panel_position")) $(sb("ib_panel_position")).val(gPanelPosition);
        if (sb("ib_hover_fx")) $(sb("ib_hover_fx")).prop("checked", gHoverFx);
        if (sb("ib_hide_raw")) $(sb("ib_hide_raw")).prop("checked", gHideRaw);
        if (sb("ib_hide_thought_leaks")) $(sb("ib_hide_thought_leaks")).prop("checked", gHideThoughtLeaks);
        if (sb("ib_show_nsfw")) $(sb("ib_show_nsfw")).prop("checked", gShowNsfw);
        if (sb("ib_notifications_enabled")) $(sb("ib_notifications_enabled")).prop("checked", gNotificationsEnabled);
        if (sb("ib_notification_threshold")) $(sb("ib_notification_threshold")).val(String(gNotificationThreshold));
        if (sb("ib_custom_css")) $(sb("ib_custom_css")).val(gCustomCss);
        UpdateInjectDepthVisibility();
    }

    // ---- Event handlers ----

    // Macro mode
    popup.querySelector("#ib_sp_use_macro").addEventListener("change", function() {
        gUseMacro = this.checked;
        localStorage.setItem(kUseMacroKey, String(gUseMacro));
        if (gUseMacro) {
            try { const ctx = SillyTavern.getContext(); if (ctx.setExtensionPrompt) ctx.setExtensionPrompt('InfoBoard', '', gInjectPosition, gInjectDepth, true); } catch {}
        }
        updateDepthVisibility();
        syncSidebar();
    });

    // Inject position
    popup.querySelector("#ib_sp_inject_position").addEventListener("change", function() {
        gInjectPosition = parseInt(this.value) || 1;
        localStorage.setItem(kInjectPositionKey, String(gInjectPosition));
        updateDepthVisibility();
        syncSidebar();
    });

    // Depth input
    popup.querySelector("#ib_sp_inject_depth").addEventListener("input change", function() {
        gInjectDepth = parseInt(this.value);
        if (isNaN(gInjectDepth) || gInjectDepth < 0) gInjectDepth = 0;
        if (gInjectDepth > 999) gInjectDepth = 999;
        this.value = gInjectDepth;
        localStorage.setItem(kInjectDepthKey, String(gInjectDepth));
        syncSidebar();
    });

    // Depth ± buttons
    popup.querySelector("#ib_sp_depth_minus").addEventListener("click", function() {
        if (gInjectDepth > 0) { gInjectDepth--; $("#ib_sp_inject_depth").val(gInjectDepth); localStorage.setItem(kInjectDepthKey, String(gInjectDepth)); syncSidebar(); }
    });
    popup.querySelector("#ib_sp_depth_plus").addEventListener("click", function() {
        if (gInjectDepth < 999) { gInjectDepth++; $("#ib_sp_inject_depth").val(gInjectDepth); localStorage.setItem(kInjectDepthKey, String(gInjectDepth)); syncSidebar(); }
    });

    // Language
    popup.querySelector("#ib_sp_lang").addEventListener("change", function() {
        gLang = this.value;
        localStorage.setItem(kLangKey, gLang);
        UpdateSettingsText();
        UpdateStatusDisplay();
        UpdateLastUpdateDisplay();
        // Re-render all boards with new language
        ReprocessChat();
        // Re-render popup with new language
        popup.remove();
        const freshBtn = document.querySelector(".ib-btn-settings");
        if (freshBtn) RenderSettingsPopup(freshBtn);
        return;
    });

    // Theme
    popup.querySelector("#ib_sp_theme").addEventListener("change", function() {
        gTheme = this.value;
        localStorage.setItem(kThemeKey, gTheme);
        ReprocessChat();
        syncSidebar();
        // Re-render popup with new theme class
        popup.remove();
        const freshBtn = document.querySelector(".ib-btn-settings");
        if (freshBtn) RenderSettingsPopup(freshBtn);
    });

    // Bar style
    popup.querySelector("#ib_sp_bar_style").addEventListener("change", function() {
        gBarStyle = this.value;
        localStorage.setItem(kBarStyleKey, gBarStyle);
        ReprocessChat();
        syncSidebar();
    });

    // Compact mode
    popup.querySelector("#ib_sp_compact_mode").addEventListener("change", function() {
        gCompactMode = this.value;
        localStorage.setItem(kCompactModeKey, gCompactMode);
        ReprocessChat();
        syncSidebar();
    });

    // Display modes
    popup.querySelector("#ib_sp_display_inline").addEventListener("change", function() {
        gDisplayInline = this.checked; localStorage.setItem(kDisplayInlineKey, String(gDisplayInline));
        popup.querySelector("#ib_sp_inline_board_count_row").style.display = gDisplayInline ? "" : "none";
        popup.querySelector("#ib_sp_board_mode_inline").style.display = gDisplayInline ? "" : "none";
        OnDisplayModeChange(); syncSidebar();
    });
    popup.querySelector("#ib_sp_display_floating").addEventListener("change", function() {
        gDisplayFloating = this.checked; localStorage.setItem(kDisplayFloatingKey, String(gDisplayFloating)); OnDisplayModeChange(); syncSidebar();
    });
    popup.querySelector("#ib_sp_display_panel").addEventListener("change", function() {
        gDisplayPanel = this.checked; localStorage.setItem(kDisplayPanelKey, String(gDisplayPanel)); OnDisplayModeChange(); syncSidebar();
    });
    popup.querySelector("#ib_sp_board_mode_inline").addEventListener("change", function() {
        gDefaultBoardModeInline = this.value; gCurrentBoardModeInline = gDefaultBoardModeInline; localStorage.setItem(kDefaultBoardModeInlineKey, gDefaultBoardModeInline); ReprocessChat(); syncSidebar();
    });
    // Inline board count — confirm/cancel pattern (avoids lag from ReprocessChat on every keystroke)
    const spCountField = popup.querySelector("#ib_sp_inline_board_count");
    const spCountConfirm = popup.querySelector("#ib_sp_count_confirm");
    let spCountSaved = gInlineBoardCount; // last applied value

    function spCountShowConfirm() {
        spCountConfirm.style.display = "inline-flex";
    }
    function spCountHideConfirm() {
        spCountConfirm.style.display = "none";
        spCountField.value = spCountSaved;
    }
    function spCountApply() {
        let v = parseInt(spCountField.value);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 99) v = 99;
        spCountField.value = v;
        gInlineBoardCount = v;
        gInlineBoardCountSaved = v;
        spCountSaved = v;
        localStorage.setItem(kInlineBoardCountKey, String(gInlineBoardCount));
        spCountConfirm.style.display = "none";
        ReprocessChat(); syncSidebar();
    }

    spCountField.addEventListener("input", function() { spCountShowConfirm(); });
    spCountField.addEventListener("change", function() { spCountShowConfirm(); });
    popup.querySelector("#ib_sp_board_count_minus").addEventListener("click", function() {
        let v = parseInt(spCountField.value) || 1;
        if (v > 1) v--;
        spCountField.value = v;
        spCountShowConfirm();
    });
    popup.querySelector("#ib_sp_board_count_plus").addEventListener("click", function() {
        let v = parseInt(spCountField.value) || 1;
        if (v < 99) v++;
        spCountField.value = v;
        spCountShowConfirm();
    });
    popup.querySelector("#ib_sp_count_ok").addEventListener("click", function() { spCountApply(); });
    popup.querySelector("#ib_sp_count_cancel").addEventListener("click", function() { spCountHideConfirm(); });
    popup.querySelector("#ib_sp_board_mode_floating").addEventListener("change", function() {
        gDefaultBoardModeFloating = this.value; gCurrentBoardModeFloating = gDefaultBoardModeFloating; localStorage.setItem(kDefaultBoardModeFloatingKey, gDefaultBoardModeFloating); ReprocessChat(); syncSidebar();
    });
    popup.querySelector("#ib_sp_board_mode_panel").addEventListener("change", function() {
        gDefaultBoardModePanel = this.value; gCurrentBoardModePanel = gDefaultBoardModePanel; localStorage.setItem(kDefaultBoardModePanelKey, gDefaultBoardModePanel); ReprocessChat(); syncSidebar();
    });
    popup.querySelector("#ib_sp_panel_position").addEventListener("change", function() {
        gPanelPosition = this.value; localStorage.setItem(kPanelPositionKey, gPanelPosition); if (gDisplayPanel) RenderPanelBoard(); syncSidebar();
    });

    // Toggles
    popup.querySelector("#ib_sp_hover_fx").addEventListener("change", function() {
        gHoverFx = this.checked; localStorage.setItem(kHoverFxKey, String(gHoverFx)); ReprocessChat(); syncSidebar();
    });
    popup.querySelector("#ib_sp_hide_raw").addEventListener("change", function() {
        gHideRaw = this.checked; localStorage.setItem(kHideRawKey, String(gHideRaw)); ReprocessChat(); syncSidebar();
    });
    popup.querySelector("#ib_sp_hide_thought_leaks").addEventListener("change", function() {
        gHideThoughtLeaks = this.checked; localStorage.setItem(kHideThoughtLeaksKey, String(gHideThoughtLeaks)); ReprocessChat(); syncSidebar();
    });
    popup.querySelector("#ib_sp_show_nsfw").addEventListener("change", function() {
        gShowNsfw = this.checked; localStorage.setItem(kShowNsfwKey, String(gShowNsfw)); ReprocessChat(); syncSidebar();
    });

    // Notifications
    popup.querySelector("#ib_sp_notifications_enabled").addEventListener("change", function() {
        gNotificationsEnabled = this.checked; localStorage.setItem(kNotificationsEnabledKey, String(gNotificationsEnabled)); syncSidebar();
    });
    popup.querySelector("#ib_sp_notification_threshold").addEventListener("change", function() {
        gNotificationThreshold = parseInt(this.value) || 5; localStorage.setItem(kNotificationThresholdKey, String(gNotificationThreshold)); syncSidebar();
    });

    // Custom CSS
    popup.querySelector("#ib_sp_save_css").addEventListener("click", function() {
        gCustomCss = popup.querySelector("#ib_sp_custom_css").value || "";
        localStorage.setItem(kCustomCssKey, gCustomCss);
        ApplyCustomCss();
        ReprocessChat();
        syncSidebar();
    });
    popup.querySelector("#ib_sp_clear_css").addEventListener("click", function() {
        if (!confirm(T("clearCustomCssConfirm"))) return;
        gCustomCss = "";
        localStorage.setItem(kCustomCssKey, "");
        popup.querySelector("#ib_sp_custom_css").value = "";
        ApplyCustomCss();
        ReprocessChat();
        syncSidebar();
    });

    // Actions
    popup.querySelector("#ib_sp_reset_state").addEventListener("click", function() {
        if (confirm(T("resetConfirm"))) {
            gState = structuredClone(kDefaultState);
            SaveState();
            ReprocessChat();
        }
    });
    popup.querySelector("#ib_sp_reprocess").addEventListener("click", function() {
        ReprocessChat();
    });

    // Clean orphaned snapshots
    popup.querySelector("#ib_sp_clean_orphan_snapshots").addEventListener("click", function() {
        if (!confirm(T("cleanOrphanSnapshotsConfirm"))) return;
        CleanPinRegistry();
        ReprocessChat();
    });

    // Close button ×
    popup.querySelector("#ib_sp_close").addEventListener("click", (e) => {
        e.stopPropagation();
        popup.remove();
    });

    // Click outside to close
    const closeOnOutside = (ev) => {
        if (!ev.target.closest(".ib-settings-popup") && !ev.target.closest(".ib-btn-settings")) {
            popup.remove();
            document.removeEventListener("click", closeOnOutside);
        }
    };
    setTimeout(() => document.addEventListener("click", closeOnOutside), 10);
}

function WireBoardControls(boardEl, prevState) {
    if (!boardEl) return;

    // 1. Кнопки режима (компактный/полный/свернутый)
    boardEl.querySelectorAll(".ib-btn-compact").forEach(btn => {
        btn.addEventListener("click", () => {
            const isCompact = boardEl.classList.contains("ib-mode-compact");
            SetBoardMode(boardEl, isCompact ? "full" : "compact");
        });
    });

    boardEl.querySelectorAll(".ib-btn-collapse").forEach(btn => {
        btn.addEventListener("click", () => {
            const isCollapsed = boardEl.classList.contains("ib-mode-collapsed");
            SetBoardMode(boardEl, isCollapsed ? "full" : "collapsed");
        });
    });

    boardEl.querySelectorAll(".ib-btn-full").forEach(btn => {
        btn.addEventListener("click", () => {
            SetBoardMode(boardEl, "full");
        });
    });

    const collapsedTag = boardEl.querySelector(".ib-collapsed-tag");
    if (collapsedTag) {
        collapsedTag.addEventListener("click", () => {
            SetBoardMode(boardEl, "full");
        });
    }

    // Theme button
    boardEl.querySelectorAll(".ib-btn-theme").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            RenderThemePopup(btn);
        });
    });

    // Settings button
    boardEl.querySelectorAll(".ib-btn-settings").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            RenderSettingsPopup(btn);
        });
    });

    // Timeline button
    boardEl.querySelectorAll(".ib-btn-timeline").forEach(btn => {
        btn.addEventListener("click", () => {
            RenderTimelinePopup();
        });
    });

    // 2. Кнопка показа сырого XML (Debug)
    boardEl.querySelectorAll(".ib-btn-debug").forEach(btn => {
        btn.addEventListener("click", () => {
            const host = boardEl.closest(".ib-board-host, #ib_floating_host, #ib_panel_host");
            const raw = host?.dataset?.rawXml || gLastRawXml || "";

            // For inline boards: derive msgIndex from the message element in DOM.
            // For floating/panel: use the global last message index.
            let msgIndex;
            const mesNode = host?.closest(".mes");
            if (mesNode) {
                msgIndex = Number(mesNode.getAttribute("mesid"));
                if (isNaN(msgIndex)) msgIndex = gLastRawXmlMsgIndex;
            } else {
                msgIndex = gLastRawXmlMsgIndex;
            }

            let debugWrap = host.querySelector(".ib-debug-wrap");

            if (debugWrap) {
                debugWrap.remove();
                btn.classList.remove("ib-active");
                return;
            }

            debugWrap = document.createElement("div");
            debugWrap.className = "ib-debug-wrap";

            // --- Кнопка "Копировать" ---
            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "ib-debug-copy";
            copyBtn.textContent = raw ? T("copyXml") || "Copy XML" : "(no XML data)";

            copyBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!raw) return;
                try {
                    await navigator.clipboard.writeText(raw);
                    copyBtn.textContent = T("copiedXml") || "Copied!";
                    setTimeout(() => { copyBtn.textContent = T("copyXml") || "Copy XML"; }, 1200);
                } catch (err) {
                    console.warn("[IB] Copy XML failed:", err);
                }
            });

            // --- Кнопка "Редактировать" ---
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "ib-debug-edit";
            editBtn.textContent = T("editXml") || "Edit";

            // --- Кнопка "Сохранить" (скрыта до редактирования) ---
            const saveBtn = document.createElement("button");
            saveBtn.type = "button";
            saveBtn.className = "ib-debug-save";
            saveBtn.textContent = T("saveXml") || "Save";
            saveBtn.style.display = "none";

            // --- Кнопка "Отмена" (скрыта до редактирования) ---
            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.className = "ib-debug-cancel";
            cancelBtn.textContent = T("cancelEdit") || "Cancel";
            cancelBtn.style.display = "none";

            // --- pre для отображения XML ---
            const pre = document.createElement("pre");
            pre.className = "ib-debug-xml";
            pre.textContent = raw || "(no raw XML available)";

            // --- textarea для редактирования ---
            const textarea = document.createElement("textarea");
            textarea.className = "ib-debug-xml-editor";
            textarea.value = raw || "";
            textarea.style.display = "none";

            // --- Переключение в режим редактирования ---
            editBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!raw) return;
                if (msgIndex < 0) {
                    editBtn.textContent = "(no msg)";
                    setTimeout(() => { editBtn.textContent = T("editXml") || "Edit"; }, 1200);
                    return;
                }
                const preHeight = pre.offsetHeight;
                pre.style.display = "none";
                textarea.style.display = "block";
                textarea.style.height = preHeight + "px";
                textarea.value = raw;

                editBtn.style.display = "none";
                copyBtn.style.display = "none";
                saveBtn.style.display = "";
                cancelBtn.style.display = "";
            });

            // --- Сохранение отредактированного XML в сообщение ---
            saveBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const newXml = textarea.value.trim();
                if (!newXml || msgIndex < 0) return;

                try {
                    const stContext = SillyTavern.getContext();
                    const msg = stContext.chat?.[msgIndex];
                    if (!msg) throw new Error("Message not found");

                    // Replace the specific XML block that belongs to this board.
                    // Use 'raw' (from host.dataset.rawXml) — the original XML of THIS board,
                    // not gLastRawXml which always points to the latest message.
                    const newMes = msg.mes.replace(raw, newXml);

                    if (newMes === msg.mes) {
                        throw new Error("XML not found in message — data out of sync");
                    }
                    msg.mes = newMes;

                    // Сохраняем чат через SillyTavern API
                    if (typeof stContext.saveChat === "function") {
                        await stContext.saveChat();
                    } else if (typeof stContext.saveSettings === "function") {
                        await stContext.saveSettings();
                    }

                    // Обновляем DOM сообщения
                    const mesNodes = document.querySelectorAll(`.mes[mesid="${msgIndex}"]`);
                    mesNodes.forEach(node => {
                        const mesTextEl = node.querySelector(".mes_text");
                        if (mesTextEl) {
                            // SillyTavern обычно перерендерит .mes_text через messageFormatting
                            // Но мы также обновляем raw данные
                        }
                    });

                    // Выходим из режима редактирования
                    pre.textContent = newXml;
                    pre.style.display = "";
                    textarea.style.display = "none";
                    editBtn.style.display = "";
                    copyBtn.style.display = "";
                    saveBtn.style.display = "none";
                    cancelBtn.style.display = "none";

                    // Only update global gLastRawXml if we edited the latest board.
                    // For old inline boards, gLastRawXml must keep pointing to the latest message's XML.
                    if (msgIndex === gLastRawXmlMsgIndex) {
                        gLastRawXml = newXml;
                    }
                    host.dataset.rawXml = newXml;

                    saveBtn.textContent = T("xmlSaved") || "Saved!";
                    setTimeout(() => { saveBtn.textContent = T("saveXml") || "Save"; }, 1200);

                    // Перепроцессим чат чтобы применить изменения
                    ScheduleReprocessChat();
                } catch (err) {
                    console.error("[IB] XML save failed:", err);
                    saveBtn.textContent = T("xmlSaveFailed") || "Failed!";
                    setTimeout(() => { saveBtn.textContent = T("saveXml") || "Save"; }, 1500);
                }
            });

            // --- Отмена редактирования ---
            cancelBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                pre.style.display = "";
                textarea.style.display = "none";
                editBtn.style.display = "";
                copyBtn.style.display = "";
                saveBtn.style.display = "none";
                cancelBtn.style.display = "none";
            });

            debugWrap.appendChild(copyBtn);
            debugWrap.appendChild(editBtn);
            debugWrap.appendChild(saveBtn);
            debugWrap.appendChild(cancelBtn);
            debugWrap.appendChild(pre);
            debugWrap.appendChild(textarea);

            // Для floating/panel — вставляем внутрь body-контейнера, не в корень host
            const bodyTarget = host.querySelector(".ib-floating-body, .ib-panel-body");
            if (bodyTarget) {
                bodyTarget.appendChild(debugWrap);
            } else {
                host.appendChild(debugWrap);
            }

            btn.classList.add("ib-active");
        });
    });

    // 3. Кнопки закрепления внутри карточек NPC
    boardEl.querySelectorAll(".ib-pin-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = btn.dataset.ibPin || "";
            if (!name) return;
            TogglePinnedNpc(name);
            ReprocessChat();
            // Закрыть попап со списком пинов, если открыт
            document.querySelectorAll(".ib-pins-popup").forEach(p => p.remove());
            document.querySelectorAll(".ib-settings-popup").forEach(p => p.remove());
        });
    });

    // Обновление открытого попапа со списком пинов
    const RefreshPinsPopup = () => {
        const popup = document.querySelector(".ib-pins-popup");
        if (!popup) return;

        // Сохраняем состояние развёрнутости секции «other» до перестроения HTML
        const wasExpanded = popup.classList.contains("ib-pins-expanded");

        // Пересобираем gPinnedNpcs на случай изменений
        gPinnedNpcs = ResolveActivePins();

        // Determine "other" pins — pinned in other chats/cards but NOT in current context
        const allPins = ResolveAllPins();
        // Set of NPC names active in current context (for ↷ disabled check)
        const currentSet = new Set(gPinnedNpcs.map(n => NormalizeName(n)));
        // Filter pins that are NOT from the current context (show pins from other chats/characters)
        const currentCharKey = GetCurrentCharKey();
        const currentChatId = GetChatId();
        const otherPins = allPins.filter(p => {
            // Skip pins that belong to the current context
            if (p.level === "perChat" && p.chatId === currentChatId) return false;
            if (p.level === "perChar" && p.charKey === currentCharKey) return false;
            if (p.level === "global") return false; // global is always current context
            return true;
        });

        const makeTierRadio = (name, currentLevel, radioLevel) => {
            const isActive = currentLevel === radioLevel;
            const activeCls = isActive ? "ib-tier-radio-active" : "";
            const tierVar = radioLevel === "perChat" ? "1" : radioLevel === "perChar" ? "2" : "3";
            const storedLevel = (currentLevel !== GetPinLevel(name)) ? `data-ib-pin-current-level="${EscapeHtml(currentLevel)}"` : "";
            return `<span class="ib-tier-radio ${activeCls} ${isActive ? `ib-tier-radio-tier-${tierVar}` : ''}" 
                data-ib-pin-name="${EscapeHtml(name)}" 
                data-ib-pin-level="${radioLevel}"
                ${storedLevel}
                title="${EscapeHtml(radioLevel === "perChat" ? T("pinTierChat") : radioLevel === "perChar" ? T("pinTierChar") : T("pinTierGlobal"))}">${isActive ? "●" : "○"}</span>`;
        };

        // Read-only version for "other" pins — no data attributes, no interaction
        const makeTierRadioReadOnly = (currentLevel, radioLevel) => {
            const isActive = currentLevel === radioLevel;
            const activeCls = isActive ? "ib-tier-radio-active" : "";
            const tierVar = radioLevel === "perChat" ? "1" : radioLevel === "perChar" ? "2" : "3";
            return `<span class="ib-tier-radio ib-pins-radio-disabled ${activeCls} ${isActive ? `ib-tier-radio-tier-${tierVar}` : ''}">${isActive ? "●" : "○"}</span>`;
        };

        let content = `<div class="ib-pins-header">${EscapeHtml(T("pinnedList"))}</div>`;

        if (gPinnedNpcs.length === 0) {
            content += `<div class="ib-pins-empty">${EscapeHtml(T("noPinned"))}</div>`;
        } else {
            content += `<div class="ib-pins-table">`;
            content += `<div class="ib-pins-table-header">
                <span></span><span class="ib-pins-th-name"></span>
                <span class="ib-pins-th-tier" title="${EscapeHtml(T("pinTierChat"))}">${EscapeHtml(T("pinTierChat"))}</span>
                <span class="ib-pins-th-tier" title="${EscapeHtml(T("pinTierChar"))}">${EscapeHtml(T("pinTierChar"))}</span>
                <span class="ib-pins-th-tier" title="${EscapeHtml(T("pinTierGlobal"))}">${EscapeHtml(T("pinTierGlobal"))}</span>
            </div>`;

            SortPinsByName(gPinnedNpcs).forEach(name => {
                const currentLevel = GetPinLevel(name);
                const normName = NormalizeName(name);
                const snap = gPinRegistry?.pinSnapshots?.[normName];
                const icon = snap?.icon ? EscapeHtml(snap.icon) : "📌";
                content += `<div class="ib-pins-row"><span class="ib-pins-icon">${icon}</span><span class="ib-pins-name">${EscapeHtml(name)}</span>${makeTierRadio(name, currentLevel, "perChat")}${makeTierRadio(name, currentLevel, "perChar")}${makeTierRadio(name, currentLevel, "global")}</div>`;
            });
            content += `</div>`;
        }

        // Expandable "other pins" section
        if (otherPins.length > 0) {
            content += `<div class="ib-pins-other-section">`;
            content += `<div class="ib-pins-expand-btn" title="${EscapeHtml(T("pinsExpandOther"))}">`;
            content += `<span class="ib-pins-expand-label">${EscapeHtml(T("pinsExpandOther"))}</span>`;
            content += `<span class="ib-pins-expand-arrow">▾</span>`;
            content += `</div>`;
            content += `<div class="ib-pins-other-list">`;
            otherPins.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })).forEach(pinInfo => {
                const { name, level } = pinInfo;
                const normalized = NormalizeName(name);
                const snap = gPinRegistry?.pinSnapshots?.[normalized];
                const alreadyActive = currentSet.has(NormalizeName(name));
                const pinhereCls = alreadyActive ? "ib-pins-other-pinhere ib-pins-radio-disabled" : "ib-pins-other-pinhere";
                const pinhereTitle = alreadyActive ? EscapeHtml(T("pinHereAlready")) : EscapeHtml(T("pinHere"));

                content += `<div class="ib-pins-other-row" data-ib-ap-name="${EscapeHtml(name)}" data-ib-ap-level="${pinInfo.level || ""}" data-ib-ap-charkey="${EscapeHtml(pinInfo.charKey || "")}" data-ib-ap-chatid="${EscapeHtml(pinInfo.chatId || "")}">`;
                const sourceName = pinInfo.level === "perChat"
                    ? pinInfo.chatId
                    : pinInfo.level === "perChar"
                        ? (GetCharNameByKey(pinInfo.charKey) || pinInfo.charKey || name)
                        : name;
                const navigateTitle = EscapeHtml(T("allPinsNavigate", { source: sourceName }));
                content += `<span class="ib-pins-other-goto" data-ib-ap-name="${EscapeHtml(name)}" data-ib-ap-charkey="${EscapeHtml(pinInfo.charKey || "")}" title="${navigateTitle}">↗</span>`;
                content += `<span class="ib-pins-other-icon">${snap?.icon ? EscapeHtml(snap.icon) : "📌"}</span>`;
                content += `<span class="ib-pins-other-name">${EscapeHtml(name)}</span>`;
                content += makeTierRadioReadOnly(level, "perChat");
                content += makeTierRadioReadOnly(level, "perChar");
                content += makeTierRadioReadOnly(level, "global");
                content += `<span class="${pinhereCls}" data-ib-ap-name="${EscapeHtml(name)}" title="${pinhereTitle}">↷</span>`;
                content += `<span class="ib-pins-other-unpin" data-ib-ap-name="${EscapeHtml(name)}" data-ib-ap-level="${pinInfo.level || ""}" data-ib-ap-charkey="${EscapeHtml(pinInfo.charKey || "")}" data-ib-ap-chatid="${EscapeHtml(pinInfo.chatId || "")}" title="${EscapeHtml(T("allPinsUnpin"))}">✕</span>`;
                content += `</div>`;
            });
            content += `</div>`;
            content += `</div>`;
        }

        popup.innerHTML = content;

        // Восстанавливаем развёрнутое состояние секции «other», если она была открыта
        // и в ней всё ещё есть персонажи после обновления
        if (wasExpanded) {
            const newExpandBtn = popup.querySelector(".ib-pins-expand-btn");
            const newOtherList = popup.querySelector(".ib-pins-other-list");
            if (newExpandBtn && newOtherList && newOtherList.children.length > 0) {
                newOtherList.classList.add("ib-pins-other-list-expanded");
                newExpandBtn.classList.add("ib-pins-expand-btn-expanded");
                popup.classList.add("ib-pins-expanded");
                const arrow = newExpandBtn.querySelector(".ib-pins-expand-arrow");
                const label = newExpandBtn.querySelector(".ib-pins-expand-label");
                if (arrow) arrow.textContent = "▴";
                if (label) label.textContent = T("pinsCollapseOther");
            }
        }

        // Tier radio handlers (only active radios — .ib-pins-radio-disabled are skipped)
        popup.querySelectorAll(".ib-tier-radio:not(.ib-pins-radio-disabled)").forEach(radio => {
            radio.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const name = radio.dataset.ibPinName;
                const level = radio.dataset.ibPinLevel;
                const currentLevel = radio.dataset.ibPinCurrentLevel || GetPinLevel(name);

                if (currentLevel === level) {
                    SetPinLevel(name, null);
                    ReprocessChat();
                    RefreshPinsPopup();
                } else {
                    SetPinLevel(name, level);
                    ReprocessChat();
                    RefreshPinsPopup();
                }
            });
        });

        // Expand/collapse button
        const expandBtn = popup.querySelector(".ib-pins-expand-btn");
        const otherList = popup.querySelector(".ib-pins-other-list");
        if (expandBtn && otherList) {
            expandBtn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const isExpanded = otherList.classList.toggle("ib-pins-other-list-expanded");
                expandBtn.classList.toggle("ib-pins-expand-btn-expanded", isExpanded);
                popup.classList.toggle("ib-pins-expanded", isExpanded);
                const arrow = expandBtn.querySelector(".ib-pins-expand-arrow");
                const label = expandBtn.querySelector(".ib-pins-expand-label");
                if (isExpanded) {
                    if (arrow) arrow.textContent = "▴";
                    if (label) label.textContent = T("pinsCollapseOther");
                } else {
                    if (arrow) arrow.textContent = "▾";
                    if (label) label.textContent = T("pinsExpandOther");
                }
            });
        }

        // Unpin buttons in "other" section — remove from the specific context, not all
        popup.querySelectorAll(".ib-pins-other-unpin").forEach(btn => {
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const name = btn.dataset.ibApName;
                const level = btn.dataset.ibApLevel || null;
                const charKey = btn.dataset.ibApCharkey || null;
                const chatId = btn.dataset.ibApChatid || null;
                RemoveFromSpecificContext(name, level, charKey, chatId);
                ReprocessChat();
                RefreshPinsPopup();
            });
        });

        // ↷ "Pin here" buttons in "other" section
        popup.querySelectorAll(".ib-pins-other-pinhere:not(.ib-pins-radio-disabled)").forEach(btn => {
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const name = btn.dataset.ibApName;
                const added = PinHere(name);
                if (added) {
                    ShowToast("📌", T("pinHereDone"), "info");
                }
                ReprocessChat();
                RefreshPinsPopup();
            });
        });

        // Goto navigation — resolve charKey from live registry at click time
        popup.querySelectorAll(".ib-pins-other-goto").forEach(gotoBtn => {
            gotoBtn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const charKey = gotoBtn.dataset.ibApCharkey;

                if (charKey) {
                    NavigateToCharacterCard(charKey);
                } else {
                    ShowToast("📍", T("pinNavNotFound"), "warning");
                }
            });
        });
    };

    // 4. Логика списка закреплённых (Кнопка 📍)
    const closePinsPopupHandler = (e) => {
        // Если клик был НЕ по попапу и НЕ по кнопке открытия -> закрываем
        if (!e.target.closest(".ib-pins-popup") && !e.target.closest(".ib-btn-pins")) {
            document.querySelectorAll(".ib-pins-popup").forEach(p => p.remove());
            document.removeEventListener("click", closePinsPopupHandler);
        }
    };

    boardEl.querySelectorAll(".ib-btn-pins").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();

            // Проверяем, открыт ли уже попап
            const existingPopup = document.querySelector(".ib-pins-popup");
            if (existingPopup) {
                const sameBtn = existingPopup.__sourceBtn === btn;
                CloseOtherPopups(".ib-pins-popup");
                existingPopup.remove();
                if (sameBtn) return;
            } else {
                CloseOtherPopups(".ib-pins-popup");
            }

            const popup = document.createElement("div");
            popup.className = `ib-pins-popup ib-popup-fixed ${GetThemeClassStr()}`;
            popup.__sourceBtn = btn;

            // Determine "other" pins — pinned in other chats/cards but NOT in current context
            const allPins = ResolveAllPins();
            // Set of NPC names active in current context (for ↷ disabled check)
            const currentSet = new Set(gPinnedNpcs.map(n => NormalizeName(n)));
            // Filter pins that are NOT from the current context (show pins from other chats/characters)
            const currentCharKey = GetCurrentCharKey();
            const currentChatId = GetChatId();
            const otherPins = allPins.filter(p => {
                // Skip pins that belong to the current context
                if (p.level === "perChat" && p.chatId === currentChatId) return false;
                if (p.level === "perChar" && p.charKey === currentCharKey) return false;
                if (p.level === "global") return false; // global is always current context
                return true;
            });

            const makeTierRadio = (name, currentLevel, radioLevel) => {
                const isActive = currentLevel === radioLevel;
                const activeCls = isActive ? "ib-tier-radio-active" : "";
                const tierVar = radioLevel === "perChat" ? "1" : radioLevel === "perChar" ? "2" : "3";
                const storedLevel = (currentLevel !== GetPinLevel(name)) ? `data-ib-pin-current-level="${EscapeHtml(currentLevel)}"` : "";
                return `<span class="ib-tier-radio ${activeCls} ${isActive ? `ib-tier-radio-tier-${tierVar}` : ''}" 
                    data-ib-pin-name="${EscapeHtml(name)}" 
                    data-ib-pin-level="${radioLevel}"
                    ${storedLevel}
                    title="${EscapeHtml(radioLevel === "perChat" ? T("pinTierChat") : radioLevel === "perChar" ? T("pinTierChar") : T("pinTierGlobal"))}">${isActive ? "●" : "○"}</span>`;
            };

            // Read-only version for "other" pins — no data attributes, no interaction
            const makeTierRadioReadOnly = (currentLevel, radioLevel) => {
                const isActive = currentLevel === radioLevel;
                const activeCls = isActive ? "ib-tier-radio-active" : "";
                const tierVar = radioLevel === "perChat" ? "1" : radioLevel === "perChar" ? "2" : "3";
                return `<span class="ib-tier-radio ib-pins-radio-disabled ${activeCls} ${isActive ? `ib-tier-radio-tier-${tierVar}` : ''}">${isActive ? "●" : "○"}</span>`;
            };

            let content = `<div class="ib-pins-header">${EscapeHtml(T("pinnedList"))}</div>`;

            if (gPinnedNpcs.length === 0) {
                content += `<div class="ib-pins-empty">${EscapeHtml(T("noPinned"))}</div>`;
            } else {
                content += `<div class="ib-pins-table">`;
                content += `<div class="ib-pins-table-header">
                    <span></span><span class="ib-pins-th-name"></span>
                    <span class="ib-pins-th-tier" title="${EscapeHtml(T("pinTierChat"))}">${EscapeHtml(T("pinTierChat"))}</span>
                    <span class="ib-pins-th-tier" title="${EscapeHtml(T("pinTierChar"))}">${EscapeHtml(T("pinTierChar"))}</span>
                    <span class="ib-pins-th-tier" title="${EscapeHtml(T("pinTierGlobal"))}">${EscapeHtml(T("pinTierGlobal"))}</span>
                </div>`;

                SortPinsByName(gPinnedNpcs).forEach(name => {
                    const currentLevel = GetPinLevel(name);
                    const normName = NormalizeName(name);
                    const snap = gPinRegistry?.pinSnapshots?.[normName];
                    const icon = snap?.icon ? EscapeHtml(snap.icon) : "📌";
                    content += `<div class="ib-pins-row"><span class="ib-pins-icon">${icon}</span><span class="ib-pins-name">${EscapeHtml(name)}</span>${makeTierRadio(name, currentLevel, "perChat")}${makeTierRadio(name, currentLevel, "perChar")}${makeTierRadio(name, currentLevel, "global")}</div>`;
                });
                content += `</div>`;
            }

            // Expandable "other pins" section
            if (otherPins.length > 0) {
                content += `<div class="ib-pins-other-section">`;
                content += `<div class="ib-pins-expand-btn" title="${EscapeHtml(T("pinsExpandOther"))}">`;
                content += `<span class="ib-pins-expand-label">${EscapeHtml(T("pinsExpandOther"))}</span>`;
                content += `<span class="ib-pins-expand-arrow">▾</span>`;
                content += `</div>`;
                content += `<div class="ib-pins-other-list">`;
                otherPins.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })).forEach(pinInfo => {
                    const { name, level } = pinInfo;
                    const normalized = NormalizeName(name);
                    const snap = gPinRegistry?.pinSnapshots?.[normalized];
                    const alreadyActive = currentSet.has(NormalizeName(name));
                    const pinhereCls = alreadyActive ? "ib-pins-other-pinhere ib-pins-radio-disabled" : "ib-pins-other-pinhere";
                    const pinhereTitle = alreadyActive ? EscapeHtml(T("pinHereAlready")) : EscapeHtml(T("pinHere"));

                    content += `<div class="ib-pins-other-row" data-ib-ap-name="${EscapeHtml(name)}" data-ib-ap-level="${pinInfo.level || ""}" data-ib-ap-charkey="${EscapeHtml(pinInfo.charKey || "")}" data-ib-ap-chatid="${EscapeHtml(pinInfo.chatId || "")}">`;
                    const sourceName = pinInfo.level === "perChat"
                        ? pinInfo.chatId
                        : pinInfo.level === "perChar"
                            ? (GetCharNameByKey(pinInfo.charKey) || pinInfo.charKey || name)
                            : name;
                    const navigateTitle = EscapeHtml(T("allPinsNavigate", { source: sourceName }));
                    content += `<span class="ib-pins-other-goto" data-ib-ap-name="${EscapeHtml(name)}" data-ib-ap-charkey="${EscapeHtml(pinInfo.charKey || "")}" title="${navigateTitle}">↗</span>`;
                    content += `<span class="ib-pins-other-icon">${snap?.icon ? EscapeHtml(snap.icon) : "📌"}</span>`;
                    content += `<span class="ib-pins-other-name">${EscapeHtml(name)}</span>`;
                    content += makeTierRadioReadOnly(level, "perChat");
                    content += makeTierRadioReadOnly(level, "perChar");
                    content += makeTierRadioReadOnly(level, "global");
                    content += `<span class="${pinhereCls}" data-ib-ap-name="${EscapeHtml(name)}" title="${pinhereTitle}">↷</span>`;
                    content += `<span class="ib-pins-other-unpin" data-ib-ap-name="${EscapeHtml(name)}" data-ib-ap-level="${pinInfo.level || ""}" data-ib-ap-charkey="${EscapeHtml(pinInfo.charKey || "")}" data-ib-ap-chatid="${EscapeHtml(pinInfo.chatId || "")}" title="${EscapeHtml(T("allPinsUnpin"))}">✕</span>`;
                    content += `</div>`;
                });
                content += `</div>`;
                content += `</div>`;
            }

            popup.innerHTML = content;
            document.body.appendChild(popup);

            PositionPopupNearButton(popup, btn);

            // Tier radio handlers (only active radios — .ib-pins-radio-disabled are skipped)
            popup.querySelectorAll(".ib-tier-radio:not(.ib-pins-radio-disabled)").forEach(radio => {
                radio.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    const name = radio.dataset.ibPinName;
                    const level = radio.dataset.ibPinLevel;
                    const currentLevel = radio.dataset.ibPinCurrentLevel || GetPinLevel(name);

                    if (currentLevel === level) {
                        SetPinLevel(name, null);
                        ReprocessChat();
                        RefreshPinsPopup();
                    } else {
                        SetPinLevel(name, level);
                        ReprocessChat();
                        RefreshPinsPopup();
                    }
                });
            });

            // Expand/collapse button
            const expandBtn = popup.querySelector(".ib-pins-expand-btn");
            const otherList = popup.querySelector(".ib-pins-other-list");
            if (expandBtn && otherList) {
                expandBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    const isExpanded = otherList.classList.toggle("ib-pins-other-list-expanded");
                    expandBtn.classList.toggle("ib-pins-expand-btn-expanded", isExpanded);
                    popup.classList.toggle("ib-pins-expanded", isExpanded);
                    const arrow = expandBtn.querySelector(".ib-pins-expand-arrow");
                    const label = expandBtn.querySelector(".ib-pins-expand-label");
                    if (isExpanded) {
                        if (arrow) arrow.textContent = "▴";
                        if (label) label.textContent = T("pinsCollapseOther");
                    } else {
                        if (arrow) arrow.textContent = "▾";
                        if (label) label.textContent = T("pinsExpandOther");
                    }
                });
            }

            // Unpin buttons in "other" section — remove from the specific context, not all
            popup.querySelectorAll(".ib-pins-other-unpin").forEach(unpinBtn => {
                unpinBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    const name = unpinBtn.dataset.ibApName;
                    const level = unpinBtn.dataset.ibApLevel || null;
                    const charKey = unpinBtn.dataset.ibApCharkey || null;
                    const chatId = unpinBtn.dataset.ibApChatid || null;
                    RemoveFromSpecificContext(name, level, charKey, chatId);
                    ReprocessChat();
                    RefreshPinsPopup();
                });
            });

            // ↷ "Pin here" buttons in "other" section
            popup.querySelectorAll(".ib-pins-other-pinhere:not(.ib-pins-radio-disabled)").forEach(btn => {
                btn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    const name = btn.dataset.ibApName;
                    const added = PinHere(name);
                    if (added) {
                        ShowToast("📌", T("pinHereDone"), "info");
                    }
                    ReprocessChat();
                    RefreshPinsPopup();
                });
            });

            // Goto navigation — resolve charKey from live registry at click time
            popup.querySelectorAll(".ib-pins-other-goto").forEach(gotoBtn => {
                gotoBtn.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    const charKey = gotoBtn.dataset.ibApCharkey;

                    if (charKey) {
                        NavigateToCharacterCard(charKey);
                    } else {
                        ShowToast("📍", T("pinNavNotFound"), "warning");
                    }
                });
            });

            // Вешаем обработчик на документ для закрытия по клику "мимо"
            // setTimeout нужен, чтобы текущий клик не закрыл попап сразу же
            setTimeout(() => {
                document.addEventListener("click", closePinsPopupHandler);
            }, 10);
        });
    });

    WireAccordionControls(boardEl);

    // 5. Per-relationship Timeline buttons inside rel cards
    boardEl.querySelectorAll(".ib-rel-timeline-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const npcName = btn.dataset.ibTimeline || "";
            if (npcName) {
                RenderTimelinePopup(npcName);
            } else {
                RenderTimelinePopup();
            }
        });
    });

    // 6. 🔔 Notifications button
    boardEl.querySelectorAll(".ib-btn-notifications").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();

            const existingPopup = document.querySelector(".ib-notifications-popup");
            if (existingPopup) {
                const sameBtn = existingPopup.__sourceBtn === btn;
                CloseOtherPopups(".ib-notifications-popup");
                existingPopup.remove();
                if (sameBtn) return;
            } else {
                CloseOtherPopups(".ib-notifications-popup");
            }

            const popup = document.createElement("div");
            popup.className = `ib-notifications-popup ib-popup-fixed ${GetThemeClassStr()}`;
            popup.__sourceBtn = btn;

            const notifLabel = T("notifications");
            const noNotifLabel = T("noSignificantChanges");

            let content = `<div class="ib-notif-header">🔔 ${EscapeHtml(notifLabel)}</div>`;

            const threshold = gNotificationThreshold || 5;
            const notifications = [];
            const prevRels = prevState ? prevState.rels : [];

            (gState.rels || []).forEach(r => {
                const ac = parseInt(r.ac) || 0;
                const tc = parseInt(r.tc) || 0;
                const lc = parseInt(r.lc) || 0;
                const maxDelta = Math.max(Math.abs(ac), Math.abs(tc), Math.abs(lc));

                if (maxDelta >= threshold) {
                    const prev = prevRels.find(pr => NamesLikelyMatch(pr.source, r.source));
                    const parts = [];
                    if (Math.abs(ac) >= threshold) parts.push(`A ${SignedText(ac)}`);
                    if (Math.abs(tc) >= threshold) parts.push(`T ${SignedText(tc)}`);
                    if (Math.abs(lc) >= threshold) parts.push(`L ${SignedText(lc)}`);
                    if (parts.length) {
                        notifications.push({
                            name: r.source,
                            status: r.status,
                            changes: parts.join(" · ")
                        });
                    }
                }
            });

            if (notifications.length === 0) {
                content += `<div class="ib-notif-empty">${EscapeHtml(noNotifLabel)}</div>`;
            } else {
                content += `<div class="ib-notif-list">`;
                notifications.forEach(n => {
                    content += `
                    <div class="ib-notif-item">
                        <span class="ib-notif-name">${EscapeHtml(n.name)}</span>
                        <span class="ib-notif-status">${EscapeHtml(n.status)}</span>
                        <span class="ib-notif-changes">${EscapeHtml(n.changes)}</span>
                    </div>`;
                });
                content += `</div>`;
            }

            popup.innerHTML = content;
            document.body.appendChild(popup);

            PositionPopupNearButton(popup, btn);

            const closeHandler = (ev) => {
                if (!ev.target.closest(".ib-notifications-popup") && !ev.target.closest(".ib-btn-notifications")) {
                    document.querySelectorAll(".ib-notifications-popup").forEach(p => p.remove());
                    document.removeEventListener("click", closeHandler);
                }
            };
            setTimeout(() => { document.addEventListener("click", closeHandler); }, 10);
        });
    });

    // 7. 📤 Export button
    boardEl.querySelectorAll(".ib-btn-export").forEach(btn => {
        btn.addEventListener("click", () => {
            ExportState();
        });
    });

    // 8. 📥 Import button
    boardEl.querySelectorAll(".ib-btn-import").forEach(btn => {
        btn.addEventListener("click", () => {
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = ".json";
            fileInput.style.display = "none";
            document.body.appendChild(fileInput);

            fileInput.addEventListener("change", () => {
                const file = fileInput.files?.[0];
                if (!file) { document.body.removeChild(fileInput); return; }

                ImportStateFromFile(file).then(() => {
                    document.body.removeChild(fileInput);
                    RenderFloatingBoard();
                    RenderPanelBoard();
                }).catch(() => {
                    document.body.removeChild(fileInput);
                });
            });

            fileInput.click();
        });
    });
}

function ApplyFloatingThemeClasses(el) {
    if (!el) return;

    [...el.classList].forEach(cls => {
        if (cls.startsWith("ib-theme-") || cls.startsWith("ib-bars-")) {
            el.classList.remove(cls);
        }
    });
    // Clear stale inline CSS variables from old theme editor
    const staleVars = [
        '--ib-bg-1','--ib-bg-2','--ib-bg-3','--ib-accent','--ib-accent-2',
        '--ib-text','--ib-danger','--ib-green','--ib-dim','--ib-muted',
        '--ib-border','--ib-border-neon','--ib-soft-border',
        '--ib-chip-bg','--ib-chip-border','--ib-chip-text',
        '--ib-neon','--ib-header-glow',
        '--ib-delta-pos','--ib-delta-neg','--ib-delta-zero',
        '--ib-ms-value',
        '--ib-heading','--ib-pill-text',
        '--ib-mood-text','--ib-mood-bg','--ib-mood-border',
        '--ib-age-text','--ib-age-bg','--ib-age-border',
        '--ib-location-text','--ib-char-name',
        '--ib-rel-label','--ib-thought-name','--ib-thought-text',
        '--ib-meter-value'
    ];
    staleVars.forEach(v => el.style.removeProperty(v));

    GetThemeClassStr().split(' ').forEach(cls => el.classList.add(cls));
    el.classList.add(`ib-bars-${gBarStyle}`);
}

function ShouldRenderInlineBoard() {
    return gDisplayInline;
}

function ShouldRenderFloatingBoard() {
    return gDisplayFloating;
}

// TODO: use in RenderPanelBoard
function ShouldRenderPanelBoard() {
    return gDisplayPanel;
}

function GetDefaultBoardMode(renderContext) {
    const mode = renderContext || "inline";
    switch (mode) {
        case "inline": return gDefaultBoardModeInline;
        case "floating": return gDefaultBoardModeFloating;
        case "panel": return gDefaultBoardModePanel;
        default: return gDefaultBoardModeInline;
    }
}

function RemoveFloatingBoard() {
    const host = document.getElementById("ib_floating_host");
    if (host) {
        if (host._ibResizeObserver) {
            host._ibResizeObserver.disconnect();
        }
        if (host._ibDragCleanup) {
            host._ibDragCleanup();
        }
        host.remove();
    }

    const tab = document.getElementById("ib_floating_tab");
    if (tab) tab.remove();
}

function EnsureFloatingTab() {
    let tab = document.getElementById("ib_floating_tab");

    if (!tab) {
        tab = document.createElement("div");
        tab.id = "ib_floating_tab";
        tab.textContent = "✦ INFOBOARD";
        tab.addEventListener("click", () => {
            RenderFloatingBoard(true);
        });
        document.body.appendChild(tab);
    }

    ApplyFloatingThemeClasses(tab);

    return tab;
}

function RenderFloatingBoard(forceOpen = false) {
    if (!gEnabled || !ShouldRenderFloatingBoard()) {
        RemoveFloatingBoard();
        return;
    }

    let host = document.getElementById("ib_floating_host");
    const tab = document.getElementById("ib_floating_tab");

    // Если пользователь свернул окно в маленькую вкладку,
    // не открываем его заново при каждом новом сообщении.
    if (!host && tab && !forceOpen) {
        return;
    }

if (!host) {
    host = document.createElement("div");
    host.id = "ib_floating_host";
    document.body.appendChild(host);
    RestoreFloatingLayout(host);
}

ApplyFloatingThemeClasses(host);

host.dataset.rawXml = gLastRawXml || "";
    
    host.innerHTML = `
        <div class="ib-floating-shell">
            <div class="ib-floating-header">
                <div class="ib-floating-title">✦ ${EscapeHtml(T("floatingTitle"))}</div>
                <div class="ib-floating-actions">
                    <button type="button" class="ib-floating-btn ib-floating-close">×</button>
                </div>
            </div>
            <div class="ib-floating-body">
                ${RenderBoard(GetMergedStateForRendering(), false, null, "floating")}
            </div>
        </div>
    `;

    const boardEl = host.querySelector(".ib-board");
    if (boardEl) {
        WireBoardControls(boardEl, null);
        AutoScrollThoughts(boardEl);
    }

    const closeBtn = host.querySelector(".ib-floating-close");

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            SaveFloatingLayout(host);
            if (host._ibResizeObserver) {
                host._ibResizeObserver.disconnect();
                host._ibResizeObserver = null;
            }
            host.remove();
            EnsureFloatingTab();
        });
    }

    MakeFloatingDraggable(host);
    WatchFloatingResize(host);

    const existingTab = document.getElementById("ib_floating_tab");
    if (existingTab) {
        existingTab.remove();
    }
}

function GetFloatingLayout() {
    try {
        const raw = localStorage.getItem(kFloatingLayoutKey);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function SaveFloatingLayout(host) {
    if (!host) return;

    const rect = host.getBoundingClientRect();

    const data = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
    };

    try {
        localStorage.setItem(kFloatingLayoutKey, JSON.stringify(data));
    } catch (e) {
        console.warn("[IB] Save floating layout failed:", e);
    }
}

function RestoreFloatingLayout(host) {
    if (!host) return;

    const data = GetFloatingLayout();
    if (!data) return;

    const safeLeft = Clamp(data.left ?? 18, 0, Math.max(0, window.innerWidth - 160));
    const safeTop = Clamp(data.top ?? 18, 0, Math.max(0, window.innerHeight - 120));
    const safeWidth = Clamp(data.width ?? 460, 280, Math.max(300, window.innerWidth - 20));
    const safeHeight = Clamp(data.height ?? 520, 220, Math.max(260, window.innerHeight - 20));

    host.style.left = `${safeLeft}px`;
    host.style.top = `${safeTop}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
    host.style.width = `${safeWidth}px`;
    host.style.height = `${safeHeight}px`;
}

function MakeFloatingDraggable(host) {
    if (!host) return;

    if (host._ibDragCleanup) {
        host._ibDragCleanup();
        host._ibDragCleanup = null;
    }

    const header = host.querySelector(".ib-floating-header");
    if (!header) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let hostW = 0;
    let activePointerId = null;

    const onPointerDown = (e) => {
        if (e.target.closest(".ib-floating-btn")) return;
        if (e.button !== undefined && e.button !== 0) return;

        const rect = host.getBoundingClientRect();

        dragging = true;
        activePointerId = e.pointerId;

        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        hostW = rect.width;

        host.style.left = `${rect.left}px`;
        host.style.top = `${rect.top}px`;
        host.style.right = "auto";
        host.style.bottom = "auto";

        // GPU promotion for smooth drag
        host.style.willChange = 'left, top';
        host.classList.add("ib-floating-dragging");

        document.body.classList.add("ib-floating-dragging");

        try {
            header.setPointerCapture?.(e.pointerId);
        } catch {}

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);

        e.preventDefault();
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        if (activePointerId !== null && e.pointerId !== activePointerId) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const nextLeft = Clamp(
            startLeft + dx,
            0,
            Math.max(0, window.innerWidth - hostW)
        );

        const nextTop = Clamp(
            startTop + dy,
            0,
            Math.max(0, window.innerHeight - 60)
        );

        host.style.left = `${nextLeft}px`;
        host.style.top = `${nextTop}px`;
    };

    const onPointerUp = (e) => {
        if (!dragging) return;

        dragging = false;
        activePointerId = null;

        // Clean up GPU promotion
        host.style.willChange = '';
        host.classList.remove("ib-floating-dragging");

        document.body.classList.remove("ib-floating-dragging");

        try {
            header.releasePointerCapture?.(e.pointerId);
        } catch {}

        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);

        SaveFloatingLayout(host);
    };

    header.addEventListener("pointerdown", onPointerDown);

    host._ibDragCleanup = () => {
        header.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        document.body.classList.remove("ib-floating-dragging");
    };
}

function WatchFloatingResize(host) {
    if (!host || host.dataset.resizeReady === "true") return;
    host.dataset.resizeReady = "true";

    if (!window.ResizeObserver) return;

    // Disconnect previous observer if exists
    if (host._ibResizeObserver) {
        host._ibResizeObserver.disconnect();
        host._ibResizeObserver = null;
    }

    let timer = null;
    let isResizing = false;

    const observer = new ResizeObserver(() => {
        // Disable backdrop-filter during resize for smoothness
        if (!isResizing) {
            isResizing = true;
            host.classList.add("ib-floating-resizing");
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
            isResizing = false;
            host.classList.remove("ib-floating-resizing");
            SaveFloatingLayout(host);
        }, 200);
    });

    observer.observe(host);
    host._ibResizeObserver = observer;
}

function GetOrCreateBoardHost(mesTextEl) {
    let host = mesTextEl.querySelector(".ib-board-host");
    if (!host) {
        host = document.createElement("div");
        host.className = "ib-board-host";
        mesTextEl.appendChild(host);
    }
    return host;
}

function CleanupBoardHosts(mesTextEl) {
    const hosts = mesTextEl.querySelectorAll(".ib-board-host");
    if (hosts.length <= 1) return;

    hosts.forEach((host, index) => {
        if (index !== hosts.length - 1) {
            host.remove();
        }
    });
}

function CleanupEmptyMessageNodes(messageTextEl) {
    if (!messageTextEl) return;

    const isEmptyNode = (node) => {
        if (!node) return true;

        if (node.nodeType === Node.TEXT_NODE) {
            return !String(node.textContent || "").trim();
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return true;

        if (node.classList?.contains("ib-board-host") || node.classList?.contains("ib-board")) {
            return false;
        }

        const tag = node.tagName?.toLowerCase();

        if (tag === "br") return true;

        const text = String(node.textContent || "")
            .replace(/\u00a0/g, " ")
            .trim();

        if (!text && node.querySelectorAll("img, video, audio, iframe, svg, canvas").length === 0) {
            const meaningfulChildren = [...node.children].filter(child => {
                const childTag = child.tagName?.toLowerCase();
                return childTag !== "br" && !child.classList?.contains("ib-board-host");
            });

            return meaningfulChildren.length === 0;
        }

        return false;
    };

    const children = [...messageTextEl.childNodes];

    for (const node of children) {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList?.contains("ib-board-host")) {
            break;
        }

        if (isEmptyNode(node)) {
            node.remove();
        }
    }
}

function CleanupRawInfoboardDom(messageTextEl) {
    if (!gHideRaw || !messageTextEl) return;

    messageTextEl
        .querySelectorAll("infoboard, chars, rels, c, rel, thk, nsfw")
        .forEach(node => {
            if (node.closest(".ib-board-host, .ib-board")) return;
            node.remove();
        });
}

function RemoveRawXmlFromText(messageTextEl) {
    if (!gHideRaw || !messageTextEl) return;

    const walker = document.createTreeWalker(
        messageTextEl,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                if (!node?.parentElement) return NodeFilter.FILTER_REJECT;
                if (node.parentElement.closest(".ib-board-host, .ib-board")) return NodeFilter.FILTER_REJECT;

                const txt = node.textContent || "";
                if (
                    txt.includes("<infoboard") ||
                    txt.includes("</infoboard>") ||
                    txt.includes("<thk") ||
                    txt.includes("</thk>") ||
                    txt.includes("<nsfw") ||
                    txt.includes("&lt;infoboard") ||
                    txt.includes("&lt;thk") ||
                    txt.includes("&lt;nsfw")
                ) {
                    return NodeFilter.FILTER_ACCEPT;
                }

                return NodeFilter.FILTER_SKIP;
            }
        }
    );

    const targets = [];
    let current = walker.nextNode();
    while (current) {
        targets.push(current);
        current = walker.nextNode();
    }

    for (const node of targets) {
        const text = node.textContent || "";
        const next = text
            .replace(/<infoboard[\s\S]*?<\/infoboard>/gi, "")
            .replace(/<thk[\s\S]*?<\/thk>/gi, "")
            .replace(/<nsfw\b[\s\S]*?\/?>/gi, "")
            // Also handle escaped HTML entities from markdown renderer
            .replace(/&lt;infoboard[\s\S]*?&lt;\/infoboard&gt;/gi, "")
            .replace(/&lt;thk[\s\S]*?&lt;\/thk&gt;/gi, "")
            .replace(/&lt;nsfw\b[\s\S]*?\/?&gt;/gi, "")
            .replace(/\n{3,}/g, "\n\n");

        if (next !== text) {
            node.textContent = next;
        }
    }
}

function RemoveThoughtLeaksInContainer(messageTextEl, parsed) {
    if (!messageTextEl || !parsed?.thoughts?.length) return;

    const npcNames = [
        ...(parsed.chars || []).map(c => c.name),
        ...(parsed.rels || []).map(r => r.source),
        ...(parsed.thoughts || []).map(t => t.name),
    ].filter(Boolean);

    const thoughtEntries = parsed.thoughts
        .map(t => {
            const name = String(t.name || "").trim();
            const text = String(t.text || "").trim();

            return {
                name,
                text,
                softText: NormalizeThoughtText(text),
                fullSoft: NormalizeThoughtText(`${name}: ${text}`),
            };
        })
        .filter(t => t.name && t.text && t.softText.length >= 5);

    if (!thoughtEntries.length) return;

    // Pre-build Sets for O(1) exact-match lookup (most common case)
    // Avoids O(n) .some() scan when the thought text matches exactly
    const softTextSet = new Set(thoughtEntries.map(t => t.softText));
    const fullSoftSet = new Set(thoughtEntries.map(t => t.fullSoft));

    function IsLeakedThoughtLine(line) {
        const raw = String(line || "").trim();
        if (!raw) return false;

        // Check if this line matches a known NPC thought in "Name: thought" format
        const parsedLine = ParseThoughtLine(raw);
        if (parsedLine && parsedLine.name && parsedLine.text && NormalizeName(parsedLine.name) !== "__unassigned__") {
            const lineName = parsedLine.name;
            const lineTextSoft = NormalizeThoughtText(parsedLine.text);

            if (lineTextSoft.length >= 5) {
                // Fast path: O(1) exact match on softText (most common case)
                if (softTextSet.has(lineTextSoft)) {
                    // Verify owner matches an NPC
                    const ownerMatches = thoughtEntries.some(t =>
                        t.softText === lineTextSoft && ThoughtOwnerMatchesNpc(lineName, t.name, npcNames)
                    );
                    if (ownerMatches) return true;
                }

                // Fast path: O(1) exact match on fullSoft "Name: thought"
                const lineFullSoft = NormalizeThoughtText(`${parsedLine.name}: ${parsedLine.text}`);
                if (fullSoftSet.has(lineFullSoft)) {
                    const ownerMatches = thoughtEntries.some(t =>
                        t.fullSoft === lineFullSoft && ThoughtOwnerMatchesNpc(lineName, t.name, npcNames)
                    );
                    if (ownerMatches) return true;
                }

                // Slow path: fuzzy substring match (rare)
                const match = thoughtEntries.some(t => {
                    const ownerMatches = ThoughtOwnerMatchesNpc(lineName, t.name, npcNames);
                    if (!ownerMatches) return false;

                    // Already checked exact matches above, skip them
                    if (lineTextSoft === t.softText || lineFullSoft === t.fullSoft) return true;

                    const minLen = Math.min(lineTextSoft.length, t.softText.length);
                    const maxLen = Math.max(lineTextSoft.length, t.softText.length);

                    if (minLen < 12) return false;

                    const closeEnough =
                        lineTextSoft.includes(t.softText) ||
                        t.softText.includes(lineTextSoft);

                    return closeEnough && (minLen / maxLen >= 0.72);
                });
                if (match) return true;
            }
        }

        // Also check standalone fragments (no "Name:" prefix, just the thought text)
        // Fast path: O(1) exact match first
        const standaloneSoft = NormalizeThoughtText(raw);
        if (standaloneSoft.length >= 12 && softTextSet.has(standaloneSoft)) return true;

        // Slow path: fuzzy standalone match
        if (LooksLikeStandaloneThoughtFragment(raw, thoughtEntries)) {
            return true;
        }

        return false;
    }

    // Collect all target text nodes via TreeWalker (single DOM pass)
    const walker = document.createTreeWalker(
        messageTextEl,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                if (!node?.parentElement) return NodeFilter.FILTER_REJECT;
                if (node.parentElement.closest(".ib-board-host, .ib-board")) {
                    return NodeFilter.FILTER_REJECT;
                }

                const raw = node.textContent || "";
                if (!raw.trim()) return NodeFilter.FILTER_SKIP;

                const lines = raw.split(/\r?\n/);
                const hasLeak = lines.some(IsLeakedThoughtLine);

                return hasLeak ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        }
    );

    const textTargets = [];
    let current = walker.nextNode();

    while (current) {
        textTargets.push(current);
        current = walker.nextNode();
    }

    for (const node of textTargets) {
        const raw = node.textContent || "";
        const lines = raw.split(/\r?\n/);

        const kept = lines.filter(line => !IsLeakedThoughtLine(line));
        const next = kept.join("\n").replace(/\n{3,}/g, "\n\n");

        node.textContent = next;
    }

    // Pass 2: Remove entire block-level elements that only contain a leaked thought
    // This catches <p>, <div>, <li> elements where SillyTavern wrapped the thought
    messageTextEl.querySelectorAll("p, div, li").forEach(el => {
        if (el.closest(".ib-board-host, .ib-board")) return;

        const text = (el.textContent || "").trim();
        if (!text) return;

        // Only remove if the ENTIRE element content is a leaked thought
        if (IsLeakedThoughtLine(text)) {
            el.remove();
        }
    });
}

function UpdateLastUpdateDisplay() {
    $("#ib_last_update").text(T("noRecentUpdates"));
}

function UpdateBoardModeVisibility() {
    const modes = { inline: gDisplayInline, floating: gDisplayFloating, panel: gDisplayPanel };
    for (const [mode, checked] of Object.entries(modes)) {
        const subrow = document.getElementById(`ib_subrow_${mode}`);
        if (subrow) {
            subrow.style.display = checked ? "" : "none";
        }
    }
    // Inline board count (on same row as inline checkbox)
    const boardCountWrap = document.getElementById("ib_inline_board_count_row");
    if (boardCountWrap) {
        boardCountWrap.style.display = gDisplayInline ? "" : "none";
    }
    // Panel position subrow
    const posSubrow = document.getElementById("ib_subrow_panel_position");
    if (posSubrow) {
        posSubrow.style.display = gDisplayPanel ? "" : "none";
    }
}

function MigrateDisplayMode() {
    // Convert legacy gDisplayMode string to boolean flags
    switch (gDisplayMode) {
        case "inline":
            gDisplayInline = true; gDisplayFloating = false; gDisplayPanel = false;
            break;
        case "floating":
            gDisplayInline = false; gDisplayFloating = true; gDisplayPanel = false;
            break;
        case "panel":
            gDisplayInline = false; gDisplayFloating = false; gDisplayPanel = true;
            break;
        case "both":
            gDisplayInline = true; gDisplayFloating = true; gDisplayPanel = false;
            break;
        default:
            gDisplayInline = true; gDisplayFloating = false; gDisplayPanel = false;
    }
    localStorage.setItem(kDisplayInlineKey, String(gDisplayInline));
    localStorage.setItem(kDisplayFloatingKey, String(gDisplayFloating));
    localStorage.setItem(kDisplayPanelKey, String(gDisplayPanel));
}

function UpdateInjectDepthVisibility() {
    // Show/hide entire inject position section based on macro mode
    if (gUseMacro) {
        $("#ib_inject_position_row").hide();
        $("#ib_inject_depth_row").hide();
        $("#ib_inject_depth_help").hide();
        return;
    }
    $("#ib_inject_position_row").show();
    // Show depth row only when position is IN_CHAT (1)
    if (gInjectPosition === 1) {
        $("#ib_inject_depth_row").show();
        $("#ib_inject_depth_help").show();
    } else {
        $("#ib_inject_depth_row").hide();
        $("#ib_inject_depth_help").hide();
    }
}

function UpdateSettingsText() {
    $('label[for="ib_enabled"]').html(`<b>${T("enable")}</b>`);
    $('label[for="ib_lang"]').html(`<b>${T("language")}</b>`);
    $('label[for="ib_theme"]').html(`<b>${T("theme")}</b>`);
    $('label[for="ib_bar_style"]').html(`<b>${T("barStyle")}</b>`);
    $('label[for="ib_compact_mode"]').html(`<b>${T("compactMode")}</b>`);
    // ib_pin_storage_mode label removed — tier pins don't use a single mode dropdown
    $('label[for="ib_hide_raw"]').text(T("hideRaw"));
    $('label[for="ib_hide_thought_leaks"]').text(T("hideThoughtLeaks"));
    $('label[for="ib_show_nsfw"]').text(T("showNsfw"));
    $('label[for="ib_hover_fx"]').text(T("hoverFx"));
    $('label[for="ib_use_macro"]').html(`<b>${T("useMacroMode")}</b>`);
    $("#ib_use_macro_help").text(T("useMacroHelp"));
    $("#ib_inject_position_label").html(`<b>${T("injectPosition")}</b>`);
    $("#ib_inject_pos_after").text(T("injectPosAfter"));
    $("#ib_inject_pos_chat").text(T("injectPosChat"));
    $("#ib_inject_pos_before").text(T("injectPosBefore"));
    $('label[for="ib_inject_depth"]').html(`<b>${T("injectDepth")}</b>`);
    $("#ib_inject_depth_help").text(T("injectDepthHelp"));
    $("#ib_state_label").text(T("currentState"));
    $("#ib_reset_state").text("🗑 " + T("resetState"));
    $("#ib_reprocess_chat").text("🔄 " + T("reprocess"));
    $("#ib_export_state").text("📤 " + T("exportState"));
    $("#ib_import_state").text("📥 " + T("importState"));
    $("#ib_custom_css_label").text(T("customCssLabel"));
    $("#ib_custom_css_help").text(T("customCssHelp"));
    $("#ib_save_custom_css").text("💾 " + T("saveCustomCss"));
    $("#ib_clear_custom_css").text("🧹 " + T("clearCustomCss"));
    $("#ib_clean_orphan_snapshots").text("🧹 " + T("cleanOrphanSnapshots"));
    $("#ib_compact_mode option[value='top3']").text(T("compactTop3"));
$("#ib_compact_mode option[value='top1']").text(T("compactTop1"));
$("#ib_compact_mode option[value='changed']").text(T("compactChanged"));
$("#ib_compact_mode option[value='all']").text(T("compactAll"));
    // ib_pin_storage_mode options removed
    // Display modes section
    $("#ib_display_modes_label").text(T("displayModes"));
    $('label[for="ib_display_inline"]').text(T("displayInline"));
    $('label[for="ib_display_floating"]').text(T("displayFloating"));
    $('label[for="ib_display_panel"]').text(T("displayPanel"));
    // Panel position setting
    $('label[for="ib_panel_position"]').html(`<b>${T("panelPosition")}</b>`);
    $("#ib_panel_position option[value='left']").text(T("panelLeft"));
    $("#ib_panel_position option[value='right']").text(T("panelRight"));
    // Board mode subrows
    const boardModeLabels = {
        inline: T("displayInline"),
        floating: T("displayFloating"),
        panel: T("displayPanel")
    };
    const boardModeIds = { inline: "ib_board_mode_inline", floating: "ib_board_mode_floating", panel: "ib_board_mode_panel" };
    for (const [mode, label] of Object.entries(boardModeLabels)) {
        const sel = `#${boardModeIds[mode]}`;
        $(`label[for="${boardModeIds[mode]}"]`).text(`${T("defaultBoardMode")}:`);
        $(`${sel} option[value='full']`).text(T("boardModeFull"));
        $(`${sel} option[value='compact']`).text(T("boardModeCompact"));
        $(`${sel} option[value='collapsed']`).text(T("boardModeCollapsed"));
    }
    // Notifications section
    $("#ib_notif_title_text").text(T("notifications"));
    $('label[for="ib_notifications_enabled"]').text(T("enableNotif"));
    $('label[for="ib_notification_threshold"]').html(`<b>${T("threshold")}</b>`);
    $("#ib_notification_threshold option[value='3']").text(`3 (${T("notifSensitive")})`);
    $("#ib_notification_threshold option[value='5']").text(`5 (${T("notifDefault")})`);
    $("#ib_notification_threshold option[value='10']").text(`10 (${T("notifMajor")})`);
    $("#ib_notification_threshold option[value='20']").text(`20 (${T("notifDramatic")})`);
    UpdateThemePreview();
}

// Функция принимает распарсенные данные и предыдущее состояние, возвращает "пропатченные" данные пинов
function PatchPinnedData(parsed, prevState) {
    const prevChars = prevState?.chars || [];
    const prevRels = prevState?.rels || [];
    const prevThoughts = prevState?.thoughts || [];

    const offscreenTag = T("offscreenTag");

    // --- 1. Обработка персонажей (<chars>) ---
    const newChars = parsed.chars || [];
    const finalChars = [];
    const processedNames = new Set();

    // Обрабатываем тех, кого вернул ИИ
    newChars.forEach(c => {
        let charData = { ...c };
        
        // Логика для ЗАКРЕПЛЕННЫХ (Pinned)
        if (IsPinnedNpc(c.name)) {
            const hasLeftTag = (charData.tags || []).some(t => {
                    const n = NormalizeName(t);
                    return n === "left" || n === "out";
                });
            // Если закрепленный ушел -> меняем на offscreen
            if (charData.presence?.key === "leftScene" || hasLeftTag) {
                charData.tags = (charData.tags || []).filter(t => {
                    const n = NormalizeName(t);
                    return n !== "left" && n !== "out";
                });
                if (!charData.tags.includes(offscreenTag)) {
                    charData.tags.push(offscreenTag);
                }
                charData.presence = { key: "offscreen", cls: "ib-presence-offscreen" };
            }
        }
        // Логика для НЕЗАКРЕПЛЕННЫХ
        else {
            // ВАЖНО: Мы НЕ удаляем их здесь!
            // Мы позволяем им быть 'left', чтобы UI показал "вышел".
            // Удаление произойдет само, когда ИИ перестанет их генерировать (так как мы скрыли их из BuildStateInjection).
        }
        
        finalChars.push(charData);
        processedNames.add(NormalizeName(c.name));
    });

    // Проверяем закрепленных, кого ИИ НЕ вернул (восстановление)
    gPinnedNpcs.forEach(pinName => {
        const normPin = NormalizeName(pinName);
        if (!processedNames.has(normPin)) {
            const oldChar = prevChars.find(ch => NormalizeName(ch.name) === normPin);
            if (oldChar) {
                const restoredTags = [...(oldChar.tags || [])];
                if (!restoredTags.includes(offscreenTag)) {
                    restoredTags.push(offscreenTag);
                }
                finalChars.push({ 
                    ...oldChar, 
                    tags: restoredTags,
                    presence: { key: "offscreen", cls: "ib-presence-offscreen" } 
                });
            } else {
                // Try pin snapshot first — preserves real data across chat switches
                const snapshot = gPinRegistry?.pinSnapshots?.[normPin];
                if (snapshot) {
                    const restoredTags = [...(snapshot.tags || [])];
                    if (!restoredTags.includes(offscreenTag)) {
                        restoredTags.push(offscreenTag);
                    }
                    finalChars.push({
                        icon: snapshot.icon || "•",
                        name: snapshot.name,
                        age: snapshot.age || "",
                        tags: restoredTags,
                        mood: snapshot.mood || "",
                        presence: { key: "offscreen", cls: "ib-presence-offscreen" }
                    });
                } else {
                    // Fallback: try to find the NPC in the current global state (gState)
                    // This preserves imported data (icon, age, tags, mood) that would otherwise be lost
                    const gStateChar = gState.chars?.find(ch => NormalizeName(ch.name) === normPin);
                    if (gStateChar) {
                        const restoredTags = [...(gStateChar.tags || [])];
                        if (!restoredTags.includes(offscreenTag)) {
                            restoredTags.push(offscreenTag);
                        }
                        finalChars.push({
                            ...gStateChar,
                            tags: restoredTags,
                            presence: { key: "offscreen", cls: "ib-presence-offscreen" }
                        });
                    } else {
                        finalChars.push({
                        name: pinName,
                        icon: "📌",
                        age: "",
                        tags: [offscreenTag],
                        mood: "",
                        presence: { key: "offscreen", cls: "ib-presence-offscreen" }
                    });
                }
            }
            }
        }
    });

    // --- 2. Обработка отношений (<rels>) ---
    const newRels = parsed.rels || [];
    const finalRels = [];
    const processedRels = new Set();

    // Просто копируем связи для всех, кто есть в finalChars (включая 'left')
    newRels.forEach(r => {
        finalRels.push(r);
        processedRels.add(NormalizeName(r.source));
    });

    // Восстановление связей для закрепленных
    gPinnedNpcs.forEach(pinName => {
        const normPin = NormalizeName(pinName);
        const charExists = finalChars.some(c => NormalizeName(c.name) === normPin);
        
        if (charExists && !processedRels.has(normPin)) {
            const oldRel = prevRels.find(rel => NormalizeName(rel.source) === normPin);
            if (oldRel) {
                finalRels.push(oldRel);
            } else {
                // Try pin snapshot first — preserves real relation data across chat switches
                const snapshot = gPinRegistry?.pinSnapshots?.[normPin];
                if (snapshot?.rel) {
                    finalRels.push({ ...snapshot.rel });
                } else {
                    // Fallback: try to find the relation in the current global state (gState)
                    // This preserves imported data (status, relationship values) that would otherwise be lost
                    const gStateRel = gState.rels?.find(rel => NormalizeName(rel.source) === normPin);
                    if (gStateRel) {
                        finalRels.push(gStateRel);
                    } else {
                        finalRels.push({
                            source: pinName,
                            target: GetUserName(),
                            a: 0, ac: 0, tr: 0, tc: 0, l: 0, lc: 0,
                            status: T("noStatus")
                        });
                    }
                }
            }
        }
    });

    // --- 3. Обработка мыслей (<thoughts>) ---
    const finalThoughts = parsed.thoughts ? [...parsed.thoughts] : [];
    const thoughtNames = new Set(finalThoughts.map(t => NormalizeName(t.name)));
    
    gPinnedNpcs.forEach(pinName => {
        const normPin = NormalizeName(pinName);
        const charExists = finalChars.some(c => NormalizeName(c.name) === normPin);
        
        if (charExists && !thoughtNames.has(normPin)) {
            const oldThought = prevThoughts.find(t => NormalizeName(t.name) === normPin);
            if (oldThought) {
                finalThoughts.push(oldThought);
            } else {
                // Try pin snapshot first — preserves real thought data across chat switches
                const snapshot = gPinRegistry?.pinSnapshots?.[normPin];
                if (snapshot?.thought) {
                    finalThoughts.push({ ...snapshot.thought });
                } else {
                    // Fallback: try to find the thought in the current global state (gState)
                    const gStateThought = gState.thoughts?.find(t => NormalizeName(t.name) === normPin);
                    if (gStateThought) finalThoughts.push(gStateThought);
                }
            }
        }
    });

    return {
        ...parsed,
        chars: finalChars,
        rels: finalRels,
        thoughts: finalThoughts
    };
}

function UpdateRollingState(state, patched) {
    if (patched.time) state.time = patched.time;
    if (patched.date) state.date = patched.date;
    if (patched.weather) state.weather = patched.weather;
    if (patched.loc) state.loc = patched.loc;
    if (patched.chars) state.chars = patched.chars;
    if (patched.rels) state.rels = patched.rels;
    if (patched.thoughts) state.thoughts = patched.thoughts;
    state.nsfw = patched.nsfw || null;
}

function ApplyParsedToState(parsed, msgIndex) {
    if (parsed.rawXml) {
        gLastRawXml = parsed.rawXml;
        if (msgIndex !== undefined) gLastRawXmlMsgIndex = msgIndex;
    }
    
    // Сохраняем предыдущие отношения для уведомлений
    const prevRels = structuredClone(gState.rels || []);

    // Применяем патч закрепленных персонажей (используем gState как предыдущее состояние)
    const patched = PatchPinnedData(parsed, gState);

    // Обновляем глобальное состояние
    UpdateRollingState(gState, patched);
    
    // Добавляем запись в таймлайн
    AddTimelineEntry(gState.rels);
    
    // Проверяем значимые изменения для уведомлений
    CheckAndNotifyChanges(prevRels, gState.rels);
}

function AutoScrollThoughts(boardEl) {
    if (!boardEl) return;
    const thoughtsScroll = boardEl.querySelector(".ib-thoughts-list[data-ib-autoscroll], .ib-thoughts-scroll[data-ib-autoscroll]");
    if (thoughtsScroll) {
        requestAnimationFrame(() => {
            thoughtsScroll.scrollTop = thoughtsScroll.scrollHeight;
        });
    }
}

function ForceRepaint(el) {
    if (!el) return;
    requestAnimationFrame(() => {
        el.style.transform = "translateZ(0)";
        void el.offsetHeight;
        requestAnimationFrame(() => {
            el.style.transform = "";
        });
    });
}

function RenderBoardIntoMessage(mesTextEl, parsed, isFresh, prevState, skipCleanup = false) {
    if (!mesTextEl || !parsed) return;

    // When called from _chunkedBoardRender (skipCleanup=true), cleanup is already done
    // in Phase 2a. When called from other code paths, we do a single cleanup pass here.
    if (!skipCleanup) {
        CleanupRawInfoboardDom(mesTextEl);
        RemoveRawXmlFromText(mesTextEl);

        if (gHideThoughtLeaks) {
            RemoveThoughtLeaksInContainer(mesTextEl, parsed);
        }

        CleanupEmptyMessageNodes(mesTextEl);
    }

    if (!ShouldRenderInlineBoard()) {
        const existingHost = mesTextEl.querySelector(".ib-board-host");
        if (existingHost) existingHost.remove();

        if (!skipCleanup) {
            CleanupBoardHosts(mesTextEl);
            CleanupEmptyMessageNodes(mesTextEl);
        }
        return;
    }

    const host = GetOrCreateBoardHost(mesTextEl);
    host.dataset.rawXml = parsed.rawXml || gLastRawXml || "";
    host.innerHTML = RenderBoard(parsed, isFresh, prevState);

    const boardEl = host.firstElementChild;
    if (boardEl) {
        WireBoardControls(boardEl, prevState);
        ForceRepaint(boardEl);

        // Auto-scroll thoughts section to bottom
        AutoScrollThoughts(boardEl);
    }

    CleanupBoardHosts(mesTextEl);
    CleanupEmptyMessageNodes(mesTextEl);
}

function ReprocessChat() {
    InvalidateAliasCache();
    const stContext = SillyTavern.getContext();
    if (!stContext.chat) {
        // Even without an active chat (e.g. new empty chat), still refresh the UI
        // so that pin level changes and snapshot-based NPCs appear correctly.
        UpdateStatusDisplay();
        UpdateLastUpdateDisplay();
        RenderFloatingBoard();
        RenderPanelBoard();
        return;
    }

    // Save previous rels for notification comparison
    const prevRels = structuredClone(gState.rels || []);

    let rollingState = structuredClone(kDefaultState);

    // Clear timeline and rebuild from chat history
    gTimeline = [];

    // ═══ Phase 1: Compute state (sync, no DOM writes) ═══
    // Parse all messages and compute rolling state without touching the DOM.
    // This is fast — the heavy work is DOM manipulation in Phase 2.
    const renderQueue = [];

    document.querySelectorAll(".mes").forEach(node => {
        const msgId = Number(node.getAttribute("mesid"));
        if (isNaN(msgId)) return;

        const stMsg = stContext.chat[msgId];
        if (!stMsg || stMsg.is_user) return;

        const parsed = ParseInfoboard(stMsg.mes || "");
        const mesTextEl = node.querySelector(".mes_text");
        if (!mesTextEl) return;

        if (!parsed) {
            // Try to extract raw thought lines from broken XML for leak cleanup
            const rawThoughts = ExtractRawThoughts(stMsg.mes || "");
            renderQueue.push({ type: "noBoard", mesTextEl, rawThoughts });
            return;
        }

        const prevState = structuredClone(rollingState);
        const patchedParsed = PatchPinnedData(parsed, rollingState);

        if (parsed.rawXml) {
            gLastRawXml = parsed.rawXml;
            gLastRawXmlMsgIndex = msgId;
        }

        UpdateRollingState(rollingState, patchedParsed);

        // Add timeline entry for each parsed infoboard block
        if (rollingState.rels && rollingState.rels.length) {
            const entry = {
                ts: Date.now(),
                msgIndex: msgId,
                gameTime: rollingState.time || "",
                gameDate: rollingState.date || "",
                rels: rollingState.rels.map(r => ({
                    source: r.source,
                    a: r.a, tr: r.tr, l: r.l,
                    status: r.status
                }))
            };
            // Only add if something changed compared to last entry
            const last = gTimeline[gTimeline.length - 1];
            const same = last && RelsEqual(last.rels, entry.rels);
            if (!same) {
                gTimeline.push(entry);
            }
        }

        renderQueue.push({ type: "board", mesTextEl, parsed, patchedParsed, prevState });
    });

    // Finalize state (sync — gState is now correct even before DOM renders)
    if (gTimeline.length > 200) gTimeline = gTimeline.slice(-200);
    SaveTimeline();

    gState = rollingState;
    SaveState();

    // Update non-DOM displays immediately (these don't need DOM rendering)
    CheckAndNotifyChanges(prevRels, gState.rels);
    UpdateStatusDisplay();
    UpdateLastUpdateDisplay();

    // ═══ Phase 2a: Synchronous cleanup of ALL messages ═══
    // Removes raw XML, thought leaks, and stale board hosts in one batch.
    // Browser performs a single layout recalc after — eliminates CLS from
    // "raw XML visible → removed" per-chunk shifts.
    _syncCleanupAll(renderQueue);

    // ═══ Phase 2b: Floating & Panel boards (immediate) ═══
    // These are single-board renders — always update first so the user
    // sees the latest state right away, without waiting for inline chunks.
    RenderFloatingBoard();
    RenderPanelBoard();

    // ═══ Phase 2c: Chunked inline board render (reverse order) ═══
    // Only render inline boards when inline mode is enabled.
    // Reverse order ensures the visible last message is rendered first,
    // minimizing perceived lag and CLS for on-screen content.
    // Old boards use unpinned data (parsed), only the latest board shows pinned NPCs.
    // Only the last MAX_INLINE_BOARDS boards are rendered — older ones just get cleanup.
    if (ShouldRenderInlineBoard()) {
        const MAX_INLINE_BOARDS = gInlineBoardCount;
        const allBoardItems = renderQueue.filter(q => q.type === "board");
        // Take only the last N boards (most recent messages)
        const boardItems = allBoardItems.slice(-MAX_INLINE_BOARDS);
        // Mark the latest board (last in forward order = first after reverse)
        if (boardItems.length > 0) {
            boardItems[boardItems.length - 1].isLatest = true;
        }
        boardItems.reverse();
        _chunkedBoardRender(boardItems);
    }
}

/**
 * Phase 2a: Synchronous cleanup of ALL messages in the render queue.
 * Removes raw XML, thought leaks, and stale board hosts.
 * Runs as a single synchronous batch — browser performs ONE layout recalc after.
 */
function _syncCleanupAll(queue) {
    for (const item of queue) {
        // 1. Remove custom XML elements (infoboard, chars, rels, c, rel, thk, nsfw)
        CleanupRawInfoboardDom(item.mesTextEl);

        // 2. Remove raw XML from text nodes
        RemoveRawXmlFromText(item.mesTextEl);

        // 3. Remove thought leaks
        if (item.type === "noBoard") {
            // Broken XML — use simple text matching fallback
            if (gHideThoughtLeaks && item.rawThoughts) {
                RemoveLeakedThoughtsFromBrokenXml(item.mesTextEl, item.rawThoughts);
            }
        } else {
            // Valid infoboard — use parsed data for precise matching
            if (gHideThoughtLeaks) {
                RemoveThoughtLeaksInContainer(item.mesTextEl, item.patchedParsed);
            }
        }

        // 4. Remove stale board host — will be re-created by RenderBoardIntoMessage
        //    if inline mode is on, otherwise stays removed
        const host = item.mesTextEl.querySelector(".ib-board-host");
        if (host) host.remove();

        // 5. Remove orphaned empty text nodes
        CleanupEmptyMessageNodes(item.mesTextEl);
    }
}

// --- Chunked board renderer for ReprocessChat Phase 2b ---
// Only renders inline boards. Cleanup is already done in Phase 2a.
// Processes messages in reverse order (last message first) so the
// visible area updates before off-screen messages.
const RENDER_CHUNK_SIZE = 8;
let _renderQueueId = 0;

function _chunkedBoardRender(boardItems) {
    const queueId = ++_renderQueueId;
    let i = 0;

    function processChunk() {
        // If a newer ReprocessChat started, abandon this render queue
        if (queueId !== _renderQueueId) return;

        const end = Math.min(i + RENDER_CHUNK_SIZE, boardItems.length);

        for (; i < end; i++) {
            const item = boardItems[i];
            // Latest board shows pinned NPCs (patchedParsed), old boards show only
            // what the AI originally returned (parsed) — no pinned data injected
            const displayParsed = item.isLatest ? item.patchedParsed : item.parsed;
            // skipCleanup=true — Phase 2a already cleaned up this message
            RenderBoardIntoMessage(item.mesTextEl, displayParsed, true, item.prevState, true);
        }

        if (i < boardItems.length) {
            // More messages to render — yield to browser for input handling & painting
            requestAnimationFrame(processChunk);
        }
    }

    // Process first chunk synchronously (for immediate visual feedback)
    processChunk();
}

function Debounce(fn, delay = 250) {
    let timer = null;

    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

const ScheduleReprocessChat = Debounce(() => ReprocessChat(), 250);

function RebuildStateFromCurrentChat() {
    InvalidateAliasCache();
    const stContext = SillyTavern.getContext();

    let rollingState = structuredClone(kDefaultState);
    let lastRawXml = "";
    let lastRawXmlMsgIndex = -1;

    if (!Array.isArray(stContext.chat)) {
        gState = rollingState;
        SaveState();
        return;
    }

    for (let i = 0; i < stContext.chat.length; i++) {
        const msg = stContext.chat[i];
        if (!msg || msg.is_user) continue;

        const parsed = ParseInfoboard(msg.mes || "");
        if (!parsed) continue;

        if (parsed.rawXml) {
            lastRawXml = parsed.rawXml;
            lastRawXmlMsgIndex = i;
        }

        // Патчим данные текущего сообщения, чтобы показать закрепленных
        // (передаем rollingState, так как это контекст предыдущих сообщений)
        const patchedParsed = PatchPinnedData(parsed, rollingState);

        // Обновляем "катящееся" состояние для следующих сообщений
        UpdateRollingState(rollingState, patchedParsed);

    };

    gState = rollingState;

    if (lastRawXml) {
        gLastRawXml = lastRawXml;
        gLastRawXmlMsgIndex = lastRawXmlMsgIndex;
    }

    SaveState();
}

async function OnChatChanged() {
    gPreSwipeState = null; // Clear pre-swipe state on chat change
    LoadState();
    LoadTimeline();
    LoadPinnedNpcs(true);  // force reload from localStorage to recover from init-time corruption
    MigrateOldPinsToRegistry();
    CleanPinRegistry();
    UpdateSettingsText();
    UpdateStatusDisplay();
    UpdateLastUpdateDisplay();

    if (!gEnabled) return;

ScheduleReprocessChat();
}

function UpdateStatusDisplay() {
    const $status = $("#ib_status");
    const $summary = $("#ib_state_summary");

    if (gEnabled) {
        $status.html(`<span style="color:#7fb68a">${EscapeHtml(T("active"))}</span>`);
        // Use merged state to show pinned NPCs from snapshots too
        const merged = GetMergedStateForRendering();
        $summary.html(
            `${EscapeHtml(gState.time)} | ${EscapeHtml(gState.date)}<br>` +
            `${EscapeHtml(gState.weather)}<br>` +
            `📍 ${EscapeHtml(gState.loc)}<br>` +
            `${EscapeHtml(T("stateNpcLabel"))}: ${merged.chars.map(c => EscapeHtml(c.name)).join(", ") || "—"}`
        );
    } else {
        $status.html(`<span style="color:#888">${EscapeHtml(T("inactive"))}</span>`);
        $summary.text(T("disabledPrompt"));
    }
}

function ExportState() {
    try {
        const exportData = {
            version: 3,
            state: gState,
            settings: {
                theme: gTheme,
                barStyle: gBarStyle,
                lang: gLang,
                hideRaw: gHideRaw,
                showNsfw: gShowNsfw,
                hoverFx: gHoverFx,
                hideThoughtLeaks: gHideThoughtLeaks,
                compactMode: gCompactMode,
                displayMode: gDisplayMode, // legacy compat
                displayInline: gDisplayInline,
                displayFloating: gDisplayFloating,
                displayPanel: gDisplayPanel,
                customCss: gCustomCss,
                notificationsEnabled: gNotificationsEnabled,
                notificationThreshold: gNotificationThreshold,
                panelWidth: gPanelWidth,
                panelPosition: gPanelPosition,
                defaultBoardModeInline: gDefaultBoardModeInline,
                defaultBoardModeFloating: gDefaultBoardModeFloating,
                defaultBoardModePanel: gDefaultBoardModePanel,
                inlineBoardCount: gInlineBoardCount
            },
            timeline: gTimeline,
            pinnedNpcs: gPinnedNpcs,
            pinRegistry: gPinRegistry
        };
        const data = JSON.stringify(exportData, null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `infoboard-full-backup-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);

        ShowNotification(
            T("exportComplete"),
            T("allDataExported"),
            'info'
        );
    } catch (e) {
        console.error("[IB] Export failed:", e);
    }
}

async function ImportStateFromFile(file) {
    if (!file) return;

    try {
        const text = await file.text();
        const parsed = JSON.parse(text);

        // Detect version: v3 format has a "version" field
        if (parsed.version === 3) {
            // Full backup restore
            if (parsed.state) {
                gState = {
                    ...structuredClone(kDefaultState),
                    ...parsed.state,
                    chars: Array.isArray(parsed.state.chars) ? parsed.state.chars : [],
                    rels: Array.isArray(parsed.state.rels) ? parsed.state.rels : [],
                    thoughts: Array.isArray(parsed.state.thoughts) ? parsed.state.thoughts : []
                };
                SaveState();
            }

            if (parsed.settings) {
                const s = parsed.settings;
                if (s.theme !== undefined) { gTheme = s.theme; localStorage.setItem(kThemeKey, gTheme); }
                if (s.barStyle !== undefined) { gBarStyle = s.barStyle; localStorage.setItem(kBarStyleKey, gBarStyle); }
                if (s.lang !== undefined) { gLang = s.lang; localStorage.setItem(kLangKey, gLang); }
                if (s.hideRaw !== undefined) { gHideRaw = s.hideRaw; localStorage.setItem(kHideRawKey, String(gHideRaw)); }
                if (s.showNsfw !== undefined) { gShowNsfw = s.showNsfw; localStorage.setItem(kShowNsfwKey, String(gShowNsfw)); }
                if (s.hoverFx !== undefined) { gHoverFx = s.hoverFx; localStorage.setItem(kHoverFxKey, String(gHoverFx)); }
                if (s.hideThoughtLeaks !== undefined) { gHideThoughtLeaks = s.hideThoughtLeaks; localStorage.setItem(kHideThoughtLeaksKey, String(gHideThoughtLeaks)); }
                if (s.compactMode !== undefined) { gCompactMode = s.compactMode; localStorage.setItem(kCompactModeKey, gCompactMode); }
                if (s.displayMode !== undefined) {
                    // Legacy: migrate from old displayMode to new boolean flags
                    gDisplayMode = s.displayMode;
                    localStorage.setItem(kDisplayModeKey, gDisplayMode);
                    MigrateDisplayMode();
                }
                // New per-mode flags (override legacy)
                if (s.displayInline !== undefined) { gDisplayInline = !!s.displayInline; localStorage.setItem(kDisplayInlineKey, String(gDisplayInline)); }
                if (s.displayFloating !== undefined) { gDisplayFloating = !!s.displayFloating; localStorage.setItem(kDisplayFloatingKey, String(gDisplayFloating)); }
                if (s.displayPanel !== undefined) { gDisplayPanel = !!s.displayPanel; localStorage.setItem(kDisplayPanelKey, String(gDisplayPanel)); }
                if (s.customCss !== undefined) { gCustomCss = s.customCss; localStorage.setItem(kCustomCssKey, gCustomCss); ApplyCustomCss(); }
                if (s.notificationsEnabled !== undefined) { gNotificationsEnabled = s.notificationsEnabled; localStorage.setItem(kNotificationsEnabledKey, String(gNotificationsEnabled)); }
                if (s.notificationThreshold !== undefined) { gNotificationThreshold = s.notificationThreshold; localStorage.setItem(kNotificationThresholdKey, String(gNotificationThreshold)); }
                if (s.panelWidth !== undefined) { gPanelWidth = s.panelWidth; localStorage.setItem(kPanelWidthKey, String(gPanelWidth)); }
                if (s.panelPosition !== undefined) { gPanelPosition = s.panelPosition; localStorage.setItem(kPanelPositionKey, gPanelPosition); }
                if (s.defaultBoardMode !== undefined) {
                    // Legacy: single setting → apply to all
                    gDefaultBoardModeInline = s.defaultBoardMode;
                    gDefaultBoardModeFloating = s.defaultBoardMode;
                    gDefaultBoardModePanel = s.defaultBoardMode;
                    gCurrentBoardModeInline = gDefaultBoardModeInline;
                    gCurrentBoardModeFloating = gDefaultBoardModeFloating;
                    gCurrentBoardModePanel = gDefaultBoardModePanel;
                    localStorage.setItem(kDefaultBoardModeInlineKey, gDefaultBoardModeInline);
                    localStorage.setItem(kDefaultBoardModeFloatingKey, gDefaultBoardModeFloating);
                    localStorage.setItem(kDefaultBoardModePanelKey, gDefaultBoardModePanel);
                }
                if (s.defaultBoardModeInline !== undefined) { gDefaultBoardModeInline = s.defaultBoardModeInline; gCurrentBoardModeInline = gDefaultBoardModeInline; localStorage.setItem(kDefaultBoardModeInlineKey, gDefaultBoardModeInline); }
                if (s.defaultBoardModeFloating !== undefined) { gDefaultBoardModeFloating = s.defaultBoardModeFloating; gCurrentBoardModeFloating = gDefaultBoardModeFloating; localStorage.setItem(kDefaultBoardModeFloatingKey, gDefaultBoardModeFloating); }
                if (s.defaultBoardModePanel !== undefined) { gDefaultBoardModePanel = s.defaultBoardModePanel; gCurrentBoardModePanel = gDefaultBoardModePanel; localStorage.setItem(kDefaultBoardModePanelKey, gDefaultBoardModePanel); }
                if (s.inlineBoardCount !== undefined) { gInlineBoardCount = Math.max(1, Math.min(99, parseInt(s.inlineBoardCount) || 5)); localStorage.setItem(kInlineBoardCountKey, String(gInlineBoardCount)); gInlineBoardCountSaved = gInlineBoardCount; }

                // Update UI controls
                $("#ib_theme").val(gTheme);
                $("#ib_bar_style").val(gBarStyle);
                $("#ib_lang").val(gLang);
                $("#ib_hide_raw").prop("checked", gHideRaw);
                $("#ib_show_nsfw").prop("checked", gShowNsfw);
                $("#ib_hover_fx").prop("checked", gHoverFx);
                $("#ib_hide_thought_leaks").prop("checked", gHideThoughtLeaks);
                $("#ib_compact_mode").val(gCompactMode);
                // ib_pin_storage_mode dropdown removed
                $("#ib_display_inline").prop("checked", gDisplayInline);
                $("#ib_display_floating").prop("checked", gDisplayFloating);
                $("#ib_display_panel").prop("checked", gDisplayPanel);
                $("#ib_board_mode_inline").val(gDefaultBoardModeInline);
                $("#ib_inline_board_count").val(gInlineBoardCount);
                $("#ib_board_mode_floating").val(gDefaultBoardModeFloating);
                $("#ib_board_mode_panel").val(gDefaultBoardModePanel);
                $("#ib_panel_position").val(gPanelPosition);
                UpdateBoardModeVisibility();
                $("#ib_custom_css").val(gCustomCss);
                $("#ib_notifications_enabled").prop("checked", gNotificationsEnabled);
                $("#ib_notification_threshold").val(gNotificationThreshold);
            }

            if (Array.isArray(parsed.timeline)) {
                gTimeline = parsed.timeline;
                SaveTimeline();
            }

            if (Array.isArray(parsed.pinnedNpcs)) {
                // Legacy: migrate flat pinnedNpcs array to perChat tier
                const chatId = GetChatId();
                if (!gPinRegistry.chats) gPinRegistry.chats = {};
                gPinRegistry.chats[chatId] = [...parsed.pinnedNpcs];
                gPinnedNpcs = ResolveActivePins();
                SavePinRegistry(gPinRegistry);
            }

            // v4/v5: full pin registry restore
            if (parsed.pinRegistry && typeof parsed.pinRegistry === "object") {
                gPinRegistry = { ...GetDefaultPinRegistry(), ...parsed.pinRegistry };
                // Migration: remove legacy `mode` field if present
                if (gPinRegistry.mode) delete gPinRegistry.mode;
                gPinnedNpcs = ResolveActivePins();
                SavePinRegistry(gPinRegistry);
            }

            UpdateSettingsText();
        } else {
            // Legacy v1/v2 format: just state data
            gState = {
                ...structuredClone(kDefaultState),
                ...parsed,
                chars: Array.isArray(parsed.chars) ? parsed.chars : [],
                rels: Array.isArray(parsed.rels) ? parsed.rels : [],
                thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : []
            };
            SaveState();
        }

        UpdateStatusDisplay();
        UpdateLastUpdateDisplay();
        RenderFloatingBoard();
        RenderPanelBoard();
        // NOTE: Do NOT call ReprocessChat() here — it would rebuild gState from
        // chat messages and overwrite the imported state (including status values).
        // The imported state is authoritative and should be preserved as-is.

        ShowNotification(
            T("importComplete"),
            T("dataRestored"),
            'info'
        );
    } catch (e) {
        console.error("[IB] Import failed:", e);
        alert(T("importFail"));
    }
}

// ============== Fallback Prompt Injection ==============
// Used when the macro system is unavailable (e.g. ST 1.13+ with changed API)
function RegisterFallbackPromptInjection(stContext) {
    if (!stContext?.eventSource || !stContext?.eventTypes) {
        console.warn("[IB] No event system available for fallback injection");
        return;
    }

    // Inject via GENERATION_STARTED event (legacy approach)
    if (stContext.eventTypes.GENERATION_STARTED) {
        stContext.eventSource.on(stContext.eventTypes.GENERATION_STARTED, () => {
            if (!gEnabled) return;
            try {
                const systemPrompt = gLang === "en" ? kSystemPromptEn : kSystemPromptRu;
                const stateBlock = BuildStateInjection();
                const fullPrompt = `${systemPrompt}\n\n${stateBlock}`;

                // Try to set the extension prompt via SillyTavern's setExtensionPrompt
                if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                    const ctx = SillyTavern.getContext();
                    if (ctx.setExtensionPrompt) {
                        ctx.setExtensionPrompt('InfoBoard', fullPrompt, gInjectPosition, gInjectDepth, true);
                    }
                }
            } catch (e) {
                console.warn("[IB] Fallback prompt injection failed:", e?.message);
            }
        });
        console.log("[IB] Registered fallback prompt injection via GENERATION_STARTED");
    } else {
        console.warn("[IB] GENERATION_STARTED event not available — prompt injection disabled");
    }
}

function OnDisplayModeChange() {
    // Update board visibility based on checkboxes
    if (!gDisplayFloating) RemoveFloatingBoard();
    if (!gDisplayPanel) RemovePanelMode();
    if (gDisplayFloating) RenderFloatingBoard();
    if (gDisplayPanel) RenderPanelBoard();

    UpdateBoardModeVisibility();
    ReprocessChat();
}

jQuery(async () => {
    const stContext = SillyTavern.getContext();

    try {
        const settingsHtml = await $.get(kSettingsFile + `?t=${Date.now()}`);
        const $extensions = $("#extensions_settings");
        const $existing = $extensions.find(".ib-settings");
        if ($existing.length > 0) {
            $existing.replaceWith(settingsHtml);
        } else {
            $extensions.append(settingsHtml);
        }
    } catch (e) {
        console.warn("[IB] settings.html not loaded, using inline fallback:", e?.status || e);
        // Fallback: create minimal settings panel inline so the extension
        // still appears in the extensions tab even if settings.html 404s
        const $extensions = $("#extensions_settings");
        if ($extensions.find(".ib-settings").length === 0) {
            $extensions.append(`
<div class="ib-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Infoboard</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="ib-setting-row">
                <input type="checkbox" id="ib_enabled" />
                <label for="ib_enabled"><b>Enable Infoboard</b></label>
            </div>
            <div class="ib-setting-row">
                <input type="checkbox" id="ib_use_macro" />
                <label for="ib_use_macro" id="ib_use_macro_label"><b>Macro mode {{InfoBoard}}</b></label>
            </div>
            <div class="ib-custom-css-help" id="ib_use_macro_help" style="margin-top: -6px; margin-bottom: 6px;">
                When on: prompt is injected via {{InfoBoard}} macro. When off (default): auto-inject.
            </div>
            <div class="ib-setting-row">
                <label for="ib_lang"><b>Language</b></label>
                <select id="ib_lang">
                    <option value="ru">Русский</option>
                    <option value="en">English</option>
                </select>
            </div>
            <div class="ib-setting-row">
                <label for="ib_theme"><b>Theme</b></label>
                <select id="ib_theme">
                    <option value="nocturne">🌙 Nocturne</option>
                    <option value="burgundy">🍷 Burgundy</option>
                    <option value="ashrose">🌸 Ash Rose</option>
                    <option value="coldsteel">🩶 Cold Steel</option>
                    <option value="frostwhite">🧊 Frostwhite</option>
                    <option value="pixel">🕹 Pixel Arcade</option>
                    <option value="pinkbite">💗 Pink Bite</option>
                    <option value="violetglass">🟣 Violet Glass</option>
                    <option value="verdantgrove">🌿 Verdant Grove</option>
                    <option value="sandalwood">🟤 Sandalwood</option>
                    <option value="gengar">👻 Gengar</option>
                    <option value="systemlog">💠 System Log</option>
                    <option value="terminal">🟩 Terminal</option>
                    <option value="oraclemoon">🌙 Oracle Moon</option>
                    <option value="bloodmoon">🩸 Blood Moon</option>
                    <option value="casefile">🕵️ Case File</option>
                    <option value="obsidianregistry">🗝 Obsidian Registry</option>
                    <option value="neonquest">🤖 Neon Quest</option>
                    <option value="shockwave">🟣 Shockwave</option>
                    <option value="lockdown">🎯 Lockdown</option>
                    <option value="hotrod">🔥 Hot Rod</option>
                    <option value="gryffindor">🦁 Gryffindor</option>
                    <option value="slytherin">🐍 Slytherin</option>
                    <option value="ravenclaw">🦅 Ravenclaw</option>
                    <option value="hufflepuff">🦡 Hufflepuff</option>
                </select>
            </div>
            <div class="ib-theme-preview" id="ib_theme_preview">
                <div class="ib-theme-preview-swatches">
                    <span class="ib-swatch ib-swatch-bg" title="Background"></span>
                    <span class="ib-swatch ib-swatch-bg2" title="Surface"></span>
                    <span class="ib-swatch ib-swatch-accent" title="Accent"></span>
                    <span class="ib-swatch ib-swatch-accent2" title="Accent 2"></span>
                    <span class="ib-swatch ib-swatch-text" title="Text"></span>
                    <span class="ib-swatch ib-swatch-danger" title="Danger"></span>
                </div>
                <div class="ib-theme-preview-label" id="ib_theme_preview_label">Palette preview</div>
            </div>
            <div class="ib-setting-row">
                <label for="ib_bar_style"><b>Bar Style</b></label>
                <select id="ib_bar_style">
                    <option value="classic">Classic</option>
                    <option value="deep">Deep Neon</option>
                    <option value="glass">Glass Needle</option>
                    <option value="soft">Soft Matte</option>
                    <option value="pixel">Pixel Blocks</option>
                    <option value="candy">Candy Gloss</option>
                    <option value="prism">Prism Glass</option>
                    <option value="neon">Neon Rails</option>
                    <option value="terminal">Terminal Segments</option>
                    <option value="hearts">Heart Meter</option>
                    <option value="constellation">Constellation Stars</option>
                    <option value="vials">Vials</option>
                    <option value="evidence">Evidence Tape</option>
                    <option value="runic">Runic Shards</option>
                    <option value="sigil">Sigil Bands</option>
                    <option value="energon">Energon</option>
                </select>
            </div>
            <div class="ib-setting-row">
                <label for="ib_compact_mode"><b>Relationship Filter</b></label>
                <select id="ib_compact_mode">
                    <option value="top3">Top 3</option>
                    <option value="top1">Top 1</option>
                    <option value="changed">Changed only</option>
                    <option value="all">All</option>
                </select>
            </div>
            <div class="ib-display-modes-section">
                <div class="ib-setting-row ib-section-label">
                    <b id="ib_display_modes_label">Display Modes</b>
                </div>
                <div class="ib-display-mode-item" data-mode="inline">
                    <div class="ib-setting-row">
                        <input type="checkbox" id="ib_display_inline" />
                        <label for="ib_display_inline" id="ib_display_inline_label">Inline</label>
                        <span class="ib-inline-count-wrap" id="ib_inline_board_count_row" style="display:none">
                            <div class="ib-depth-input-wrap ib-depth-input-compact">
                                <button type="button" class="ib-depth-btn ib-depth-btn-compact ib-depth-minus" id="ib_board_count_minus">−</button>
                                <input type="number" id="ib_inline_board_count" min="1" max="99" value="5" class="ib-depth-field ib-depth-field-compact" />
                                <button type="button" class="ib-depth-btn ib-depth-btn-compact ib-depth-plus" id="ib_board_count_plus">+</button>
                            </div>
                        </span>
                        <span class="ib-inline-mode-wrap" id="ib_subrow_inline" style="display:none">
                            <label for="ib_board_mode_inline" id="ib_board_mode_inline_label">Default:</label>
                            <select id="ib_board_mode_inline">
                                <option value="full">Full</option>
                                <option value="compact">Compact</option>
                                <option value="collapsed">Collapsed</option>
                            </select>
                        </span>
                    </div>
                </div>
                <div class="ib-display-mode-item" data-mode="floating">
                    <div class="ib-setting-row">
                        <input type="checkbox" id="ib_display_floating" />
                        <label for="ib_display_floating" id="ib_display_floating_label">Floating</label>
                    </div>
                    <div class="ib-board-mode-subrow" id="ib_subrow_floating">
                        <label for="ib_board_mode_floating" id="ib_board_mode_floating_label">Default:</label>
                        <select id="ib_board_mode_floating">
                            <option value="full">Full</option>
                            <option value="compact">Compact</option>
                            <option value="collapsed">Collapsed</option>
                        </select>
                    </div>
                </div>
                <div class="ib-display-mode-item" data-mode="panel">
                    <div class="ib-setting-row">
                        <input type="checkbox" id="ib_display_panel" />
                        <label for="ib_display_panel" id="ib_display_panel_label">Panel</label>
                    </div>
                    <div class="ib-board-mode-subrow" id="ib_subrow_panel">
                        <label for="ib_board_mode_panel" id="ib_board_mode_panel_label">Default:</label>
                        <select id="ib_board_mode_panel">
                            <option value="full">Full</option>
                            <option value="compact">Compact</option>
                            <option value="collapsed">Collapsed</option>
                        </select>
                    </div>
                    <div class="ib-board-mode-subrow" id="ib_subrow_panel_position">
                        <label for="ib_panel_position" id="ib_panel_position_label">Side:</label>
                        <select id="ib_panel_position">
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="ib-setting-row">
                <input type="checkbox" id="ib_hover_fx" />
                <label for="ib_hover_fx">Enable stat hover effects</label>
            </div>
            <div class="ib-setting-row">
                <input type="checkbox" id="ib_hide_raw" />
                <label for="ib_hide_raw">Hide raw XML from messages</label>
            </div>
            <div class="ib-setting-row">
                <input type="checkbox" id="ib_hide_thought_leaks" />
                <label for="ib_hide_thought_leaks">Hide leaked NPC thoughts from visible text</label>
            </div>
            <div class="ib-setting-row">
                <input type="checkbox" id="ib_show_nsfw" />
                <label for="ib_show_nsfw">Show NSFW section</label>
            </div>
            <div class="ib-notification-settings">
                <div class="ib-notif-title">🔔 <b id="ib_notif_title_text">Notifications</b></div>
                <div class="ib-setting-row">
                    <input type="checkbox" id="ib_notifications_enabled" />
                    <label for="ib_notifications_enabled">Enable notifications</label>
                </div>
                <div class="ib-setting-row">
                    <label for="ib_notification_threshold"><b>Threshold</b></label>
                    <select id="ib_notification_threshold">
                        <option value="3">3 (Sensitive)</option>
                        <option value="5">5 (Default)</option>
                        <option value="10">10 (Major only)</option>
                        <option value="20">20 (Dramatic only)</option>
                    </select>
                </div>
            </div>
            <div id="ib_status" class="ib-status">Extension is inactive.</div>
            <div id="ib_last_update" class="ib-last-update">No recent updates.</div>
            <div id="ib_state_display" class="ib-state-display">
                <b id="ib_state_label">Current State:</b>
                <div id="ib_state_summary" class="ib-state-summary">No state loaded.</div>
            </div>
            <div class="ib-button-row">
                <div class="menu_button" id="ib_reset_state">🗑 Reset State</div>
                <div class="menu_button" id="ib_reprocess_chat">🔄 Reprocess Chat</div>
            </div>
            <div class="ib-button-row">
                <div class="menu_button" id="ib_export_state">📤 Export All</div>
                <div class="menu_button" id="ib_import_state">📥 Import All</div>
            </div>
            <div class="ib-custom-css-wrap">
                <label for="ib_custom_css"><b id="ib_custom_css_label">Custom CSS Overrides</b></label>
                <textarea id="ib_custom_css" class="text_pole" rows="10" placeholder=".ib-board { border-radius: 20px; }"></textarea>
                <div class="ib-custom-css-help" id="ib_custom_css_help">Applied after built-in styles. Use to override colors, spacing, bars, or any Infoboard classes.</div>
                <div class="ib-button-row">
                    <div class="menu_button" id="ib_save_custom_css">💾 Save Custom CSS</div>
                    <div class="menu_button" id="ib_clear_custom_css">🧹 Clear Custom CSS</div>
                </div>
            </div>
            <input type="file" id="ib_import_file" accept=".json,application/json" style="display:none;" />
        </div>
    </div>
</div>`);
        }
    }

    gEnabled = localStorage.getItem(kEnabledKey) === "true";
    gTheme = localStorage.getItem(kThemeKey) || "nocturne";
    gHideRaw = localStorage.getItem(kHideRawKey) !== "false";
    gShowNsfw = localStorage.getItem(kShowNsfwKey) !== "false";
    gLang = localStorage.getItem(kLangKey) || "ru";
    gBarStyle = localStorage.getItem(kBarStyleKey) || "deep";
    gCustomCss = localStorage.getItem(kCustomCssKey) || "";
    gHoverFx = localStorage.getItem(kHoverFxKey) !== "false";
    gHideThoughtLeaks = localStorage.getItem(kHideThoughtLeaksKey) !== "false";
    gCompactMode = localStorage.getItem(kCompactModeKey) || "top3";
    gDisplayMode = localStorage.getItem(kDisplayModeKey) || "inline";
    gNotificationsEnabled = localStorage.getItem(kNotificationsEnabledKey) !== "false";
    gNotificationThreshold = parseInt(localStorage.getItem(kNotificationThresholdKey)) || 5;
    gUseMacro = localStorage.getItem(kUseMacroKey) === "true";
    gInjectPosition = parseInt(localStorage.getItem(kInjectPositionKey));
    if (isNaN(gInjectPosition) || ![0, 1, 2].includes(gInjectPosition)) gInjectPosition = 1;
    gInjectDepth = parseInt(localStorage.getItem(kInjectDepthKey));
    if (isNaN(gInjectDepth) || gInjectDepth < 0) gInjectDepth = 0;
    gInlineBoardCount = parseInt(localStorage.getItem(kInlineBoardCountKey));
    if (isNaN(gInlineBoardCount) || gInlineBoardCount < 1) gInlineBoardCount = 5;
    if (gInlineBoardCount > 99) gInlineBoardCount = 99;
    gInlineBoardCountSaved = gInlineBoardCount;
    gPanelWidth = parseInt(localStorage.getItem(kPanelWidthKey)) || 380;
    gDefaultBoardModeInline = localStorage.getItem(kDefaultBoardModeInlineKey) || "full";
    gDefaultBoardModeFloating = localStorage.getItem(kDefaultBoardModeFloatingKey) || "full";
    gDefaultBoardModePanel = localStorage.getItem(kDefaultBoardModePanelKey) || "full";

    // Reset runtime modes to settings defaults on reinit
    gCurrentBoardModeInline = gDefaultBoardModeInline;
    gCurrentBoardModeFloating = gDefaultBoardModeFloating;
    gCurrentBoardModePanel = gDefaultBoardModePanel;

    gPanelPosition = localStorage.getItem(kPanelPositionKey) || "right";

    // Load new display mode booleans, or migrate from legacy
    if (localStorage.getItem(kDisplayInlineKey) !== null) {
        gDisplayInline = localStorage.getItem(kDisplayInlineKey) === "true";
        gDisplayFloating = localStorage.getItem(kDisplayFloatingKey) === "true";
        gDisplayPanel = localStorage.getItem(kDisplayPanelKey) === "true";
    } else {
        MigrateDisplayMode();
    }

    LoadState();
    ApplyCustomCss();
    LoadPinnedNpcs();
    MigrateOldPinsToRegistry();
    CleanPinRegistry();
    LoadTimeline();

    // Fallback: ensure old cached settings.html elements are cleaned up
    // Remove old #ib_display_mode dropdown if cached
    const oldDisplaySelect = document.getElementById("ib_display_mode");
    if (oldDisplaySelect) oldDisplaySelect.closest(".ib-setting-row")?.remove();
    // Remove old .ib-board-mode-row elements (legacy dropdown-based approach)
    document.querySelectorAll(".ib-board-mode-row").forEach(el => el.remove());
    // Remove old #ib_default_board_mode if cached
    const oldBoardModeSelect = document.getElementById("ib_default_board_mode");
    if (oldBoardModeSelect) oldBoardModeSelect.closest(".ib-setting-row")?.remove();

    // If the new checkbox-based section doesn't exist (cached old HTML), create it dynamically
    if (!document.getElementById("ib_display_inline")) {
        const compactRow = document.getElementById("ib_compact_mode")?.closest(".ib-setting-row");
        if (compactRow) {
            const section = document.createElement("div");
            section.className = "ib-display-modes-section";
            section.innerHTML = `
                <div class="ib-setting-row ib-section-label">
                    <b id="ib_display_modes_label">${T("displayModes")}</b>
                </div>
                <div class="ib-display-mode-item" data-mode="inline">
                    <div class="ib-setting-row">
                        <input type="checkbox" id="ib_display_inline" />
                        <label for="ib_display_inline" id="ib_display_inline_label">${T("displayInline")}</label>
                        <span class="ib-inline-count-wrap" id="ib_inline_board_count_row" style="display:none">
                            <div class="ib-depth-input-wrap ib-depth-input-compact">
                                <button type="button" class="ib-depth-btn ib-depth-btn-compact ib-depth-minus" id="ib_board_count_minus">−</button>
                                <input type="number" id="ib_inline_board_count" min="1" max="99" value="${gInlineBoardCount}" class="ib-depth-field ib-depth-field-compact" />
                                <button type="button" class="ib-depth-btn ib-depth-btn-compact ib-depth-plus" id="ib_board_count_plus">+</button>
                            </div>
                        </span>
                        <span class="ib-inline-mode-wrap" id="ib_subrow_inline" style="display:none">
                            <label for="ib_board_mode_inline" id="ib_board_mode_inline_label">${T("defaultBoardMode")}:</label>
                            <select id="ib_board_mode_inline">
                                <option value="full">${T("boardModeFull")}</option>
                                <option value="compact">${T("boardModeCompact")}</option>
                                <option value="collapsed">${T("boardModeCollapsed")}</option>
                            </select>
                        </span>
                    </div>
                </div>
                <div class="ib-display-mode-item" data-mode="floating">
                    <div class="ib-setting-row">
                        <input type="checkbox" id="ib_display_floating" />
                        <label for="ib_display_floating" id="ib_display_floating_label">${T("displayFloating")}</label>
                    </div>
                    <div class="ib-board-mode-subrow" id="ib_subrow_floating">
                        <label for="ib_board_mode_floating" id="ib_board_mode_floating_label">${T("defaultBoardMode")}:</label>
                        <select id="ib_board_mode_floating">
                            <option value="full">${T("boardModeFull")}</option>
                            <option value="compact">${T("boardModeCompact")}</option>
                            <option value="collapsed">${T("boardModeCollapsed")}</option>
                        </select>
                    </div>
                </div>
                <div class="ib-display-mode-item" data-mode="panel">
                    <div class="ib-setting-row">
                        <input type="checkbox" id="ib_display_panel" />
                        <label for="ib_display_panel" id="ib_display_panel_label">${T("displayPanel")}</label>
                    </div>
                    <div class="ib-board-mode-subrow" id="ib_subrow_panel">
                        <label for="ib_board_mode_panel" id="ib_board_mode_panel_label">${T("defaultBoardMode")}:</label>
                        <select id="ib_board_mode_panel">
                            <option value="full">${T("boardModeFull")}</option>
                            <option value="compact">${T("boardModeCompact")}</option>
                            <option value="collapsed">${T("boardModeCollapsed")}</option>
                        </select>
                    </div>
                    <div class="ib-board-mode-subrow" id="ib_subrow_panel_position">
                        <label for="ib_panel_position" id="ib_panel_position_label">${T("panelPosition")}:</label>
                        <select id="ib_panel_position">
                            <option value="left">${T("panelLeft")}</option>
                            <option value="right">${T("panelRight")}</option>
                        </select>
                    </div>
                </div>
            `;
            compactRow.after(section);
        }
    }

    $("#ib_enabled").prop("checked", gEnabled);
    $("#ib_use_macro").prop("checked", gUseMacro);
    $("#ib_inject_position").val(String(gInjectPosition));
    $("#ib_inject_depth").val(gInjectDepth);
    // Show/hide depth row based on position
    UpdateInjectDepthVisibility();
    $("#ib_lang").val(gLang);
    $("#ib_theme").val(gTheme);
    $("#ib_bar_style").val(gBarStyle);
    
    $("#ib_compact_mode").on("change", function () {
        gCompactMode = $(this).val();
        localStorage.setItem(kCompactModeKey, gCompactMode);
        ReprocessChat();
    });

    // ib_pin_storage_mode dropdown handler removed — tier pins use multi-level cycle
    
    $("#ib_hide_raw").prop("checked", gHideRaw);
    $("#ib_hide_thought_leaks").on("change", function () {
        gHideThoughtLeaks = $(this).is(":checked");
        localStorage.setItem(kHideThoughtLeaksKey, String(gHideThoughtLeaks));
        ReprocessChat();
    });
    
    $("#ib_show_nsfw").prop("checked", gShowNsfw);
    $("#ib_hover_fx").prop("checked", gHoverFx);
    $("#ib_hide_thought_leaks").prop("checked", gHideThoughtLeaks);
    $("#ib_compact_mode").val(gCompactMode);
    $("#ib_display_inline").prop("checked", gDisplayInline);
    $("#ib_display_floating").prop("checked", gDisplayFloating);
    $("#ib_display_panel").prop("checked", gDisplayPanel);
    $("#ib_board_mode_inline").val(gDefaultBoardModeInline);
    $("#ib_inline_board_count").val(gInlineBoardCount);
    $("#ib_board_mode_floating").val(gDefaultBoardModeFloating);
    $("#ib_board_mode_panel").val(gDefaultBoardModePanel);
    $("#ib_panel_position").val(gPanelPosition);

    // Show/hide default mode subrows based on checkbox state
    UpdateBoardModeVisibility();
    $("#ib_custom_css").val(gCustomCss);

    UpdateSettingsText();
    UpdateStatusDisplay();
    UpdateLastUpdateDisplay();
    UpdateThemePreview();

    $("#ib_enabled").on("change", function () {
        gEnabled = $(this).is(":checked");
        localStorage.setItem(kEnabledKey, String(gEnabled));
        UpdateStatusDisplay();
        // InjectPrompt(); // Не нужно вызывать здесь, макрос сам вернет пустоту если выключено
        
        if (gEnabled) {
            ReprocessChat();
        } else {
            document.querySelectorAll(".ib-board-host").forEach(el => el.remove());
            RemoveFloatingBoard();
            RemovePanelMode();
            // Clear auto-inject when disabled
            if (!gUseMacro) {
                try {
                    const ctx = SillyTavern.getContext();
                    if (ctx.setExtensionPrompt) {
                        ctx.setExtensionPrompt('InfoBoard', '', gInjectPosition, gInjectDepth, true);
                    }
                } catch {}
            }
        }
    });

    $("#ib_use_macro").on("change", function () {
        gUseMacro = $(this).is(":checked");
        localStorage.setItem(kUseMacroKey, String(gUseMacro));

        if (gUseMacro) {
            // Switching to macro mode — clear any existing auto-inject
            try {
                const ctx = SillyTavern.getContext();
                if (ctx.setExtensionPrompt) {
                    ctx.setExtensionPrompt('InfoBoard', '', gInjectPosition, gInjectDepth, true);
                }
            } catch {}
            console.log("[IB] Switched to macro mode — use {{InfoBoard}} in your prompt");
        } else {
            // Switching to auto-inject mode — will inject on next generation
            console.log("[IB] Switched to auto-inject mode");
        }
        UpdateInjectDepthVisibility();
    });

    $("#ib_inject_position").on("change", function () {
        gInjectPosition = parseInt($(this).val());
        if (isNaN(gInjectPosition)) gInjectPosition = 1;
        localStorage.setItem(kInjectPositionKey, String(gInjectPosition));
        UpdateInjectDepthVisibility();
    });

    $("#ib_inject_depth").on("input change", function () {
        gInjectDepth = parseInt($(this).val());
        if (isNaN(gInjectDepth) || gInjectDepth < 0) gInjectDepth = 0;
        if (gInjectDepth > 999) gInjectDepth = 999;
        $(this).val(gInjectDepth);
        localStorage.setItem(kInjectDepthKey, String(gInjectDepth));
    });

    $("#ib_depth_minus").on("click", function () {
        if (gInjectDepth > 0) {
            gInjectDepth--;
            $("#ib_inject_depth").val(gInjectDepth);
            localStorage.setItem(kInjectDepthKey, String(gInjectDepth));
        }
    });

    $("#ib_depth_plus").on("click", function () {
        if (gInjectDepth < 999) {
            gInjectDepth++;
            $("#ib_inject_depth").val(gInjectDepth);
            localStorage.setItem(kInjectDepthKey, String(gInjectDepth));
        }
    });

    $("#ib_lang").on("change", function () {
        gLang = $(this).val();
        localStorage.setItem(kLangKey, gLang);
        UpdateSettingsText();
        UpdateStatusDisplay();
        UpdateLastUpdateDisplay();
        UpdateThemePreview();
        // InjectPrompt(); // Не нужно, макрос подхватит новый язык при генерации
        ReprocessChat();
    });

    // ... (остальные обработчики событий без изменений) ...
    $("#ib_theme").on("change", function () {
        gTheme = $(this).val();
        localStorage.setItem(kThemeKey, gTheme);
        // Clean up any stale <style> element left by the old theme editor
        const staleStyle = document.getElementById("ib_custom_bar_chip_style");
        if (staleStyle) staleStyle.remove();
        UpdateThemePreview();
        ReprocessChat();
    });

    $("#ib_bar_style").on("change", function () {
        gBarStyle = $(this).val();
        localStorage.setItem(kBarStyleKey, gBarStyle);
        ReprocessChat();
    });

    $("#ib_hover_fx").on("change", function () {
        gHoverFx = $(this).is(":checked");
        localStorage.setItem(kHoverFxKey, String(gHoverFx));
        ReprocessChat();
    });

    $("#ib_hide_raw").on("change", function () {
        gHideRaw = $(this).is(":checked");
        localStorage.setItem(kHideRawKey, String(gHideRaw));
        ReprocessChat();
    });

    $("#ib_show_nsfw").on("change", function () {
        gShowNsfw = $(this).is(":checked");
        localStorage.setItem(kShowNsfwKey, String(gShowNsfw));
        ReprocessChat();
    });

    $("#ib_save_custom_css").on("click", function () {
        gCustomCss = $("#ib_custom_css").val() || "";
        localStorage.setItem(kCustomCssKey, gCustomCss);
        ApplyCustomCss();
        ReprocessChat();
    });

    $("#ib_clear_custom_css").on("click", function () {
        if (!confirm(T("clearCustomCssConfirm"))) return;
        gCustomCss = "";
        localStorage.setItem(kCustomCssKey, "");
        $("#ib_custom_css").val("");
        ApplyCustomCss();
        ReprocessChat();
    });

    $("#ib_clean_orphan_snapshots").on("click", function () {
        if (!confirm(T("cleanOrphanSnapshotsConfirm"))) return;
        CleanPinRegistry();
        ReprocessChat();
    });

    $("#ib_reset_state").on("click", function () {
        if (confirm(T("resetConfirm"))) {
            gState = structuredClone(kDefaultState);
            SaveState();
            UpdateStatusDisplay();
            UpdateLastUpdateDisplay();
            ReprocessChat();
        }
    });

    $(document).on("change", "#ib_display_inline", function () {
        gDisplayInline = $(this).is(":checked");
        localStorage.setItem(kDisplayInlineKey, String(gDisplayInline));
        OnDisplayModeChange();
    });

    $(document).on("change", "#ib_display_floating", function () {
        gDisplayFloating = $(this).is(":checked");
        localStorage.setItem(kDisplayFloatingKey, String(gDisplayFloating));
        OnDisplayModeChange();
    });

    $(document).on("change", "#ib_display_panel", function () {
        gDisplayPanel = $(this).is(":checked");
        localStorage.setItem(kDisplayPanelKey, String(gDisplayPanel));
        OnDisplayModeChange();
    });

    $(document).on("change", "#ib_board_mode_inline", function () {
        gDefaultBoardModeInline = $(this).val();
        gCurrentBoardModeInline = gDefaultBoardModeInline;
        localStorage.setItem(kDefaultBoardModeInlineKey, gDefaultBoardModeInline);
        ReprocessChat();
    });

    // Inline board count sidebar handlers — confirm/cancel pattern
    function sidebarCountShowConfirm() {
        const el = document.getElementById("ib_count_confirm");
        if (el) el.style.display = "inline-flex";
    }
    function sidebarCountHideConfirm() {
        const el = document.getElementById("ib_count_confirm");
        if (el) el.style.display = "none";
        const field = document.getElementById("ib_inline_board_count");
        if (field) field.value = gInlineBoardCountSaved;
    }
    function sidebarCountApply() {
        const field = document.getElementById("ib_inline_board_count");
        let v = parseInt($(field).val());
        if (isNaN(v) || v < 1) v = 1;
        if (v > 99) v = 99;
        $(field).val(v);
        gInlineBoardCount = v;
        gInlineBoardCountSaved = v;
        localStorage.setItem(kInlineBoardCountKey, String(gInlineBoardCount));
        const el = document.getElementById("ib_count_confirm");
        if (el) el.style.display = "none";
        ReprocessChat();
    }

    $(document).on("input", "#ib_inline_board_count", function () { sidebarCountShowConfirm(); });
    $(document).on("change", "#ib_inline_board_count", function () { sidebarCountShowConfirm(); });
    $(document).on("click", "#ib_board_count_minus", function () {
        const field = document.getElementById("ib_inline_board_count");
        let v = parseInt($(field).val()) || 1;
        if (v > 1) v--;
        $(field).val(v);
        sidebarCountShowConfirm();
    });
    $(document).on("click", "#ib_board_count_plus", function () {
        const field = document.getElementById("ib_inline_board_count");
        let v = parseInt($(field).val()) || 1;
        if (v < 99) v++;
        $(field).val(v);
        sidebarCountShowConfirm();
    });
    $(document).on("click", "#ib_count_ok", function () { sidebarCountApply(); });
    $(document).on("click", "#ib_count_cancel", function () { sidebarCountHideConfirm(); });
    $(document).on("change", "#ib_board_mode_floating", function () {
        gDefaultBoardModeFloating = $(this).val();
        gCurrentBoardModeFloating = gDefaultBoardModeFloating;
        localStorage.setItem(kDefaultBoardModeFloatingKey, gDefaultBoardModeFloating);
        ReprocessChat();
    });
    $(document).on("change", "#ib_board_mode_panel", function () {
        gDefaultBoardModePanel = $(this).val();
        gCurrentBoardModePanel = gDefaultBoardModePanel;
        localStorage.setItem(kDefaultBoardModePanelKey, gDefaultBoardModePanel);
        ReprocessChat();
    });

    $(document).on("change", "#ib_panel_position", function () {
        gPanelPosition = $(this).val();
        localStorage.setItem(kPanelPositionKey, gPanelPosition);
        // Re-render panel with new position
        RemovePanelMode();
        if (gDisplayPanel) RenderPanelBoard();
    });

    $("#ib_reprocess_chat").on("click", function () {
        ReprocessChat();
    });

    $("#ib_export_state").on("click", function () {
        ExportState();
    });

    $("#ib_import_state").on("click", function () {
        $("#ib_import_file").trigger("click");
    });

    $("#ib_import_file").on("change", function (e) {
        const file = e.target.files?.[0];
        if (file) {
            ImportStateFromFile(file);
        }
        e.target.value = "";
    });

    // УБРАНО: событие GENERATION_STARTED больше не нужно для инжекта
    // if (stContext.eventTypes.GENERATION_STARTED) {
    //     stContext.eventSource.on(stContext.eventTypes.GENERATION_STARTED, InjectPrompt);
    // }

    if (stContext.eventTypes.CHAT_CHANGED) {
        stContext.eventSource.on(stContext.eventTypes.CHAT_CHANGED, OnChatChanged);
    }

if (stContext.eventTypes.MESSAGE_RECEIVED) {
    stContext.eventSource.on(stContext.eventTypes.MESSAGE_RECEIVED, () => {
        gPreSwipeState = null; // Clear pre-swipe state — new message generated
        ScheduleReprocessChat();
    });
}

if (stContext.eventTypes.MESSAGE_EDITED) {
    stContext.eventSource.on(stContext.eventTypes.MESSAGE_EDITED, () => {
        ScheduleReprocessChat();
    });
}

    if (stContext.eventTypes.MESSAGE_SWIPED) {
        stContext.eventSource.on(stContext.eventTypes.MESSAGE_SWIPED, (msgIndex) => {
            document.querySelectorAll(".ib-board-host").forEach(el => el.remove());

            // Calculate state BEFORE the swiped message for correct prompt injection.
            // SillyTavern MESSAGE_SWIPED may pass message index as parameter.
            // Fallback: try to get it from the currently displayed/active message.
            let swipeIdx = (typeof msgIndex === 'number') ? msgIndex : -1;
            if (swipeIdx < 0) {
                try {
                    const ctx = SillyTavern.getContext();
                    // Various ST versions store the active message ID differently
                    swipeIdx = typeof ctx.messageId === 'number' ? ctx.messageId : -1;
                } catch {}
            }
            if (swipeIdx >= 0) {
                gPreSwipeState = CalculateStateUpToMessage(swipeIdx);
                console.log(`[IB] Swipe detected for message ${swipeIdx}, using pre-swipe state`);
            } else {
                gPreSwipeState = null;
                console.log("[IB] Swipe detected but message index unavailable, using full state");
            }

            ScheduleReprocessChat();
        });
    }

    if (stContext.eventTypes.MESSAGE_DELETED) {
        stContext.eventSource.on(stContext.eventTypes.MESSAGE_DELETED, () => {
            gPreSwipeState = null; // Clear pre-swipe state
            RebuildStateFromCurrentChat();

            document.querySelectorAll(".ib-board-host").forEach(el => el.remove());

            setTimeout(() => ReprocessChat(), 300);
            setTimeout(() => RenderFloatingBoard(), 400);
            setTimeout(() => RenderPanelBoard(), 450);
        });
    }
        
    setTimeout(() => ReprocessChat(), 300);
    setTimeout(() => UpdateThemePreview(), 150);
    setTimeout(() => RenderPanelBoard(), 600);

    // Mobile idle: re-evaluate on resize
    const _panelResizeHandler = () => SchedulePanelToggleIdle();
    window.addEventListener('resize', _panelResizeHandler);

    // --- Notifications settings ---
    // Fallback: if settings.html was cached and notification section missing, create it
    if (!document.getElementById("ib_notifications_enabled")) {
        const nsfwRow = document.getElementById("ib_show_nsfw")?.closest(".ib-setting-row");
        if (nsfwRow) {
            const section = document.createElement("div");
            section.className = "ib-notification-settings";
            const isRu = gLang === "ru";
            section.innerHTML = `
                <div class="ib-notif-title">🔔 <b id="ib_notif_title_text">${isRu ? "Уведомления" : "Notifications"}</b></div>
                <div class="ib-setting-row">
                    <input type="checkbox" id="ib_notifications_enabled" />
                    <label for="ib_notifications_enabled">${isRu ? "Включить уведомления" : "Enable notifications"}</label>
                </div>
                <div class="ib-setting-row">
                    <label for="ib_notification_threshold"><b>${isRu ? "Порог" : "Threshold"}</b></label>
                    <select id="ib_notification_threshold">
                        <option value="3">3 (${isRu ? "Чувствительный" : "Sensitive"})</option>
                        <option value="5">5 (${isRu ? "По умолчанию" : "Default"})</option>
                        <option value="10">10 (${isRu ? "Только крупные" : "Major only"})</option>
                        <option value="20">20 (${isRu ? "Только драматичные" : "Dramatic only"})</option>
                    </select>
                </div>
            `;
            nsfwRow.after(section);
        }
    }

    $("#ib_notifications_enabled").prop("checked", gNotificationsEnabled);
    $("#ib_notification_threshold").val(gNotificationThreshold);

    $("#ib_notifications_enabled").on("change", function () {
        gNotificationsEnabled = $(this).is(":checked");
        localStorage.setItem(kNotificationsEnabledKey, String(gNotificationsEnabled));
    });

    $("#ib_notification_threshold").on("change", function () {
        gNotificationThreshold = parseInt($(this).val()) || 5;
        localStorage.setItem(kNotificationThresholdKey, String(gNotificationThreshold));
    });

    // --- НАЧАЛО: Регистрация макроса {{InfoBoard}} и автоинжекта ---
    if (power_user && typeof power_user === 'object') {
        try {
            power_user.experimental_macro_engine = true;
        } catch (e) {
            console.warn("[IB] Could not set experimental_macro_engine:", e?.message);
        }
    }

    // Always register the macro (if available) — it checks gUseMacro at runtime
    if (macros && macros.registry && typeof macros.registry.registerMacro === 'function') {
        try {
            macros.registry.registerMacro('InfoBoard', {
                category: 'Infoboard',
                aliases: [{ alias: 'IB' }],
                description: 'Injects the Infoboard system prompt and current state. Place this in your System Prompt or Author\'s Note. Only works when "Macro mode" is enabled in settings.',
                handler: () => {
                    // Macro only returns content when macro mode is enabled
                    if (!gEnabled || !gUseMacro) return '';

                    const systemPrompt = gLang === "en" ? kSystemPromptEn : kSystemPromptRu;
                    const fullPrompt = `${systemPrompt}\n\n${BuildStateInjection()}`;

                    return fullPrompt;
                }
            });
            console.log("[IB] Macro {{InfoBoard}} registered (active only when macro mode is on)");
        } catch (e) {
            console.warn("[IB] Macro registration failed:", e?.message);
        }
    } else {
        console.warn("[IB] Macro system not available — macro mode will not work");
    }

    // Always register the auto-inject handler — it checks !gUseMacro at runtime
    if (stContext?.eventSource && stContext?.eventTypes?.GENERATION_STARTED) {
        stContext.eventSource.on(stContext.eventTypes.GENERATION_STARTED, () => {
            // Auto-inject only when macro mode is OFF
            if (!gEnabled || gUseMacro) {
                // Clear any previous auto-inject to avoid stale prompts
                try {
                    const ctx = SillyTavern.getContext();
                    if (ctx.setExtensionPrompt) {
                        ctx.setExtensionPrompt('InfoBoard', '', gInjectPosition, gInjectDepth, true);
                    }
                } catch {}
                return;
            }
            try {
                const systemPrompt = gLang === "en" ? kSystemPromptEn : kSystemPromptRu;
                const stateBlock = BuildStateInjection();
                const fullPrompt = `${systemPrompt}\n\n${stateBlock}`;

                if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                    const ctx = SillyTavern.getContext();
                    if (ctx.setExtensionPrompt) {
                        ctx.setExtensionPrompt('InfoBoard', fullPrompt, gInjectPosition, gInjectDepth, true);
                    }
                }
            } catch (e) {
                console.warn("[IB] Auto-inject failed:", e?.message);
            }
        });
        console.log("[IB] Auto-inject handler registered (active only when macro mode is off)");
    } else {
        console.warn("[IB] GENERATION_STARTED event not available — auto-inject disabled");
    }

    // Log current mode at startup
    console.log(`[IB] Infoboard extension ready — mode: ${gUseMacro ? 'macro {{InfoBoard}}' : 'auto-inject'}`);
    // --- КОНЕЦ: Регистрация макроса и автоинжекта ---
});