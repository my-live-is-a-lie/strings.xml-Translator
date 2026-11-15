/**
 * Shade variants for the 6 accent-color swatches in the settings sidebar palette.
 *
 * Each family offers exactly 4 variants: index 0 always matches the family's original/default
 * colors (exactly what `src/index.css`'s `html[data-accent="..."]` block defines), and indices
 * 1-3 are closely related alternate shades the user can pick to replace that swatch's displayed
 * color. Picking a variant only changes the swatch's *own* stored shade; it is applied live (the
 * actual `--accent-*` CSS custom properties) only when that swatch is the currently active accent.
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
  border: string = active
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
  };
}

export const ACCENT_VARIANTS: Record<AccentColorId, AccentVariant[]> = {
  teal: [
    shade('#1eb996', '#19a585', '#158c71', '#185f54', '#1c6f63', '#144f46', '#16695e'), // original
    shade('#10b981', '#059669', '#047857', '#064e3b', '#065f46', '#022c22'), // Emerald
    shade('#22c55e', '#16a34a', '#15803d', '#14532d', '#166534', '#052e16'), // Green
    shade('#14b8a6', '#0d9488', '#0f766e', '#134e4a', '#115e59', '#042f2e'), // Teal
  ],
  blue: [
    shade('#3b82f6', '#2563eb', '#1d4ed8', '#1e3a8a', '#1d4ed8', '#172554'), // original
    shade('#6366f1', '#4f46e5', '#4338ca', '#312e81', '#3730a3', '#1e1b4b'), // Indigo
    shade('#0ea5e9', '#0284c7', '#0369a1', '#0c4a6e', '#075985', '#082f49'), // Sky
    shade('#64748b', '#475569', '#334155', '#0f172a', '#1e293b', '#020617'), // Slate
  ],
  violet: [
    shade('#8b5cf6', '#7c3aed', '#6d28d9', '#4c1d95', '#5b21b6', '#3b0764'), // original
    shade('#a855f7', '#9333ea', '#7e22ce', '#581c87', '#6b21a8', '#3b0764'), // Purple
    shade('#d946ef', '#c026d3', '#a21caf', '#701a75', '#86198f', '#4a044e'), // Fuchsia
    shade('#6366f1', '#4f46e5', '#4338ca', '#312e81', '#3730a3', '#1e1b4b'), // Indigo
  ],
  rose: [
    shade('#f43f5e', '#e11d48', '#be123c', '#881337', '#9f1239', '#4c0519'), // original
    shade('#ec4899', '#db2777', '#be185d', '#831843', '#9d174d', '#500724'), // Pink
    shade('#ef4444', '#dc2626', '#b91c1c', '#7f1d1d', '#991b1b', '#450a0a'), // Red
    shade('#6d2e46', '#5c2539', '#4a1e2e', '#2e1220', '#3a1728', '#1f0c16'), // Wine
  ],
  amber: [
    shade('#f59e0b', '#d97706', '#b45309', '#78350f', '#92400e', '#451a03'), // original
    shade('#f97316', '#ea580c', '#c2410c', '#7c2d12', '#9a3412', '#431407'), // Orange
    shade('#eab308', '#ca8a04', '#a16207', '#713f12', '#854d0e', '#422006'), // Yellow
    shade('#d1a33d', '#b78a2e', '#9c7324', '#5c4216', '#73531c', '#3d2c0f'), // Mustard
  ],
  cyan: [
    shade('#06b6d4', '#0891b2', '#0e7490', '#164e63', '#155e75', '#083344'), // original
    shade('#0ea5e9', '#0284c7', '#0369a1', '#0c4a6e', '#075985', '#082f49'), // Sky
    shade('#14b8a6', '#0d9488', '#0f766e', '#134e4a', '#115e59', '#042f2e'), // Teal
    shade('#22d3ee', '#06b6d4', '#0891b2', '#164e63', '#0e7490', '#083344'), // Aqua
  ],
};

/** Applies a variant's colors as live CSS custom properties on the document root, or clears the override (index 0). */
export function applyAccentVariant(variant: AccentVariant, index: number): void {
  const root = document.documentElement.style;
  if (index === 0) {
    root.removeProperty('--accent-primary');
    root.removeProperty('--accent-on-primary');
    root.removeProperty('--accent-hover');
    root.removeProperty('--accent-active');
    root.removeProperty('--accent-muted');
    root.removeProperty('--accent-muted-hover');
    root.removeProperty('--accent-muted-active');
    root.removeProperty('--accent-border');
    root.removeProperty('--accent-soft');
    root.removeProperty('--accent-ring');
    return;
  }
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
