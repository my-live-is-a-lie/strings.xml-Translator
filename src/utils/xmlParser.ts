import { ResourceItem, SingleStringItem, PluralStringItem, ArrayStringItem, PluralQuantityItem, ArrayElementItem } from '../types';

/**
 * Preserves Android XML string content verbatim without stripping escape sequences
 * like \', \", \?, \n, \\n, \t, or leading/trailing spaces.
 */
export function decodeAndroidXmlString(raw: string): string {
  if (!raw) return '';
  return raw;
}

export interface ParsedXmlResult {
  items: ResourceItem[];
  errors: string[];
  resourcesAttributes?: string;
  indentStyle?: string;
  itemIndentStyle?: string;
}

/**
 * Extracts raw inner XML content of <string name="...">...</string> directly from XML text
 * so entities like &gt; and &amp;, escapes like \' and \", and exact whitespace are 100% untouched.
 */
function extractRawStringMap(xmlContent: string): Map<string, string> {
  const map = new Map<string, string>();
  const regex = /<string\s+[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/string>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xmlContent)) !== null) {
    map.set(match[1], match[2]);
  }
  return map;
}

/**
 * Parses an Android strings.xml string into structured ResourceItems completely offline
 * using DOMParser while preserving exact raw syntax and whitespace.
 */
export function parseAndroidXml(xmlContent: string): ParsedXmlResult {
  const errors: string[] = [];

  if (!xmlContent || !xmlContent.trim()) {
    return { items: [], errors: ['XML content is empty.'] };
  }

  // Detect <resources ...> attributes, top-level tag indentation, and <item> indentation
  const resourcesMatch = xmlContent.match(/<resources(\s+[^>]+?)?\s*>/);
  const resourcesAttributes = resourcesMatch?.[1]?.trim() || '';

  const stringIndentMatch = xmlContent.match(/^[ \t]*(?=<(?:string|plurals|string-array)\b)/m);
  const indentStyle = stringIndentMatch ? stringIndentMatch[0] : '';

  const itemIndentMatch = xmlContent.match(/^[ \t]*(?=<item\b)/m);
  const itemIndentStyle = itemIndentMatch ? itemIndentMatch[0] : '';

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');

    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      // Sometimes XML lacks a root <resources> tag if copied in pieces, try wrapping
      if (!xmlContent.includes('<resources')) {
        const wrapped = `<resources>\n${xmlContent}\n</resources>`;
        const retryDoc = parser.parseFromString(wrapped, 'application/xml');
        if (!retryDoc.querySelector('parsererror')) {
          return {
            ...parseDomTree(retryDoc, wrapped),
            resourcesAttributes,
            indentStyle,
            itemIndentStyle,
          };
        }
      }
      return { items: [], errors: [`XML Parsing Error: ${parseError.textContent?.slice(0, 200) || 'Malformed XML'}`] };
    }

    return {
      ...parseDomTree(xmlDoc, xmlContent),
      resourcesAttributes,
      indentStyle,
      itemIndentStyle,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown parsing error';
    return { items: [], errors: [msg] };
  }
}

function parseDomTree(xmlDoc: Document, rawXmlContent: string): { items: ResourceItem[]; errors: string[] } {
  const items: ResourceItem[] = [];
  const errors: string[] = [];

  const root = xmlDoc.querySelector('resources');
  if (!root) {
    return { items: [], errors: ['No <resources> root element found in Android XML.'] };
  }

  const rawStringMap = extractRawStringMap(rawXmlContent);

  let order = 0;
  let lastComment = '';
  let lastRawComments: string[] = [];

  for (let i = 0; i < root.childNodes.length; i++) {
    const node = root.childNodes[i];

    // Collect comments preserving exact raw text
    if (node.nodeType === Node.COMMENT_NODE) {
      const rawComment = node.nodeValue ?? node.textContent ?? '';
      lastRawComments.push(rawComment);
      const commentText = rawComment.trim();
      if (commentText) {
        lastComment = lastComment ? `${lastComment}\n${commentText}` : commentText;
      }
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    const name = element.getAttribute('name');

    if (!name) {
      continue;
    }

    const translatableAttr = element.getAttribute('translatable');
    const translatable = translatableAttr !== 'false';
    const formattedAttr = element.getAttribute('formatted');
    const formatted = formattedAttr !== 'false';

    if (tagName === 'string') {
      // Preserve exact inner text without .trim() or stripping escapes
      const rawInner = rawStringMap.get(name) ?? element.innerHTML ?? element.textContent ?? '';
      const source = decodeAndroidXmlString(rawInner);

      const item: SingleStringItem = {
        id: `str_${name}_${order}`,
        name,
        type: 'string',
        comment: lastComment || undefined,
        rawComments: lastRawComments.length > 0 ? [...lastRawComments] : undefined,
        rawSourceInner: rawInner,
        translatable,
        formatted,
        order: order++,
        source,
        target: '',
        status: 'untranslated',
      };
      items.push(item);
      lastComment = '';
      lastRawComments = [];
    } else if (tagName === 'plurals') {
      const pluralQuantities: PluralQuantityItem[] = [];
      const itemNodes = element.querySelectorAll('item');

      itemNodes.forEach((itemEl) => {
        const qty = itemEl.getAttribute('quantity') as PluralQuantityItem['quantity'];
        if (qty) {
          const raw = itemEl.innerHTML ?? itemEl.textContent ?? '';
          pluralQuantities.push({
            quantity: qty,
            source: decodeAndroidXmlString(raw),
            target: '',
          });
        }
      });

      const pluralItem: PluralStringItem = {
        id: `plu_${name}_${order}`,
        name,
        type: 'plural',
        comment: lastComment || undefined,
        rawComments: lastRawComments.length > 0 ? [...lastRawComments] : undefined,
        translatable,
        formatted,
        order: order++,
        items: pluralQuantities,
        status: 'untranslated',
      };
      items.push(pluralItem);
      lastComment = '';
      lastRawComments = [];
    } else if (tagName === 'string-array') {
      const arrayElements: ArrayElementItem[] = [];
      const itemNodes = element.querySelectorAll('item');

      itemNodes.forEach((itemEl, idx) => {
        const raw = itemEl.innerHTML ?? itemEl.textContent ?? '';
        arrayElements.push({
          index: idx,
          source: decodeAndroidXmlString(raw),
          target: '',
        });
      });

      const arrayItem: ArrayStringItem = {
        id: `arr_${name}_${order}`,
        name,
        type: 'array',
        comment: lastComment || undefined,
        rawComments: lastRawComments.length > 0 ? [...lastRawComments] : undefined,
        translatable,
        formatted,
        order: order++,
        items: arrayElements,
        status: 'untranslated',
      };
      items.push(arrayItem);
      lastComment = '';
      lastRawComments = [];
    }
  }

  return { items, errors };
}

const CANONICAL_PLURAL_ORDER: PluralQuantityItem['quantity'][] = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
];

/**
 * Returns the required CLDR / Android plural quantities for a given language code.
 * Arabic ('ar') requires all 6 forms: zero, one, two, few, many, other.
 */
export function getPluralQuantitiesForLanguage(
  langCode: string = 'ar'
): PluralQuantityItem['quantity'][] {
  const base = langCode.split('-')[0].toLowerCase();

  if (base === 'ar') {
    return ['zero', 'one', 'two', 'few', 'many', 'other'];
  }
  if (['ru', 'uk', 'pl', 'cs'].includes(base)) {
    return ['one', 'few', 'many', 'other'];
  }
  if (base === 'he') {
    return ['one', 'two', 'many', 'other'];
  }
  if (base === 'ro') {
    return ['one', 'few', 'other'];
  }
  return ['one', 'other'];
}

/**
 * Ensures every PluralStringItem in the list has all plural quantities required
 * by the target language (e.g., zero, one, two, few, many, other for Arabic).
 */
export function normalizePluralsForLanguage(
  items: ResourceItem[],
  langCode: string = 'ar'
): ResourceItem[] {
  const requiredQuantities = getPluralQuantitiesForLanguage(langCode);

  return items.map((item) => {
    if (item.type !== 'plural') return item;

    const existingMap = new Map<PluralQuantityItem['quantity'], PluralQuantityItem>();
    for (const qItem of item.items) {
      existingMap.set(qItem.quantity, qItem);
    }

    const oneSource =
      existingMap.get('one')?.source ||
      existingMap.get('other')?.source ||
      item.items[0]?.source ||
      '';
    const otherSource =
      existingMap.get('other')?.source ||
      existingMap.get('one')?.source ||
      item.items[item.items.length - 1]?.source ||
      '';

    // Combine required quantities for target language with any quantities already in the item
    const allQuantitiesSet = new Set<PluralQuantityItem['quantity']>([
      ...requiredQuantities,
      ...item.items.map((i) => i.quantity),
    ]);

    const sortedQuantities = CANONICAL_PLURAL_ORDER.filter((q) => allQuantitiesSet.has(q));

    const normalizedItems: PluralQuantityItem[] = sortedQuantities.map((qty) => {
      const existing = existingMap.get(qty);
      if (existing) {
        return {
          ...existing,
          source: existing.source || (qty === 'one' ? oneSource : otherSource),
        };
      }
      return {
        quantity: qty,
        source: qty === 'one' ? oneSource : otherSource,
        target: '',
      };
    });

    const anyFilled = normalizedItems.some((pi) => pi.target.trim().length > 0);

    return {
      ...item,
      items: normalizedItems,
      status: anyFilled
        ? item.status === 'untranslated'
          ? 'translated'
          : item.status
        : 'untranslated',
    };
  });
}

/**
 * Merges target translations from an existing target strings.xml into source items
 */
export function mergeTargetXml(
  baseItems: ResourceItem[],
  targetXmlContent: string,
  targetLang: string = 'ar'
): { updatedItems: ResourceItem[]; matchedCount: number } {
  const normalizedBaseItems = normalizePluralsForLanguage(baseItems, targetLang);
  const { items: targetItems } = parseAndroidXml(targetXmlContent);
  if (targetItems.length === 0) {
    return { updatedItems: normalizedBaseItems, matchedCount: 0 };
  }

  // Create lookup map by name
  const targetMap = new Map<string, ResourceItem>();
  for (const item of targetItems) {
    targetMap.set(item.name, item);
  }

  let matchedCount = 0;

  const updatedItems = normalizedBaseItems.map((base) => {
    const targetMatch = targetMap.get(base.name);
    if (!targetMatch) return base;

    if (base.type === 'string' && targetMatch.type === 'string') {
      const targetVal = targetMatch.source; // In target XML, its element content was parsed into .source
      if (targetVal && targetVal.trim()) {
        matchedCount++;
        return {
          ...base,
          target: targetVal,
          status: 'translated' as const,
          translationSource: base.translationSource || ('manual' as const),
        };
      }
    } else if (base.type === 'plural' && targetMatch.type === 'plural') {
      let matchedAny = false;
      const targetQtyMap = new Map(targetMatch.items.map((i) => [i.quantity, i.source]));

      const baseMap = new Map(base.items.map((i) => [i.quantity, i]));
      const oneSource =
        baseMap.get('one')?.source ||
        baseMap.get('other')?.source ||
        base.items[0]?.source ||
        '';
      const otherSource =
        baseMap.get('other')?.source ||
        baseMap.get('one')?.source ||
        base.items[base.items.length - 1]?.source ||
        '';

      const allQuantitiesSet = new Set<PluralQuantityItem['quantity']>([
        ...base.items.map((i) => i.quantity),
        ...targetMatch.items.map((i) => i.quantity),
      ]);
      const sortedQuantities = CANONICAL_PLURAL_ORDER.filter((q) => allQuantitiesSet.has(q));

      const updatedPlurals: PluralQuantityItem[] = sortedQuantities.map((qty) => {
        const basePi = baseMap.get(qty) || {
          quantity: qty,
          source: qty === 'one' ? oneSource : otherSource,
          target: '',
        };
        const targetPluralVal = targetQtyMap.get(qty);
        if (targetPluralVal && targetPluralVal.trim()) {
          matchedAny = true;
          return { ...basePi, target: targetPluralVal };
        }
        return basePi;
      });

      if (matchedAny) {
        matchedCount++;
        return {
          ...base,
          items: updatedPlurals,
          status: 'translated' as const,
          translationSource: base.translationSource || ('manual' as const),
        };
      }
    } else if (base.type === 'array' && targetMatch.type === 'array') {
      let matchedAny = false;
      const updatedArr = base.items.map((ai, idx) => {
        const targetArrVal = targetMatch.items[idx]?.source;
        if (targetArrVal && targetArrVal.trim()) {
          matchedAny = true;
          return { ...ai, target: targetArrVal };
        }
        return ai;
      });
      if (matchedAny) {
        matchedCount++;
        return {
          ...base,
          items: updatedArr,
          status: 'translated' as const,
          translationSource: base.translationSource || ('manual' as const),
        };
      }
    }

    return base;
  });

  return { updatedItems, matchedCount };
}
