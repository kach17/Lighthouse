// Measurements: found in any language the browser writes units in, shown in the reader's other system in the unit
// that reads naturally (largest at 1 or more; feet and inches, pounds and ounces as they are said), to one decimal
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ROOT } = require('./helpers');

global.window = global; global.self = global;
for (const f of ['src/utils/data.js', 'src/utils/utils.js', 'src/modules/math.js']) require(path.join(ROOT, f));
const M = Object.values(global).find(v => v && v.findAmounts && v.convertUnit);
global.LighthouseUtils.ask = (type, { langs }) => Promise.resolve({ success: true, result: M.buildWords(langs) });
const ready = M.loadWords(['en', 'de', 'ja']);

const CASES = [
    ['75°F', '23.9°C'], ['50 lb', '22.7 kg'], ['2 miles', '3.2 km'], ['6 ft 6 in', '2.0 m'], ['150 lb', '68.0 kg'],
    ['0.5 km', '1,640.4 ft'], ['300 cm', '9 ft 10 in'], ['8 oz', '226.8 g'], ['0.3 in', '7.6 mm'], ['2 gallons', '7.6 L'],
    ['60 mph', '96.6 km/h'], ['20 °C', '68°F'], ['180 cm', '5 ft 11 in'], ['3.4 kg', '7 lb 8 oz'], ['5 Meilen', '8.0 km'],
    ['2 マイル', '3.2 km'], ['12 stone', '76.2 kg'],
];
for (const [text, shown] of CASES) {
    test(`${text} → ${shown}`, async () => {
        await ready;
        const [a] = M.findAmounts(text);
        assert.ok(a && a.index === 0 && a.length === text.length, 'read as one measurement');
        assert.strictEqual(M.convertUnit(a.value, a.unit).shown, shown);
    });
}
test('an address is not a measurement ("5 St Mary Street")', async () => { await ready; assert.deepStrictEqual(M.findAmounts('5 St Mary Street'), []); });
