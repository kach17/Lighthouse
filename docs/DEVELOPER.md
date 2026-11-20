# Developer Documentation

## Before you start

There's no bundler. No `import`/`export`. Each file wraps itself in an IIFE and attaches to `window`:

```js
(function() {
    function doSomething() { ... }
    window.LighthouseSelection = { doSomething };
})();
```

`extension/manifest.json` controls load order - utilities first, modules second, `content.js` last. If you add a file, add it there in the right position.

---

## Who owns what

Each layer decides its own things, and only it does:

| Layer | File | Its job |
|---|---|---|
| Input | `input.js` | The only listener: keys, pointer, editing, selection, scroll. Features subscribe by scope; one filter decides what reaches them |
| Text | `selection.js` | Reading and writing text in every kind of box (the surfaces), the snapshot of a selection, the context the bar works from, snapping, the owed space |
| Geometry | `geometry.js` | Where a selection is drawn: its ends and its box, measured against the current layout |
| Language | `language.js` | Whether a selection is in a language the reader reads, on the device |
| Numbers | `math.js`, `data.js` | Amounts in text (prices, measurements), conversions, arithmetic |
| State | `state.js` | The settings, and the bar's state machine: which bar shows, with which actions |
| Controller | `content.js` | Connects input to the pipeline and to State |
| Features | `actions.js`, `editing.js`, `handles.js`, `markers.js`, `send.js` | The buttons, the typing helpers, the drag handles, highlights, Send |
| Interface | `ui.js` | The bar, the strip and popovers, in a closed shadow root, and where the bar goes |
| Background | `background.js` | The services Lighthouse calls (translation, definitions, rates), settings kept current |
| Settings | `popup.js` | The settings window |

**When you change something, find the owner first.** Every bug or change starts by naming the layer that owns it, from the table above, and is fixed there, with a test that reproduces it. If two layers both decide the same thing, that is a bug in itself.

## How an interaction flows

```
User event → selectionChanged (content.js) → selection.js builds the snapshot → State.send('selected') picks the mode → ui.js renders
```

Each step is isolated. `state.js` doesn't touch the DOM, and only `state.js` changes State: other modules tell it what happened (`State.send`). `ui.js` doesn't know about selection logic. `content.js` just connects them.

Every event enters through `input.js`, which also decides who a press belongs to, once, as it begins: the bar's (a press on Lighthouse, heard only by its own `bar` and `drag` scopes), the user's (one begun holding Alt: anything can be selected, and the page neither hears the press nor acts on it) or the page's. Snapping is decided at release instead: with Alt down then, the selection stays exactly as dragged. Handlers never check where a press came from; they only receive the ones that are theirs.

Typing helpers step aside, unless a subscription opts in (`inProxyFields`), where no text is typed as prose: a proxy (a hidden or few-pixel field an editor types through and draws elsewhere: Monaco, Ace, CodeMirror 5) or an editor marked as not prose (spellcheck and autocorrect off: CodeMirror 6). Both are known by what they are (`isProxyField`), so no editor is named. A key or `beforeinput` a handler acts on (prevents and returns `true`) isn't heard by the page after it: Lexical would act on it again. The focused field is checked once at load as well: a page that focuses its input as it loads sends no `focusin`.

---

## Files

The repository: `extension/` is the extension itself (what Chrome loads and the store gets), `docs/` what to read, `scripts/` the store build, `tests/` the test suite, `.github/` the release workflow. Inside `extension/`:

```
manifest.json
icons/
src/
├── background/
│   ├── background.js        Services (the only network access), settings migration.
│   └── qr.js                QR codes, made locally.
├── content/
│   ├── content.js           Entry point: connects input to the pipeline and the state machine.
│   ├── styles.css           Everything in the shadow root. tokens.css: the design tokens.
│   └── page.css             The only styles in pages: highlight paint, converted values.
├── modules/
│   ├── actions.js           Every action: condition, execute, preview. Parsers (currency, units, dates...).
│   ├── api.js               Context (prepareContext) and tools; external calls: translate, define, rates.
│   ├── editing.js           Editing helpers for text fields: wrapping, brackets, tidy spacing, the owed space.
│   ├── geometry.js          Where a selection is drawn: page extents, the text-field mirror, selection edges.
│   ├── handles.js           Drag handles for adjusting selections.
│   ├── input.js             The only place listening to input; what counts as a text field.
│   ├── language.js          On-device language checks: is a selection foreign, page and user languages.
│   ├── markers.js           Highlights, painted by the browser (CSS Custom Highlight API); the page is never changed.
│   ├── send.js              Send: the composer (the last multi-line box typed in) and sending into it.
│   ├── math.js              Expression parsing and calculation.
│   ├── selection.js         Context detection, text insertion, snapping.
│   ├── state.js             Mode state machine, action filtering.
│   └── ui.js                Shadow DOM tooltip rendering.
├── offscreen/               Reads the clipboard for the extension (never the page).
├── popup/popup.js           Settings UI.
└── utils/
    ├── config.js            Every setting, declared once (default, options); validation.
    ├── data.js              Currencies, units, icons.
    └── utils.js             Shared helpers: elements, messaging, segmenters, tokens, frames.
```

---

## State modes

The bar's state machine is in `state.js`: every change is a named event, `State.send(event, data)`, and the table of events and transitions is at the top of `send`.

| Mode | When |
|---|---|
| `HIDDEN` | Nothing to show |
| `SELECTION` | Text selected on a page |
| `SMART` | Text selected and a parser matched (math, currency, date, units) |
| `INPUT` | A field: text selected in it, or the first click into it |
| `LINK` | A bar for something on the page: an external link pointed at; a value Convert page changed (what it was, Undo all); a highlight pointed at (Clear highlight); the text being read aloud (Pause, Speed, Stop: while reading, this bar returns whenever no other is shown). A context with `buttons` gets those. Selection changes never close it |
| `SNIPPET_MENU` | User typed `//` and matching snippets exist. It opens with the first one chosen; ← → choose another, Tab inserts the chosen one (Enter too, so a chat doesn't send a half-typed name), Space is just a space. The chosen one looks and previews as hovering does; the strip says the keys |
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

## Changing saved settings

Settings are saved only once someone changes them; everything else comes from the defaults in `config.js`. They sync between a person's computers, which can run different versions of Lighthouse for a while, and people skip versions. So:

- **Never delete automatically.** What this version doesn't know (a newer version's setting, a value it added, a button in the order) is kept, and ignored when read: `Config.validOnly` drops it from what is read, and the default applies. Deleting it would delete it for the newer version too, through sync.
- **Add, don't reshape.** A new field older versions ignore, or a new setting, keeps every version working. Don't change what an existing setting means.
- **Keep what you don't know when saving.** Editing an item (a snippet, an engine) keeps the fields this version doesn't use.
- **New defaults reach only people who never changed that setting.** A new built-in item in a list people edit (a search engine) reaches only new installs, unless an update adds it to saved lists.

When a reshape can't be avoided (snippets, saved as one item, will one day reach Chrome's limit of about 8 KB per synced item and need splitting):

1. Save the new shape under a new name; leave the old item untouched.
2. Read the new name first; without it, read the old item and convert it in memory. Write only when something is edited.
3. While older versions may still run, save both, the old shape too when the data still fits it.
4. Many versions later, stop saving the old item and delete that one name, deliberately.

## Shared tools

Each exists once; use it rather than writing another.

| Need | Use |
|---|---|
| Ask the background worker | `LighthouseUtils.ask()`: one shared answer per question, so preview, info, execute and page conversion share one request (`asyncQuery` in `api.js` unwraps it); `message()` for what must be asked fresh (the clipboard) |
| A language's name | `LighthouseUtils.languageName('de')` ("German") |
| Words or sentences | `LighthouseUtils.segmenter('word' \| 'sentence')` |
| A token in JavaScript (px, ms) | `LighthouseUtils.token('--so-duration', 200)` |
| Shorten text for display | `LighthouseUtils.shorten(text, max)` |
| A short message (Copied) | `LighthouseUtils.toast(msg, type, root)`: the bar's in its shadow root, Settings' in its page |
| Show something on screen | `LighthouseUtils.frame.draw(key, fn)`: runs in the next frame; `frame.cancel(key)` when hiding |
| The page selection | `LighthouseSelection.getActiveSelection()` |
| Where the selection is drawn | `LighthouseSelection.current().edges('painted')` (handles, the bar) or `edges('content')` (Highlight); `LighthouseGeometry` underneath |
| The selection's language | `ctx.language` / `ctx.foreign` (from `LighthouseLanguage.inspect()`) |
| Copy to the clipboard | `tools.copy()` |
| Put a result where it belongs: replacing the selection in a field, copied on the page | `tools.place(value)` |
| Make a range on the page open the bar when pointed at | `LighthouseContent.point.add(range, context)` / `.remove(range)` (`content.js`, as highlights do); elements are found by the `HOVERED` selector there |
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
| A field's length limit (maxlength), as the browser counts it | `LighthouseInput.lengthLimit(el)`: `{ length, max }`, or null when it states none |

Only `page.css` is injected into web pages; everything else is `styles.css` in the shadow root. Timings and spacing live in `tokens.css`.

## The context

`getContext()` also attaches `ctx.snapshot`: the selection frozen at that moment (`text` as selected, `cleanText`, `field` and `offsets` or a copy of the `range`, `caret`, `backward`, `pointer`) with two live parts, `edges(kind)`, measured against the current layout, and `language`, a promise decided once. Its `id` stays the same while the selection does. Nothing writes to it.

Two questions, two snapshots. *Where is the selection now* (handles, positioning, Highlight): `LighthouseSelection.current()`, the snapshot of the live selection, the same object while it is unchanged, so a keep-open action that changes the selection (Expand) is followed. *Which bar is this* (the pointer it opened at, the side it took): `ctx.snapshot`, the one the pipeline read. Choose the kind of surface by `snapshot.field` (set only for plain fields), not by `ctx.isInput`, which is also true for rich editors. `isInput` is true only where Lighthouse can change the selection: across lines in rich text it is false, and the bar offers what it offers for page text. There `ctx.text` is the selection as the browser reads it, with the line breaks between paragraphs and list items; read for positions (the snapshot's `text`), they run together.


`LighthouseAPI.prepareContext()` builds `ctx` once per selection, so `getParsed()` results last the whole render. Besides the raw fields it has `cleanText`, `wordCount` (segmented for Chinese, Japanese, Thai), `hasDigit`, `hasLetter`, `number`, `tools`, and `foreign` / `language`.

"Foreign" needs evidence: another script, a confident detection, or a declared language (nearest `lang`, else the page's) the user doesn't read. Chrome is unsure about most short text, so an unsure guess only counts when it names a language the user reads. Undecided: both Translate and Define are offered.

## Network

All requests go through `gatewayFetch` in `background.js`, without cookies or referrer, only to the manifest's `host_permissions` (any site only for opt-in link previews, once the user grants it); only LanguageTool may receive a POST body. QR codes are made in the background (`qr.js`): nothing is sent. Define reads English Wiktionary (the only edition with a definition endpoint) and translates the entry for readers without English. Spelling sends the selection and its sentence (at most 500 characters). Link icons come from Chrome's favicon cache.

`_favicon` is never web-accessible: any site could then read Chrome's favicon cache, and so which sites you've visited. Link icons in web pages come from the background (`FAVICON`) instead. The clipboard is read by the extension, never the page: `tools.readClipboard()` asks the background, which reads it in a hidden offscreen page (`src/offscreen/`). Read in the page, Chrome would prompt on every site and an allowed site would get the clipboard. Collected snippets are in `chrome.storage.session` (memory only), which only the extension can read: content scripts reach them through the `COLLECTION` service. Previews showing changing data (clipboard, collection) return `live: true` so they aren't cached.


**Local addresses** (this computer and the private network: `localhost`, `127.0.0.1`, `192.168.…`, one-word names, `.local`) are reachable only from a page that is itself local. A public page can't make Lighthouse reach them with a link preview or a site's icon; a page not known counts as public. The page is `sender.url`, always given for Lighthouse's own scripts. `network.test.js` checks this.

**Custom CSS loads nothing.** `safeCSS` in `data.js` lets the browser parse it and removes every declaration that would fetch an address (`url()`, `src()`, `image-set()` other than `data:`, and `@import`), escaped or hidden in a custom property included, so a shared theme can't report the pages it's shown on. Every theme goes through it in `resolveThemeCSS`.

**Privacy lockdown** (`onDevice`): `gatewayFetch` refuses every request, so nothing goes out whatever asks. An action that uses the network says so with `network`: `'preview'` (its preview and strip info need it; a click opens a site, so it stays) or `'always'` (it is nothing without the network: hidden). Declare it on any new action that reaches a service.
## Parsers

Parsers in `actions.js` receive `(text, ctx)` and are read through `getParsed()`. Dates: short selections only; tokens become a one-character "shape" matched by `DATE_PATTERNS`; names come from `LighthouseData.getDateVocabulary()`; any number left over rejects the match. An ambiguous `03/04` is read by `tools.dateOrder()` (browser language, or the time zone for plain English), and the preview offers the other reading unless a weekday settles it.

## Modifying text

Always use `tools.replace(text, options)` inside an action. Never manipulate `el.value` directly.

`tools.replace` calls `insertText` in `selection.js` which handles spacing, cursor placement, and undo in one place for both native inputs and contentEditable elements. Every edit's joins are tidied by one function, `tidySeam`: the spaces and marks around a join are rewritten as a whole, by Unicode role (separator, sentence end, opener, closer), judging only what the edit changed. Deleting, cutting and typing over a selection that holds a space go through `insertText` too, in plain fields and rich editors alike; pasting into rich text stays the editor's (its formatting, its own paste features). Brackets act on `beforeinput`, which comes only for a key no editor has taken: an editor that pairs brackets itself keeps its own.

Send puts a page selection into the last box typed in on the page, of any kind Lighthouse types into (not a structured or sensitive field, a code editor or a proxy field). `send.js` keeps it, weakly, with rich text's caret when it was left. It goes in where that caret was, through `insertText`, and the page doesn't scroll; in a one-line box lines become spaces and there is no quote. `tools.composer()` gives `{ el, label, multiline }` while the box is on the page and shown; `tools.send(text, { quote })` sends. The shortcut (`back-to-box` in the manifest's `commands`, Alt+L) flips between the page and the box. To the box: scrolled away, the box comes back; still on the screen (fixed below a chat), the chat comes back to where it was while typing (`view`, the text mid-screen at the last keystroke). It remembers what was mid-screen and the selection (a chat scrolls in its own panel, so not the page's scroll position); pressed again from the box, back there. `$.seen()` tells what is really on the screen; `$.reveal()` scrolls only to what isn't. It is the browser's: the background hears it and messages the tab, so no page key is listened to.

Rich text is read one line at a time, so a selection across lines isn't `writable`: the editor changes it, its own way. Editors keep their own model of the text and the selection, and four things in `selection.js` keep them in step, each with tests that fail without it (`tests/editors`): a selection Lighthouse moves is announced at once (`selectionchange`), as an editor acts on the selection it last heard of; the caret after an edit is placed once the editor's own update has landed; a selection being replaced is inserted over as it is, not narrowed first; and text with line breaks is handed to the editor as a paste, which every editor turns into its own paragraphs (inserted text keeps only its first line in Lexical).

Spacing follows the text's own convention, not one language's rules: a deletion removes a space only where it made one extra, and marks are recognized by Unicode category. A space taken away is owed: a word typed next at that caret gets it back. It's recorded in `insertText`, where every deletion goes (keys, the bar's Cut and Delete), and paid on the next keystroke (`editing.js`).

---

## Bar and handles

**Keys, wherever Lighthouse shows something:** the arrows move where you look: ← → along a row (the bar, the snippet menu, an open popover), ↑ ↓ between levels (into a popover above or below, whichever side it opens on). Tab completes or acts on what is chosen, Enter does the same, Escape steps back a level and then closes. A key Lighthouse acts on doesn't reach the page too. Today the snippet menu follows this; full keyboard use of the bar is still to come, and builds on the same rule.

The bar sits at whole pixels, centered on the selection on the edge nearer the pointer (one line: above), and moves with the text while scrolling. It rises out of the selection when it appears; when it leaves or moves to another line a snapshot fades out where it was; on the same line it glides. Handles are drawn under the bar, and below a selection the bar keeps clear of their tabs.

## Shadow DOM

The bar, its handles and the highlights' button and hints render in a closed shadow root: the page can't break their styles or read what they show. Use the tokens from `tokens.css` (`var(--so-ink)`, `var(--so-surface)`, ...); in the shadow root they come with the user's theme.

---

## Tests

`tests/` holds logic tests and browser tests that load the real extension into Chromium; see `tests/editors/README.md`. Run `npm test` in `tests/editors` before and after a change, and add a test with every bug fix. `tests/editors/` runs the content scripts against real editors (ProseMirror, Lexical, Quill, CodeMirror 6) and the settings popup; see its README.

**On real sites, by hand.** The tests run against the editors sites are built with, not the sites themselves. After a change to how text is read, written or measured, check: a chat app (claude.ai, ChatGPT or Gemini: select in an answer, type and use a snippet in the message box, Send), a mail app (Gmail: compose, brackets, tidy spacing), a code site (GitHub: a file, a comment box), and a notes app (Notion).

**Releasing:** add the version's section to `CHANGELOG.md`, its heading exactly the version (`## 1.51` for `1.51`: the workflow stops when there is none), raise `version` in `manifest.json`, and push to `Revamp`. A workflow (`.github/workflows/Release.yml`) then makes the release, with those notes and two packages: `lighthouse-<version>-source.zip`, the extension's files as they are here, and `lighthouse-<version>.zip`, the one for the Chrome Web Store, built from them by `scripts/build-store.sh` (comments dropped, text in plain ASCII, the code otherwise unchanged and readable: about a fifth less memory in every tab). The build is reproducible: to check a release's store package, check out its tag and run `sh scripts/build-store.sh`; the zip's SHA-256 matches the one in the release notes. The tests can run against a store package too: unzip it and set `LIGHTHOUSE_ROOT` to that folder. A push that keeps the version makes none.

## Debugging

**Content scripts:** in the page's console (F12), choose Lighthouse in the context menu at the top (it says "top" by default); then `LighthouseState`, `LighthouseSelection.current()` and the rest can be read.

**Background:** `chrome://extensions` → Lighthouse → service worker. Service errors show up here.