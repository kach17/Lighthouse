// The text actions get (Copy, Collect, Translate, Send...): line breaks between paragraphs and list items kept
// where Lighthouse doesn't edit; exactly as stored where it does
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, select } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());
const ctxText = (p) => p.evaluate(() => LighthouseSelection.getContext().text);

test('page text across paragraphs and list items', async () => {
    const p = await open(browser);
    await p.evaluate(() => {
        document.body.insertAdjacentHTML('afterbegin', '<div id="src"><p>The quick brown fox.</p><p>Over the dog.</p><ul><li>one</li><li>two</li></ul></div>');
        const r = document.createRange(); r.selectNodeContents(document.getElementById('src')); getSelection().removeAllRanges(); getSelection().addRange(r);
    });
    assert.strictEqual(await ctxText(p), 'The quick brown fox.\n\nOver the dog.\n\none\ntwo');
    await p.close();
});

for (const ed of ['ce', 'pm', 'lx', 'ql']) {
    test(`${ed}: across lines keeps the break; within a line, as stored`, async () => {
        const p = await open(browser);
        await set(p, ed, ['hello world', 'second line']);
        await select(p, ed, [0, 6], [1, 6]);
        assert.match(await ctxText(p), /^world\n+second$/);
        await select(p, ed, [0, 0], [0, 11]);
        assert.strictEqual(await ctxText(p), 'hello world');
        await p.close();
    });
}

test('a text field: exactly its value', async () => {
    const p = await open(browser);
    await set(p, 'ta', ['hello world', 'second line']);
    await select(p, 'ta', [0, 6], [1, 6]);
    assert.strictEqual(await ctxText(p), 'world\nsecond');
    await p.close();
});
