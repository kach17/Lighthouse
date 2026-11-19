// Snippets, as completion works elsewhere: the menu opens with the first snippet chosen, ← → choose another, Tab
// inserts (Enter too, so a chat doesn't send), Space is just a space. What the strip and preview show, and fields
// focused before the extension loaded
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, select, text, press, type, wait, inBar } = require('./helpers');

const SNIPPETS = [
    { trigger: 'addr', expansion: '221B Baker Street' },
    { trigger: 'address', expansion: '221B Baker Street, London NW1 6XE' },
    { trigger: 'sig', expansion: 'Best, Kach' },
];
const settings = { shortcuts: SNIPPETS };
let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

async function typed(ed, act, options = {}) {
    const p = await open(browser, { settings, ...options });
    await set(p, ed, ['']);
    await select(p, ed, [0, 0]);
    await act(p);
    await wait(150);
    const result = await text(p, ed);
    const sent = await p.evaluate(() => document.getElementById('sent').textContent);
    await p.close();
    return sent ? `${result} [sent ${sent}]` : result;
}

for (const ed of ['ta', 'in', 'ce', 'pm', 'lx', 'ql']) {
    test(`${ed}: Tab inserts a snippet`, async () => {
        assert.strictEqual(await typed(ed, async (p) => { await type(p, 'Hi //addr'); await wait(250); await press(p, 'Tab'); }), 'Hi 221B Baker Street');
    });
}

// The menu: [keys after typing, expected]
const MENU = [
    ['//ad', ['Tab'], '221B Baker Street'],                              // the first is chosen as the menu opens
    ['//ad', ['ArrowRight', 'Tab'], '221B Baker Street, London NW1 6XE'],
    ['//ad', ['ArrowRight', 'ArrowLeft', 'Tab'], '221B Baker Street'],
    ['//ad', ['ArrowLeft', 'Tab'], '221B Baker Street, London NW1 6XE'], // round, to the last
    ['//ad', ['Enter'], '221B Baker Street'],                            // Enter inserts too
    ['//sig', ['Tab'], 'Best, Kach'],
    ['//addr', [' '], '//addr '],                                        // Space is a space
    ['//ad', ['Escape', 'ArrowLeft', 'x'], '//axd'],                     // closed, the arrows are the text's again
];
for (const ed of ['ta', 'pm', 'lx']) for (const [name, keys, want] of MENU) {
    test(`${ed}: ${name} then ${keys.join(' ')}`, async () => {
        assert.strictEqual(await typed(ed, async (p) => { await type(p, name); await wait(250); for (const k of keys) k.length === 1 ? await type(p, k) : await press(p, k); }), want);
    });
}

// A chat that sends on Enter: while the menu is open, Enter inserts and the chat doesn't send; otherwise it sends
test('chat: Enter after a whole name inserts and doesn\'t send', async () => {
    const chat = async (p) => p.evaluate(() => { const c = document.getElementById('chat'); c.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sent').textContent = c.value; c.value = ''; } }); });
    assert.strictEqual(await typed('ta', async (p) => { await chat(p); await p.focus('#chat'); await type(p, '//sig'); await wait(250); await press(p, 'Enter'); await p.evaluate(() => { document.getElementById('ta').value = document.getElementById('chat').value; }); }), 'Best, Kach');
    assert.strictEqual(await typed('ta', async (p) => { await chat(p); await p.focus('#chat'); await type(p, '//ad'); await wait(250); await press(p, 'Enter'); await p.evaluate(() => { document.getElementById('ta').value = document.getElementById('chat').value; }); }), '221B Baker Street');
    assert.strictEqual(await typed('ta', async (p) => { await chat(p); await p.focus('#chat'); await type(p, 'hello'); await wait(250); await press(p, 'Enter'); }), ' [sent hello]');
});

// What the bar shows: the strip says the keys, the chosen snippet's preview is open as on hover
test('the strip says the keys; a pick opens its preview', async () => {
    const p = await open(browser, { settings, openShadow: true });
    await set(p, 'ta', ['']); await select(p, 'ta', [0, 0]);
    const bar = () => inBar(p, (root) => {
        const strip = root.querySelector('.lighthouse-strip .is-shown') || root.querySelector('.lighthouse-strip');
        const picked = root.querySelector('.lighthouse-btn.is-picked');
        const preview = [...root.querySelectorAll('.lighthouse-btn > div.visible')].map(e => e.textContent.trim());
        return { strip: strip && strip.textContent, picked: picked && picked.querySelector('.lighthouse-label, span').textContent.trim(), preview };
    });
    const after = async (keys) => { for (const k of keys) await (k.startsWith('//') ? type(p, k) : press(p, k)); await wait(800); return bar(); };
    const clear = async () => { await press(p, 'Escape'); await p.evaluate(() => { document.getElementById('ta').value = ''; }); };
    assert.strictEqual((await after(['//addre'])).strip, 'Tab to insert'); await clear();   // one match
    const opened = await after(['//ad']);                                                   // several
    assert.match(opened.strip, /^Tab to insert/);   // and ← → to choose, where the bar has room
    assert.strictEqual(opened.picked, 'addr');
    assert.deepStrictEqual(opened.preview, ['221B Baker Street']);
    assert.deepStrictEqual((await after(['ArrowRight'])).preview, ['221B Baker Street, London NW1 6XE']);
    assert.deepStrictEqual(p.errors, []);
    await p.close();
});

// A field focused before the extension loaded (some sites focus their input as the page loads)
for (const ed of ['ta', 'pm']) {
    test(`${ed}: focused before the extension loaded`, async () => {
        const focus = (p) => p.evaluate((ed) => { editors[ed].set(['']); editors[ed].select([0, 0], [0, 0]); }, ed);
        const p = await open(browser, { settings, before: focus });
        await type(p, '//sig'); await wait(250); await press(p, 'Tab'); await wait(150);
        assert.strictEqual(await text(p, ed), 'Best, Kach');
        await p.close();
    });
}

// Lexical emptied by the browser (select all, Backspace): a name at the very start still inserts
test('lx: emptied natively, a snippet at the start', async () => {
    const p = await open(browser, { settings: { ...settings, tidySpacing: false } });
    await set(p, 'lx', ['hello world']); await select(p, 'lx', [0, 0], [0, 11]);
    await press(p, 'Backspace'); await type(p, '//sig'); await wait(250); await press(p, 'Tab'); await wait(150);
    assert.strictEqual(await text(p, 'lx'), 'Best, Kach');
    await p.close();
});
