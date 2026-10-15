import type { CATEGORICAL_PALETTE_IDS, GRADIENT_PALETTE_IDS } from '../generated/shared-constants';
import { KELLYS_COLORS } from '../generated/shared-constants';
import { clamp01 } from './numeric-binning.js';

/** Every palette id; contracts/shared-constants.json lists them for both languages. */
type PaletteId = (typeof CATEGORICAL_PALETTE_IDS)[number] | (typeof GRADIENT_PALETTE_IDS)[number];

// Kelly's colours, in slot order, are shared with the Python package.
export { KELLYS_COLORS };

// Color-blind safe
export const OKABE_ITO_COLORS = [
  '#E69F00',
  '#56B4E9',
  '#009E73',
  '#F0E442',
  '#0072B2',
  '#D55E00',
  '#CC79A7',
  '#000000',
] as const;

export const TOL_BRIGHT_COLORS = [
  '#4477AA',
  '#66CCEE',
  '#228833',
  '#CCBB44',
  '#EE6677',
  '#AA3377',
  '#BBBBBB',
] as const;

// Categorical (general purpose)
export const SET2_COLORS = [
  '#66C2A5',
  '#FC8D62',
  '#8DA0CB',
  '#E78AC3',
  '#A6D854',
  '#FFD92F',
  '#E5C494',
  '#B3B3B3',
] as const;

export const DARK2_COLORS = [
  '#1B9E77',
  '#D95F02',
  '#7570B3',
  '#E7298A',
  '#66A61E',
  '#E6AB02',
  '#A6761D',
  '#666666',
] as const;

export const TABLEAU10_COLORS = [
  '#4E79A7',
  '#F28E2B',
  '#E15759',
  '#76B7B2',
  '#59A14F',
  '#EDC948',
  '#B07AA1',
  '#FF9DA7',
  '#9C755F',
  '#BAB0AB',
] as const;

export const VIRIDIS_COLORS = [
  '#440154',
  '#482878',
  '#3E4989',
  '#31688E',
  '#26828E',
  '#1F9E89',
  '#35B779',
  '#6CCE59',
  '#B4DE2C',
  '#FDE725',
] as const;

export const INFERNO_COLORS = [
  '#000004',
  '#1B0C41',
  '#4A0C6B',
  '#781C6D',
  '#A52C60',
  '#CF4446',
  '#ED6925',
  '#FB9B06',
  '#F7D13D',
  '#FCFFA4',
] as const;

export const PLASMA_COLORS = [
  '#0D0887',
  '#46039F',
  '#7201A8',
  '#9C179E',
  '#BD3786',
  '#D8576B',
  '#ED7953',
  '#FB9F3A',
  '#FDCA26',
  '#F0F921',
] as const;

export const CIVIDIS_COLORS = [
  '#00224E',
  '#123570',
  '#3B496C',
  '#575D6D',
  '#707173',
  '#8A8678',
  '#A59C74',
  '#C3B369',
  '#E1CC55',
  '#FEE838',
] as const;

/**
 * Batlow from Fabio Crameri's Scientific Colour Maps.
 * Included as a publication-oriented sequential option for ordered numeric data.
 */
export const BATLOW_COLORS = [
  '#011959',
  '#103F60',
  '#1B5962',
  '#3C6D56',
  '#687B3E',
  '#9D892B',
  '#D29343',
  '#F8A27E',
  '#FDB7BC',
  '#FACCFA',
] as const;

export const COLOR_SCHEMES = {
  kellys: KELLYS_COLORS,
  okabeIto: OKABE_ITO_COLORS,
  tolBright: TOL_BRIGHT_COLORS,
  set2: SET2_COLORS,
  dark2: DARK2_COLORS,
  tableau10: TABLEAU10_COLORS,
  viridis: VIRIDIS_COLORS,
  cividis: CIVIDIS_COLORS,
  inferno: INFERNO_COLORS,
  batlow: BATLOW_COLORS,
  plasma: PLASMA_COLORS,
} as const satisfies Record<PaletteId, readonly string[]>;

export type ColorSchemeId = keyof typeof COLOR_SCHEMES;

export const COLOR_SCHEME_INFO: Record<ColorSchemeId, { label: string; description: string }> = {
  kellys: { label: "Kelly's Colors", description: 'Maximum contrast (default)' },
  okabeIto: { label: 'Okabe-Ito', description: 'Colorblind-safe' },
  tolBright: { label: 'Tol Bright', description: 'Colorblind-safe' },
  set2: { label: 'Set2', description: 'Categorical' },
  dark2: { label: 'Dark2', description: 'Categorical' },
  tableau10: { label: 'Tableau 10', description: 'Categorical' },
  viridis: { label: 'Viridis', description: 'Perceptually uniform sequential gradient' },
  cividis: { label: 'Cividis', description: 'Colorblind-friendly sequential gradient' },
  inferno: { label: 'Inferno', description: 'High-contrast sequential gradient' },
  batlow: { label: 'Batlow', description: 'Scientific sequential gradient' },
  plasma: { label: 'Plasma', description: 'Vivid sequential gradient' },
};

export function getColorSchemeStops(paletteId: string): readonly string[] {
  return COLOR_SCHEMES[paletteId as ColorSchemeId] || COLOR_SCHEMES.kellys;
}

export function getColorSchemeInfo(
  paletteId: string,
): { label: string; description: string } | null {
  return COLOR_SCHEME_INFO[paletteId as ColorSchemeId] ?? null;
}

export function createColorSchemeLinearGradient(
  paletteId: string,
  direction: string = '90deg',
): string {
  return `linear-gradient(${direction}, ${getColorSchemeStops(paletteId).join(', ')})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;
  const value = parseInt(expanded, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

function interpolateHexColorSrgb(start: string, end: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(start);
  const [r2, g2, b2] = hexToRgb(end);
  const clampedT = clamp01(t);
  return rgbToHex([
    r1 + (r2 - r1) * clampedT,
    g1 + (g2 - g1) * clampedT,
    b1 + (b2 - b1) * clampedT,
  ]);
}

export function sampleColorSchemeColor(paletteId: string, t: number): string {
  const palette = getColorSchemeStops(paletteId);
  if (palette.length === 0) return '#000000';
  if (palette.length === 1) return palette[0];

  const clampedT = clamp01(t);
  if (clampedT === 0) return palette[0];
  if (clampedT === 1) return palette[palette.length - 1];

  const scaled = clampedT * (palette.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.ceil(scaled);
  if (lowerIndex === upperIndex) return palette[lowerIndex];

  return interpolateHexColorSrgb(palette[lowerIndex], palette[upperIndex], scaled - lowerIndex);
}
