# Developer Documentation

## Before you start

There's no bundler. No `import`/`export`. Each file wraps itself in an IIFE and attaches to `window`:

```js
(function() {
    function doSomething() { ... }
    window.LighthouseSelection = { doSomething };
})();
```

`manifest.json` controls load order - utilities first, modules second, `content.js` last. If you add a file, add it there in the right position.

---

## How an interaction flows

```
User event → selectionChanged (content.js) → selection.js builds the snapshot → State.send('selected') picks the mode → ui.js renders
```

Each step is isolated. `state.js` doesn't touch the DOM. `ui.js` doesn't know about selection logic. `content.js` just connects them.

---

## Files

```
src/
├── content/content.js       Entry point. Event listeners, lifecycle.
├── modules/
│   ├── actions.js           Every action: condition, execute, preview. Parsers (currency, units, dates...).
│   ├── api.js               Context (prepareContext) and tools; external calls: translate, define, rates.
│   ├── editing.js           Editing helpers for text fields (wrapping, brackets).
│   ├── geometry.js          Where a selection is drawn: page extents, the text-field mirror, selection edges.
│   ├── handles.js           Drag handles for adjusting selections.
│   ├── input.js             Text field detection and behaviour.
│   ├── language.js          On-device language checks: is a selection foreign, page and user languages.
│   ├── markers.js           Highlights, painted by the browser (CSS Custom Highlight API); the page is never changed.
│   ├── math.js              Expression parsing and calculation.
│   ├── selection.js         Context detection, text insertion, snapping.
│   ├── state.js             Mode state machine, action filtering.
│   └── ui.js                Shadow DOM tooltip rendering.
├── popup/popup.js           Settings UI.
└── utils/
    ├── config.js            Every setting, declared once (default, options); validation.
    ├── data.js              Currencies, units, icons.
    └── utils.js             EventManager, Logger, shared helpers.
```

---

## State modes

The bar's state machine lives in `state.js`. Every change is a named event, `State.send(event, data)`; nothing else writes the mode, the field memory (`lastFocusedInput`) or the busy flags. The table of events and the transitions they make is at the top of `send`. `state.js` touches no DOM: `content.js` connects two effects, `show` and `hide`.

| Mode | When |
|---|---|
| `HIDDEN` | Nothing to show |
| `SELECTION` | Text selected on a page |
| `SMART` | Text selected and a parser matched (math, currency, date, color, JSON, base64) |
| `INPUT` | A field: text selected in it, or the first click into it |
| `LINK` | Hovering an external link |
| `SNIPPET_MENU` | User typed `//` and matching shortcuts exist |
| `DRAGGING` | A handle is being dragged: no bar; the drag owns the selection |

`State.acting` is on while a keep-open action runs (Case); `State.busy` (acting or dragging) means no new selection is read. `State.orderActions(candidates, matched)` is the one ordering: content-matched actions first, then the user's order.

---

## Adding an action

```js
{
    id: 'my_action',
    label: 'Label',
    category: 'selection',    // 'selection' | 'input' | 'smart' | 'link'
    icon: 'copy',             // key in ICON_REGISTRY in data.js
    condition: (ctx) => ctx.hasText,
    execute: (ctx, tools) => {        // or url: (ctx) => '...' for an action that only opens a page
        tools.copy(ctx.text);
        return { success: true, message: 'Done' };
    },
    preview: (ctx, tools) => {         // optional, shown on hover: the result
        return { previewText: '...' };  // or node; items: the menu; isValue, previewClick, live (see fillPreview in ui.js)
    },
    info: (ctx, tools) => 'In German'  // optional, shown in the strip: a decision, never the result
}
```

**What belongs in an action:** only what is its own: its decisions (Search's `engines()`, Case's `nextCase()`), its request payloads, its parse (`parse()` and `parsed(ctx)`, memoized per selection with `getParsed`) and its wording. These are properties of the action object, used by its hooks through `this` (hooks are always called as methods of their action). **What stays shared:** facts about the selection, computed once and read from `ctx` (`language`, `wordCount`, `cleanText`); the user's preferences, through one accessor each (`userLanguage()`, `userCurrency()`); domain libraries (dates, conversions in `math.js`, language names); preview patterns in the toolkit (`textPreview`, `buildCopyMenu`); and services, through `tools.query()`.

After a click (a button, or an item in its menu), the bar either is **done** and closes, or **stays** (`keepOpen: true`): it keeps its place and refreshes for the selection as it now is, through the same pipeline as any selection, so the buttons are decided again (Clear all leaves Paste; Expand gets the expanded selection's buttons). Its feedback goes in the strip. Use `keepOpen` when the natural next step is in the same bar: Case, Expand, Read aloud, Clear all, one Spelling fix of several. A menu item takes `keepOpen` too. An action that rewrites text it should stay on keeps it selected (`tools.replace(text, { select: true })`).

`dynamicLabel(ctx, tools)` (optional) works out the label for this selection: text, or `{ quote }` to show a value instead (Paste shows the clipboard text).

`info(ctx, tools)` (optional) returns a short line, or a promise of one, for the strip: what Lighthouse decided for this action, which neither the label nor the preview shows (the languages Translate used, how old Convert's rate is, which engine Search opens). It is asked only when the button is pointed at, once per render (again after a `keepOpen` execute). It uses only local work or the same requests its preview makes, which the shared cache answers once; it never makes a request of its own. When a decision is made inside `execute`, make it a property of the action that both use (Case's `nextCase`).

Menu items (`{ label, icon, onClick }` in a preview's `items`) may have `info` too, as text; picking one ends like an action's execute (the bar closes, the selection collapses or the field keeps focus).

**Services return their decisions with their results:** `tools.rate()` gives `{ rate, asOf }`; through `tools.query(service, payload)`, `TRANSLATE` its `sourceLang` and `targetLang`, `DEFINE` the `language` the word was read as, `SPELLCHECK` the `language` it was checked as. A new service should do the same rather than hide what it chose. Each action builds its own request; the toolkit has no per-action wrappers.

The background script automatically migrates new actions into existing users' settings. You don't need to touch migration.

---

## Shared tools

Each exists once; use it rather than writing another.

| Need | Use |
|---|---|
| Ask the background worker | `LighthouseUtils.ask()`: one shared answer per question, so preview, info, execute and page conversion share one request (`asyncQuery` in `api.js` unwraps it); `message()` for what must be asked fresh (the clipboard) |
| A language's name | `LighthouseUtils.languageName('de')` ("German") |
| Words or sentences | `LighthouseUtils.segmenter('word' \| 'sentence')` |
| A token in JavaScript (px, ms) | `LighthouseUtils.token('--so-duration', 200)` |
| Shorten text for display | `LighthouseUtils.shorten(text, max)` |
| Show something on screen | `LighthouseUtils.frame.draw(key, fn)`: runs in the next frame; `frame.cancel(key)` when hiding |
| The page selection | `LighthouseSelection.getActiveSelection()` |
| Where the selection is drawn | `LighthouseSelection.current().edges('painted')` (handles, the bar) or `edges('content')` (Highlight); `LighthouseGeometry` underneath |
| The selection's language | `ctx.language` / `ctx.foreign` (from `LighthouseLanguage.inspect()`) |
| Copy to the clipboard | `tools.copy()` |
| Prices and measurements in a text | `LighthouseMath.findAmounts(text)`: words from the browser (Intl) in the reader's and the page's languages |
| A language tag's base language | `LighthouseData.baseLanguage(code)` ('de-AT' -> 'de'), everywhere, the background included |
| The focused element | `LighthouseInput.focusedElement()`: also inside web components |
| Read a setting | `LighthouseState.get(key)`: always a valid value (declared in `config.js`), so no fallback |
| Add a setting | One line in `SETTINGS` in `config.js`; a popup switch or choice needs only `data-setting="key"` on its control |
| Set a selection between two ends | `LighthouseSelection.selectBetween(snapshot, fixed, moving)`: field offsets or DOM points, either order |
| Grow the selection by a word | `LighthouseSelection.extendByWord(atStart)` (through `surface`, so every surface alike) |
| The text position under a point | `LighthouseGeometry.pointAt(snapshot, x, y)` |
| Read a number (`1.234,5`, `1,234.5`) | `LighthouseMath.parseLocaleNumber()` |
| Convert units and currencies | `LighthouseMath.convertUnit()`, `patterns()`, `convertAllText()` |
| Is this a text field (and may we type in it) | `LighthouseInput.fieldKind(el, { forTyping })` |

Only `page.css` is injected into web pages; everything else is `styles.css` in the shadow root. Timings and spacing live in `tokens.css`.

## The context

`getContext()` also attaches `ctx.snapshot`: the selection frozen at that moment (`text` as selected, `cleanText`, `field` and `offsets` or a copy of the `range`, `caret`, `backward`, `pointer`) with two live parts, `edges(kind)`, measured against the current layout, and `language`, a promise decided once. Its `id` stays the same while the selection does. Nothing writes to it.

Two questions, two snapshots. *Where is the selection now* (handles, positioning, Highlight): `LighthouseSelection.current()`, the snapshot of the live selection, the same object while it is unchanged, so a keep-open action that changes the selection (Expand) is followed. *Which bar is this* (the pointer it opened at, the side it took): `ctx.snapshot`, the one the pipeline read. Choose the kind of surface by `snapshot.field` (set only for plain fields), not by `ctx.isInput`, which is also true for rich editors.


`LighthouseAPI.prepareContext()` builds `ctx` once per selection, so `getParsed()` results last the whole render. Besides the raw fields it has `cleanText`, `wordCount` (segmented for Chinese, Japanese, Thai), `hasDigit`, `hasLetter`, `number`, `tools`, and `foreign` / `language`.

"Foreign" needs evidence: another script, a confident detection, or a declared language (nearest `lang`, else the page's) the user doesn't read. Chrome is unsure about most short text, so an unsure guess only counts when it names a language the user reads. Undecided: both Translate and Define are offered.

## Network

All requests go through `gatewayFetch` in `background.js`, without cookies or referrer, only to the manifest's `host_permissions`; only LanguageTool may receive a POST body. Define reads English Wiktionary (the only edition with a definition endpoint) and translates the entry for readers without English. Spelling sends the selection and its sentence (at most 500 characters). Link icons come from Chrome's favicon cache.

`_favicon` is never web-accessible: any site could then read Chrome's favicon cache, and so which sites you've visited. Link icons in web pages come from the background (`FAVICON`) instead. The clipboard is read by the extension, never the page: `tools.readClipboard()` asks the background, which reads it in a hidden offscreen page (`src/offscreen/`). Read in the page, Chrome would prompt on every site and an allowed site would get the clipboard. Collected snippets are in `chrome.storage.session` (memory only). Previews showing changing data (clipboard, collection) return `live: true` so they aren't cached.

## Parsers

Parsers in `actions.js` receive `(text, ctx)` and are read through `getParsed()`. Dates: short selections only; tokens become a one-character "shape" matched by `DATE_PATTERNS`; names come from `LighthouseData.getDateVocabulary()`; any number left over rejects the match. An ambiguous `03/04` is read by `tools.dateOrder()` (browser language, or the time zone for plain English), and the preview offers the other reading unless a weekday settles it.

## Modifying text

Always use `tools.replace(text, options)` inside an action. Never manipulate `el.value` directly.

`tools.replace` calls `insertText` in `selection.js` which handles spacing, cursor placement, and undo in one place for both native inputs and contentEditable elements. Deleting and cutting are only intercepted when tidying is needed (`needsTidy()`); otherwise the browser's own edit runs, with its normal events.

---

## isEditableElement

```js
const { isForm, isEditable } = window.LighthouseSelection.isEditableElement(el);
```

Use this whenever you need to check if an element accepts text input. It correctly excludes password fields, buttons, and other non-text inputs that a raw `tagName === 'INPUT'` check would miss.

---

## Bar and handles

The bar sits at whole pixels, centered on the selection on the edge nearer the pointer (one line: above), and moves with the text while scrolling. It rises out of the selection when it appears; when it leaves or moves to another line a snapshot fades out where it was; on the same line it glides. Handles are drawn under the bar, and below a selection the bar keeps clear of their tabs.

## Shadow DOM

The tooltip renders inside a Shadow Root. The page can't break its styles and it can't leak onto the page. When writing UI code, use the existing CSS variables (`var(--so-text-color)` etc.) - they're defined inside the shadow root, not on `:root`.

---

## Tests

`tests/` holds logic tests and browser tests that load the real extension into Chromium; see `tests/README.md`. Run `npm test` there before and after a change, and add a test with every bug fix.

## Debugging

**Page console (F12)**  state transitions log as `[Lighthouse] ...`

**Background script** - `chrome://extensions` → Lighthouse → service worker. API errors show up here.

**Inspecting state** - `window.LighthouseState` is accessible from the page console.