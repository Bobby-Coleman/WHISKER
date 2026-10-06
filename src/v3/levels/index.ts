// The levels, by id, and their order in the menu.
import type { Level } from './types';
import { sandbox } from './sandbox';

export const LEVELS: Record<string, Level> = { sandbox, prologue: sandbox };
// (prologue and chapter one replace the stand-ins as they land)
export const LEVEL_ORDER = ['prologue'];
