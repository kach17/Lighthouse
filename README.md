# Lighthouse

**Help that shows up only when you need it.**

Select anything on a page and the right tools appear: a translation, a definition, a converted price. Type anywhere and the small stuff takes care of itself. The rest of the time, you won't notice Lighthouse is there.

![Select anything and the right tools appear](docs/images/screenshot-1.png)

---

## When you read

Select a word, a name or a whole sentence and get what you need without leaving the page.

- **Look it up:** definitions, Wikipedia previews and search, with your choice of search engines
- **Translate:** text in another language, translated right over the words
- **Numbers in your terms:** prices, measurements, dates and more, the way you know them
- **Keep and share:** highlight what matters, listen to it, or take it with you

![Quick facts and translations over the words](docs/images/screenshot-2.png)

## When you write

In any text box.

- **Snippets:** the phrases you type again and again, two keystrokes away
- **Send:** bring text from the page into the message you're writing
- **Translate what you write** into the language you need
- **Spelling and grammar** in many languages
- **Collect and paste:** gather bits from anywhere, then paste them all at once

![Your words, two keystrokes away](docs/images/screenshot-3.png)

## The small stuff, handled

Things you'd normally fix by hand, done before you notice. A few of them:

- Selecting part of a word selects the whole word
- Deleting or pasting leaves the spacing and punctuation right
- Typing a quote or bracket around a selection wraps it instead of replacing it
- Copied links come out without tracking codes
- Drag handles let you adjust a selection precisely

![The everyday small stuff, answered right where it is](docs/images/screenshot-4.png)

## Make it yours

Everything works out of the box. If you want to adjust it, reorder or hide buttons, add search engines, set your language and currency, or switch Lighthouse off for any site.

![Your buttons, your search engines, your choice of sites](docs/images/screenshot-5.png)

---

## Installation

Lighthouse isn't on the Chrome Web Store yet.

1. Download or clone this repository
2. Go to `chrome://extensions/` and turn on **Developer mode**
3. Click **Load unpacked** and select the folder

Works on Chrome, Edge and Brave.

---

## Privacy

Lighthouse runs on every page so it can appear when you select something, which is why Chrome asks for permission to read the pages you visit. It never stores or sends what you browse.

When a feature needs an outside service, Lighthouse sends only what that feature needs, and only when you point at or use it:

- **Translate and Define:** Google Translate and Wiktionary receive the words you selected
- **Wikipedia:** Wikipedia receives the name you selected
- **Currency:** Coinbase provides exchange rates; nothing you selected is sent
- **Spelling** (off by default): [LanguageTool](https://languagetool.org) receives the text you're checking and the sentence around it. See their [privacy policy](https://languagetool.org/legal/privacy).
- **Link previews** (off by default): the page behind the link you point at

Everything else happens on your device. Things you collect are forgotten when the browser closes, and your snippets stay with your browser. There is no account, no analytics and no ads.

---

## Contributing

Plain JavaScript, no bundler, no framework. See [DEVELOPER.md](./DEVELOPER.md).

---

## License

[MIT](./LICENSE)
