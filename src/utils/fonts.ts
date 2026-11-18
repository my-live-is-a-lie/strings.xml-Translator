// Custom fonts: the default font of the app (and, optionally, a separate font for the text fields).
//  - Font files picked from the device are kept in their own IndexedDB database (binary data) and
//    registered with the browser through the FontFace API.
//  - Metadata and the current choice live in `app_*` keys of the normal storage layer.
import { useSyncExternalStore } from 'react';
import { getStoredItem, setStoredItem } from './storage';
import { debugIgnored } from './debug';

/** 'app' = whole app, 'source' = source text field, 'editor' = translation field. */
export type FontTarget = 'app' | 'source' | 'editor';

export interface UserFontMeta {
  id: string;
  family: string;
  weight: number;
  italic: boolean;
  fileName: string;
}

/** `f` is a family id ('b:default', 'b:serif' ... or 'u:<family name>'), `v` a variant key ('400', '700i'). */
export interface FontChoice {
  f: string;
  v: string;
}

/** Letter-spacing value in em; `null` = Default (no explicit spacing). */
export type SpacingValue = number | null;

export interface SpacingSelection {
  app: SpacingValue;
  source: SpacingValue;
  editor: SpacingValue;
}

/** Text effect applied to the interface text (never to the text fields). */
export type TextEffectKind = 'none' | 'shadow' | 'outline';

export interface TextEffect {
  kind: TextEffectKind;
  /** Thickness in px: shadow blur radius, outline ring radius. */
  thickness: number;
}

export interface FontSelection {
  app: FontChoice;
  /** Source text field (only used while `separate` is on). */
  source: FontChoice;
  /** Translation field (only used while `separate` is on). */
  editor: FontChoice;
  separate: boolean;
  spacing: SpacingSelection;
  effect: TextEffect;
}

export interface FontVariant {
  key: string;
  weight: number;
  italic: boolean;
  label: string;
  fontId?: string;
}

export interface FontFamilyEntry {
  id: string;
  name: string;
  /** Translation key for the display name (built-in "Default" only). */
  nameKey?: string;
  builtin: boolean;
  css: string;
  variants: FontVariant[];
}

export interface ResolvedFont {
  family: FontFamilyEntry;
  variant: FontVariant;
}

const FONTS_KEY = 'app_fonts_v1';
const SELECTION_KEY = 'app_font_selection_v1';
const DB_NAME = 'strings_translator_fonts';
const STORE = 'files';
const MAX_FONT_BYTES = 30 * 1024 * 1024;

export const DEFAULT_STACK = "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FALLBACK_STACK = ", 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const DEFAULT_FAMILY_ID = 'b:default';
const DEFAULT_CHOICE: FontChoice = { f: DEFAULT_FAMILY_ID, v: '400' };

/** Letter-spacing presets (em) offered in the panel dropdown; `null` = Default. */
export const SPACING_PRESETS: SpacingValue[] = [null, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1];
export const SPACING_MIN = -0.02;
export const SPACING_MAX = 0.1;

/** Thickness range (px) per effect mode. */
export const EFFECT_RANGES: Record<'shadow' | 'outline', { min: number; max: number }> = {
  shadow: { min: 0, max: 3 },
  outline: { min: 0.5, max: 1.5 },
};

/** Colour of the shadow halo and the outline ring. */
export const FX_COLOR = '#202634';
const FX_SHADOW_ALPHA = 0.55;

/** Display text for a spacing value: "-0.02 em", "0 em", "+0.1 em". */
export function formatSpacingValue(value: number): string {
  return `${value > 0 ? '+' : ''}${value} em`;
}

// ---------- Names of styles ----------

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

export function styleLabel(weight: number, italic: boolean): string {
  const name = WEIGHT_NAMES[weight] ?? String(weight);
  if (!italic) return name;
  return weight === 400 ? 'Italic' : `${name} Italic`;
}

export const variantKey = (weight: number, italic: boolean): string => `${weight}${italic ? 'i' : ''}`;

function makeVariant(weight: number, italic: boolean, fontId?: string): FontVariant {
  return { key: variantKey(weight, italic), weight, italic, label: styleLabel(weight, italic), fontId };
}

const sortVariants = (list: FontVariant[]): FontVariant[] =>
  [...list].sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));

// ---------- Family list ----------

const BUILTIN_VARIANTS = (): FontVariant[] =>
  sortVariants([makeVariant(400, false), makeVariant(700, false), makeVariant(400, true), makeVariant(700, true)]);

const BUILTIN_FAMILIES: FontFamilyEntry[] = [
  { id: DEFAULT_FAMILY_ID, name: 'Default', nameKey: 'font_default', builtin: true, css: DEFAULT_STACK, variants: BUILTIN_VARIANTS() },
  { id: 'b:serif', name: 'serif', builtin: true, css: 'serif', variants: BUILTIN_VARIANTS() },
  { id: 'b:sans-serif', name: 'sans-serif', builtin: true, css: 'sans-serif', variants: BUILTIN_VARIANTS() },
  { id: 'b:monospace', name: 'monospace', builtin: true, css: 'monospace', variants: BUILTIN_VARIANTS() },
];

/** The CSS family name a user font is registered under (kept apart from system font names). */
export const userCssName = (family: string): string => `UF ${family.replace(/["\\]/g, '')}`;
const userCssStack = (family: string): string => `"${userCssName(family)}"${FALLBACK_STACK}`;

/** Built-in fonts first ("Default" pinned on top), then everything else sorted by name; styles sorted by weight. */
export function buildFamilies(fonts: UserFontMeta[]): FontFamilyEntry[] {
  const map = new Map<string, FontFamilyEntry>();
  for (const f of fonts) {
    const key = f.family.toLowerCase();
    let entry = map.get(key);
    if (!entry) {
      entry = { id: `u:${f.family}`, name: f.family, builtin: false, css: userCssStack(f.family), variants: [] };
      map.set(key, entry);
    }
    entry.variants.push(makeVariant(f.weight, f.italic, f.id));
  }
  const user = [...map.values()].map((e) => ({ ...e, variants: sortVariants(e.variants) }));
  const all = [...BUILTIN_FAMILIES.slice(1), ...user].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  return [BUILTIN_FAMILIES[0], ...all];
}

/** Picks the stored choice if it still exists, otherwise the closest alternative (never fails). */
export function resolveChoice(families: FontFamilyEntry[], choice: FontChoice): ResolvedFont {
  const family = families.find((f) => f.id === choice.f) ?? families[0];
  const variant =
    family.variants.find((v) => v.key === choice.v) ??
    family.variants.find((v) => v.key === '400') ??
    family.variants[0];
  return { family, variant };
}

/** Keeps the same weight/italic when the new family has it, otherwise Regular, otherwise the first style. */
export function pickVariantKey(family: FontFamilyEntry, wanted: string): string {
  return (
    family.variants.find((v) => v.key === wanted)?.key ??
    family.variants.find((v) => v.key === '400')?.key ??
    family.variants[0].key
  );
}

// ---------- Reading font files ----------

interface FontInfo {
  family: string;
  weight: number;
  italic: boolean;
}

const tag = (view: DataView, offset: number): string =>
  String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type TableReader = (name: string) => Promise<DataView | null>;

function sfntReader(buf: ArrayBuffer): TableReader | null {
  const view = new DataView(buf);
  if (view.byteLength < 12) return null;
  let base = 0;
  if (tag(view, 0) === 'ttcf') {
    if (view.byteLength < 16) return null;
    base = view.getUint32(12);
  }
  if (base + 12 > view.byteLength) return null;
  const sig = view.getUint32(base);
  const ok = sig === 0x00010000 || sig === 0x4f54544f || sig === 0x74727565 || sig === 0x74797031;
  if (!ok) return null;
  const count = view.getUint16(base + 4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > view.byteLength) break;
    tables.set(tag(view, rec), { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  return async (name) => {
    const t = tables.get(name);
    if (!t || t.offset + t.length > view.byteLength) return null;
    return new DataView(buf, t.offset, t.length);
  };
}

function woffReader(buf: ArrayBuffer): TableReader | null {
  const view = new DataView(buf);
  if (view.byteLength < 44 || tag(view, 0) !== 'wOFF') return null;
  const count = view.getUint16(12);
  const tables = new Map<string, { offset: number; comp: number; orig: number }>();
  for (let i = 0; i < count; i++) {
    const rec = 44 + i * 20;
    if (rec + 20 > view.byteLength) break;
    tables.set(tag(view, rec), { offset: view.getUint32(rec + 4), comp: view.getUint32(rec + 8), orig: view.getUint32(rec + 12) });
  }
  return async (name) => {
    const t = tables.get(name);
    if (!t || t.offset + t.comp > view.byteLength) return null;
    const raw = new Uint8Array(buf, t.offset, t.comp);
    const bytes = t.comp < t.orig ? await inflate(raw) : raw.slice();
    return new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  };
}

function readNameRecord(table: DataView, wantedId: number): string | null {
  if (table.byteLength < 6) return null;
  const count = table.getUint16(2);
  const strOffset = table.getUint16(4);
  let best: { text: string; score: number } | null = null;
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > table.byteLength) break;
    const platform = table.getUint16(rec);
    const lang = table.getUint16(rec + 4);
    const id = table.getUint16(rec + 6);
    if (id !== wantedId) continue;
    const length = table.getUint16(rec + 8);
    const start = strOffset + table.getUint16(rec + 10);
    if (start + length > table.byteLength) continue;
    let text = '';
    if (platform === 3 || platform === 0) {
      for (let p = 0; p + 1 < length; p += 2) text += String.fromCharCode(table.getUint16(start + p));
    } else if (platform === 1) {
      for (let p = 0; p < length; p++) text += String.fromCharCode(table.getUint8(start + p));
    } else {
      continue;
    }
    text = text.trim();
    if (!text) continue;
    const score = platform === 3 ? (lang === 0x409 ? 4 : 3) : platform === 0 ? 2 : 1;
    if (!best || score > best.score) best = { text, score };
  }
  return best?.text ?? null;
}

/** Reads family name, weight and italic flag from a TTF / OTF / TTC / WOFF file. Returns null if unreadable. */
export async function readFontInfo(buf: ArrayBuffer, fileName: string): Promise<FontInfo | null> {
  try {
    const read = woffReader(buf) ?? sfntReader(buf);
    if (!read) return null;
    const nameTable = await read('name');
    const os2 = await read('OS/2');
    const head = await read('head');
    const family =
      (nameTable && (readNameRecord(nameTable, 16) ?? readNameRecord(nameTable, 1))) ||
      fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim() ||
      'Font';
    const sub = (nameTable && (readNameRecord(nameTable, 17) ?? readNameRecord(nameTable, 2))) || '';
    const macStyle = head && head.byteLength >= 46 ? head.getUint16(44) : 0;
    const fsSelection = os2 && os2.byteLength >= 64 ? os2.getUint16(62) : 0;
    const italic = (fsSelection & 1) !== 0 || (fsSelection & 512) !== 0 || (macStyle & 2) !== 0 || /italic|oblique/i.test(sub);
    let weight = os2 && os2.byteLength >= 6 ? os2.getUint16(4) : 0;
    if (!weight || weight < 1 || weight > 1000) weight = (macStyle & 1) !== 0 || /bold/i.test(sub) ? 700 : 400;
    weight = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
    return { family, weight, italic };
  } catch (err) {
    debugIgnored('fonts.readFontInfo', err);
    return null;
  }
}

// ---------- Binary storage (IndexedDB, separate database) ----------

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryFiles = new Map<string, ArrayBuffer>();

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise =
      typeof indexedDB === 'undefined'
        ? Promise.resolve(null)
        : new Promise((resolve) => {
            try {
              const req = indexedDB.open(DB_NAME, 1);
              req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
              };
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => resolve(null);
              req.onblocked = () => resolve(null);
            } catch {
              resolve(null);
            }
          });
  }
  return dbPromise;
}

/**
 * Stores a font file. Returns true when the file reached IndexedDB. When
 * IndexedDB is unavailable the file is kept in memory only (so the font still
 * works for this session) and false is returned, so the caller can warn the
 * user that the font will not survive a restart. A failed transaction still
 * rejects, and in that case nothing is cached.
 */
async function putFile(id: string, data: ArrayBuffer): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    memoryFiles.set(id, data);
    return false;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  memoryFiles.set(id, data);
  return true;
}

async function getFile(id: string): Promise<ArrayBuffer | null> {
  const cached = memoryFiles.get(id);
  if (cached) return cached;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function deleteFile(id: string): Promise<void> {
  memoryFiles.delete(id);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------- Store ----------

interface Snapshot {
  fonts: UserFontMeta[];
  selection: FontSelection;
}

const isChoice = (v: unknown): v is FontChoice =>
  !!v && typeof v === 'object' && typeof (v as FontChoice).f === 'string' && typeof (v as FontChoice).v === 'string';

function loadFonts(): UserFontMeta[] {
  try {
    const raw = JSON.parse(getStoredItem(FONTS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (f): f is UserFontMeta =>
        !!f && typeof f.id === 'string' && typeof f.family === 'string' && typeof f.weight === 'number' && typeof f.italic === 'boolean'
    );
  } catch {
    return [];
  }
}

const isSpacingValue = (v: unknown): v is SpacingValue =>
  v === null || (typeof v === 'number' && Number.isFinite(v));

const clampSpacing = (v: SpacingValue): SpacingValue =>
  v === null ? null : Math.round(Math.min(SPACING_MAX, Math.max(SPACING_MIN, v)) * 100) / 100;

function loadSelection(): FontSelection {
  try {
    const raw = JSON.parse(getStoredItem(SELECTION_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const spacing = raw.spacing && typeof raw.spacing === 'object' ? raw.spacing : {};
      const effect = raw.effect && typeof raw.effect === 'object' ? raw.effect : {};
      const kind: TextEffectKind = effect.kind === 'shadow' || effect.kind === 'outline' ? effect.kind : 'none';
      const range = kind === 'outline' ? EFFECT_RANGES.outline : EFFECT_RANGES.shadow;
      const thickness =
        typeof effect.thickness === 'number' && Number.isFinite(effect.thickness)
          ? Math.round(Math.min(range.max, Math.max(range.min, effect.thickness)) * 100) / 100
          : 1;
      return {
        app: isChoice(raw.app) ? raw.app : DEFAULT_CHOICE,
        source: isChoice(raw.source) ? raw.source : DEFAULT_CHOICE,
        editor: isChoice(raw.editor) ? raw.editor : DEFAULT_CHOICE,
        separate: raw.separate === true,
        spacing: {
          app: clampSpacing(isSpacingValue(spacing.app) ? spacing.app : null),
          source: clampSpacing(isSpacingValue(spacing.source) ? spacing.source : null),
          editor: clampSpacing(isSpacingValue(spacing.editor) ? spacing.editor : null),
        },
        effect: { kind, thickness },
      };
    }
  } catch (err) {
    debugIgnored('fonts.loadSelection', err);
  }
  return {
    app: DEFAULT_CHOICE,
    source: DEFAULT_CHOICE,
    editor: DEFAULT_CHOICE,
    separate: false,
    spacing: { app: null, source: null, editor: null },
    effect: { kind: 'none', thickness: 1 },
  };
}

let snapshot: Snapshot = { fonts: loadFonts(), selection: loadSelection() };
const listeners = new Set<() => void>();
const faces = new Map<string, FontFace>();
const loading = new Map<string, Promise<void>>();

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function persist() {
  setStoredItem(FONTS_KEY, JSON.stringify(snapshot.fonts));
  setStoredItem(SELECTION_KEY, JSON.stringify(snapshot.selection));
}

export const getFontsSnapshot = (): Snapshot => snapshot;
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useFonts(): Snapshot {
  return useSyncExternalStore(subscribe, getFontsSnapshot);
}

// ---------- Letter spacing and text effect ----------

/** Builds the text-shadow value for the effect, or null when no effect is active. */
function buildFxShadow(effect: TextEffect): string | null {
  if (effect.kind === 'none') return null;
  if (effect.kind === 'shadow') return `0 0 ${effect.thickness}px rgba(32,38,52,${FX_SHADOW_ALPHA})`;
  // Outline: a ring of 16 shadows around each glyph, growing purely outward
  // (a text stroke would draw half inside the glyph and darken the fill).
  const parts: string[] = [];
  for (let m = 0; m < 16; m++) {
    const a = (m * Math.PI) / 8;
    parts.push(`${(Math.cos(a) * effect.thickness).toFixed(2)}px ${(Math.sin(a) * effect.thickness).toFixed(2)}px 0 ${FX_COLOR}`);
  }
  return parts.join(', ');
}

/** Applies the letter-spacing choice (CSS vars + gate read by index.css). */
function applySpacing(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const s = snapshot.selection.spacing;
  const set = (name: string, v: SpacingValue) => {
    if (v === null) root.style.removeProperty(name);
    else root.style.setProperty(name, `${v}em`);
  };
  set('--ls-app', s.app);
  set('--ls-source', s.source);
  set('--ls-editor', s.editor);
  if (s.app !== null || s.source !== null || s.editor !== null) root.setAttribute('data-ls-on', '');
  else root.removeAttribute('data-ls-on');
}

/** Applies the text-effect choice (CSS var + gate read by index.css). */
function applyEffect(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const shadow = buildFxShadow(snapshot.selection.effect);
  if (shadow === null) {
    root.style.removeProperty('--fx-text-shadow');
    root.removeAttribute('data-text-fx');
  } else {
    root.style.setProperty('--fx-text-shadow', shadow);
    root.setAttribute('data-text-fx', '');
  }
}

// ---------- Applying the choice to the page ----------

export function applyFonts(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const families = buildFamilies(snapshot.fonts);
  const app = resolveChoice(families, snapshot.selection.app);

  if (app.family.id === DEFAULT_FAMILY_ID) root.style.removeProperty('--font-sans');
  else root.style.setProperty('--font-sans', app.family.css);
  root.style.fontWeight = app.variant.weight === 400 ? '' : String(app.variant.weight);
  root.style.fontStyle = app.variant.italic ? 'italic' : '';
  // Non-default app weights win over the weight utilities on headings and
  // buttons (which would otherwise ignore the panel choice). Regular keeps
  // the designed emphasis: no variable, no override.
  if (app.variant.weight === 400) {
    root.style.removeProperty('--app-font-weight');
    root.removeAttribute('data-app-weight');
  } else {
    root.style.setProperty('--app-font-weight', String(app.variant.weight));
    root.setAttribute('data-app-weight', '');
  }

  if (snapshot.selection.separate) {
    for (const [prefix, choice] of [['editor', snapshot.selection.editor], ['source', snapshot.selection.source]] as const) {
      const r = resolveChoice(families, choice);
      root.style.setProperty(`--${prefix}-font-family`, r.family.css);
      root.style.setProperty(`--${prefix}-font-weight`, String(r.variant.weight));
      root.style.setProperty(`--${prefix}-font-style`, r.variant.italic ? 'italic' : 'normal');
    }
    root.setAttribute('data-editor-font', '');
  } else {
    root.removeAttribute('data-editor-font');
    for (const prefix of ['editor', 'source']) {
      for (const p of ['family', 'weight', 'style']) root.style.removeProperty(`--${prefix}-font-${p}`);
    }
  }

  applySpacing();
  applyEffect();
}

// ---------- Registering fonts with the browser ----------

function loadFace(meta: UserFontMeta): Promise<void> {
  if (faces.has(meta.id)) return Promise.resolve();
  const running = loading.get(meta.id);
  if (running) return running;
  const job = (async () => {
    const data = await getFile(meta.id);
    if (!data) return;
    const face = new FontFace(userCssName(meta.family), data.slice(0), {
      weight: String(meta.weight),
      style: meta.italic ? 'italic' : 'normal',
    });
    await face.load();
    // The FontFace now holds the data, so the in-memory copy is redundant.
    memoryFiles.delete(meta.id);
    document.fonts.add(face);
    faces.set(meta.id, face);
  })()
    .catch((err) => debugIgnored('fonts.loadFace', err))
    .finally(() => loading.delete(meta.id));
  loading.set(meta.id, job);
  return job;
}

/** Registers every added font (used when the font panel opens, so the previews show real fonts). */
export async function loadAllFonts(): Promise<void> {
  await Promise.all(snapshot.fonts.map(loadFace));
}

/** Call once at startup: applies the saved choice right away and loads the fonts it needs. */
export function initFonts(): void {
  applyFonts();
  const families = buildFamilies(snapshot.fonts);
  const wanted = new Set<string>();
  for (const c of [snapshot.selection.app, snapshot.selection.source, snapshot.selection.editor]) wanted.add(resolveChoice(families, c).family.id);
  void Promise.all(snapshot.fonts.filter((f) => wanted.has(`u:${f.family}`)).map(loadFace)).then(applyFonts);
}

// ---------- Actions ----------

export function setFontChoice(target: FontTarget, choice: FontChoice): void {
  emit({ ...snapshot, selection: { ...snapshot.selection, [target]: choice } });
  persist();
  applyFonts();
}

export function setSeparateEditorFont(separate: boolean): void {
  const sel = snapshot.selection;
  // First time on: start both fields from the app font instead of snapping back to "Default"
  const isUnset = (c: FontChoice) => c.f === DEFAULT_CHOICE.f && c.v === DEFAULT_CHOICE.v;
  const next: FontSelection = separate
    ? { ...sel, separate, source: isUnset(sel.source) ? sel.app : sel.source, editor: isUnset(sel.editor) ? sel.app : sel.editor }
    : { ...sel, separate };
  emit({ ...snapshot, selection: next });
  persist();
  applyFonts();
}

export function setSpacing(target: FontTarget, value: SpacingValue): void {
  emit({ ...snapshot, selection: { ...snapshot.selection, spacing: { ...snapshot.selection.spacing, [target]: value } } });
  persist();
  applyFonts();
}

export function setEffectKind(kind: TextEffectKind): void {
  const sel = snapshot.selection;
  let thickness = sel.effect.thickness;
  if (kind === 'outline') thickness = Math.min(EFFECT_RANGES.outline.max, Math.max(EFFECT_RANGES.outline.min, thickness));
  else if (kind === 'shadow') thickness = Math.min(EFFECT_RANGES.shadow.max, Math.max(EFFECT_RANGES.shadow.min, thickness));
  emit({ ...snapshot, selection: { ...sel, effect: { kind, thickness } } });
  persist();
  applyFonts();
}

// Dragging the thickness slider fires input events far faster than the screen
// refreshes, and every event used to re-render all subscribers, rewrite storage
// and rebuild the 16-layer shadow (plus a full style recalc of all chrome text),
// so the drag felt jumpy. The thumb fill and px label still update synchronously
// on every event, but the heavy effect apply runs at most once per animation
// frame and the storage write is deferred until the drag settles.
let effectRafId = 0;
let effectPersistTimer: ReturnType<typeof setTimeout> | null = null;

export function setEffectThickness(thickness: number): void {
  const value = Math.round(thickness * 100) / 100;
  const sel = snapshot.selection;
  emit({ ...snapshot, selection: { ...sel, effect: { ...sel.effect, thickness: value } } });
  if (!effectRafId) {
    if (typeof requestAnimationFrame === 'function') {
      effectRafId = requestAnimationFrame(() => {
        effectRafId = 0;
        applyEffect();
      });
    } else {
      applyEffect();
    }
  }
  if (effectPersistTimer) clearTimeout(effectPersistTimer);
  effectPersistTimer = setTimeout(() => {
    effectPersistTimer = null;
    persist();
  }, 300);
}

export interface AddFontsResult {
  added: UserFontMeta[];
  failed: number;
  /** Fonts that were added but could not be persisted (IndexedDB unavailable). */
  sessionOnly: number;
}

export async function addFontFiles(files: File[]): Promise<AddFontsResult> {
  const added: UserFontMeta[] = [];
  let failed = 0;
  let sessionOnly = 0;
  for (const file of files) {
    try {
      if (file.size === 0 || file.size > MAX_FONT_BYTES) throw new Error('size');
      const data = await file.arrayBuffer();
      const info = await readFontInfo(data, file.name);
      if (!info) throw new Error('unreadable');
      // The browser must accept it too, otherwise it would be listed but never render
      const probe = new FontFace(userCssName(info.family), data.slice(0), {
        weight: String(info.weight),
        style: info.italic ? 'italic' : 'normal',
      });
      await probe.load();

      // Same family + weight + italic replaces the older file. The new file is
      // written first: if that write fails, the old font stays untouched
      // instead of being deleted while its metadata still points at it.
      const same = snapshot.fonts.find(
        (f) => f.family.toLowerCase() === info.family.toLowerCase() && f.weight === info.weight && f.italic === info.italic
      );
      const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const meta: UserFontMeta = { id, family: info.family, weight: info.weight, italic: info.italic, fileName: file.name };
      const persisted = await putFile(id, data);
      if (!persisted) sessionOnly++;
      if (same) await removeFontFiles(same.id);
      document.fonts.add(probe);
      faces.set(id, probe);
      // The FontFace now holds the data, so the in-memory copy is redundant.
      memoryFiles.delete(id);
      emit({ ...snapshot, fonts: [...snapshot.fonts.filter((f) => f.id !== same?.id), meta] });
      persist();
      added.push(meta);
    } catch (err) {
      debugIgnored('fonts.addFontFiles', err);
      failed++;
    }
  }
  applyFonts();
  return { added, failed, sessionOnly };
}

async function removeFontFiles(id: string): Promise<void> {
  const face = faces.get(id);
  if (face) {
    try {
      document.fonts.delete(face);
    } catch (err) {
      debugIgnored('fonts.removeFace', err);
    }
    faces.delete(id);
  }
  await deleteFile(id);
}

export async function removeFont(id: string): Promise<void> {
  await removeFontFiles(id);
  const fonts = snapshot.fonts.filter((f) => f.id !== id);
  const families = buildFamilies(fonts);
  const fix = (c: FontChoice): FontChoice => {
    const fam = families.find((f) => f.id === c.f);
    return fam ? { f: fam.id, v: pickVariantKey(fam, c.v) } : DEFAULT_CHOICE;
  };
  const sel = snapshot.selection;
  emit({ fonts, selection: { ...sel, app: fix(sel.app), source: fix(sel.source), editor: fix(sel.editor) } });
  persist();
  applyFonts();
}
