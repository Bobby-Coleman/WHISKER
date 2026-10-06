// The levels, by id, and their order in the menu.
import type { Level } from './types';
import { sandbox } from './sandbox';
import { prologue } from './prologue';
import { moor } from './moor';

export const LEVELS: Record<string, Level> = { sandbox, prologue, moor };
// (prologue and chapter one replace the stand-ins as they land)
export const LEVEL_ORDER = ['prologue', 'moor'];
