import fs from 'node:fs';
import { generateBoard } from '../shared/mapgen.js';
export const geo = JSON.parse(fs.readFileSync(new URL('../data/geo.json', import.meta.url), 'utf8'));
export const config = JSON.parse(fs.readFileSync(new URL('../data/map.config.json', import.meta.url), 'utf8'));
let cached;
export function board() { return cached ||= generateBoard(config, geo).board; }
