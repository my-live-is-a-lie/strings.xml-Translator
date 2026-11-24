// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseAndroidXml } from '../src/utils/xmlParser';
import { itemsForLanguage, needsTranslation, safeFileBase, exportZipName, suggestedProjectName, valuesDirFor, xmlForLanguage } from '../src/utils/multiLang';
import type { SingleStringItem, TranslationProject } from '../src/types';

const raw = '<resources>\n    <string name="a">Hello</string>\n    <string name="b">Bye</string>\n</resources>';
const parsed = parseAndroidXml(raw);
const project: TranslationProject = {
  id: 'p', name: 'P', sourceFileName: 'strings.xml', sourceLang: 'en', targetLang: 'ar', targetLocaleName: 'Arabic',
  items: parsed.items, rawSourceXml: raw, resourcesAttributes: parsed.resourcesAttributes, indentStyle: parsed.indentStyle,
  itemIndentStyle: parsed.itemIndentStyle, lastModified: 0,
};

describe('multi-language helpers', () => {
  it('starts other languages blank and flags them as needing translation', () => {
    const fr = itemsForLanguage(project, 'fr');
    expect(fr.every(needsTranslation)).toBe(true);
    expect((fr[0] as SingleStringItem).target).toBe('');
  });

  it('writes translated targets, leaves untranslated strings out and uses the Android folder name', () => {
    const fr = itemsForLanguage(project, 'fr').map((i) =>
      i.name === 'a' ? ({ ...i, target: 'Bonjour', status: 'translated' } as SingleStringItem) : i
    );
    const xml = xmlForLanguage(project, fr);
    expect(xml).toContain('Bonjour');
    expect(xml).not.toContain('>Bye<');
    expect(valuesDirFor('pt-rBR')).toBe('values-pt-rBR');
  });
});

describe('export zip naming', () => {
  it('names the zip after the project and the Android values folder of the target language', () => {
    expect(exportZipName({ ...project, name: 'ICU.MessageFormat', targetLang: 'ar' })).toBe('ICU.MessageFormat-values-ar.zip');
    expect(exportZipName({ ...project, name: 'My App', targetLang: 'pt-rBR' })).toBe('My_App-values-pt-rBR.zip');
  });
  it('falls back to the source file name and strips its .xml extension', () => {
    expect(exportZipName({ ...project, name: '', sourceFileName: 'strings.xml' })).toBe('strings-values-ar.zip');
    expect(exportZipName({ ...project, name: '  ', sourceFileName: 'ICU.MessageFormat.xml' })).toBe('ICU.MessageFormat-values-ar.zip');
  });
  it('keeps Arabic project names and replaces path-unsafe characters', () => {
    expect(safeFileBase('تطبيقي')).toBe('تطبيقي');
    expect(safeFileBase('a/b\\c')).toBe('a_b_c');
    expect(safeFileBase('')).toBe('strings');
  });
});

describe('project name suggestion', () => {
  it('uses the file name without .xml, and skips the generic strings.xml', () => {
    expect(suggestedProjectName('ICU.MessageFormat.xml')).toBe('ICU.MessageFormat');
    expect(suggestedProjectName('my-app.XML')).toBe('my-app');
    expect(suggestedProjectName('strings.xml')).toBe('');
    expect(suggestedProjectName('STRINGS.XML')).toBe('');
    expect(suggestedProjectName('strings')).toBe('');
  });
});

describe('compact one-line source files', () => {
  it('still applies translations when the whole source file is on one line', () => {
    const oneLine = '<resources><string name="a">Hello</string><string name="b">Bye</string></resources>';
    const p = parseAndroidXml(oneLine);
    const proj = { ...project, items: p.items, rawSourceXml: oneLine };
    const items = p.items.map((i) => ({ ...(i as SingleStringItem), target: 'X-' + (i as SingleStringItem).source, status: 'translated' as const }));
    const xml = xmlForLanguage(proj, items);
    expect(xml).toContain('X-Hello');
    expect(xml).toContain('X-Bye');
  });
});
