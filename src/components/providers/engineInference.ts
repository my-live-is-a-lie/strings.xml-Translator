/** The engine a provider name points at, unless an engine was picked explicitly. */
export function inferEngineFromName(typedName: string, selectedEngine: string): string {
  if (selectedEngine && selectedEngine !== 'auto') return selectedEngine;
  const lower = typedName.trim().toLowerCase();
  if (lower.includes('libre') || lower.includes('ليبر')) return 'libretranslate';
  if (lower.includes('lara') || lower.includes('لارا') || lower.includes('translated')) return 'lara';
  if (lower.includes('yandex') || lower.includes('ياندكس')) return 'yandex';
  if (lower.includes('deepl') || lower.includes('ديب')) return 'deepl';
  if (lower.includes('gemini') || lower.includes('جيميني')) return 'gemini';
  if (lower.includes('openai') || lower.includes('gpt') || lower.includes('chatgpt')) return 'openai';
  if (lower.includes('microsoft') || lower.includes('azure') || lower.includes('bing')) return 'microsoft';
  if (lower.includes('google') || lower.includes('جوجل')) return 'google_cloud';
  return 'auto';
}
