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
│   ├── actions.js           Every action: condition, execute, preview.
│   ├── api.js               External calls: translate, define, rates.
│   ├── handles.js           Drag handles for adjusting selections.
│   ├── markers.js           Page-level text highlighting.
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
    preview: (ctx, tools) => {         // optional, shown on hover
        return { previewText: '...' };
    }
}
```

`keepOpen: true` keeps the tooltip open after execute - useful for actions the user might repeat like Case toggle.

The background script automatically migrates new actions into existing users' settings. You don't need to touch migration.

---

## Modifying text

Always use `tools.replace(text, options)` inside an action. Never manipulate `el.value` directly.

`tools.replace` calls `insertText` in `selection.js` which handles spacing, cursor placement, and undo in one place for both native inputs and contentEditable elements.

---

## isEditableElement

```js
const { isForm, isEditable } = window.LighthouseSelection.isEditableElement(el);
```

Use this whenever you need to check if an element accepts text input. It correctly excludes password fields, buttons, and other non-text inputs that a raw `tagName === 'INPUT'` check would miss.

---

## Shadow DOM

The tooltip renders inside a Shadow Root. The page can't break its styles and it can't leak onto the page. When writing UI code, use the existing CSS variables (`var(--so-text-color)` etc.) - they're defined inside the shadow root, not on `:root`.

---

## Debugging

**Page console (F12)**  state transitions log as `[Lighthouse] ...`

**Background script** - `chrome://extensions` → Lighthouse → service worker. API errors show up here.

**Inspecting state** - `window.LighthouseState` is accessible from the page console.