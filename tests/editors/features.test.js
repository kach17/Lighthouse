// The features the restructuring will touch that the other tests don't reach: highlights, Read aloud, Convert page
// and its undo, and the bar's previews (a definition, a translation), each through the real bar, with real clicks
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, wait, drag, textAt, clickBar, point, strip, popover } = require('./helpers');

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
