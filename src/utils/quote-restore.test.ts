import { describe, expect, it } from 'vitest';
import { normalizeEngineReply } from './translator';

describe('normalizeEngineReply restores apostrophe-quoted placeholders', () => {
  const source = "'{username}' said: ''Hello!''";

  it('re-wraps a placeholder the engine unquoted', () => {
    expect(normalizeEngineReply(source, 'قال {username}: مرحبا!')).toBe("قال '{username}': مرحبا!");
  });

  it('leaves an already quoted placeholder alone', () => {
    expect(normalizeEngineReply(source, "قال '{username}': مرحبا!")).toBe("قال '{username}': مرحبا!");
  });

  it('does nothing when the source has no quoted placeholder', () => {
    expect(normalizeEngineReply('Hi {name}', 'مرحبا {name}')).toBe('مرحبا {name}');
  });
});

describe('normalizeEngineReply removes engine-added double quotes', () => {
  const source = "'{username}' said: ''Hello!''";

  it('unwraps a quoted placeholder and converts remaining pairs to the source style', () => {
    expect(normalizeEngineReply(source, 'قال "\'{username}\'": "مرحبًا!"')).toBe("قال '{username}': ''مرحبًا!''");
  });

  it('keeps the source quoting when the engine quoted the placeholder with double quotes only', () => {
    expect(normalizeEngineReply(source, 'قال "{username}": "مرحبًا!"')).toBe("قال '{username}': ''مرحبًا!''");
  });

  it('strips double quotes when the source has none and no doubled apostrophes', () => {
    expect(normalizeEngineReply('Hi {name}', '"مرحبا" {name}')).toBe('مرحبا {name}');
  });

  it('keeps double quotes when the source uses them', () => {
    expect(normalizeEngineReply('He said "Hi {name}"', 'قال "مرحبا {name}"')).toBe('قال "مرحبا {name}"');
  });
});
