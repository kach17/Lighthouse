# Editor tests

The content scripts, loaded as the manifest lists them, against the editors Lighthouse meets in pages:
ProseMirror, Lexical and Quill (each with its own undo history), CodeMirror 6, a plain contenteditable,
plain fields, an editor that pairs brackets itself and a hidden proxy field; and the settings popup.

```
npm install     # once: the editors, esbuild, Puppeteer (downloads its Chrome)
npm test        # builds fixtures/editors.js into build/, then runs every *.test.js

To test a store package instead of the source, unzip it and set `LIGHTHOUSE_ROOT` to that folder (`LIGHTHOUSE_ROOT=/tmp/built npm test`).

While working on one area, run its group; run everything (`npm test`) before a change is finished:

| Command | Runs | Takes |
|---|---|---|
| `npm run test:fast` | Unit conversions, no browser | about a second |
| `npm run test:editing` | Brackets, tidy spacing, the owed space, rich text, undo, code editors | a few minutes |
| `npm run test:writing` | Snippets and Send | a few minutes |
| `npm run test:geometry` | Handles, the caret bar, snapping, selected text | about a minute |
| `npm run test:features` | Highlights, Read aloud, Convert page, previews, the settings window, units | about a minute |

```

One area: `node --test snippets.test.js`; one test: `node --test --test-name-pattern="focused before" snippets.test.js`.
To use another Chrome: `PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npm test`.

| File | What it holds to |
|---|---|
| `brackets.test.js` | Wrapping, auto-close, step over, paired Backspace in every editor; an editor's own pairing and proxy fields left alone |
| `tidy.test.js` | Deleting, cutting, typing over a selection leave one clean join in every editor; the joins themselves (`tidySeam`) |
| `rich-text.test.js` | Lines arrive as the editor's paragraphs; across lines the editor's own result; editing buttons only where Lighthouse can edit . Known flaky: *pm: Backspace over "world⏎second"* fails now and then with or without Lighthouse's changes (ProseMirror's own timing) |
| `caret-bar.test.js` | The bar for a caret: above the caret's line in every editor, empty or not, wherever the click lands |
| `code-editor.test.js` | CodeMirror 6 exactly as without Lighthouse |
| `snippets.test.js` | Space after a name, the menu's keys, the strip and preview, fields focused before load |
| `features.test.js` | Highlight and Clear highlight, Read aloud, Convert page and Undo all, the Define and Translate previews: through the real bar, with real clicks |
| `handles.test.js` | Drag handles on the selected text, also when a field's selection begins or ends with a line break |
| `snapping.test.js` | A drag snapped to whole words, also when it begins or ends in empty space beside the text |
| `send.test.js` | Send: offered only after writing in a composer, in at the caret, as a quote, no scrolling, one undo |
| `selection-text.test.js` | The text actions get keeps line breaks between paragraphs and list items |
| `owed-space.test.js` | After a wrap, a snippet or a pair left at the end of a line, the next word gets its space, a mark none |
| `units.test.js` | Measurements in any language, shown in the other system in the unit that reads naturally (no browser needed) |
| `undo.test.js` | Every Lighthouse edit is one undo step, in the browser's or the editor's history |
| `offscreen.test.js` | The hidden clipboard page: opened for a read, closed 20 s after the last one (no browser needed) |
| `popup.test.js` | The Snippets instruction, copying (click, keyboard) with the toast, Add in reach |

`helpers.js` opens a page with every editor and the bar's real stylesheets (`open`), and reads or drives one by name: `set`, `select`
(`[line, column]`), `text`, `press` ('Shift+Tab'), `type`, `undo`. `open(browser, { lighthouse: false })`
gives the same page without the extension, to compare with what the editor does on its own.

The Lexical lines in `selection.js` (announcing a moved selection, placing the caret after the editor's
update, inserting over a selection as it is, lines as a paste) each have tests here that fail without them.
