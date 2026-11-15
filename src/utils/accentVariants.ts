/**
 * Shade variants for the 6 accent-color swatches in the settings sidebar palette.
 *
 * Each family offers exactly 4 variants, ordered lightest to darkest with closely related hues
 * kept next to each other; the one outlier hue in each family (farthest from the rest) sits last.
 * The entry flagged `isOriginal` is the family's original/default color (exactly what
 * `src/index.css`'s `html[data-accent="..."]` block defines) and is what a fresh swatch starts on.
 * Picking a variant only changes the swatch's *own* stored shade; it is applied live (the actual
 * `--accent-*` CSS custom properties) only when that swatch is the currently active accent.
 */

export type AccentColorId = 'teal' | 'blue' | 'violet' | 'rose' | 'amber' | 'cyan';

export interface AccentVariant {
  primary: string;
  onPrimary: string;
  hover: string;
  active: string;
  muted: string;
  mutedHover: string;
  mutedActive: string;
  border: string;
  soft: string;
  ring: string;
  /** True for the one entry per family that matches the original/default accent (src/index.css). */
  isOriginal?: boolean;
}

const ON_PRIMARY = '#10151c';

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shade(
  primary: string,
  hover: string,
  active: string,
  muted: string,
  mutedHover: string,
  mutedActive: string,
  border: string = active,
  isOriginal?: true
): AccentVariant {
  return {
    primary,
    onPrimary: ON_PRIMARY,
    hover,
    active,
    muted,
    mutedHover,
    mutedActive,
    border,
    soft: rgba(primary, 0.15),
    ring: rgba(primary, 0.25),
    ...(isOriginal ? { isOriginal } : {}),
  };
}

export const ACCENT_VARIANTS: Record<AccentColorId, AccentVariant[]> = {
  teal: [
    shade('#1eb996', '#19a585', '#158c71', '#185f54', '#1c6f63', '#144f46', '#16695e', true), // original
    shade('#14b8a6', '#0d9488', '#0f766e', '#134e4a', '#115e59', '#042f2e'), // Teal
    shade('#10b981', '#059669', '#047857', '#064e3b', '#065f46', '#022c22'), // Emerald
    shade('#22c55e', '#16a34a', '#15803d', '#14532d', '#166534', '#052e16'), // Green (outlier: more yellow-green)
  ],
  blue: [
    shade('#6366f1', '#4f46e5', '#4338ca', '#312e81', '#3730a3', '#1e1b4b'), // Indigo
    shade('#3b82f6', '#2563eb', '#1d4ed8', '#1e3a8a', '#1d4ed8', '#172554', undefined, true), // original
    shade('#0ea5e9', '#0284c7', '#0369a1', '#0c4a6e', '#075985', '#082f49'), // Sky
    shade('#64748b', '#475569', '#334155', '#0f172a', '#1e293b', '#020617'), // Slate (outlier: desaturated gray-blue)
  ],
  violet: [
    shade('#6366f1', '#4f46e5', '#4338ca', '#312e81', '#3730a3', '#1e1b4b'), // Indigo
    shade('#8b5cf6', '#7c3aed', '#6d28d9', '#4c1d95', '#5b21b6', '#3b0764', undefined, true), // original
    shade('#a855f7', '#9333ea', '#7e22ce', '#581c87', '#6b21a8', '#3b0764'), // Purple
    shade('#d946ef', '#c026d3', '#a21caf', '#701a75', '#86198f', '#4a044e'), // Fuchsia (outlier: magenta/pink)
  ],
  rose: [
    shade('#ec4899', '#db2777', '#be185d', '#831843', '#9d174d', '#500724'), // Pink
    shade('#f43f5e', '#e11d48', '#be123c', '#881337', '#9f1239', '#4c0519', undefined, true), // original
    shade('#ef4444', '#dc2626', '#b91c1c', '#7f1d1d', '#991b1b', '#450a0a'), // Red
    shade('#6d2e46', '#5c2539', '#4a1e2e', '#2e1220', '#3a1728', '#1f0c16'), // Wine (outlier: dark & muted)
  ],
  amber: [
    shade('#f97316', '#ea580c', '#c2410c', '#7c2d12', '#9a3412', '#431407'), // Orange
    shade('#f59e0b', '#d97706', '#b45309', '#78350f', '#92400e', '#451a03', undefined, true), // original
    shade('#eab308', '#ca8a04', '#a16207', '#713f12', '#854d0e', '#422006'), // Yellow
    shade('#d1a33d', '#b78a2e', '#9c7324', '#5c4216', '#73531c', '#3d2c0f'), // Mustard (outlier: muted/desaturated)
  ],
  cyan: [
    shade('#22d3ee', '#06b6d4', '#0891b2', '#164e63', '#0e7490', '#083344'), // Aqua
    shade('#0ea5e9', '#0284c7', '#0369a1', '#0c4a6e', '#075985', '#082f49'), // Sky
    shade('#06b6d4', '#0891b2', '#0e7490', '#164e63', '#155e75', '#083344', undefined, true), // original
    shade('#14b8a6', '#0d9488', '#0f766e', '#134e4a', '#115e59', '#042f2e'), // Teal (outlier: more green)
  ],
};

/** The index of the family's original/default shade (where a fresh, un-customized swatch starts). */
export function getDefaultVariantIndex(id: AccentColorId): number {
  const index = ACCENT_VARIANTS[id].findIndex((v) => v.isOriginal);
  return index >= 0 ? index : 0;
}

/** Applies a variant's colors as live CSS custom properties on the document root. */
export function applyAccentVariant(variant: AccentVariant): void {
  const root = document.documentElement.style;
  root.setProperty('--accent-primary', variant.primary);
  root.setProperty('--accent-on-primary', variant.onPrimary);
  root.setProperty('--accent-hover', variant.hover);
  root.setProperty('--accent-active', variant.active);
  root.setProperty('--accent-muted', variant.muted);
  root.setProperty('--accent-muted-hover', variant.mutedHover);
  root.setProperty('--accent-muted-active', variant.mutedActive);
  root.setProperty('--accent-border', variant.border);
  root.setProperty('--accent-soft', variant.soft);
  root.setProperty('--accent-ring', variant.ring);
}
