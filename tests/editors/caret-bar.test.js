// The bar for a caret (a click into a box) sits above the caret's line: one rule for plain fields and rich editors,
// empty or not, wherever in the box the click landed
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, set, wait, barBox, inBar, drag, textAt } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

// A click into a tall box at a point (fractions of its width and height); the bar's bottom, and where the box is
async function clickInto(ed, lines, fx, fy) {
    const p = await open(browser, { openShadow: true });
    await p.evaluate((ed) => { const el = editors[ed].el; el.style.minHeight = el.style.height = '140px'; el.style.marginTop = '120px'; el.scrollIntoView({ block: 'center' }); }, ed);   // room above it, and in view
    await set(p, ed, lines);
    // The box, and where its first line starts (a field's padding; a rich editor's first paragraph, margins and all)
    const box = await p.evaluate((ed) => {
        const el = editors[ed].el, r = el.getBoundingClientRect(), first = el.querySelector('p, div'), css = getComputedStyle(el);
        const line = first ? first.getBoundingClientRect().top : r.top + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop);
        return { left: r.left, top: r.top, width: r.width, height: r.height, line };
    }, ed);
    await p.mouse.click(box.left + box.width * fx, box.top + box.height * fy); await wait(900);
    const shown = await barBox(p), bar = shown ? Math.round(shown.bottom) : null;
    await p.close();
    return { bar, top: box.top, line: box.line };
}

for (const ed of ['ta', 'ce', 'pm', 'lx', 'ql']) {
    test(`${ed}: an empty box: the same place wherever the click lands`, async () => {
        const high = await clickInto(ed, [''], 0.5, 0.15), low = await clickInto(ed, [''], 0.5, 0.85);
        assert.ok(high.bar !== null, 'the bar shows');
        assert.strictEqual(low.bar, high.bar);
        assert.ok(high.bar <= high.line, `above the first line (bar bottom ${high.bar}, line ${Math.round(high.line)})`);
    });
}

test('ta: text on the third line: above that line, not above the whole box', async () => {
    const p = await clickInto('ta', ['one', 'two', 'three'], 0.9, 0.35);   // past the text: the caret ends up after "three"
    assert.ok(p.bar > p.top + 10, `the bar (bottom ${p.bar}) is near the third line, below the box's top (${p.top})`);
});

// How far the strip's text sits from the bar's centre
const stripOff = (p) => inBar(p, (root) => { const bar = root.getElementById('lighthouse-extension-tooltip').getBoundingClientRect(), r = document.createRange();
    r.selectNodeContents(root.querySelector('.lighthouse-strip .is-shown')); const t = r.getBoundingClientRect(); return (t.left + t.width / 2) - (bar.left + bar.width / 2); });

// A selection's bar: its strip's text centred (a change that centred the bar's buttons once moved the strip too)
test('a selection bar: the strip\'s text centred', async () => {
    const p = await open(browser, { openShadow: true });
    await p.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<p id="src" style="font:18px sans-serif; margin:150px 40px 20px">The quick brown fox jumps over the lazy dog.</p>'));
    await drag(p, await textAt(p, '#src', 'quick'), await textAt(p, '#src', 'fox', true));
    assert.ok(Math.abs(await stripOff(p)) < 1);
    await p.close();
});

// An empty box, nothing on the clipboard to show: the caret bar has only Paste, one icon wide. Its strip says "Paste"
// whole (the bar widens to it, the button centred), not a cut-off "Pa…"
test('empty box: the strip names Paste whole, the button centred under it', async () => {
    const p = await open(browser, { openShadow: true });
    await p.setViewport({ width: 900, height: 700, deviceScaleFactor: 2 });   // where text drawn a hair wider than measured showed
    await set(p, 'ta', ['']);
    const box = await p.evaluate(() => { const q = document.getElementById('ta').getBoundingClientRect(); return [q.left + 30, q.top + q.height / 2]; });
    await p.mouse.click(...box); await wait(900);
    const bar = await inBar(p, (root) => {
        const b = root.getElementById('lighthouse-extension-tooltip'), s = root.querySelector('.lighthouse-strip .is-shown'), btns = [...b.querySelectorAll(':scope > .lighthouse-btn')];
        const q = b.getBoundingClientRect(), k = btns[0] && btns[0].getBoundingClientRect();
        return { text: s && s.textContent, whole: s && s.scrollWidth <= s.clientWidth, buttons: btns.map(x => x.dataset.action), off: k ? Math.abs((k.left + k.width / 2) - (q.left + q.width / 2)) : null, at: [q.left, q.bottom] };
    });
    const field = await p.evaluate(() => { const q = document.getElementById('ta').getBoundingClientRect(); return [q.left, q.top]; });
    assert.deepStrictEqual(bar.buttons, ['paste']);
    assert.strictEqual(bar.text, 'Paste');
    assert.ok(bar.whole, 'not cut off');
    assert.ok(bar.off < 2, `the button centred (${bar.off})`);
    assert.ok(Math.abs(await stripOff(p)) < 1, 'the strip\'s text centred');
    assert.ok(Math.abs(bar.at[1] - field[1]) < 60 && bar.at[0] > field[0] - 40, `by the box, not elsewhere (${bar.at} / ${field})`);
    await p.close();
});
