// Brackets: wrapping a selection, auto-closing (close mode), stepping over, the paired Backspace; in every editor,
// left to an editor that pairs brackets itself, and never in a proxy field
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, select, text, press, type } = require('./helpers');

const RICH_AND_PLAIN = ['ta', 'ce', 'pm', 'lx', 'ql'];
let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

async function run(settings, ed, from, to, act) {
    const p = await open(browser, { settings });
    await set(p, ed, ['hello world']);
    await select(p, ed, from, to);
    await act(p);
    const result = await text(p, ed);
    assert.deepStrictEqual(p.errors, []);
    await p.close();
    return result;
}

for (const ed of RICH_AND_PLAIN) {
    test(`${ed}: "(" over a selection wraps it`, async () => {
        assert.strictEqual(await run({ brackets: 'wrap' }, ed, [0, 0], [0, 5], (p) => type(p, '(')), '(hello) world');
    });
    test(`${ed}: close mode pairs "(", and ")" steps over the closer`, async () => {
        assert.strictEqual(await run({ brackets: 'close' }, ed, [0, 11], [0, 11], (p) => type(p, '(x)')), 'hello world(x)');
    });
    test(`${ed}: Backspace in an empty pair removes both`, async () => {
        assert.strictEqual(await run({ brackets: 'close' }, ed, [0, 11], [0, 11], async (p) => { await type(p, '('); await press(p, 'Backspace'); }), 'hello world');
    });
}

test('an editor that pairs brackets itself keeps its own behavior', async () => {
    assert.strictEqual(await run({ brackets: 'wrap' }, 'own', [0, 0], [0, 5], (p) => type(p, '(')), '[OWN] world');
});

test('a proxy field (hidden, an editor types through it) is left alone', async () => {
    assert.strictEqual(await run({ brackets: 'wrap' }, 'proxy', [0, 0], [0, 5], (p) => type(p, '(')), '( world');
});
