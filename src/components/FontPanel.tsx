import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';
import { isRtlLanguageCode, useT } from '../i18n/i18n';
import AddFontModal from './AddFontModal';
import {
  EFFECT_RANGES,
  SPACING_PRESETS,
  buildFamilies,
  formatSpacingValue,
  loadAllFonts,
  pickVariantKey,
  resolveChoice,
  setEffectKind,
  setEffectThickness,
  setFontChoice,
  setSeparateEditorFont,
  setSpacing,
  useFonts,
  type FontFamilyEntry,
  type FontTarget,
  type SpacingValue,
  type TextEffectKind,
} from '../utils/fonts';

type MenuState = { target: FontTarget; kind: 'family' | 'style' | 'spacing' } | null;

const menuClass =
  'absolute top-full mt-1 start-0 z-40 min-w-[8.5rem] max-w-[14rem] max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-[#2A3446] bg-white dark:bg-[#161922] shadow-lg py-1 flex flex-col no-scrollbar';
const spacingMenuClass =
  'absolute top-full mt-1 end-0 z-40 min-w-[8.5rem] max-w-[14rem] max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-[#2A3446] bg-white dark:bg-[#161922] shadow-lg py-1 flex flex-col no-scrollbar';
const chipClass = 'flex items-center gap-1.5 max-w-full min-w-0 text-base text-slate-900 dark:text-white cursor-pointer select-none';
const menuItemClass =
  'block w-full shrink-0 text-start px-3 py-1.5 text-base truncate cursor-pointer hover:bg-slate-100 dark:hover:bg-[#1C2333]';

/** Sub-menu of the sidebar "F" button: choose the default font, its style, add or remove fonts. */
export default function FontPanel({ targetLang, uiLang, sourceLang }: { targetLang: string; uiLang: string; sourceLang: string }) {
  const { t, tb } = useT();
  const snap = useFonts();
  const [menu, setMenu] = useState<MenuState>(null);
  const [addOpen, setAddOpen] = useState(false);
  const families = useMemo(() => buildFamilies(snap.fonts), [snap.fonts]);
  // Letter-spacing breaks Arabic letter joining, so a spacing control stays
  // disabled (silently, no note) while its content language is Arabic/RTL.
  const isTargetRtl = isRtlLanguageCode(targetLang);
  const isUiRtl = isRtlLanguageCode(uiLang);
  const isSourceRtl = isRtlLanguageCode(sourceLang);
  const labelClass = 'text-[11px] font-medium text-slate-500 dark:text-slate-400';

  // Register all added fonts so the lists preview each name in its own font
  useEffect(() => {
    void loadAllFonts();
  }, []);

  // A tap anywhere outside the open list closes it (a tap on a chip is handled by the chip itself)
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest('[data-font-chip],[data-font-menu]')) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu]);

  const familyName = (f: FontFamilyEntry) => (f.nameKey ? tb(f.nameKey) : f.name);

  const renderStrip = (target: FontTarget) => {
    const choice = snap.selection[target];
    const { family, variant } = resolveChoice(families, choice);
    const previewStyle = {
      fontFamily: family.css,
      fontWeight: variant.weight,
      fontStyle: variant.italic ? 'italic' : 'normal',
    } as const;
    const open = menu?.target === target ? menu.kind : null;
    const multiStyle = family.variants.length > 1;
    const toggle = (kind: 'family' | 'style') =>
      setMenu((prev) => (prev && prev.target === target && prev.kind === kind ? null : { target, kind }));

    return (
      <div className="flex items-center gap-5 min-w-0">
        <div className="relative min-w-0 max-w-[45%]">
          <button
            type="button"
            data-font-chip
            onClick={() => toggle('family')}
            className={chipClass}
            style={previewStyle}
            aria-haspopup="listbox"
            aria-expanded={open === 'family'}
            aria-label={tb('font_pick_family')}
          >
            <span className="truncate" dir="auto" data-i18n={family.nameKey ? '' : undefined}>
              {familyName(family)}
            </span>
            <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open === 'family' ? 'rotate-180' : ''}`} />
          </button>
          {open === 'family' && (
            <div data-font-menu role="listbox" className={menuClass}>
              {families.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="option"
                  aria-selected={f.id === family.id}
                  onClick={() => {
                    setFontChoice(target, { f: f.id, v: pickVariantKey(f, variant.key) });
                    setMenu(null);
                  }}
                  className={`${menuItemClass} ${
                    f.id === family.id ? 'text-[var(--accent-primary)]' : 'text-slate-800 dark:text-slate-100'
                  }`}
                  style={{ fontFamily: f.css }}
                  dir="auto"
                >
                  {familyName(f)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative min-w-0 max-w-[40%]">
          <button
            type="button"
            data-font-chip
            disabled={!multiStyle}
            onClick={() => toggle('style')}
            className={`${chipClass} disabled:cursor-default`}
            style={previewStyle}
            aria-haspopup="listbox"
            aria-expanded={open === 'style'}
            aria-label={tb('font_pick_style')}
          >
            <span className="truncate">{variant.label}</span>
            {multiStyle && (
              <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open === 'style' ? 'rotate-180' : ''}`} />
            )}
          </button>
          {open === 'style' && (
            <div data-font-menu role="listbox" className={menuClass}>
              {family.variants.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  role="option"
                  aria-selected={v.key === variant.key}
                  onClick={() => {
                    setFontChoice(target, { f: family.id, v: v.key });
                    setMenu(null);
                  }}
                  className={`${menuItemClass} ${
                    v.key === variant.key ? 'text-[var(--accent-primary)]' : 'text-slate-800 dark:text-slate-100'
                  }`}
                  style={{ fontFamily: family.css, fontWeight: v.weight, fontStyle: v.italic ? 'italic' : 'normal' }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {target === 'app' && (
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              setAddOpen(true);
            }}
            title={tb('font_add')}
            aria-label={tb('font_add')}
            className="ms-auto w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-lg leading-none text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-200/70 dark:bg-[#252F42] cursor-pointer"
          >
            +
          </button>
        )}
      </div>
    );
  };

  const renderSpacingRow = (target: FontTarget, disabled: boolean) => {
    const value = snap.selection.spacing[target];
    const open = menu?.target === target && menu.kind === 'spacing';
    const toggle = () =>
      setMenu((prev) => (prev && prev.target === target && prev.kind === 'spacing' ? null : { target, kind: 'spacing' }));
    return (
      <div className="flex items-center justify-between gap-3">
        <span className={labelClass} data-i18n>{t('font_spacing')}</span>
        <div className="relative min-w-0">
          <button
            type="button"
            data-font-chip
            disabled={disabled}
            onClick={toggle}
            className={`${chipClass} disabled:cursor-default disabled:opacity-50`}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={tb('font_pick_spacing')}
          >
            <span className="truncate">{value === null ? tb('font_default') : formatSpacingValue(value)}</span>
            <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div data-font-menu role="listbox" className={spacingMenuClass}>
              {SPACING_PRESETS.map((v: SpacingValue) => (
                <button
                  key={v === null ? 'default' : String(v)}
                  type="button"
                  role="option"
                  aria-selected={v === value}
                  onClick={() => {
                    setSpacing(target, v);
                    setMenu(null);
                  }}
                  className={`${menuItemClass} ${v === value ? 'text-[var(--accent-primary)]' : 'text-slate-800 dark:text-slate-100'}`}
                >
                  {v === null ? tb('font_default') : formatSpacingValue(v)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const separate = snap.selection.separate;
  const effect = snap.selection.effect;
  const effectRange = effect.kind === 'outline' ? EFFECT_RANGES.outline : EFFECT_RANGES.shadow;
  const effectPct = Math.round(((effect.thickness - effectRange.min) / (effectRange.max - effectRange.min)) * 10000) / 100;

  return (
    <div className="px-4 py-3 flex flex-col gap-2.5 border-b border-slate-200/80 dark:border-[#252C3A] bg-slate-50/70 dark:bg-[#141822]/60 animate-in fade-in duration-150">
      {renderStrip('app')}
      {renderSpacingRow('app', isUiRtl)}

      <button
        type="button"
        role="switch"
        aria-checked={separate}
        onClick={() => {
          setMenu(null);
          setSeparateEditorFont(!separate);
        }}
        className="flex items-center justify-between gap-3 text-start cursor-pointer pt-1"
      >
        <span className="text-xs text-slate-600 dark:text-slate-300" data-i18n>{t('font_separate')}</span>
        <span
          className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${separate ? 'bg-[var(--accent-primary)]' : 'bg-slate-300 dark:bg-[#2A3446]'}`}
        >
          <span
            className={`absolute top-0.5 start-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${separate ? 'translate-x-4 rtl:-translate-x-4' : ''}`}
          />
        </span>
      </button>

      {separate && (
        <>
          <span className={`${labelClass} pt-1`} data-i18n>{t('font_label_source')}</span>
          {renderStrip('source')}
          {renderSpacingRow('source', isSourceRtl)}
          <span className={`${labelClass} pt-1`} data-i18n>{t('font_label_editor')}</span>
          {renderStrip('editor')}
          {renderSpacingRow('editor', isTargetRtl)}
        </>
      )}

      <div className="border-t border-slate-200/80 dark:border-[#252C3A]" />
      <span className={labelClass} data-i18n>{t('font_effect')}</span>
      <div className="flex rounded-xl bg-slate-100 dark:bg-[#1C2333] p-1 gap-1" role="group" aria-label={t('font_effect')}>
        {(['none', 'shadow', 'outline'] as const).map((k: TextEffectKind) => (
          <button
            key={k}
            type="button"
            onClick={() => setEffectKind(k)}
            aria-pressed={effect.kind === k}
            className={`flex-1 h-8 rounded-lg text-sm font-medium cursor-pointer transition ${
              effect.kind === k
                ? 'bg-[var(--accent-primary)] text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#242E40]'
            }`}
          >
            {t(`font_effect_${k}`)}
          </button>
        ))}
      </div>
      {effect.kind !== 'none' && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            className="fx-slider flex-1 min-w-0"
            min={effectRange.min}
            max={effectRange.max}
            step={0.01}
            value={effect.thickness}
            onChange={(e) => setEffectThickness(parseFloat(e.target.value))}
            style={{ '--p': `${effectPct}%` } as CSSProperties}
            aria-label={tb('font_effect_thickness')}
          />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200 tabular-nums shrink-0 w-12 text-end">
            {effect.thickness} px
          </span>
        </div>
      )}

      {addOpen && <AddFontModal target="app" onClose={() => setAddOpen(false)} />}
    </div>
  );
}
