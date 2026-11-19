// The settings popup: the Snippets tab's instruction, copying a snippet (click or keyboard) with the Copied
// toast, and Add staying in reach. Served from a local server: the clipboard needs a secure page.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http'), fs = require('fs'), path = require('path');
const { launch, wait, ROOT } = require('./helpers');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
let browser, server, origin;
before(async () => {
    server = http.createServer((req, res) => {
        const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
    }).listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await launch();
    await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
});
after(async () => { await browser.close(); server.close(); });

async function popup(shortcuts, settings = {}) {
    const p = await browser.newPage();
    await p.setViewport({ width: 340, height: 560 });
    p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
    await p.evaluateOnNewDocument((shortcuts, settings) => {
        const store = { shortcuts, ...settings }, event = { addListener() {}, removeListener() {} };
        window.chrome = {
            runtime: { id: 'test', lastError: null, getManifest: () => ({ version: '0', host_permissions: [] }), getURL: (p) => '/' + p, sendMessage: (m, cb) => cb && cb({}), onMessage: event },
            storage: { sync: { get: (d, cb) => cb(Object.assign({}, typeof d === 'object' && d || {}, store)), set: (o, cb) => { Object.assign(store, o); cb && cb(); }, remove() {} },
                       local: { get: (d, cb) => cb({}), set() {} }, onChanged: event },
            permissions: { contains: (o, cb) => cb(false), request: (o, cb) => cb(false), remove: (o, cb) => cb && cb(true) },
            tabs: { query: (q, cb) => cb([{ url: 'https://example.com/' }]), create: (o) => { window.opened = o.url; } },
            commands: { getAll: (cb) => cb([{ name: 'back-to-box', shortcut: settings.shortcut === undefined ? 'Alt+L' : settings.shortcut }]) },
        };
    }, shortcuts, settings);
    await p.goto(`${origin}/src/popup/popup.html`); await wait(300);
    await p.click('[data-tab="shortcuts"]'); await wait(150);
    return p;
}
const desc = (p) => p.$eval('#shortcuts-desc', (e) => e.textContent);
const clipboard = (p) => p.evaluate(() => navigator.clipboard.readText());
const toast = (p) => p.evaluate(() => [...document.querySelectorAll('.lighthouse-toast')].map(t => t.textContent).join());

test('the instruction is at the top: first-time, then how to use them', async () => {
    let p = await popup([]);
    assert.match(await desc(p), /^Save text you type often/);
    await p.close();
    p = await popup([{ trigger: 'addr', expansion: '221B Baker Street' }]);
    assert.strictEqual(await desc(p), 'Type //name and press Tab to insert. Click one to copy.');
    assert.strictEqual(await p.$('#shortcuts-hint'), null);
    await p.close();
});

test('a snippet copies by click and by keyboard, with the Copied toast; Delete doesn\'t copy', async () => {
    const p = await popup([{ trigger: 'addr', expansion: '221B Baker Street' }, { trigger: 'sig', expansion: 'Best, Kach' }]);
    await p.click('#shortcuts-list li:nth-child(1) .lh-row-sub'); await wait(100);
    assert.strictEqual(await clipboard(p), '221B Baker Street');
    assert.strictEqual(await toast(p), 'Copied');
    await p.focus('#shortcuts-list li:nth-child(2)'); await p.keyboard.press('Enter'); await wait(100);
    assert.strictEqual(await clipboard(p), 'Best, Kach');
    await p.evaluate(() => navigator.clipboard.writeText('untouched'));
    await p.hover('#shortcuts-list li:nth-child(1)'); await p.click('#shortcuts-list li:nth-child(1) .lh-row-delete'); await wait(100);
    assert.strictEqual(await clipboard(p), 'untouched');
    assert.strictEqual(await p.$$eval('#shortcuts-list li', (l) => l.length), 1);
    assert.deepStrictEqual(p.errors, []);
    await p.close();
});

test('Add stays in reach once the list outgrows the popup', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ trigger: 's' + i, expansion: 'Snippet number ' + i }));
    const p = await popup(many);
    const add = await p.$eval('#add-shortcut-trigger', (e) => { const r = e.getBoundingClientRect(); return { position: getComputedStyle(e).position, visible: r.bottom <= innerHeight && r.top >= 0 }; });
    assert.deepStrictEqual(add, { position: 'sticky', visible: true });
    await p.close();
});

// Privacy lockdown, switched on in Settings: the buttons that are nothing without the network say Lockdown and can't be
// turned on or off; the others (a click opens a site) stay as they were; each button's own setting is kept
test('Privacy lockdown: the Buttons tab says which buttons it keeps off', async () => {
    const p = await popup([]);
    const rows = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#button-list li')].map(li => [li._ref, li.querySelector('.lh-row-state').textContent])));
    await p.click('[data-tab="settings"]'); await wait(100);
    await p.evaluate(() => document.getElementById('toggle-on-device').closest('label').click()); await wait(150);
    await p.click('[data-tab="menu"]'); await wait(150);
    const state = await rows();
    for (const id of ['currency', 'translate_to', 'spellcheck']) assert.strictEqual(state[id], 'Lockdown', id);
    for (const id of ['translate', 'dictionary', 'wikipedia']) assert.notStrictEqual(state[id], 'Lockdown', id);
    const stored = () => p.evaluate(() => new Promise(r => chrome.storage.sync.get({ enabled: null }, (o) => r(JSON.stringify(o.enabled)))));
    const before = await stored();
    await p.evaluate(() => [...document.querySelectorAll('#button-list li')].find(li => li._ref === 'currency').click()); await wait(100);
    assert.strictEqual((await rows()).currency, 'Lockdown', 'a click changes nothing');
    assert.strictEqual(await stored(), before, 'its own setting is kept');
    assert.deepStrictEqual(p.errors, []);
    await p.close();
});

// The shortcut back to the box, as Chrome has it (rebound, or removed); clicked, Chrome's page to change it
test('Settings shows the shortcut as Chrome has it, and opens Chrome to change it', async () => {
    for (const [shortcut, shown] of [[undefined, 'Alt+L'], ['Ctrl+Shift+K', 'Ctrl+Shift+K'], ['', 'Set']]) {
        const p = await popup([], shortcut === undefined ? {} : { shortcut });
        await p.click('[data-tab="settings"]'); await wait(100);
        assert.strictEqual(await p.$eval('#shortcut-back', b => b.textContent), shown);
        await p.click('#shortcut-back'); await wait(50);
        assert.strictEqual(await p.evaluate(() => window.opened), 'chrome://extensions/shortcuts');
        await p.close();
    }
});
