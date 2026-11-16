import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PixelAvatars = require('../public/js/pixel-avatars.js');

console.log('--- Testing pixel avatars ---');
assert.strictEqual(PixelAvatars.count, 20);
assert.strictEqual(PixelAvatars.list.length, 20);

const weaponChars = new Set(['M', 'N', 'W']);
PixelAvatars.list.forEach(({ id, name, weapon }) => {
    assert.ok(name && weapon, `avatar ${id} needs a name and a weapon`);
    const grid = PixelAvatars.grid(id);
    assert.strictEqual(grid.length, 16, `avatar ${id} must have 16 rows`);
    grid.forEach(row => assert.strictEqual(row.length, 16, `avatar ${id} rows must have 16 columns`));
    assert.ok(grid.flat().some(c => weaponChars.has(c) || c === 'G' || c === 'R'), `avatar ${id} must draw a weapon`);
    const svg = PixelAvatars.svg(id, 32);
    assert.ok(svg.startsWith('<svg') && svg.includes('<rect'), `avatar ${id} must render an svg`);
});
assert.strictEqual(PixelAvatars.svg(0, 32), '');
assert.strictEqual(PixelAvatars.svg(21, 32), '');
console.log('Pixel avatar tests PASSED!');
