// The features the restructuring will touch that the other tests don't reach: highlights, Read aloud, Convert page
// and its undo, and the bar's previews (a definition, a translation), each through the real bar, with real clicks
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, wait, drag, textAt, clickBar, point, strip, popover, inBar } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

// A page paragraph, and a drag over it from `from` to the end of `to`
async function page(p, html) { await p.evaluate((h) => document.body.insertAdjacentHTML('afterbegin', `<p id="src" style="font:18px sans-serif; margin:120px 40px 20px">${h}</p>`), html); }
async function over(p, from, to = from) { await drag(p, await textAt(p, '#src', from), await textAt(p, '#src', to, true)); }

test('Highlight paints the selection, and Clear highlight removes it', async () => {
    const p = await open(browser, { openShadow: true, settings: { order: ['marker', 'copy', 'search'] } });
    await page(p, 'The quick brown fox jumps over the lazy dog.');
    await over(p, 'quick', 'brown');
    await clickBar(p, 'Highlight');
    const painted = await p.evaluate(() => [...CSS.highlights.values()].flatMap(h => [...h]).map(r => r.toString()));
    assert.deepStrictEqual(painted, ['quick brown']);
    assert.strictEqual(await p.evaluate(() => document.getElementById('src').innerHTML), 'The quick brown fox jumps over the lazy dog.', 'the page itself is unchanged');
    // Pointed at, with nothing selected, a highlight opens its own bar
    await p.mouse.click(30, 400); await wait(400);
    const word = await p.evaluate(() => { const t = document.getElementById('src').firstChild, r = document.createRange(); r.setStart(t, 4); r.setEnd(t, 9); const q = r.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; });
    await p.mouse.move(...word, { steps: 4 }); await wait(900);
    await clickBar(p, 'Clear highlight');
    assert.strictEqual(await p.evaluate(() => [...CSS.highlights.values()].reduce((n, h) => n + h.size, 0)), 0);
    await p.close();
});

test('Read aloud speaks the selection', async () => {
    const p = await open(browser, { openShadow: true, voices: true, settings: { order: ['speak', 'copy', 'search'] } });
    await page(p, 'The quick brown fox jumps over the lazy dog.');
    await over(p, 'The', 'dog.');
    await clickBar(p, 'Read aloud');
    await wait(300);
    assert.match((await p.evaluate(() => window.spoken)).join(' '), /The quick brown fox jumps over the lazy dog\./);
    await p.close();
});

test('Read aloud uses a voice on the device when there is one', async () => {
    const p = await open(browser, { openShadow: true, voices: true, settings: { order: ['speak', 'copy', 'search'] } });
    // Chrome's online voice first in the list, then one on the device: the one on the device reads
    await p.evaluate(() => { const online = { lang: 'en-US', name: 'Google US English', voiceURI: 'g', localService: false, default: true }, here = { lang: 'en-GB', name: 'Daniel', voiceURI: 'd', localService: true, default: false };
        speechSynthesis.getVoices = () => [online, here]; speechSynthesis.speak = (u) => { window.spoken.push(u.voice && u.voice.name); }; });
    await page(p, 'The quick brown fox jumps over the lazy dog.');
    await over(p, 'The', 'dog.');
    await clickBar(p, 'Read aloud'); await wait(300);
    assert.deepStrictEqual(await p.evaluate(() => [...new Set(window.spoken)]), ['Daniel']);
    await p.close();
});

test('Convert page converts prices and measurements, and Undo all puts them back', async () => {
    const p = await open(browser, { openShadow: true, settings: { standards: { currency: 'USD', units: 'metric', language: 'en' } },
        replies: { GET_RATE: { rate: 0.00668, asOf: Date.now() } } });
    await page(p, 'Rooms from ¥12,000, sunny at 77°F.');
    await over(p, '¥12,000');
    await point(p, '$');
    await clickBar(p, 'Convert page');
    await wait(500);
    assert.strictEqual(await p.evaluate(() => document.getElementById('src').textContent), 'Rooms from $80.16, sunny at 25°C.');
    // Pointed at, with nothing selected, a converted value opens its own bar
    await p.mouse.click(30, 400); await wait(400);
    const value = await p.evaluate(() => { const c = document.querySelector('#src .lighthouse-converted') || document.getElementById('src'); const q = c.getBoundingClientRect(); return [q.left + 6, q.top + q.height / 2]; });
    await p.mouse.move(...value, { steps: 4 }); await wait(900);
    await clickBar(p, 'Undo all');
    assert.strictEqual(await p.evaluate(() => document.getElementById('src').textContent), 'Rooms from ¥12,000, sunny at 77°F.');
    await p.close();
});

test('Define shows the definition, and the strip the word\'s language', async () => {
    const p = await open(browser, { openShadow: true, settings: { order: ['dictionary', 'copy', 'search'] },
        replies: { DEFINE: { result: { definition: 'A small wild animal of the dog family.', language: 'en', link: 'https://en.wiktionary.org/wiki/fox' } } } });
    await page(p, 'The quick brown fox jumps.');
    await over(p, 'fox');
    await point(p, 'Define');
    assert.match(await popover(p) || '', /A small wild animal of the dog family\./);
    assert.match(await strip(p) || '', /English word/);
    await p.close();
});

test('Translate shows the translation over the words', async () => {
    const p = await open(browser, { openShadow: true, settings: { order: ['translate', 'copy', 'search'] },
        replies: { TRANSLATE: { result: { text: 'The brown fox sleeps.', sourceLang: 'fr', targetLang: 'en' } } } });
    await page(p, 'Le renard brun dort.');
    await over(p, 'Le', 'dort.');
    await point(p, 'Translate');
    assert.match(await popover(p) || '', /The brown fox sleeps\./);
    await p.close();
});

// Privacy lockdown: nothing is asked of the background's services, actions that are nothing without the network
// are not offered, a preview from the network isn't asked for (a click still opens the site), and no online voice
test('privacy lockdown: no previews asked for, network-only actions hidden', async () => {
    const replies = { DEFINE: { result: { definition: 'A small wild animal.', language: 'en', link: 'https://en.wiktionary.org/wiki/fox' } }, GET_RATE: { rate: 0.00668, asOf: Date.now() } };
    const p = await open(browser, { openShadow: true, replies, settings: { onDevice: true, order: ['dictionary', 'currency', 'copy', 'search'], standards: { currency: 'USD', units: 'metric', language: 'en' } } });
    await page(p, 'The quick brown fox costs ¥12,000.');
    await over(p, 'fox');
    await point(p, 'Define');
    assert.strictEqual(await popover(p), null, 'no definition fetched');
    await over(p, '¥12,000');
    const names = await p.evaluate(() => LighthouseState.activeActions.map(a => a.id));
    assert.ok(!names.includes('currency'), `no currency button (${names})`);
    const asked = await p.evaluate(() => (window.asked || []).filter(a => ['DEFINE', 'GET_RATE', 'TRANSLATE', 'WIKI_SUMMARY'].includes(a)));
    assert.deepStrictEqual(asked, [], 'nothing asked of the network services');
    await p.close();
});

test('privacy lockdown: Read aloud is not offered with online voices only', async () => {
    const p = await open(browser, { openShadow: true, voices: true, settings: { onDevice: true, order: ['speak', 'copy', 'search'] } });
    await p.evaluate(() => { speechSynthesis.getVoices = () => [{ lang: 'en-US', name: 'Google US English', voiceURI: 'g', localService: false, default: true }]; });
    await page(p, 'The quick brown fox jumps over the lazy dog.');
    await over(p, 'The', 'dog.');
    assert.ok(!(await p.evaluate(() => LighthouseState.activeActions.map(a => a.id))).includes('speak'));
    await p.close();
});

// A selection too long to search (over 2,000 characters: the address would fail) has no Search button
test('search: not offered for a selection too long to search', async () => {
    const p = await open(browser, { openShadow: true });
    await p.evaluate(() => document.body.insertAdjacentHTML('afterbegin', `<p id="long" style="font:14px sans-serif; margin:150px 40px 20px">${'All work and no play makes a dull day. '.repeat(70)}</p>`));
    // A real drag (Lighthouse ignores made-up events): from its first word to the end of its last line
    const end = await p.evaluate(() => { const q = document.getElementById('long').getBoundingClientRect(); return [q.right - 2, q.bottom - 4]; });
    await drag(p, await textAt(p, '#long', 'All'), end);
    const buttons = await inBar(p, (root) => [...root.querySelectorAll('#lighthouse-extension-tooltip > .lighthouse-btn')].map(b => b.dataset.action));
    assert.ok(buttons.includes('copy'), `the bar is there (${buttons})`);
    assert.ok(!buttons.includes('search'), `no Search (${buttons})`);
    await p.close();
});

// Custom CSS loads nothing (a shared "theme" could otherwise report every page it is shown on)
const TRICKS = [
    ['url()', '#x { background: url(https://evil.test/a.png); color: red; }'],
    ['an escaped url', '#x { background: \\75 rl(https://evil.test/b.png); }'],
    ['image-set', '#x { background-image: image-set("https://evil.test/c.png" 1x); }'],
    ['@import', '@import url(https://evil.test/d.css); #x { color: red; }'],
    ['a custom property', ':root { --bg: url(https://evil.test/e.png); } #x { background: var(--bg); }'],
    ['@font-face', '@font-face { font-family: f; src: url(https://evil.test/f.woff2); }'],
    ['@media', '@media (min-width: 1px) { #x { background: url("//evil.test/g.png"); } }'],
    ['a nested rule', '#x { & .y { background: url(https://evil.test/h.png); } }'],
];
test('custom CSS: every way of loading anything is removed, the rest kept', async () => {
    const p = await open(browser);
    for (const [name, css] of TRICKS) {
        const out = await p.evaluate((css) => window.LighthouseData.safeCSS(css), css);
        assert.ok(!/evil\.test/.test(out), `${name}: ${out}`);
    }
    const kept = await p.evaluate(() => window.LighthouseData.safeCSS('#x { color: red; background: url(data:image/png;base64,AAAA); }'));
    assert.match(kept, /color: red/); assert.ok(!/url\(/.test(kept), 'a theme loads nothing, not even a built-in image');
    const theme = await p.evaluate(() => { const t = window.LighthouseData.resolveThemeCSS({ themeMode: 'dark' }); return window.LighthouseData.safeCSS(t) === t; });
    assert.ok(theme, 'a theme as made by Settings passes unchanged');
    await p.close();
});

test('custom CSS: a booby-trapped theme sends nothing while Lighthouse is used', async () => {
    const http = require('http'); let hits = 0;
    const server = http.createServer((req, res) => { hits++; res.end(''); }); await new Promise(r => server.listen(0, '127.0.0.1', r));
    const at = `http://127.0.0.1:${server.address().port}`;
    const css = TRICKS.map(([, c]) => c.replace(/https:\/\/evil\.test|\/\/evil\.test/g, at)).join('\n').replace(/#x/g, '#lighthouse-extension-tooltip');
    const p = await open(browser, { openShadow: true, settings: { customStyles: css } });
    await p.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<p id="src" style="font:18px sans-serif; margin:150px 40px 20px">The quick brown fox jumps over the lazy dog.</p>'));
    await drag(p, await textAt(p, '#src', 'quick'), await textAt(p, '#src', 'fox', true));
    await point(p, 'Copy', { preview: false }); await wait(800);
    await p.close(); server.close();
    assert.strictEqual(hits, 0, 'the tracking server heard nothing');
});

// Copied links come without their tracking codes; anything else comes back exactly as given
test('cleanLink: tracking codes go, everything else is kept as written', async () => {
    const p = await open(browser);
    const out = await p.evaluate(() => [
        'https://example.com/page?utm_source=x&id=7&fbclid=abc',
        'www.example.com/a?gclid=1',
        'https://example.com',
        'https://example.com/page is great',
        'Read https://example.com/?utm_source=x now',
        'not a link',
    ].map(window.LighthouseUtils.cleanLink));
    assert.deepStrictEqual(out, ['https://example.com/page?id=7', 'www.example.com/a', 'https://example.com',
        'https://example.com/page is great', 'Read https://example.com/?utm_source=x now', 'not a link']);
    await p.close();
});

for (const how of ['pointing at a link', 'selecting its text']) {
    test(`copy a link by ${how}: without its tracking codes`, async () => {
        const p = await open(browser, { openShadow: true });
        await p.evaluate(() => {
            window.copiedText = [];   // a stand-in clipboard (the test page isn't a secure origin: it has none)
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.copiedText.push(t); return Promise.resolve(); } } });
            document.body.insertAdjacentHTML('afterbegin', '<p id="src" style="font:18px sans-serif; margin:150px 40px 20px">See <a id="a" href="https://example.com/a?utm_medium=mail&x=2&fbclid=9">this page</a> or https://example.com/b?gclid=5&y=3 today.</p>');
        });
        if (how === 'pointing at a link') {
            const at = await p.evaluate(() => { const q = document.getElementById('a').getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; });
            await p.mouse.move(at[0], at[1] + 30); await p.mouse.move(...at, { steps: 4 }); await wait(900);
        } else await drag(p, await textAt(p, '#src', 'https'), await textAt(p, '#src', 'y=3', true));
        await clickBar(p, 'Copy'); await wait(200);
        assert.deepStrictEqual(await p.evaluate(() => window.copiedText), [how === 'pointing at a link' ? 'https://example.com/a?x=2' : 'https://example.com/b?y=3']);
        await p.close();
    });
}

// Collect, with something collected already, adds to it and says so; with nothing, it's just Collect
for (const [had, label, says] of [[[], 'Collect', null], [['first', 'second', 'third'], 'Collect more', '3 collected so far']]) {
    test(`collect: ${had.length ? 'adding to what is collected' : 'nothing collected yet'}`, async () => {
        const p = await open(browser, { openShadow: true, settings: { enabled: { stack: true }, showLabels: true }, replies: { COLLECTION: { items: had } } });
        await p.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<p id="src" style="font:18px sans-serif; margin:150px 40px 20px">The quick brown fox jumps over the lazy dog.</p>'));
        await drag(p, await textAt(p, '#src', 'quick'), await textAt(p, '#src', 'fox', true)); await wait(400);
        const shown = await inBar(p, (root) => { const b = root.querySelector('#lighthouse-extension-tooltip > .lighthouse-btn[data-action="stack"]'); return b && b.querySelector('.lighthouse-label').textContent; });
        assert.strictEqual(shown, label);
        if (says) { await point(p, label, { preview: false }); assert.match(await strip(p), new RegExp(says)); }
        await p.close();
    });
}