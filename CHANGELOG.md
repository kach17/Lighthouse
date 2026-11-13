# Changelog

## 1.4

**Works in more places**
- Brackets and tidy spacing now work in rich text editors too, like the ones in chat apps, email and notes, not only in plain text boxes.
- Fixed: on pages that focus their text box as they load, snippets, brackets and tidy spacing didn't work until you switched tabs and back.
- Fixed: multi-line snippets lost every line after the first in some editors.
- Fixed: the background service failed to start on Linux.
- Fixed: in text fields, a drag handle could sit on the line above or below the selection (a selection begun past a line's end, or a whole line selected).
- Fixed: a selection dragged into the empty space below the text wasn't widened to whole words.
- The bar for a click into a text box now always appears just above the line you clicked on, the same in every kind of box (it used to go above the whole box in some, and move with the click in others).
- Fixed: copying (and translating, collecting, searching) a selection across paragraphs or list items ran them together ("jumps.Over"); line breaks are kept.

**Send**
- Select text on a page and Send puts it into the last message box you wrote in on that page, right where your cursor was, with tidy spacing. It only appears once you've written in such a box (a chat, an email, a comment), and the bar says which box. It never sends the message itself.
- Hover Send for "Send as quote": the text on lines of its own, each starting with "> ", ready for your question underneath.

**Snippets**
- Enter now inserts a snippet whose whole name you typed; a chat no longer sends the literal `//name`.
- Choosing among several: Tab picks one (again for the next), ← → move, Enter inserts. The bar says which key does what.
- Click a snippet in Settings to copy it, for places typing can't reach.
- The Snippets tab explains itself at the top, and "Add snippet" stays in reach in a long list.

**Defaults for new installs**
- Spelling is off until you turn it on: it's the one feature that sends what you write (the selection and its sentence) to a server, LanguageTool.
- A new bar shows icons only (the strip under it names the button you point at), with Send right after Copy.
- A new bar starts with Read aloud, Highlight, Expand, QR code, Delete and Clear on, and Collect, Calculate and the developer tools (JSON, Base64, Color) off. Your own settings are kept.

**Tidier, and out of the way**
- Typing over a selection that ends in a space keeps the space ("small " → "big noodles").
- Text inserted inside a word no longer gets spaces around it.
- Code editors are left alone, so tidying never touches your code.
- Selections across paragraphs in rich editors are left to the editor, and the bar no longer offers editing there.
- An editor's own bracket pairing is respected.