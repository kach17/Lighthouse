# Changelog

## 1.51

- Lighthouse is now called Lighthouse — Selection Toolbar, to say what it is.
- Fixed: letters that reach below the line (g, y, p, j) were cut off in the bar's status line, Paste's text and other one-line previews.
- Settings explain more plainly what selecting whole words, tidy spacing, and the languages you read and write in do.

## 1.5

**Privacy**
- Privacy lockdown: one switch in Settings, and Lighthouse contacts no service at all. No previews, exchange rates or spelling, and only your device's own voices; a click can still open a site.
- Read aloud prefers a voice on your device, so what it reads stays there. Before, it could pick one of Chrome's online voices, which send the text away to be spoken.

**Back to where you were**
- Alt+L takes you back to the last box you typed in, with the cursor where you left it. Press it again to return to where you were reading, your selection included.
- On chat sites, where the conversation scrolls above a fixed box, Alt+L brings the conversation back to where it was while you typed.
- Chrome listens for the shortcut, not the page. Settings shows it, and a click there changes it.
- Send now works with any box you type in, like a site's search box: select a word on the page and Send puts it there.

**Snippets**
- The snippet menu works like completion elsewhere: it opens with the first snippet chosen, ← → choose another, and Tab inserts it.
- Space is just a space now. Enter inserts too, so a chat never sends a half-typed name.

**Fixes**
- Escape closes Lighthouse's bar or snippet menu without the page reacting to it too; an editor no longer loses your cursor.
- In an empty text box, the line above Paste read "Pa…". It now says "Paste" in full.

**Under the hood**
- Lighthouse works as before, rebuilt so that each decision is made in one place: where a selection sits on screen, whether a text box can be edited, and what the bar shows. Bugs like the ones fixed in 1.45, where the bar and the handles disagreed about where a selection was, can't happen that way anymore.

## 1.45

- Fixed: on long pages, a drag handle could appear far from the selection.
- Fixed: on some chat pages, the bar went to the top of the screen instead of next to the selection.
- More measurements: volumes and speeds join lengths, weights and temperatures, in every language your browser knows.
- Conversions read naturally: 0.5 km as 1,640.4 ft, 180 cm as 5 ft 11 in, always to one decimal.
- Measurements in two units, like 6 ft 6 in or 5 lb 4 oz, are read as one.
- After brackets, quotes or a snippet at the end of a line, the next word you type gets its space; a period or comma doesn't.

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