(function (root) {
    const SIZE = 16;

    const BASE = [
        '................',
        '................',
        '.....OOOOOO.....',
        '....OHHHHHHO....',
        '....OHHHHHHO....',
        '....OHSSSSHO....',
        '....OSESSESO....',
        '....OSSSSSSO....',
        '.....OSSSSO.....',
        '....OAAAAAAO....',
        '...OAAABBAAAO...',
        '...OSAABBAASO...',
        '....OAAAAAAO....',
        '....OPPPPPPO....',
        '....OPPOOPPO....',
        '....OKKOOKKO....'
    ];

    const COLORS = {
        O: '#1a1a2e', E: '#1a1a2e', K: '#3e2723',
        M: '#cfd8dc', N: '#78909c', G: '#ffd54f', W: '#8d6e63',
        R: '#e53935', U: '#42a5f5', Y: '#ffffff'
    };

    const px = (x, y, c) => ({ x, y, c });
    const h = (x1, x2, y, c) => { const o = []; for (let x = x1; x <= x2; x++) o.push(px(x, y, c)); return o; };
    const v = (x, y1, y2, c) => { const o = []; for (let y = y1; y <= y2; y++) o.push(px(x, y, c)); return o; };

    const rightHand = () => [px(12, 11, 'S')];
    const leftHand = () => [px(3, 11, 'S')];

    const WEAPONS = {
        sword: () => [px(13, 2, 'N'), ...v(13, 3, 9, 'M'), ...h(12, 14, 10, 'G'), ...rightHand(), px(13, 11, 'W'), px(13, 12, 'G')],
        greatsword: () => [px(13, 0, 'N'), ...v(13, 1, 9, 'M'), ...v(14, 2, 9, 'N'), ...h(12, 15, 10, 'G'), ...rightHand(), px(13, 11, 'W'), px(13, 12, 'G')],
        staffOrb: () => [...v(13, 5, 14, 'W'), px(13, 5, 'G'), px(13, 2, 'U'), ...h(12, 14, 3, 'U'), px(13, 4, 'U'), px(12, 3, 'Y'), ...rightHand()],
        staffCrystal: () => [...v(13, 5, 14, 'W'), px(13, 1, 'U'), ...h(12, 14, 2, 'U'), px(13, 2, 'Y'), ...h(12, 14, 3, 'U'), px(13, 4, 'U'), ...rightHand()],
        bow: () => [px(13, 2, 'W'), px(14, 3, 'W'), ...v(15, 4, 11, 'W'), px(14, 12, 'W'), px(13, 13, 'W'), ...v(13, 3, 12, 'Y'), ...rightHand()],
        dagger: () => [px(13, 6, 'N'), ...v(13, 7, 10, 'M'), px(13, 11, 'G'), px(13, 12, 'W'), ...rightHand(),
            px(2, 6, 'N'), ...v(2, 7, 10, 'M'), px(2, 11, 'G'), px(2, 12, 'W'), ...leftHand()],
        axe: () => [...v(13, 4, 13, 'W'), px(13, 4, 'M'), px(13, 5, 'M'), ...h(14, 15, 3, 'N'), ...h(14, 15, 4, 'M'), ...h(14, 15, 5, 'M'), ...h(14, 15, 6, 'N'), ...rightHand()],
        hammer: () => [...v(13, 5, 13, 'W'), ...h(12, 15, 2, 'N'), ...h(12, 15, 3, 'M'), ...h(12, 15, 4, 'N'), ...rightHand()],
        mace: () => [...v(13, 6, 13, 'W'), px(13, 2, 'N'), ...h(12, 14, 3, 'G'), ...h(11, 15, 4, 'G'), ...h(12, 14, 5, 'G'), ...rightHand()],
        katana: () => [px(13, 1, 'N'), ...v(13, 2, 9, 'M'), ...h(12, 14, 10, 'K'), ...rightHand(), px(13, 11, 'R'), px(13, 12, 'R')],
        cutlass: () => [px(14, 3, 'N'), px(14, 4, 'M'), px(14, 5, 'M'), ...v(13, 6, 9, 'M'), ...h(12, 14, 10, 'G'), ...rightHand(), px(13, 11, 'W')],
        spear: () => [px(13, 0, 'N'), px(13, 1, 'M'), ...h(12, 14, 2, 'M'), ...v(13, 3, 14, 'W'), ...rightHand()],
        pickaxe: () => [...v(13, 3, 13, 'W'), ...h(11, 15, 2, 'N'), px(11, 3, 'N'), px(15, 3, 'N'), px(13, 2, 'M'), ...rightHand()],
        scythe: () => [...v(13, 1, 14, 'W'), ...h(9, 14, 0, 'N'), ...h(8, 13, 1, 'M'), ...rightHand()],
        wandFire: () => [...v(13, 7, 12, 'W'), px(13, 3, 'R'), ...h(12, 14, 4, 'R'), px(13, 4, 'Y'), ...h(12, 14, 5, 'R'), px(13, 6, 'R'), ...rightHand()],
        wandStar: () => [...v(13, 5, 12, 'W'), px(13, 1, 'G'), px(12, 2, 'G'), px(13, 2, 'Y'), px(14, 2, 'G'), px(13, 3, 'G'), ...rightHand()],
        pistol: () => [...h(13, 15, 10, 'N'), px(13, 9, 'N'), px(13, 11, 'W'), px(14, 11, 'N'), ...rightHand()],
        bo: () => [...v(13, 0, 15, 'W'), px(13, 0, 'G'), px(13, 15, 'G'), ...rightHand()]
    };

    const SHIELD = () => [...h(0, 3, 9, 'N'), ...h(0, 3, 10, 'B'), ...h(0, 3, 11, 'B'), ...h(0, 3, 12, 'B'), ...h(1, 2, 13, 'N'), px(1, 11, 'G'), px(2, 11, 'G')];

    const helmet = (c) => [...h(5, 10, 3, c), ...h(5, 10, 4, c), ...h(5, 10, 5, c), ...h(6, 9, 2, c)];
    const hood = () => [...h(5, 10, 2, 'H'), ...v(4, 3, 7, 'H'), ...v(11, 3, 7, 'H')];
    const mask = () => h(5, 10, 7, 'H');
    const pointyHat = () => [px(9, 0, 'H'), ...h(7, 9, 1, 'H'), ...h(6, 9, 2, 'H'), ...h(3, 12, 3, 'H')];
    const cowboyHat = () => [...h(5, 10, 1, 'H'), ...h(5, 10, 2, 'H'), ...h(3, 12, 3, 'H'), ...h(5, 10, 2, 'B')];
    const bald = () => [...h(5, 10, 3, 'S'), ...h(5, 10, 4, 'S'), px(5, 5, 'S'), px(10, 5, 'S')];
    const spikes = () => [px(6, 1, 'H'), px(8, 1, 'H'), px(10, 1, 'H'), px(5, 2, 'H'), px(7, 2, 'H'), px(9, 2, 'H')];
    const longHair = () => [...v(4, 5, 9, 'H'), ...v(11, 5, 9, 'H')];

    const CHARACTERS = [
        { name: 'Knight', pal: { s: '#f5cba7', h: '#cfd8dc', a: '#90a4ae', b: '#1e88e5', p: '#455a64' }, head: () => [...helmet('M'), px(7, 1, 'R'), px(8, 1, 'R'), px(8, 0, 'R')], weapon: 'sword', shield: true },
        { name: 'Wizard', pal: { s: '#f5cba7', h: '#5e35b1', a: '#5e35b1', b: '#ffd54f', p: '#4527a0' }, head: () => [...pointyHat(), ...h(5, 10, 7, 'Y'), ...h(6, 9, 8, 'Y'), px(7, 9, 'Y'), px(8, 9, 'Y')], weapon: 'staffOrb' },
        { name: 'Archer', pal: { s: '#f5cba7', h: '#2e7d32', a: '#388e3c', b: '#795548', p: '#5d4037' }, head: () => [...hood(), px(10, 1, 'R'), px(10, 0, 'R')], weapon: 'bow' },
        { name: 'Rogue', pal: { s: '#e0ac69', h: '#37474f', a: '#455a64', b: '#263238', p: '#263238' }, head: () => [...hood(), ...mask()], weapon: 'dagger' },
        { name: 'Barbarian', pal: { s: '#c68642', h: '#78909c', a: '#8d6e63', b: '#d84315', p: '#6d4c41' }, head: () => [...helmet('N'), px(3, 3, 'Y'), px(2, 2, 'Y'), px(2, 1, 'Y'), px(12, 3, 'Y'), px(13, 2, 'Y'), px(13, 1, 'Y')], weapon: 'axe' },
        { name: 'Paladin', pal: { s: '#f5cba7', h: '#ffd54f', a: '#fafafa', b: '#ffd54f', p: '#bdbdbd' }, head: () => [...helmet('G'), px(7, 1, 'Y'), px(8, 1, 'Y')], weapon: 'hammer' },
        { name: 'Cleric', pal: { s: '#f5cba7', h: '#eceff1', a: '#f5f5f5', b: '#fbc02d', p: '#cfd8dc' }, head: () => [px(7, 0, 'G'), ...h(6, 9, 1, 'H'), px(7, 1, 'G'), px(8, 1, 'G')], weapon: 'mace' },
        { name: 'Ninja', pal: { s: '#f5cba7', h: '#212121', a: '#212121', b: '#d32f2f', p: '#212121' }, head: () => [...hood(), ...mask(), ...h(5, 10, 5, 'H'), ...h(5, 10, 4, 'B'), px(11, 5, 'B'), px(12, 6, 'B')], weapon: 'katana' },
        { name: 'Samurai', pal: { s: '#f5cba7', h: '#b71c1c', a: '#c62828', b: '#ffd54f', p: '#263238' }, head: () => [...helmet('H'), px(6, 1, 'G'), px(9, 1, 'G'), px(7, 0, 'G'), px(8, 0, 'G')], weapon: 'katana' },
        { name: 'Pirate', pal: { s: '#e0ac69', h: '#e53935', a: '#1565c0', b: '#ffd54f', p: '#4e342e' }, head: () => [...h(5, 10, 3, 'H'), ...h(5, 10, 4, 'H'), px(11, 5, 'H'), px(12, 6, 'H'), ...h(5, 6, 6, 'O')], weapon: 'cutlass' },
        { name: 'Lancer', pal: { s: '#f5cba7', h: '#1565c0', a: '#1565c0', b: '#ffd54f', p: '#283593' }, head: () => [...helmet('H'), px(5, 1, 'R'), px(6, 1, 'R')], weapon: 'spear' },
        { name: 'Dwarf', pal: { s: '#e0ac69', h: '#e65100', a: '#6d4c41', b: '#ffca28', p: '#4e342e' }, head: () => [...h(5, 10, 3, 'N'), ...h(5, 10, 4, 'N'), ...h(5, 10, 7, 'H'), ...h(5, 10, 8, 'H'), ...h(6, 9, 9, 'H')], weapon: 'pickaxe' },
        { name: 'Elf', pal: { s: '#f5cba7', h: '#fff59d', a: '#2e7d32', b: '#c0ca33', p: '#1b5e20', m: '#a5d6a7' }, head: () => [px(3, 6, 'S'), px(2, 5, 'S'), px(12, 6, 'S'), px(13, 5, 'S'), ...longHair()], weapon: 'sword' },
        { name: 'Necromancer', pal: { s: '#cfd8dc', h: '#4a148c', a: '#311b92', b: '#b388ff', p: '#1a1a2e' }, head: () => [...hood(), px(6, 6, 'R'), px(9, 6, 'R')], weapon: 'scythe' },
        { name: 'Fire Mage', pal: { s: '#f5cba7', h: '#e53935', a: '#bf360c', b: '#ffb300', p: '#4e342e' }, head: () => spikes(), weapon: 'wandFire' },
        { name: 'Ice Mage', pal: { s: '#f5cba7', h: '#b3e5fc', a: '#0277bd', b: '#e1f5fe', p: '#01579b' }, head: () => longHair(), weapon: 'staffCrystal' },
        { name: 'Gunslinger', pal: { s: '#e0ac69', h: '#6d4c41', a: '#c62828', b: '#ffcc80', p: '#1a237e' }, head: () => cowboyHat(), weapon: 'pistol' },
        { name: 'Monk', pal: { s: '#f5cba7', h: '#f5cba7', a: '#ef6c00', b: '#ffd54f', p: '#8d6e63' }, head: () => bald(), weapon: 'bo' },
        { name: 'Witch', pal: { s: '#f5cba7', h: '#6a1b9a', a: '#4a148c', b: '#76ff03', p: '#311b92', d: '#ff6f00' }, head: () => [...pointyHat(), ...v(4, 5, 9, 'D'), ...v(11, 5, 9, 'D')], weapon: 'wandStar' },
        { name: 'Dark Knight', pal: { s: '#f5cba7', h: '#212121', a: '#37474f', b: '#7b1fa2', p: '#212121', m: '#b39ddb' }, head: () => [...helmet('H'), px(6, 6, 'R'), px(9, 6, 'R'), px(3, 3, 'N'), px(2, 2, 'N'), px(12, 3, 'N')], weapon: 'greatsword' }
    ];

    function buildGrid(character) {
        const grid = BASE.map((row) => row.split(''));
        const apply = (ops) => ops.forEach(({ x, y, c }) => {
            if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) grid[y][x] = c;
        });
        apply(character.head());
        if (character.shield) apply(SHIELD());
        apply(WEAPONS[character.weapon]());
        return grid;
    }

    function colorFor(ch, pal) {
        switch (ch) {
            case 'S': return pal.s;
            case 'H': return pal.h;
            case 'A': return pal.a;
            case 'B': return pal.b;
            case 'P': return pal.p;
            case 'D': return pal.d || '#8b5a2b';
            case 'M': return pal.m || COLORS.M;
            default: return COLORS[ch] || null;
        }
    }

    const cache = {};

    function svg(id, size) {
        const index = Number(id) - 1;
        const character = CHARACTERS[index];
        if (!character) return '';
        const key = `${index}:${size || 0}`;
        if (cache[key]) return cache[key];

        const grid = buildGrid(character);
        let rects = '';
        for (let y = 0; y < SIZE; y++) {
            let x = 0;
            while (x < SIZE) {
                const color = colorFor(grid[y][x], character.pal);
                if (!color) { x++; continue; }
                let run = 1;
                while (x + run < SIZE && colorFor(grid[y][x + run], character.pal) === color) run++;
                rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${color}"/>`;
                x += run;
            }
        }
        const dim = size ? ` width="${size}" height="${size}"` : '';
        cache[key] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}"${dim} shape-rendering="crispEdges" role="img" aria-label="${character.name}">${rects}</svg>`;
        return cache[key];
    }

    const api = {
        count: CHARACTERS.length,
        list: CHARACTERS.map((c, i) => ({ id: i + 1, name: c.name, weapon: c.weapon })),
        grid: (id) => buildGrid(CHARACTERS[Number(id) - 1]),
        svg
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PixelAvatars = api;
})(typeof window !== 'undefined' ? window : globalThis);
