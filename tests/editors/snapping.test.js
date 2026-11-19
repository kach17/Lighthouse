// Snapping widens a dragged selection to whole words, also when the drag begins or ends in empty space beside
// the text (where the end that stays has no line of text to measure)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { launch, open, wait, drag } = require('./helpers');

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

// Paragraphs at the top of the page, empty space above and below them; a drag between two points
async function selectByDragging(from, to) {
    const p = await open(browser);
    await p.evaluate(() => document.body.insertAdjacentHTML('afterbegin', `<div id="above" style="height: 60px"></div>
        <div style="font: 18px/1.6 sans-serif; width: 600px"><p id="p1">The quick brown fox jumps.</p><p id="p2">Over the lazy dog it went.</p></div>
        <div id="below" style="height: 60px"></div>`));
    const point = ([id, x, y]) => p.evaluate((id, x, y) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left + x, r.top + y]; }, id, x, y);
    const [a, z] = [await point(from), await point(to)];
    await drag(p, a, z, { steps: 10, settle: 800 });
    const selected = await p.evaluate(() => getSelection().toString().replace(/\s+/g, ' ').trim());
    await p.close();
    return selected;
}

test('a drag from inside a word to the empty space below', async () => {
    assert.match(await selectByDragging(['p1', 100, 14], ['below', 300, 30]), /^brown fox jumps\. Over the lazy dog it went\.$/);
});
test('a drag from the empty space above to inside a word', async () => {
    assert.match(await selectByDragging(['above', 300, 20], ['p2', 115, 14]), /^The quick brown fox jumps\. Over the lazy$/);
});
