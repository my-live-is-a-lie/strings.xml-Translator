export type StringType = 'string' | 'plural' | 'array';

export type TranslationStatus = 'untranslated' | 'translated' | 'needs_review';

export interface BaseResourceItem {
  id: string; // unique internal id
  name: string; // Android resource name attribute, e.g. "app_name"
  type: StringType;
  comment?: string; // Preceding XML comment <!-- ... -->
  rawComments?: string[]; // Exact raw comment contents preserving whitespace
  rawSourceInner?: string; // Exact raw inner XML from source file
  translatable?: boolean; // translatable="false"
  formatted?: boolean; // formatted="false"
  order: number;
  translationSource?: 'ai' | 'manual'; // Tracks whether translated via AI/provider or manual input
}

export interface SingleStringItem extends BaseResourceItem {
  type: 'string';
  source: string; // English/base value
  target: string; // Translated value
  status: TranslationStatus;
}

export interface PluralQuantityItem {
  quantity: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
  source: string;
  target: string;
}

export interface PluralStringItem extends BaseResourceItem {
  type: 'plural';
  items: PluralQuantityItem[];
  status: TranslationStatus;
}

export interface ArrayElementItem {
  index: number;
  source: string;
  target: string;
}

export interface ArrayStringItem extends BaseResourceItem {
  type: 'array';
  items: ArrayElementItem[];
  status: TranslationStatus;
}

export type ResourceItem = SingleStringItem | PluralStringItem | ArrayStringItem;

export interface TranslationProject {
  id: string;
  name: string; // e.g., "My Android App"
  sourceFileName: string; // e.g., "strings.xml"
  sourceLang: string; // e.g., "en"
  targetLang: string; // e.g., "es", "ar", "fr", "de"
  targetLocaleName: string; // e.g., "Spanish", "Arabic"
  items: ResourceItem[];
  rawSourceXml?: string; // Original source XML string for 1-to-1 export fidelity
  resourcesAttributes?: string; // Attributes on <resources ...> tag
  indentStyle?: string; // Indentation prefix for top-level tags (e.g. "" or "    ")
  itemIndentStyle?: string; // Indentation prefix for <item> tags inside plurals/arrays
  translationsByLang?: Record<string, ResourceItem[]>; // Cache per locale so switching doesn't lose data
  lastModified: number;
}

export type FilterStatus = 'all' | 'untranslated' | 'translated' | 'needs_review';

export type SourceFilter = 'all' | 'ai' | 'manual';

