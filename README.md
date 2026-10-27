# Lighthouse

Lighthouse is a lightweight browser extension that puts the right tools in front of you at the right time - so the small stuff never pulls you away from what you're doing.

Select text or click into a field and what you need is already there. Nothing more, nothing less.

---

## Features

**On any page**
*Without leaving what you're reading*
- Search, Translate, Define, Read aloud, Highlight
- Math, Currency, Units, Dates, Colors, JSON, Base64
- Wikipedia preview, QR code

**In any text field**
*Without breaking what you're writing*
- Paste (including everything you collected), Cut, Delete, Clear, Case
- Spelling and grammar, in many languages
- Wrap, saved phrases and details on demand
- Character limits, where a field has one

**The details**
*The small frictions that usually go unnoticed*
- Shows only what's relevant for what you selected
- Smart word snapping
- Spacing and punctuation correct themselves
- Auto-paired brackets
- Drag handles to adjust your selection

---

## Installation

Lighthouse isn't on the Chrome Web Store yet.

1. Download or clone this repository
2. Go to `chrome://extensions/` and enable **Developer mode**
3. Click **Load unpacked** and select the folder

Works on Chrome, Brave, and Edge.

---

## Settings

Works out of the box for most people. If you want to adjust it to fit how you work - reorder or hide actions, add search engines, set your language and currency, or disable it on specific sites - it's all in the toolbar icon.

---

## Privacy

Language checks happen on your device. Lighthouse only contacts a service when you use a feature that needs one, and sends only what that feature needs, without cookies:

- **Translate and Define:** Google Translate (the selected text) and Wiktionary (the selected word)
- **Wikipedia:** Wikipedia (the selected term)
- **Currency:** Coinbase (exchange rates only; nothing you selected)
- **Spelling:** [LanguageTool](https://languagetool.org) (the selection and the sentence around it, at most 500 characters). See their [privacy policy](https://languagetool.org/legal/privacy).
- **Link previews** (off by default): the page you hover

Link icons come from your browser's own cache. Things you collect stay in memory and are cleared when the browser closes.

---

## Contributing

Plain JavaScript, no bundler, no framework. See [DEVELOPER.md](./DEVELOPER.md).

---

## License

MIT