// What a page can make Lighthouse fetch (background.js gatewayFetch, the one way out): a public page can't reach this
// computer or the private network through a link preview or a site's icon; a local page can; a page not known counts as
// public. Run against a stand-in for Chrome and the network, recording every address actually requested
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm'), path = require('path');
const { ROOT } = require('./helpers');

function background() {
    const requested = [];
    const any = new Proxy(function () {}, { get: (t, k) => k === 'get' ? (d, cb) => { const v = { onDevice: false, ...(typeof d === 'object' ? d : {}) }; return cb ? cb(v) : Promise.resolve(v); } : any, apply: () => any });
    const ctx = { console, URL, AbortController, setTimeout, clearTimeout, navigator: { language: 'en-US', languages: ['en-US'] }, chrome: any,
        fetch: async (url) => { requested.push(url); return { ok: true, status: 200, url, headers: { get: () => 'text/html' }, text: async () => '<title>x</title>' }; } };
    ctx.self = ctx;
    ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/background', f), 'utf8'), ctx));
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/background/background.js'), 'utf8'), ctx);
    return { fetch: (url, from) => ctx.gatewayFetch(url, { anyHost: true, from }).then(() => 'fetched', (e) => e.message), requested };
}

const PUBLIC = 'https://news.example.com/story';
for (const target of ['http://localhost:8080/admin', 'http://127.0.0.1:3000/', 'http://[::1]/', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://printer.local/', 'http://router/']) {
    test(`a public page can't reach ${target}`, async () => {
        const b = background();
        assert.strictEqual(await b.fetch(target, PUBLIC), 'Private network address');
        assert.deepStrictEqual([...b.requested], [], 'nothing was requested');
    });
}

test('a local page can (an intranet, a development server)', async () => {
    for (const from of ['http://localhost:5173/', 'http://intranet.local/wiki']) {
        const b = background();
        assert.strictEqual(await b.fetch('http://localhost:8080/docs', from), 'fetched', from);
    }
});

test('a page not known counts as public', async () => {
    for (const from of [undefined, null, '', 'not a url']) {
        const b = background();
        assert.strictEqual(await b.fetch('http://localhost:8080/admin', from), 'Private network address', String(from));
        assert.deepStrictEqual([...b.requested], []);
    }
});

test('a public page still reaches public sites', async () => {
    const b = background();
    assert.strictEqual(await b.fetch('https://example.org/article', PUBLIC), 'fetched');
});