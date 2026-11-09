import React, { useCallback, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { StringList } from './StringList';
import { inlineSign } from '../utils/direction';
import { ResourceItem, FilterStatus, SourceFilter } from '../types';
import { useT } from '../i18n/i18n';

interface StringsListDrawerProps {
  /** Show on wide phone screens too (landscape split layout). */
  always?: boolean;
  isOpen: boolean;
  onClose: () => void;
  items: ResourceItem[];
  /** Number shown in the title (strings left by the active filters); defaults to all strings */
  count?: number;
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
  always = false,
  isOpen,
  onClose,
  items,
  count,
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
  const { t } = useT();
  const asideRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isDraggingRef = useRef(false);
  const currentDeltaXRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 'h' = horizontal swipe (closes the drawer), 'v' = vertical scroll (never moves the drawer); decided once per touch
  const gestureRef = useRef<'h' | 'v' | null>(null);
  // The search field lives in the header: an icon that opens a bar over the title
  const [searchOpen, setSearchOpen] = useState(false);
  // When the drawer opens with a search already active, show the bar (adjusted during render)
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) setSearchOpen(searchQuery !== '');
  }

  const handleDismiss = useCallback(() => {
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
  }, [onClose]);
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      handleDismiss();
    },
    [onSelect, handleDismiss]
  );

  if (!isOpen) return null;

  const isRtl = inlineSign() === 1;
  // Focus inside the tap itself so the keyboard comes up with the bar instead of a beat later
  const openSearch = () => {
    searchInputRef.current?.focus({ preventScroll: true });
    setSearchOpen(true);
  };
  // X while searching: clears the text first, a second press closes the bar (and the keyboard with it)
  const handleCloseButton = () => {
    if (!searchOpen) {
      handleDismiss();
    } else if (searchQuery) {
      onSearchChange('');
      searchInputRef.current?.focus({ preventScroll: true });
    } else {
      searchInputRef.current?.blur();
      setSearchOpen(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 ${always ? '' : 'md:hidden'} flex justify-start`}>
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
            gestureRef.current = null;
          }
        }}
        onTouchMove={(e) => {
          if (!touchStartRef.current || e.touches.length !== 1) return;
          const touch = e.touches[0];
          const deltaX = touch.clientX - touchStartRef.current.x;
          const deltaY = touch.clientY - touchStartRef.current.y;

          // Decide the gesture once, from the first real movement: mostly sideways = swipe to close,
          // anything else = scrolling the list, which must never drag the drawer
          if (gestureRef.current === null) {
            if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return;
            gestureRef.current = Math.abs(deltaX) > Math.abs(deltaY) * 2 ? 'h' : 'v';
          }
          if (gestureRef.current === 'v') return;

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

          if ((isQuickFlick || isSmallSwipe) && isHorizontal && gestureRef.current === 'h') {
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
          gestureRef.current = null;
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
          gestureRef.current = null;
        }}
        className="relative w-72 sm:w-80 max-w-[85vw] h-dvh max-h-dvh overflow-hidden bg-white dark:bg-[#161922] border-e border-slate-200 dark:border-[#252C3A] shadow-2xl z-10 flex flex-col animate-in slide-in-from-left rtl:slide-in-from-right duration-200 touch-pan-y will-change-transform"
      >
        {/* Drawer Header */}
        <div className="relative flex items-center justify-between gap-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-slate-200/80 dark:border-[#252C3A]">
          <span data-i18n
            className="text-xs font-bold text-slate-800 dark:text-slate-100 transition-opacity duration-200"
            style={{ opacity: searchOpen ? 0 : 1 }}
          >
            {t('strings_list', count ?? items.length)}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={openSearch}
              className="w-8 h-8 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#202634] transition cursor-pointer"
              style={{ opacity: searchOpen ? 0 : 1, pointerEvents: searchOpen ? 'none' : 'auto' }}
              tabIndex={searchOpen ? -1 : 0}
              title={t('search')}
              aria-label={t('search')}
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={handleCloseButton}
              className="w-8 h-8 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#202634] transition cursor-pointer"
              title={
                !searchOpen
                  ? t('close_drawer')
                  : searchQuery
                    ? t('clear_search')
                    : t('close_search')
              }
            >
              <X
                className="w-4 h-4"
                style={{
                  transform: searchOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 320ms cubic-bezier(0.34, 1.4, 0.64, 1)',
                }}
              />
            </button>
          </div>

          {/* Search bar: revealed from the icon outwards (clip, so the text is never squished) and covers the title */}
          <div
            className="absolute bottom-2.5 h-9 start-3 end-12 flex items-center rounded-full bg-slate-100 dark:bg-slate-800/80 px-3.5 ring-1 ring-slate-200/60 dark:ring-slate-700/60 focus-within:ring-2 focus-within:ring-[#0B57D0] dark:focus-within:ring-[#A8C7FA] will-change-[clip-path,opacity]"
            style={{
              opacity: searchOpen ? 1 : 0,
              pointerEvents: searchOpen ? 'auto' : 'none',
              clipPath: searchOpen
                ? 'inset(0 0 0 0 round 999px)'
                : isRtl
                  ? 'inset(0 88% 0 0 round 999px)'
                  : 'inset(0 0 0 88% round 999px)',
              transition: 'clip-path 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease-out',
            }}
            aria-hidden={!searchOpen}
          >
            <input
              ref={searchInputRef}
              id="drawer-search-input"
              type="text"
              tabIndex={searchOpen ? 0 : -1}
              placeholder={t('search_key_or_text')}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full text-xs bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Drawer Body: StringList */}
        <div className="flex-1 overflow-hidden">
          <StringList
            items={items}
            selectedId={selectedId}
            onSelect={handleSelect}
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
            hideSearch
          />
        </div>
      </aside>
    </div>
  );
};

export const StringsListDrawer = React.memo(StringsListDrawerBase);
