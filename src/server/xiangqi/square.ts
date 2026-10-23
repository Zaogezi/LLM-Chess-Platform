/**
 * Small coordinate helpers shared by the engine modules.
 */

import type { Side } from '../../shared/protocol';
import { BOARD_COLS, BOARD_ROWS, FILES } from './constants';
import type { RawMove } from './types';

/** Board index from zero-based row/col. */
export function idx(row: number, col: number): number {
  return row * BOARD_COLS + col;
}

export function rowOf(index: number): number {
  return Math.floor(index / BOARD_COLS);
}

export function colOf(index: number): number {
  return index % BOARD_COLS;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
}

export function opposite(side: Side): Side {
  return side === 'red' ? 'black' : 'red';
}

/** Canonical UCCI square name, e.g. index 0 -> "a0". */
export function squareName(index: number): string {
  return `${FILES[colOf(index)]}${rowOf(index)}`;
}

/** Strictly parsed UCCI move; returns null on anything that is not `a0a1`-shaped. */
export function parseUcciMove(text: string): RawMove | null {
  if (typeof text !== 'string') return null;
  const normalized = text.trim().toLowerCase();
  if (!/^[a-i][0-9][a-i][0-9]$/.test(normalized)) return null;
  const from = parseSquareName(normalized.slice(0, 2));
  const to = parseSquareName(normalized.slice(2, 4));
  if (from === null || to === null) return null;
  return { from, to };
}

/** Parse a two-character UCCI square name into a board index, or null. */
export function parseSquareName(text: string): number | null {
  const normalized = text.trim().toLowerCase();
  if (!/^[a-i][0-9]$/.test(normalized)) return null;
  const col = normalized.charCodeAt(0) - 97;
  const row = normalized.charCodeAt(1) - 48;
  if (!inBounds(row, col)) return null;
  return idx(row, col);
}

/** Canonical four-character UCCI coordinate move. */
export function canonicalUcci(from: number, to: number): string {
  return `${squareName(from)}${squareName(to)}`;
}
