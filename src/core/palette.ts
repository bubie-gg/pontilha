import { parseHex } from './color';

/** Starter palette: one neutral ramp plus hue-shifted ramps (shadows lean cool, lights lean warm). */
const HEX = [
  // neutrals
  '#16141c', '#2e2a38', '#4d4759', '#77708a', '#a9a2b8', '#d8d3e0', '#f7f4fa',
  // reds
  '#4a1730', '#8a2340', '#c93c4a', '#f0715e', '#ffb08f',
  // oranges and yellows
  '#5a2a1e', '#9c4a22', '#db7b2a', '#f6b847', '#ffe6a0',
  // greens
  '#12332f', '#1f5e45', '#3a9150', '#7dc25b', '#c6e77a',
  // blues
  '#14204a', '#1f3e8c', '#2f6fd0', '#4fb0f0', '#a4e4ff',
  // purples
  '#2c1a4a', '#57307f', '#8c4fb8', '#c98be0', '#f2c6f5',
];

export const DEFAULT_PALETTE: number[] = HEX.map((h) => parseHex(h)!);
