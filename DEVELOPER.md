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
User event → content.js → selection.js builds context → state.js picks mode → ui.js renders
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
    ├── config.js            Default settings.
    ├── data.js              Currencies, units, icons.
    └── utils.js             EventManager, Logger, shared helpers.
```

---

## State modes

`State.update(ctx)` transitions automatically. You never set the mode directly.

| Mode | When |
|---|---|
| `HIDDEN` | Nothing to show |
| `SELECTION` | Text selected on a page |
| `SMART` | Text selected and a parser matched (math, currency, date, color, JSON, base64) |
| `INPUT` | Focus inside a text field, no selection |
| `LINK` | Hovering an external link |
| `SNIPPET_MENU` | User typed `//` and matching shortcuts exist - set directly by `content.js`, not via `update` |

---

## Adding an action

```js
{
    id: 'my_action',
    label: 'Label',
    category: 'selection',    // 'selection' | 'input' | 'smart' | 'link'
    icon: 'copy',             // key in ICON_REGISTRY in data.js
    condition: (ctx) => ctx.hasText,
    execute: (ctx, tools) => {
        tools.copy(ctx.text);
        return { success: true, message: 'Done' };
    },
    preview: (ctx, tools) => {         // optional, shown on hover: the result
        return { previewText: '...' };
    },
    info: (ctx, tools) => 'In German'  // optional, shown in the strip: a decision, never the result
}
```

`keepOpen: true` keeps the tooltip open after execute - useful for actions the user might repeat like Case toggle.

`dynamicLabel(ctx, tools)` (optional) works out the label for this selection: text, or `{ quote }` to show a value instead (Paste shows the clipboard text).

`info(ctx, tools)` (optional) returns a short line, or a promise of one, for the strip: what Lighthouse decided for this action, which neither the label nor the preview shows (the languages Translate used, how old Convert's rate is, which engine Search opens). It is asked only when the button is pointed at, once per render (again after a `keepOpen` execute). It uses only local work or the same requests its preview makes, which the shared cache answers once; it never makes a request of its own. When a decision is made inside `execute`, move it into a helper both use (`spokenLanguage`, `nextCase`).

**Tools return their decisions with their results:** `tools.rate()` gives `{ rate, asOf }`, `translate` its `sourceLang` and `targetLang`, `define` the `language` the word was read as, `spellcheck` the `language` it was checked as. A new tool should do the same rather than hide what it chose.

The background script automatically migrates new actions into existing users' settings. You don't need to touch migration.

---

## Shared tools

Each exists once; use it rather than writing another.

| Need | Use |
|---|---|
| Ask the background worker | `LighthouseUtils.message()` (`asyncQuery` in `api.js` unwraps it, and caches answers so preview, info and execute share one request) |
| A language's name | `LighthouseUtils.languageName('de')` ("German") |
| Words or sentences | `LighthouseUtils.segmenter('word' \| 'sentence')` |
| A token in JavaScript (px, ms) | `LighthouseUtils.token('--so-duration', 200)` |
| Shorten text for display | `LighthouseUtils.shorten(text, max)` |
| Show something on screen | `LighthouseUtils.frame.draw(key, fn)`: runs in the next frame; `frame.cancel(key)` when hiding |
| The page selection | `LighthouseSelection.getActiveSelection()` |
| Where the selection starts and ends | `LighthouseHandles.selectionEnds()` |
| The selection's language | `ctx.language` / `ctx.foreign` (from `LighthouseLanguage.inspect()`) |
| Copy to the clipboard | `tools.copy()` |
| Read a number (`1.234,5`, `1,234.5`) | `LighthouseMath.parseLocaleNumber()` |
| Convert units and currencies | `LighthouseMath.convertUnit()`, `patterns()`, `convertAllText()` |
| Is this a text field (and may we type in it) | `LighthouseInput.fieldKind(el, { forTyping })` |

Only `page.css` is injected into web pages; everything else is `styles.css` in the shadow root. Timings and spacing live in `tokens.css`.

## The context

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