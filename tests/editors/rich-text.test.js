// Rich text: multi-line text arrives as the editor's own paragraphs; a selection across lines is the editor's
// to change (exactly as without Lighthouse), and the bar doesn't offer editing there
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, select, text, press, type, wait } = require('./helpers');

const EDITORS = ['ta', 'ce', 'pm', 'lx', 'ql'];
let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

async function edit(ed, from, to, act, options) {
    const p = await open(browser, options);
    await set(p, ed, ['hello world', 'second line']);
    await select(p, ed, from, to);
    await act(p, ed);
    const result = await text(p, ed);
    await p.close();
    return result;
}

for (const ed of EDITORS) {
    test(`${ed}: lines inserted over a selection become lines`, async () => {
        const insert = (p, ed) => p.evaluate((ed) => LighthouseSelection.insertText(editors[ed].el, 'A\nB'), ed);
        assert.strictEqual(await edit(ed, [0, 6], [0, 11], insert), 'hello A\nB\nsecond line');
    });
    test(`${ed}: a multi-line snippet arrives as lines`, async () => {
        const settings = { shortcuts: [{ trigger: 'ml', expansion: 'Best,\nKach' }] };
        assert.strictEqual(await edit(ed, [1, 11], [1, 11], async (p) => { await type(p, ' //ml'); await wait(250); await press(p, 'Tab'); }, { settings }), 'hello world\nsecond line Best,\nKach');
    });
}

// Across two lines in rich text: the same result as with no extension at all
const ACROSS = [
    ['Backspace', (p) => press(p, 'Backspace')],
    ['"("', (p) => type(p, '(')],
    ['Ctrl+X', (p) => press(p, 'Control+KeyX')],
];
for (const ed of ['ce', 'pm', 'lx', 'ql']) for (const [name, act] of ACROSS) {
    test(`${ed}: ${name} over "world⏎second" is the editor's own`, async () => {
        const native = await edit(ed, [0, 6], [1, 6], act, { lighthouse: false });
        assert.strictEqual(await edit(ed, [0, 6], [1, 6], act, { settings: { brackets: 'wrap' } }), native);
    });
}

// What the bar offers: editing only where Lighthouse can edit (ctx.isInput)
for (const ed of ['ce', 'pm', 'lx', 'ql']) {
    test(`${ed}: editing buttons within a line, not across lines`, async () => {
        const p = await open(browser);
        await set(p, ed, ['hello world', 'second line']);
        const isInput = async (a, z) => { await select(p, ed, a, z); return p.evaluate(() => LighthouseSelection.getContext().isInput); };
        assert.strictEqual(await isInput([0, 6], [0, 11]), true);
        assert.strictEqual(await isInput([0, 6], [1, 6]), false);
        assert.strictEqual(await isInput([0, 0], [0, 11]), true);   // a whole line is one line
        await p.close();
    });
}

for (const ed of ['pm', 'lx', 'ql']) {
    test(`${ed}: the bar's Delete tidies the join`, async () => {
        const p = await open(browser);
        await set(p, ed, ['I want small noodles']);
        await select(p, ed, [0, 7], [0, 12]);
        await p.evaluate((ed) => LighthouseSelection.insertText(editors[ed].el, ''), ed);
        assert.strictEqual(await text(p, ed), 'I want noodles');
        await p.close();
    });
}
