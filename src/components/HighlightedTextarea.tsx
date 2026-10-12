import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useState,
  useCallback,
} from 'react';

export interface HighlightedTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  containerClassName?: string;
  backdropClassName?: string;
  enableSwipeResize?: boolean;
  resetKey?: string | number;
  onExpandedChange?: (isExpanded: boolean) => void;
  onValueChange?: (newValue: string) => void;
}

/**
 * Renders text with high-visibility typing mistake indicators for consecutive spaces (2 or more spaces in a row),
 * matching Weblate's red dotted box with middle dots (····) around multiple spaces between words.
 */
function renderContentWithWhitespaceIndicators(text: string) {
  if (!text) return null;

  // Split text by 2 or more consecutive spaces
  const parts = text.split(/( {2,})/g);

  return parts.map((part, idx) => {
    if (!part) return null;

    if (/^ {2,}$/.test(part)) {
      const spaceCount = part.length;
      return (
        <span
          key={idx}
          className="relative inline-flex items-center justify-center align-middle select-none"
          style={{
            border: '2px dotted #FF1E1E',
            backgroundColor: 'rgba(239, 68, 68, 0.22)',
            borderRadius: '2px',
            boxShadow: '0 0 6px rgba(255, 30, 30, 0.45)',
            verticalAlign: 'middle',
            height: '1.45em',
            margin: '0 1px',
            boxSizing: 'border-box',
          }}
          title={`${spaceCount} consecutive spaces (typing mistake)`}
        >
          {/* Transparent spaces to reserve exact natural text width */}
          <span className="opacity-0 select-none whitespace-pre leading-none px-0.5">
            {part}
          </span>
          {/* High-visibility centered middle dots representing each whitespace character */}
          <span
            className="absolute inset-0 flex items-center justify-around pointer-events-none text-white font-mono font-black text-xs sm:text-sm select-none leading-none px-[2px] tracking-widest drop-shadow-xs"
            aria-hidden="true"
          >
            {Array.from({ length: spaceCount }).map((_, dIdx) => (
              <span key={dIdx} className="flex-1 text-center font-bold">
                ·
              </span>
            ))}
          </span>
        </span>
      );
    }

    // Normal text part: render invisible text so layout matches the textarea exactly
    return (
      <span key={idx} className="opacity-0 select-none whitespace-pre-wrap">
        {part}
      </span>
    );
  });
}

/**
 * Measures the exact rendered height of text inside a textarea in pixels
 */
function getTextContentHeight(ta: HTMLTextAreaElement, text: string): number {
  if (!text) return 0;
  try {
    const computed = window.getComputedStyle(ta);
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.left = '-9999px';
    probe.style.top = '-9999px';
    probe.style.width = `${ta.clientWidth || 300}px`;
    probe.style.font = computed.font;
    probe.style.fontSize = computed.fontSize;
    probe.style.fontFamily = computed.fontFamily;
    probe.style.fontWeight = computed.fontWeight;
    probe.style.lineHeight = computed.lineHeight;
    probe.style.letterSpacing = computed.letterSpacing;
    probe.style.whiteSpace = 'pre-wrap';
    probe.style.wordBreak = 'break-word';
    probe.style.overflowWrap = 'break-word';
    probe.textContent = text;
    document.body.appendChild(probe);
    const height = probe.clientHeight;
    document.body.removeChild(probe);
    return height;
  } catch {
    const lineCount = text.split('\n').length;
    return lineCount * 22;
  }
}

/**
 * Computes progressive states where empty lines between text blocks are collapsed from bottom to top.
 * State 0 is the original text.
 * State 1 has the bottom-most empty line collapsed (bottom text moved up to the empty line).
 * Subsequent states collapse higher empty lines one by one.
 */
function computeRearrangeStates(text: string): string[] {
  if (!text) return [text];
  const lines = text.split('\n');
  if (lines.length < 3) return [text];

  // Find line indices that are empty lines between non-empty text lines
  const gapIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      const hasBefore = lines.slice(0, i).some((l) => l.trim() !== '');
      const hasAfter = lines.slice(i + 1).some((l) => l.trim() !== '');
      if (hasBefore && hasAfter) {
        gapIndices.push(i);
      }
    }
  }

  if (gapIndices.length === 0) {
    return [text];
  }

  // Sort from bottom to top so bottom text moves up first
  const collapsibleGaps = [...gapIndices].sort((a, b) => b - a);
  const states: string[] = [text];

  for (let k = 1; k <= collapsibleGaps.length; k++) {
    const gapsToRemove = new Set(collapsibleGaps.slice(0, k));
    const nextLines = lines.filter((_, idx) => !gapsToRemove.has(idx));
    states.push(nextLines.join('\n'));
  }

  return states;
}

interface RearrangeHistory {
  states: string[];
  currentIndex: number;
}

export const HighlightedTextarea = forwardRef<HTMLTextAreaElement, HighlightedTextareaProps>(
  (
    {
      value,
      dir = 'ltr',
      className = '',
      containerClassName = '',
      backdropClassName = '',
      enableSwipeResize = true,
      resetKey,
      onExpandedChange,
      onValueChange,
      onScroll,
      style,
      ...props
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const backdropRef = useRef<HTMLDivElement | null>(null);
    const lastDragEndTimeRef = useRef<number>(0);
    const lastHandledTapTimeRef = useRef<number>(0);

    const [isExpanded, setIsExpanded] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const naturalHeightRef = useRef<number>(48);
    const expandedHeightRef = useRef<number | null>(null);
    const isExpandedRef = useRef<boolean>(false);

    // Rearrange empty lines tracking
    const rearrangeHistoryRef = useRef<RearrangeHistory | null>(null);
    const isRearrangeDraggingRef = useRef<boolean>(false);

    // Keep ref in sync with state
    useEffect(() => {
      isExpandedRef.current = isExpanded;
    }, [isExpanded]);

    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

    // Reset when resetKey (e.g. string item ID) changes
    useEffect(() => {
      if (resetKey !== undefined) {
        setIsExpanded(false);
        isExpandedRef.current = false;
        expandedHeightRef.current = null;
        rearrangeHistoryRef.current = null;
        isRearrangeDraggingRef.current = false;
        if (textareaRef.current) {
          textareaRef.current.style.minHeight = '';
        }
      }
    }, [resetKey]);

    // If value changes externally (user typed, pasted, clicked insert buttons) outside our rearrange gesture,
    // clear rearrange history so swiping down won't bring old original position back
    useEffect(() => {
      const hist = rearrangeHistoryRef.current;
      if (hist && !isRearrangeDraggingRef.current) {
        if (value !== hist.states[hist.currentIndex]) {
          rearrangeHistoryRef.current = null;
        }
      }
    }, [value]);

    const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
      if (backdropRef.current) {
        backdropRef.current.scrollTop = e.currentTarget.scrollTop;
        backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
      }
      onScroll?.(e);
    };

    useEffect(() => {
      if (textareaRef.current && backdropRef.current) {
        backdropRef.current.scrollTop = textareaRef.current.scrollTop;
        backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
      }
    }, [value]);

    // Allows typing on a new line when the input box is expanded by tapping the empty space below text
    const handleEmptyLineTap = useCallback(
      (clientX: number, clientY: number) => {
        if (!isExpandedRef.current) return;
        if (Date.now() - lastDragEndTimeRef.current < 400) return;
        if (Date.now() - lastHandledTapTimeRef.current < 300) return;

        const ta = textareaRef.current;
        if (!ta) return;

        // If the textarea is empty, focus at start without adding blank lines
        if (!value) {
          ta.focus();
          ta.setSelectionRange(0, 0);
          return;
        }

        const rect = ta.getBoundingClientRect();
        const clickY = clientY - rect.top;

        const computed = window.getComputedStyle(ta);
        const padTop = parseFloat(computed.paddingTop) || 8;
        const textH = getTextContentHeight(ta, value);
        const textBottom = padTop + textH;

        // Only act if the user tapped in the empty space below existing text content
        if (clickY > textBottom + 6) {
          lastHandledTapTimeRef.current = Date.now();

          // Append at most ONE newline so cursor moves to the new line without creating huge empty gaps
          const nextVal = value.endsWith('\n') ? value : value + '\n';

          if (nextVal !== value) {
            onValueChange?.(nextVal);
          }

          requestAnimationFrame(() => {
            if (ta) {
              ta.focus();
              const pos = nextVal.length;
              ta.setSelectionRange(pos, pos);
              // Ensure existing text stays completely visible at top
              if (ta.scrollHeight <= ta.clientHeight) {
                ta.scrollTop = 0;
              }
            }
          });
        }
      },
      [value, onValueChange]
    );

    // Restore normal height helper
    const restoreNormalHeight = useCallback(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const natH = naturalHeightRef.current || 48;
      ta.style.transition =
        'height 0.22s cubic-bezier(0.16, 1, 0.3, 1), min-height 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
      ta.style.height = `${natH}px`;
      ta.style.minHeight = '';
      setIsExpanded(false);
      isExpandedRef.current = false;
      expandedHeightRef.current = null;
      onExpandedChange?.(false);
      setTimeout(() => {
        if (ta) ta.style.transition = '';
      }, 240);
    }, [onExpandedChange]);

    // Expand helper
    const expandInputHeight = useCallback(
      (customH?: number) => {
        const ta = textareaRef.current;
        if (!ta) return;
        naturalHeightRef.current = ta.offsetHeight;
        const targetH = customH || Math.max(ta.offsetHeight + 95, 145);
        ta.style.transition =
          'height 0.22s cubic-bezier(0.16, 1, 0.3, 1), min-height 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        ta.style.height = `${targetH}px`;
        ta.style.minHeight = `${targetH}px`;
        setIsExpanded(true);
        isExpandedRef.current = true;
        expandedHeightRef.current = targetH;
        onExpandedChange?.(true);
        setTimeout(() => {
          if (ta) ta.style.transition = '';
        }, 240);
      },
      [onExpandedChange]
    );

    // Native touch event listeners to handle tap + swipe down to extend & tap + swipe up to restore
    useEffect(() => {
      if (!enableSwipeResize) return;

      const container = containerRef.current;
      if (!container) return;

      let startY = 0;
      let startX = 0;
      let startTime = 0;
      let activeGesture: 'none' | 'rearrange' | 'resize' = 'none';
      let activeDragStartIdx = 0;
      let startHeight = 0;
      let natHeight = 48;

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        startY = touch.clientY;
        startX = touch.clientX;
        startTime = Date.now();
        activeGesture = 'none';
        isRearrangeDraggingRef.current = false;

        const ta = textareaRef.current;
        if (!ta) return;

        startHeight = ta.offsetHeight;
        if (!isExpandedRef.current) {
          natHeight = ta.offsetHeight;
          naturalHeightRef.current = natHeight;
        } else {
          natHeight = naturalHeightRef.current || 48;
        }

        // Initialize or validate rearrange history
        const curVal = ta.value ?? value ?? '';
        let hist = rearrangeHistoryRef.current;
        if (hist && hist.states[hist.currentIndex] !== curVal) {
          hist = null;
          rearrangeHistoryRef.current = null;
        }
        if (!hist) {
          const states = computeRearrangeStates(curVal);
          if (states.length > 1) {
            hist = { states, currentIndex: 0 };
            rearrangeHistoryRef.current = hist;
          }
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        const deltaY = touch.clientY - startY;
        const deltaX = touch.clientX - startX;
        const absY = Math.abs(deltaY);
        const absX = Math.abs(deltaX);

        // Don't hijack if user held finger for a long press (text selection)
        if (Date.now() - startTime > 450 && activeGesture === 'none') {
          return;
        }

        if (activeGesture === 'none') {
          // Detect clear vertical swipe
          if (absY > 7 && absY > absX * 1.05) {
            const hist = rearrangeHistoryRef.current;
            const canMoveUp = hist && hist.currentIndex < hist.states.length - 1;
            const canRestoreDown = hist && hist.currentIndex > 0;

            if (deltaY < -5 && canMoveUp) {
              // Swipe UP: move bottom text up to empty new line
              activeGesture = 'rearrange';
              activeDragStartIdx = hist.currentIndex;
              isRearrangeDraggingRef.current = true;
            } else if (deltaY > 5 && canRestoreDown) {
              // Swipe DOWN: restore each text back to original position one by one
              activeGesture = 'rearrange';
              activeDragStartIdx = hist.currentIndex;
              isRearrangeDraggingRef.current = true;
            } else if (!isExpandedRef.current && deltaY > 5) {
              // Not expanded and swiping DOWN: start extending!
              activeGesture = 'resize';
              setIsDragging(true);
            } else if (isExpandedRef.current && deltaY < -5) {
              // Already expanded and swiping UP: start collapsing back!
              if (!textareaRef.current || textareaRef.current.scrollTop <= 5) {
                activeGesture = 'resize';
                setIsDragging(true);
              }
            } else if (isExpandedRef.current && deltaY > 5) {
              // Already expanded and swiping DOWN further
              activeGesture = 'resize';
              setIsDragging(true);
            }
          }
        }

        if (activeGesture === 'rearrange') {
          if (e.cancelable) {
            e.preventDefault();
          }
          const hist = rearrangeHistoryRef.current;
          if (!hist) return;

          const STEP_PX = 24; // 24px per line transition
          let targetIdx = activeDragStartIdx;

          if (deltaY < 0) {
            // Swiping UP: move bottom text up to empty new line
            const distUp = -deltaY;
            const steps = Math.floor(Math.max(0, distUp - 4) / STEP_PX);
            targetIdx = Math.min(hist.states.length - 1, activeDragStartIdx + steps);
          } else {
            // Swiping DOWN: restore each text back to original position one by one based on swipe down distance
            const distDown = deltaY;
            const steps = Math.floor(Math.max(0, distDown - 4) / STEP_PX);
            targetIdx = Math.max(0, activeDragStartIdx - steps);
          }

          if (targetIdx !== hist.currentIndex) {
            hist.currentIndex = targetIdx;
            const nextVal = hist.states[targetIdx];
            const ta = textareaRef.current;
            if (ta) {
              ta.value = nextVal;
            }
            onValueChange?.(nextVal);
            if (window.navigator?.vibrate) {
              try {
                window.navigator.vibrate(10);
              } catch {}
            }
          }
        } else if (activeGesture === 'resize') {
          if (e.cancelable) {
            e.preventDefault();
          }
          const ta = textareaRef.current;
          if (!ta) return;

          ta.style.transition = 'none';

          const minH = natHeight;
          const maxH = Math.min(window.innerHeight * 0.65, 420);
          const currentH = Math.min(maxH, Math.max(minH, startHeight + deltaY));

          ta.style.height = `${currentH}px`;
          ta.style.minHeight = `${currentH}px`;
        }
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (activeGesture === 'rearrange') {
          const hist = rearrangeHistoryRef.current;
          if (hist) {
            const touchDuration = Date.now() - startTime;
            const touch = e.changedTouches[0];
            const deltaY = touch ? touch.clientY - startY : 0;

            // Quick flick gestures
            if (touchDuration < 280) {
              if (deltaY <= -18 && hist.currentIndex < hist.states.length - 1) {
                const nextIdx = Math.min(
                  hist.states.length - 1,
                  Math.max(hist.currentIndex, activeDragStartIdx + 1)
                );
                if (nextIdx !== hist.currentIndex) {
                  hist.currentIndex = nextIdx;
                  const nextVal = hist.states[nextIdx];
                  if (textareaRef.current) textareaRef.current.value = nextVal;
                  onValueChange?.(nextVal);
                  if (window.navigator?.vibrate) {
                    try {
                      window.navigator.vibrate(12);
                    } catch {}
                  }
                }
              } else if (deltaY >= 18 && hist.currentIndex > 0) {
                const nextIdx = Math.max(
                  0,
                  Math.min(hist.currentIndex, activeDragStartIdx - 1)
                );
                if (nextIdx !== hist.currentIndex) {
                  hist.currentIndex = nextIdx;
                  const nextVal = hist.states[nextIdx];
                  if (textareaRef.current) textareaRef.current.value = nextVal;
                  onValueChange?.(nextVal);
                  if (window.navigator?.vibrate) {
                    try {
                      window.navigator.vibrate(12);
                    } catch {}
                  }
                }
              }
            }
          }

          isRearrangeDraggingRef.current = false;
          lastDragEndTimeRef.current = Date.now();
          activeGesture = 'none';
          return;
        }

        if (activeGesture !== 'resize') {
          return;
        }

        activeGesture = 'none';
        setIsDragging(false);
        lastDragEndTimeRef.current = Date.now();

        const touchDuration = Date.now() - startTime;
        const touch = e.changedTouches[0];
        const deltaY = touch ? touch.clientY - startY : 0;
        const ta = textareaRef.current;
        if (!ta) return;

        ta.style.transition =
          'height 0.22s cubic-bezier(0.16, 1, 0.3, 1), min-height 0.22s cubic-bezier(0.16, 1, 0.3, 1)';

        if (!isExpandedRef.current) {
          // Was not expanded: did user swipe down?
          if (deltaY >= 25 || (deltaY >= 14 && touchDuration < 280)) {
            // Extend down!
            const finalH = Math.max(
              natHeight + 60,
              Math.min(window.innerHeight * 0.65, startHeight + deltaY)
            );
            ta.style.height = `${finalH}px`;
            ta.style.minHeight = `${finalH}px`;
            setIsExpanded(true);
            isExpandedRef.current = true;
            expandedHeightRef.current = finalH;
            onExpandedChange?.(true);
          } else {
            // Drag was too small, snap back to normal
            ta.style.height = `${natHeight}px`;
            ta.style.minHeight = '';
            setIsExpanded(false);
            isExpandedRef.current = false;
            expandedHeightRef.current = null;
            onExpandedChange?.(false);
          }
        } else {
          // Was already expanded: did user swipe up?
          if (deltaY <= -20 || (deltaY <= -12 && touchDuration < 280)) {
            // Bring it back to normal width/height!
            ta.style.height = `${natHeight}px`;
            ta.style.minHeight = '';
            setIsExpanded(false);
            isExpandedRef.current = false;
            expandedHeightRef.current = null;
            onExpandedChange?.(false);
          } else if (deltaY > 20) {
            // Dragged even further down
            const finalH = Math.min(window.innerHeight * 0.65, startHeight + deltaY);
            ta.style.height = `${finalH}px`;
            ta.style.minHeight = `${finalH}px`;
            expandedHeightRef.current = finalH;
          } else {
            // Snap back to saved expanded height
            const currentExpH = expandedHeightRef.current || startHeight;
            ta.style.height = `${currentExpH}px`;
            ta.style.minHeight = `${currentExpH}px`;
          }
        }

        setTimeout(() => {
          if (ta) ta.style.transition = '';
        }, 240);
      };

      container.addEventListener('touchstart', onTouchStart, { passive: true });
      container.addEventListener('touchmove', onTouchMove, { passive: false });
      container.addEventListener('touchend', onTouchEnd, { passive: true });
      container.addEventListener('touchcancel', onTouchEnd, { passive: true });

      return () => {
        container.removeEventListener('touchstart', onTouchStart);
        container.removeEventListener('touchmove', onTouchMove);
        container.removeEventListener('touchend', onTouchEnd);
        container.removeEventListener('touchcancel', onTouchEnd);
      };
    }, [enableSwipeResize, onExpandedChange]);

    // Handle mouse drag / click on the bottom handle
    const handleHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      // For mouse interactions on the handle
      if (e.pointerType !== 'mouse') return;
      e.currentTarget.setPointerCapture(e.pointerId);

      const startY = e.clientY;
      const startTime = Date.now();
      const ta = textareaRef.current;
      if (!ta) return;

      const startHeight = ta.offsetHeight;
      const natHeight = isExpandedRef.current ? naturalHeightRef.current : startHeight;
      let dragged = false;

      const onPointerMove = (moveEvent: PointerEvent) => {
        const deltaY = moveEvent.clientY - startY;
        if (Math.abs(deltaY) > 4) {
          dragged = true;
          setIsDragging(true);
          ta.style.transition = 'none';
          const maxH = Math.min(window.innerHeight * 0.65, 420);
          const currentH = Math.min(maxH, Math.max(natHeight, startHeight + deltaY));
          ta.style.height = `${currentH}px`;
          ta.style.minHeight = `${currentH}px`;
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        setIsDragging(false);
        lastDragEndTimeRef.current = Date.now();

        const deltaY = upEvent.clientY - startY;
        const duration = Date.now() - startTime;

        if (!dragged || (Math.abs(deltaY) < 6 && duration < 300)) {
          // Simple click on handle: toggle expand/restore
          if (isExpandedRef.current) {
            restoreNormalHeight();
          } else {
            expandInputHeight();
          }
          return;
        }

        ta.style.transition =
          'height 0.22s cubic-bezier(0.16, 1, 0.3, 1), min-height 0.22s cubic-bezier(0.16, 1, 0.3, 1)';

        if (!isExpandedRef.current) {
          if (deltaY >= 20) {
            const finalH = Math.max(natHeight + 60, startHeight + deltaY);
            ta.style.height = `${finalH}px`;
            ta.style.minHeight = `${finalH}px`;
            setIsExpanded(true);
            isExpandedRef.current = true;
            expandedHeightRef.current = finalH;
            onExpandedChange?.(true);
          } else {
            ta.style.height = `${natHeight}px`;
            ta.style.minHeight = '';
            setIsExpanded(false);
            isExpandedRef.current = false;
            expandedHeightRef.current = null;
            onExpandedChange?.(false);
          }
        } else {
          if (deltaY <= -15) {
            restoreNormalHeight();
          } else if (deltaY > 15) {
            const finalH = Math.min(window.innerHeight * 0.65, startHeight + deltaY);
            ta.style.height = `${finalH}px`;
            ta.style.minHeight = `${finalH}px`;
            expandedHeightRef.current = finalH;
          } else {
            const currentExpH = expandedHeightRef.current || startHeight;
            ta.style.height = `${currentExpH}px`;
            ta.style.minHeight = `${currentExpH}px`;
          }
        }

        setTimeout(() => {
          if (ta) ta.style.transition = '';
        }, 240);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    const effectiveTextareaClass = isExpanded
      ? className.replace(/\boverflow-hidden\b/g, '').trim() + ' overflow-y-auto'
      : className;

    return (
      <div
        ref={containerRef}
        className={`relative w-full rounded-xl bg-[#0E121A] overflow-hidden group/inputbox select-text ${containerClassName}`}
      >
        {/* Real interactive textarea */}
        <textarea
          ref={textareaRef}
          dir={dir}
          value={value}
          onScroll={handleScroll}
          onClick={(e) => {
            handleEmptyLineTap(e.clientX, e.clientY);
            props.onClick?.(e);
          }}
          onChange={(e) => {
            // When user edits text, clear rearrange history so swiping down won't restore
            if (!isRearrangeDraggingRef.current) {
              rearrangeHistoryRef.current = null;
            }
            props.onChange?.(e);
          }}
          onKeyDown={(e) => {
            if (!isRearrangeDraggingRef.current) {
              if (
                e.key === 'Backspace' ||
                e.key === 'Delete' ||
                e.key === 'Enter' ||
                (e.key.length === 1 && !e.ctrlKey && !e.metaKey)
              ) {
                rearrangeHistoryRef.current = null;
              }
            }
            props.onKeyDown?.(e);
          }}
          style={{
            ...style,
            backgroundColor: 'transparent',
          }}
          className={`relative z-10 w-full ${effectiveTextareaClass}`}
          {...props}
        />

        {/* High-visibility overlay on top (z-20 pointer-events-none so all typing/clicks pass through to textarea) */}
        <div
          ref={backdropRef}
          aria-hidden="true"
          dir={dir}
          className={`absolute inset-0 pointer-events-none select-none z-20 font-sans whitespace-pre-wrap break-words overflow-hidden ${backdropClassName}`}
          style={{
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
          }}
        >
          <div className="w-full inline-block">
            {renderContentWithWhitespaceIndicators(value)}
            {value.endsWith('\n') && <br aria-hidden="true" />}
          </div>
        </div>

        {/* Swipe-to-extend / Swipe-up-to-collapse Bottom Indicator Bar */}
        {enableSwipeResize && (
          <div
            onPointerDown={handleHandlePointerDown}
            onClick={(e) => {
              e.stopPropagation();
              if (isExpanded) {
                restoreNormalHeight();
              } else {
                expandInputHeight();
              }
            }}
            title={
              isExpanded
                ? 'اسحب للأعلى أو انقر للاستعادة للحجم الطبيعي / Swipe up or tap to restore normal size'
                : 'اسحب للأسفل لتوسيع مربع الإدخال / Swipe down to extend input box'
            }
            className={`absolute bottom-0 inset-x-0 h-3.5 z-30 flex items-center justify-center cursor-ns-resize select-none touch-none transition-colors ${
              isDragging ? 'bg-slate-800/40' : 'hover:bg-slate-800/20'
            }`}
          >
            <div
              className={`h-[2.5px] rounded-full transition-all duration-200 ${
                isDragging
                  ? 'w-14 bg-[#334155]'
                  : isExpanded
                    ? 'w-11 bg-[#252E3E] group-hover/inputbox:bg-[#323D50]'
                    : 'w-8 bg-[#1E2633] group-hover/inputbox:bg-[#252E3E] group-hover/inputbox:w-10'
              }`}
            />
          </div>
        )}
      </div>
    );
  }
);

HighlightedTextarea.displayName = 'HighlightedTextarea';

