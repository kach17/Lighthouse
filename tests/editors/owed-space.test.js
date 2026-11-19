// After Lighthouse puts text in where a line ends (a wrap, a snippet, Send…) or the caret leaves an auto-closed pair,
// the next word gets its space; a mark typed next gets none, and nothing changes where text already follows
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, select, text, press, type, wait } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

async function run(ed, lines, from, to, act, settings = {}) {
    const p = await open(browser, { settings: { brackets: 'close', shortcuts: [{ trigger: 'sig', expansion: 'Best, Kach' }], ...settings } });
    await set(p, ed, lines); await select(p, ed, from, to);
    await act(p); await wait(200);
    const t = await text(p, ed); await p.close(); return t;
}

for (const ed of ['ta', 'lx']) {   // a field, and the rich editor that has needed the most care
    test(`${ed}: a wrap at the end, then a word`, async () => assert.strictEqual(await run(ed, ['hello world'], [0, 6], [0, 11], (p) => type(p, '(x')), 'hello (world) x'));
    test(`${ed}: a wrap at the end, then a mark`, async () => assert.strictEqual(await run(ed, ['hello world'], [0, 6], [0, 11], (p) => type(p, '(.')), 'hello (world).'));
    test(`${ed}: a pair left with its closer, then a word`, async () => assert.strictEqual(await run(ed, ['Call me '], [0, 8], [0, 8], (p) => type(p, '(now)x')), 'Call me (now) x'));
    test(`${ed}: a pair left with →, then a word`, async () => assert.strictEqual(await run(ed, ['Call me '], [0, 8], [0, 8], async (p) => { await type(p, '(now'); await press(p, 'ArrowRight'); await wait(50); await type(p, 'x'); }), 'Call me (now) x'));
    test(`${ed}: a snippet from the menu, then a word`, async () => assert.strictEqual(await run(ed, ['Thanks, '], [0, 8], [0, 8], async (p) => { await type(p, '//sig'); await wait(250); await press(p, 'Enter'); await wait(150); await type(p, 'x'); }), 'Thanks, Best, Kach x'));
    test(`${ed}: a snippet with Tab, then a word`, async () => assert.strictEqual(await run(ed, ['Thanks, '], [0, 8], [0, 8], async (p) => { await type(p, '//sig'); await wait(250); await press(p, 'Tab'); await wait(150); await type(p, 'x'); }), 'Thanks, Best, Kach x'));
}
