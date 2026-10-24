import {Skin} from '../core/types';

// Counts must match SKIN_OPTIONS in backend/src/game/rules.ts. Everything is drawn in a 100x100 box.

export const COLORS = [
    {name: 'Rouge', hex: '#ef4444'},
    {name: 'Orange', hex: '#f97316'},
    {name: 'Jaune', hex: '#facc15'},
    {name: 'Lime', hex: '#84cc16'},
    {name: 'Vert', hex: '#22c55e'},
    {name: 'Cyan', hex: '#06b6d4'},
    {name: 'Bleu', hex: '#3b82f6'},
    {name: 'Indigo', hex: '#6366f1'},
    {name: 'Mauve', hex: '#a855f7'},
    {name: 'Rose', hex: '#ec4899'},
    {name: 'Blanc', hex: '#f1f5f9'},
    {name: 'Charbon', hex: '#334155'},
];

export const SHAPES = [
    {name: 'Rond', path: 'M50 24a34 34 0 1 1 0 68a34 34 0 1 1 0-68z'},
    {name: 'Carré', path: 'M34 24h32a18 18 0 0 1 18 18v32a18 18 0 0 1-18 18h-32a18 18 0 0 1-18-18v-32a18 18 0 0 1 18-18z'},
    {name: 'Triangle', path: 'M50 20q5 0 8 6l30 56q4 10-8 10h-60q-12 0-8-10l30-56q3-6 8-6z'},
    {name: 'Hexagone', path: 'M46 23q4-2 8 0l25 14q4 2 4 7v29q0 5-4 7l-25 14q-4 2-8 0l-25-14q-4-2-4-7v-29q0-5 4-7z'},
    {name: 'Fantôme', path: 'M18 58a32 32 0 0 1 64 0v34l-8-6l-8 6l-8-6l-8 6l-8-6l-8 6l-8-6l-8 6z'},
    {name: 'Œuf', path: 'M50 24c18 0 30 20 30 38c0 18-13 30-30 30s-30-12-30-30c0-18 12-38 30-38z'},
];

export const EYES = ['Ronds', 'Joyeux', 'Fâchés', 'Endormis', 'Cyclope', 'Lunettes'];
export const MODIFIERS = ['Couronne', 'Casquette', 'Cornes', 'Antenne', 'Nœud', 'Moustache'];

export const colorOf = (index: number | undefined) => COLORS[index ?? 0]?.hex ?? COLORS[0].hex;

/** The player's color for bars and borders: their main color */
export const skinColor = (skin: Skin | null | undefined) => colorOf(skin?.main);

export const randomSkin = (): Skin => {
    const pick = (n: number) => Math.floor(Math.random() * n);
    const main = pick(COLORS.length);
    let secondary = pick(COLORS.length);
    if (secondary === main) secondary = (main + 4) % COLORS.length;
    return {shape: pick(SHAPES.length), modifier: pick(MODIFIERS.length), eyes: pick(EYES.length), main, secondary};
};
