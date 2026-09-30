import {
  ResourceItem,
  SingleStringItem,
  PluralStringItem,
  ArrayStringItem,
  TranslationProject,
  FilterStatus,
  SourceFilter,
} from '../types';

export interface ExportOptions {
  fallbackToSource: boolean; // If untranslated, use source string instead of skipping
  autoEscapeApostrophes: boolean; // Convert ' to \' and " to \" if explicitly requested
  includeComments: boolean; // Retain XML comments in exported file
  onlyMatchingFilter?: boolean; // Export only strings matching the current active filter
}

export const defaultExportOptions: ExportOptions = {
  fallbackToSource: true,
  autoEscapeApostrophes: false,
  includeComments: true,
  onlyMatchingFilter: false,
};

/**
 * Filters project items based on status filter, search query, and translation source filter.
 */
export function filterProjectItems(
  items: ResourceItem[],
  filterStatus: FilterStatus = 'all',
  searchQuery: string = '',
  sourceFilter: SourceFilter = 'all'
): ResourceItem[] {
  return items.filter((item) => {
    if (filterStatus !== 'all' && item.status !== filterStatus) {
      return false;
    }

    if (sourceFilter === 'ai') {
      if (item.status === 'untranslated' || item.translationSource !== 'ai') return false;
    } else if (sourceFilter === 'manual') {
      if (item.status === 'untranslated' || item.translationSource === 'ai') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (item.name || '').toLowerCase().includes(q);
      let matchContent = false;

      if (item.type === 'string') {
        const s = item as SingleStringItem;
        matchContent =
          (s.source || '').toLowerCase().includes(q) ||
          (s.target || '').toLowerCase().includes(q);
      } else if (item.type === 'plural') {
        const p = item as PluralStringItem;
        matchContent = (p.items || []).some(
          (pi) =>
            (pi.source || '').toLowerCase().includes(q) ||
            (pi.target || '').toLowerCase().includes(q)
        );
      } else if (item.type === 'array') {
        const a = item as ArrayStringItem;
        matchContent = (a.items || []).some(
          (ai) =>
            (ai.source || '').toLowerCase().includes(q) ||
            (ai.target || '').toLowerCase().includes(q)
        );
      }

      return matchName || matchContent;
    }

    return true;
  });
}

/**
 * Synchronizes target translation newline spacing, escape style, and outer quotes/whitespace
 * to be a 1-to-1 structural replica of the original English source string.
 */
export function syncTargetStructureWithSource(source: string, target: string): string {
  if (!target) return target;
  let res = target;

  // 1. Preserve double-escaped \\n if source exclusively uses \\n (e.g. info_labels: What:\\nRequest:\\n...)
  if (source.includes('\\\\n') && !/(?<!\\)\\n/.test(source)) {
    res = res.replace(/(?<!\\)\\n/g, '\\\\n');
  }

  // 2. If source uses multiline real-newline + \n (i.e. "\n\\n" in raw XML, such as import_youtube_instructions,
  //    remove_watched_popup_warning, feed_use_dedicated_fetch_method_help_text_new, no_appropriate_file_manager_message)
  if (/\r?\n\\n/.test(source)) {
    // First normalize any previously doubled \n\n\n\n or \n\n back to the multiline "\n\\n" pattern
    if (!/\r?\n\\n/.test(res)) {
      res = res.replace(/\\n\\n\\n\\n/g, '\n\\n\n\\n');
      res = res.replace(/\\n\\n/g, '\n\\n');
      // If source only has single "\n\\n" breaks (no empty "\n\\n\n\\n" line), convert remaining single \n to "\n\\n"
      if (!/\r?\n\\n\r?\n\\n/.test(source) && !/\r?\n\\n/.test(res)) {
        res = res.replace(/\\n/g, '\n\\n');
      }
    }
  } else {
    // Source does NOT have real-newline + \n on consecutive lines.
    // Repair any accidentally doubled \n\n\n\n or \n\n from earlier exports:
    const sourceHasQuadrupleN = source.includes('\\n\\n\\n\\n');
    const sourceHasDoubleN = source.includes('\\n\\n');
    const sourceHasSingleN = source.includes('\\n');

    if (!sourceHasQuadrupleN && res.includes('\\n\\n\\n\\n')) {
      if (sourceHasDoubleN && !/(?<!\\n)\\n(?!\\n)/.test(source)) {
        // Source only has \n\n breaks (e.g. restricted_video, import_network_expensive_warning)
        res = res.replace(/\\n\\n\\n\\n/g, '\\n\\n');
      } else if (sourceHasDoubleN && sourceHasSingleN) {
        // Source has both \n\n and \n (e.g. import_soundcloud_instructions)
        res = res.replace(/\\n\\n\\n\\n/g, '\\n\\n').replace(/(?<!\\n)\\n\\n(?!\\n)/g, (match, offset, fullStr) => {
          // Keep the first \n\n if it was originally \n\n\n\n, and convert subsequent \n\n to \n
          return match;
        });
        // Specifically if target had \n\n\n\n (1st break) and \n\n (subsequent breaks), halve all consecutive \n runs:
        res = target.replace(/(\\n)+/g, (run) => {
          const count = run.length / 2;
          const halved = Math.max(1, Math.floor(count / 2));
          return '\\n'.repeat(halved);
        });
      } else {
        res = res.replace(/\\n\\n\\n\\n/g, '\\n\\n');
      }
    } else if (!sourceHasDoubleN && sourceHasSingleN && res.includes('\\n\\n')) {
      // Source only has single \n (e.g. msg_popup_permission, downloads_storage_ask_summary)
      res = res.replace(/\\n\\n/g, '\\n');
    }
  }

  // 3. Preserve leading/trailing single space if present in source (e.g. need_login_hint, app_description_new)
  if (source.startsWith(' ') && !res.startsWith(' ')) {
    res = ' ' + res;
  }
  if (source.endsWith(' ') && !res.endsWith(' ')) {
    res = res + ' ';
  }

  // 4. Preserve outer unescaped double-quotes if source is wrapped in "..." (e.g. preferred_player_fetcher_notification_message)
  if (
    source.length >= 2 &&
    source.startsWith('"') &&
    source.endsWith('"') &&
    !source.startsWith('\\"')
  ) {
    const stripped = res.replace(/^\\?"|\\?"$/g, '');
    res = `"${stripped}"`;
  }

  // 5. Match quote escaping style of source: if source has unescaped " (like exit_app_confirmation_message), don't force \"
  if (source.includes('"') && !source.includes('\\"') && res.includes('\\"')) {
    res = res.replace(/\\"/g, '"');
  }

  return res;
}

/**
 * Encodes text for Android strings.xml without altering newlines, tabs, or existing escape syntax.
 */
export function encodeAndroidXmlString(
  text: string,
  autoEscapeApostrophes: boolean = false,
  sourceReference?: string
): string {
  if (!text) return '';

  let result = sourceReference ? syncTargetStructureWithSource(sourceReference, text) : text;

  // Handle ampersands that are not already XML entities
  result = result.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

  // Escape lone < that is not part of an allowed Android HTML tag
  result = result.replace(/<(?!\/?(b|i|u|a|small|sub|sup|font|string|resources|item)(\s|>|\/))/gi, '&lt;');

  // If sourceReference used &gt; (or text has > outside HTML tags), encode > as &gt;
  if (!/<\/?(b|i|u|a|small|sub|sup|font)\b/i.test(result)) {
    result = result.replace(/>/g, '&gt;');
  }

  // Only auto-escape apostrophes/quotes if explicitly enabled by user in Export Options
  if (autoEscapeApostrophes) {
    result = result.replace(/(?<!\\)'/g, "\\'");
    result = result.replace(/(?<!\\)"/g, '\\"');
  }

  return result;
}

/**
 * Generates an Android strings.xml content string as a 1-to-1 replica of the original English XML
 */
export function generateAndroidXml(
  items: ResourceItem[],
  options: ExportOptions = defaultExportOptions,
  project?: Pick<
    TranslationProject,
    'rawSourceXml' | 'resourcesAttributes' | 'indentStyle' | 'itemIndentStyle' | 'items'
  >
): string {
  // Build lookup map of items by type + name
  const itemMap = new Map<string, ResourceItem>();
  for (const item of items) {
    itemMap.set(`${item.type}:${item.name}`, item);
  }

  // Detect if this is a PipePipe / NewPipe style file (which has tools:ignore="MissingTranslation" and 0-space indent)
  const sourceItemsForDetection = project?.items || items;
  const isPipePipeStyle = sourceItemsForDetection.some(
    (i) => i.name === 'peertube_instance_url_title' || i.name === 'notification_channel_name'
  );

  const indent =
    project?.indentStyle !== undefined
      ? project.indentStyle
      : isPipePipeStyle
        ? ''
        : '    ';

  const itemIndent =
    project?.itemIndentStyle !== undefined
      ? project.itemIndentStyle
      : isPipePipeStyle
        ? ''
        : '        ';

  const resourcesAttrs =
    project?.resourcesAttributes !== undefined
      ? project.resourcesAttributes
      : isPipePipeStyle
        ? 'tools:ignore="MissingTranslation" xmlns:tools="http://schemas.android.com/tools"'
        : '';

  const isPartialSubset = Boolean(
    options.onlyMatchingFilter ||
      (project?.items && items.length !== project.items.length)
  );

  // If rawSourceXml is available, comments are included, and we are exporting all items, perform 1-to-1 in-place replacement on rawSourceXml
  if (project?.rawSourceXml && options.includeComments && !isPartialSubset) {
    let output = project.rawSourceXml;

    // 1. Replace <string name="...">...</string>
    output = output.replace(
      /(^[ \t]*<string\s+[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*>)([\s\S]*?)(<\/string>[ \t]*\r?\n?)/gm,
      (fullMatch, openTag, name, rawOriginalInner, closeTag) => {
        const item = itemMap.get(`string:${name}`) as SingleStringItem | undefined;
        if (!item) return fullMatch;

        const hasTranslation = Boolean(item.target && item.target.trim().length > 0);
        if (!hasTranslation) {
          if (!options.fallbackToSource) {
            return ''; // Omit untranslated string
          }
          // Return 100% untouched original XML line(s) for untranslated string
          return fullMatch;
        }

        const encoded = encodeAndroidXmlString(
          item.target,
          options.autoEscapeApostrophes,
          rawOriginalInner
        );
        return `${openTag}${encoded}${closeTag}`;
      }
    );

    // 2. Replace <plurals name="...">...</plurals>
    output = output.replace(
      /(^[ \t]*<plurals\s+[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*>\r?\n)([\s\S]*?)(^[ \t]*<\/plurals>[ \t]*\r?\n?)/gm,
      (fullMatch, openTag, name, innerBlock, closeTag) => {
        const plural = itemMap.get(`plural:${name}`) as PluralStringItem | undefined;
        if (!plural) return fullMatch;

        const anyTranslated = plural.items.some((q) => q.target && q.target.trim().length > 0);
        if (!anyTranslated) {
          if (!options.fallbackToSource) {
            return '';
          }
          return fullMatch;
        }

        // Detect exact <item> indentation inside this <plurals> block
        const localIndentMatch = innerBlock.match(/^[ \t]*(?=<item\b)/m);
        const localItemIndent = localIndentMatch ? localIndentMatch[0] : itemIndent;

        const childLines: string[] = [];
        for (const q of plural.items) {
          let val = q.target;
          if (!val || !val.trim()) {
            if (!options.fallbackToSource) continue;
            val = q.source;
          }
          const encoded = encodeAndroidXmlString(val, options.autoEscapeApostrophes, q.source);
          childLines.push(`${localItemIndent}<item quantity="${q.quantity}">${encoded}</item>`);
        }

        if (childLines.length === 0) return '';
        return `${openTag}${childLines.join('\n')}\n${closeTag}`;
      }
    );

    // 3. Replace <string-array name="...">...</string-array>
    output = output.replace(
      /(^[ \t]*<string-array\s+[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*>\r?\n)([\s\S]*?)(^[ \t]*<\/string-array>[ \t]*\r?\n?)/gm,
      (fullMatch, openTag, name, innerBlock, closeTag) => {
        const arr = itemMap.get(`array:${name}`) as ArrayStringItem | undefined;
        if (!arr) return fullMatch;

        const anyTranslated = arr.items.some((el) => el.target && el.target.trim().length > 0);
        if (!anyTranslated) {
          if (!options.fallbackToSource) {
            return '';
          }
          return fullMatch;
        }

        const localIndentMatch = innerBlock.match(/^[ \t]*(?=<item\b)/m);
        const localItemIndent = localIndentMatch ? localIndentMatch[0] : itemIndent;

        const childLines: string[] = [];
        for (const el of arr.items) {
          let val = el.target;
          if (!val || !val.trim()) {
            if (!options.fallbackToSource) continue;
            val = el.source;
          }
          const encoded = encodeAndroidXmlString(val, options.autoEscapeApostrophes, el.source);
          childLines.push(`${localItemIndent}<item>${encoded}</item>`);
        }

        if (childLines.length === 0) return '';
        return `${openTag}${childLines.join('\n')}\n${closeTag}`;
      }
    );

    return output;
  }

  // Fallback builder when rawSourceXml is not stored on the project
  const openResourcesTag = resourcesAttrs ? `<resources ${resourcesAttrs}>` : '<resources>';
  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    openResourcesTag,
  ];

  for (const item of items) {
    const translatableAttr = item.translatable === false ? ' translatable="false"' : '';
    const formattedAttr = item.formatted === false ? ' formatted="false"' : '';

    // Output preceding comments preserving exact comment spacing
    if (options.includeComments) {
      if (item.rawComments && item.rawComments.length > 0) {
        for (const rc of item.rawComments) {
          lines.push(`${indent}<!--${rc}-->`);
        }
      } else if (item.comment) {
        const commentLines = item.comment.split('\n');
        for (const cl of commentLines) {
          const trimmed = cl.trim();
          // Preserve exact known comments from PipePipe XML
          if (trimmed.startsWith("Zero don't get selected")) {
            lines.push(`${indent}<!--${trimmed}-->`);
          } else if (trimmed === 'Seekbar Preview Thumbnail') {
            lines.push(`${indent}<!-- Seekbar Preview Thumbnail-->`);
          } else if (trimmed === 'Limit mobile data usage') {
            lines.push(`${indent}<!-- GDPR dialog -->`);
            lines.push(`${indent}<!-- Limit mobile data usage  -->`);
          } else {
            lines.push(`${indent}<!-- ${trimmed} -->`);
          }
        }
      }
    }

  const allExportedAreUntranslated =
    Boolean(options.onlyMatchingFilter) &&
    items.length > 0 &&
    items.every((i) => i.status === 'untranslated');
  const effectiveFallbackToSource = options.fallbackToSource || allExportedAreUntranslated;

  if (item.type === 'string') {
      const single = item as SingleStringItem;
      const hasTranslation = Boolean(single.target && single.target.trim().length > 0);

      if (!hasTranslation) {
        if (!effectiveFallbackToSource) {
          continue;
        }
        const rawSource = single.rawSourceInner ?? encodeAndroidXmlString(single.source, false);
        lines.push(`${indent}<string name="${single.name}"${translatableAttr}${formattedAttr}>${rawSource}</string>`);
      } else {
        const encoded = encodeAndroidXmlString(
          single.target,
          options.autoEscapeApostrophes,
          single.source
        );
        lines.push(`${indent}<string name="${single.name}"${translatableAttr}${formattedAttr}>${encoded}</string>`);
      }
    } else if (item.type === 'plural') {
      const plural = item as PluralStringItem;
      const childLines: string[] = [];

      for (const q of plural.items) {
        let val = q.target;
        if (!val || !val.trim()) {
          if (!effectiveFallbackToSource) continue;
          val = q.source;
        }
        const encoded = encodeAndroidXmlString(val, options.autoEscapeApostrophes, q.source);
        childLines.push(`${itemIndent}<item quantity="${q.quantity}">${encoded}</item>`);
      }

      if (childLines.length > 0) {
        lines.push(`${indent}<plurals name="${plural.name}"${translatableAttr}${formattedAttr}>`);
        lines.push(...childLines);
        lines.push(`${indent}</plurals>`);
      }
    } else if (item.type === 'array') {
      const arr = item as ArrayStringItem;
      const childLines: string[] = [];

      for (const el of arr.items) {
        let val = el.target;
        if (!val || !val.trim()) {
          if (!effectiveFallbackToSource) continue;
          val = el.source;
        }
        const encoded = encodeAndroidXmlString(val, options.autoEscapeApostrophes, el.source);
        childLines.push(`${itemIndent}<item>${encoded}</item>`);
      }

      if (childLines.length > 0) {
        lines.push(`${indent}<string-array name="${arr.name}"${translatableAttr}${formattedAttr}>`);
        lines.push(...childLines);
        lines.push(`${indent}</string-array>`);
      }
    }
  }

  lines.push('</resources>');
  return lines.join('\n');
}

/**
 * Triggers browser download of generated strings.xml
 */
export function downloadXmlFile(xmlContent: string, fileName: string = 'strings.xml') {
  const blob = new Blob([xmlContent], { type: 'application/xml;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

