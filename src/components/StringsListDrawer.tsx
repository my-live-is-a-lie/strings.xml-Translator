import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { StringList } from './StringList';
import { inlineSign } from '../utils/direction';
import { ResourceItem, FilterStatus, SourceFilter } from '../types';

interface StringsListDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: ResourceItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterStatus: FilterStatus;
  onFilterChange: (st: FilterStatus) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (sf: SourceFilter) => void;
  targetLang: string;
  targetLocaleName?: string;
  appLang: 'ar' | 'en';
  onBulkUpdateTranslations?: (items: ResourceItem[]) => void;
  onResetItemHistory?: (id: string) => void;
}

// Wrapped with React.memo below: re-renders only when its props change
const StringsListDrawerBase: React.FC<StringsListDrawerProps> = ({
  isOpen,
  onClose,
  items,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  filterStatus,
  onFilterChange,
  sourceFilter,
  onSourceFilterChange,
  targetLang,
  targetLocaleName,
  appLang,
  onBulkUpdateTranslations,
  onResetItemHistory,
}) => {
  const asideRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isDraggingRef = useRef(false);
  const currentDeltaXRef = useRef(0);

  if (!isOpen) return null;

  const handleDismiss = () => {
    if (asideRef.current) {
      asideRef.current.style.transition = 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)';
      asideRef.current.style.transform = `translateX(${-100 * inlineSign()}%)`;
    }
    if (backdropRef.current) {
      backdropRef.current.style.transition = 'opacity 0.18s ease-out';
      backdropRef.current.style.opacity = '0';
    }
    setTimeout(() => {
      onClose();
    }, 160);
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden flex justify-start">
      {/* Backdrop with 200ms snappy fade */}
      <div
        ref={backdropRef}
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={handleDismiss}
      />

      {/* Drawer Content on Left Side - GPU-accelerated direct DOM tracking */}
      <aside
        ref={asideRef}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            const touch = e.touches[0];
            touchStartRef.current = {
              x: touch.clientX,
              y: touch.clientY,
              time: Date.now(),
            };
            isDraggingRef.current = false;
            currentDeltaXRef.current = 0;
          }
        }}
        onTouchMove={(e) => {
          if (!touchStartRef.current || e.touches.length !== 1) return;
          const touch = e.touches[0];
          const deltaX = touch.clientX - touchStartRef.current.x;
          const deltaY = touch.clientY - touchStartRef.current.y;

          // Only track movement towards the drawer's own edge
          // (leftward in LTR, rightward in RTL); `shift` is negative in that direction.
          const shift = deltaX * inlineSign();
          if (shift < 0) {
            // Horizontal movement check (allows natural diagonal swipe)
            if (Math.abs(deltaX) > Math.abs(deltaY) * 0.4 || isDraggingRef.current) {
              isDraggingRef.current = true;
              currentDeltaXRef.current = deltaX;

              // Direct DOM style updates: 0 React re-renders, 120fps hardware motion
              if (asideRef.current) {
                asideRef.current.style.transition = 'none';
                asideRef.current.style.transform = `translateX(${deltaX}px)`;
              }
              if (backdropRef.current) {
                backdropRef.current.style.transition = 'none';
                backdropRef.current.style.opacity = `${Math.max(0.1, 1 + shift / 220)}`;
              }
            }
          }
        }}
        onTouchEnd={(e) => {
          if (!touchStartRef.current) return;
          const endX = e.changedTouches[0]?.clientX ?? (touchStartRef.current.x + currentDeltaXRef.current);
          const endY = e.changedTouches[0]?.clientY ?? touchStartRef.current.y;
          const deltaX = endX - touchStartRef.current.x;
          const deltaY = endY - touchStartRef.current.y;
          const duration = Math.max(1, Date.now() - touchStartRef.current.time);
          const velocity = Math.abs(deltaX) / duration;
          const shiftEnd = deltaX * inlineSign();

          // Small swipe & quick flick detection:
          // Closes on a small flick (deltaX < -15px within 350ms or velocity > 0.15)
          // or a gentle small drag of just -22px
          const isQuickFlick = shiftEnd < -15 && (duration < 350 || velocity > 0.15);
          const isSmallSwipe = shiftEnd < -22;
          const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 0.35;

          if ((isQuickFlick || isSmallSwipe) && isHorizontal) {
            handleDismiss();
          } else {
            // Snap back open
            if (asideRef.current) {
              asideRef.current.style.transition = 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)';
              asideRef.current.style.transform = 'translateX(0px)';
            }
            if (backdropRef.current) {
              backdropRef.current.style.transition = 'opacity 0.18s ease-out';
              backdropRef.current.style.opacity = '1';
            }
          }

          touchStartRef.current = null;
          isDraggingRef.current = false;
          currentDeltaXRef.current = 0;
        }}
        onTouchCancel={() => {
          if (asideRef.current) {
            asideRef.current.style.transition = 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)';
            asideRef.current.style.transform = 'translateX(0px)';
          }
          if (backdropRef.current) {
            backdropRef.current.style.transition = 'opacity 0.18s ease-out';
            backdropRef.current.style.opacity = '1';
          }
          touchStartRef.current = null;
          isDraggingRef.current = false;
          currentDeltaXRef.current = 0;
        }}
        className="relative w-72 sm:w-80 max-w-[85vw] h-dvh max-h-dvh overflow-hidden bg-white dark:bg-[#161922] border-e border-slate-200 dark:border-[#252C3A] shadow-2xl z-10 flex flex-col animate-in slide-in-from-left rtl:slide-in-from-right duration-200 touch-pan-y will-change-transform"
      >
        {/* Drawer Header */}
        <div className="relative flex items-center justify-between gap-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-slate-200/80 dark:border-[#252C3A]">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
            {appLang === 'ar'
              ? `قائمة النصوص (${items.length})`
              : `Strings List (${items.length})`}
          </span>
          <button
            onClick={handleDismiss}
            className="w-8 h-8 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#202634] transition cursor-pointer"
            title={appLang === 'ar' ? 'إغلاق القائمة' : 'Close drawer'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Body: StringList */}
        <div className="flex-1 overflow-hidden">
          <StringList
            items={items}
            selectedId={selectedId}
            onSelect={(id) => {
              onSelect(id);
              handleDismiss();
            }}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            filterStatus={filterStatus}
            onFilterChange={onFilterChange}
            sourceFilter={sourceFilter}
            onSourceFilterChange={onSourceFilterChange}
            targetLang={targetLang}
            targetLocaleName={targetLocaleName}
            appLang={appLang}
            onBulkUpdateTranslations={onBulkUpdateTranslations}
            onResetItemHistory={onResetItemHistory}
          />
        </div>
      </aside>
    </div>
  );
};

export const StringsListDrawer = React.memo(StringsListDrawerBase);
