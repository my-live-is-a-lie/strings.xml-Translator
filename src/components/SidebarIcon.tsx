import React from 'react';

interface SidebarIconProps {
  className?: string;
  direction?: 'left' | 'right';
}

/**
 * Sidebar Panel Icon with rounded rectangular frame, vertical divider,
 * and chevron. Defaults to 'right' (right-hand sidebar panel for right drawer / RTL).
 */
export const SidebarIcon: React.FC<SidebarIconProps> = ({
  className = 'w-4.5 h-4.5',
  direction = 'right',
}) => {
  const isRight = direction === 'right';

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Outer rounded rectangular frame */}
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      {/* Vertical sidebar panel divider */}
      <line x1={isRight ? '15.5' : '8.5'} y1="3" x2={isRight ? '15.5' : '8.5'} y2="21" />
      {/* Chevron inside the sidebar panel */}
      {isRight ? (
        <path d="M18.8 9.75L16.4 12L18.8 14.25" />
      ) : (
        <path d="M5.2 9.75L7.6 12L5.2 14.25" />
      )}
    </svg>
  );
};
