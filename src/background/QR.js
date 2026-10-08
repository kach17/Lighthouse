/**
 * Lighthouse - QR codes, made here so the text never leaves the browser. Only what the QR action needs:
 * any text as UTF-8 bytes, error correction level L (codes are read from a screen), one fixed mask
 * (scanners read any). qr(text): rows of booleans (true: dark), or null when the text is too long.
 */
const qr = (() => {
    // Level L, versions 1-40 (ISO/IEC 18004): error correction codewords per block, and number of blocks
    const EC = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
    const BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25];

    // Codewords a version holds, from its size less the fixed patterns
    function codewords(v) {
        let n = (16 * v + 128) * v + 64;
        if (v >= 2) { const a = Math.floor(v / 7) + 2; n -= (25 * a - 10) * a - 55; if (v >= 7) n -= 36; }
        return n >> 3;
    }

    // Reed-Solomon over GF(256): the error correction codewords of one block
    const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
    function ecc(data, degree) {
        const div = new Array(degree).fill(0); div[degree - 1] = 1;
        for (let i = 0, root = 1; i < degree; i++, root = mul(root, 2)) {
            for (let j = 0; j < degree; j++) { div[j] = mul(div[j], root); if (j + 1 < degree) div[j] ^= div[j + 1]; }
        }
        const rem = new Array(degree).fill(0);
        for (const b of data) {
            const f = b ^ rem.shift(); rem.push(0);
            div.forEach((d, i) => rem[i] ^= mul(d, f));
        }
        return rem;
    }

    return function (text) {
        const bytes = new TextEncoder().encode(text), utf8 = bytes.some(b => b > 127);
        let v = 1;
        const fits = (v) => (utf8 ? 12 : 0) + 4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= (codewords(v) - EC[v - 1] * BLOCKS[v - 1]) * 8;
        while (v <= 40 && !fits(v)) v++;
        if (v > 40) return null;

        // Data: the UTF-8 designator where needed, byte mode, length, the bytes, terminator, padding
        const bits = [], put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
        if (utf8) put(0x71A, 12);   // ECI 26: UTF-8
        put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
        const total = codewords(v), nb = BLOCKS[v - 1], ec = EC[v - 1], cap = (total - ec * nb) * 8;
        put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
        for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
        const data = [];
        for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

        // Blocks, each with its error correction, interleaved; short blocks first
        const short = nb - total % nb, len = Math.floor(total / nb), blocks = [];
        for (let i = 0, k = 0; i < nb; i++) {
            const d = data.slice(k, k += len - ec + (i < short ? 0 : 1));
            blocks.push([...d, ...(i < short ? [0] : []), ...ecc(d, ec)]);
        }
        const out = [];
        for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== len - ec || j >= short) out.push(b[i]); });

        // The matrix: fixed patterns first (marked as such), then the codewords, masked
        const size = v * 4 + 17, dark = [...Array(size)].map(() => Array(size).fill(false)), fixed = dark.map(r => r.slice());
        const set = (x, y, on) => { dark[y][x] = on; fixed[y][x] = true; };
        for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // timing
        const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
            if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
        } };
        finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
        if (v > 1) {   // alignment patterns
            const n = Math.floor(v / 7) + 2, step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, pos = [6];
            for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
            pos.forEach((y, i) => pos.forEach((x, j) => {
                if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
                for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }));
        }
        // Format (level L, mask 0) and, from version 7, version information, each with its BCH code
        const bch = (val, poly, len) => { let r = val; for (let i = 0; i < len; i++) r = (r << 1) ^ ((r >>> (len - 1)) * poly); return r; };
        const fmt = ((1 << 3 | 0) << 10 | bch(1 << 3 | 0, 0x537, 10)) ^ 0x5412;
        for (let i = 0; i < 15; i++) {
            const on = ((fmt >>> i) & 1) === 1;
            set(8, i < 6 ? i : i < 8 ? i + 1 : size - 15 + i, on);
            set(i < 8 ? size - 1 - i : i < 9 ? 7 : 14 - i, 8, on);
        }
        set(8, size - 8, true);
        if (v >= 7) {
            const ver = v << 12 | bch(v, 0x1F25, 12);
            for (let i = 0; i < 18; i++) { const on = ((ver >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, on); set(b, a, on); }
        }
        // Codewords in the zigzag, two columns at a time from the right, skipping fixed modules; mask 0: (x + y) even
        let i = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
                const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
                if (fixed[y][x]) continue;
                const bit = i < out.length * 8 && ((out[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++;
                dark[y][x] = bit !== ((x + y) % 2 === 0);
            }
        }
        return dark;
    };
})();
