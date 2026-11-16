import React from 'react';

/** Italic "F" glyph used for the font button (drawn like the lucide icons: 24px grid, rounded strokes). */
export const FontIcon: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className = 'w-5 h-5', style }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
    aria-hidden="true"
  >
    <path d="M10 20 L13.2 4.5 H20" />
    <path d="M11.4 12.4 H17" />
  </svg>
);
