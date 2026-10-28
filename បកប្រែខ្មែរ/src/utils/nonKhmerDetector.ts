/**
 * Utility for detecting and inspecting non-Khmer text in translations
 * (e.g. English words, Latin script, CJK characters, or foreign terms)
 */

export interface NonKhmerItem {
  word: string;
  count: number;
  type: 'latin' | 'cjk' | 'foreign_symbol' | 'other';
  contexts: string[];
}

/**
 * Checks if a character is part of Khmer Unicode blocks:
 * Khmer: U+1780 - U+17FF
 * Khmer Symbols: U+19E0 - U+19FF
 */
export function isKhmerChar(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 0x1780 && code <= 0x17ff) || (code >= 0x19e0 && code <= 0x19ff);
}

/**
 * Checks if a single string contains any non-Khmer alphabet/script characters
 * (ignoring standard punctuation, whitespace, and numbers)
 */
export function hasNonKhmerWords(text: string): boolean {
  if (!text) return false;
  // Match Latin letters, CJK, Cyrillic, Greek, etc.
  const nonKhmerRegex = /[a-zA-Z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/;
  return nonKhmerRegex.test(text);
}

/**
 * Extracts all non-Khmer words from text (excluding SRT tags, timestamps, and standard symbols)
 */
export function extractNonKhmerWords(text: string): NonKhmerItem[] {
  if (!text) return [];

  // Remove SRT tags like [SRT_1 | ...] or [P1] before checking
  const sanitized = text
    .replace(/\[SRT_\d+(?:\s*\|[^\n\]]*)?\]/gi, ' ')
    .replace(/\[P\d+\]:?/gi, ' ')
    .replace(/\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}/g, ' ')
    .replace(/```[a-z]*/gi, ' ')
    .replace(/```/g, ' ');

  // Match words containing Latin characters (e.g. "System", "Level", "Rank-A", "Hunter") or CJK
  const latinWordRegex = /\b[a-zA-Z0-9_\-']*[a-zA-Z]+[a-zA-Z0-9_\-']*\b/g;
  const cjkRegex = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g;

  const map = new Map<string, { count: number; type: 'latin' | 'cjk' | 'foreign_symbol' | 'other'; contexts: Set<string> }>();

  // Process Latin words
  const lines = sanitized.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Latin
    let match: RegExpExecArray | null;
    while ((match = latinWordRegex.exec(trimmedLine)) !== null) {
      const word = match[0];
      // Filter out pure SRT artifact keywords if any
      if (/^(srt|timecode|http|https|www)$/i.test(word)) continue;

      const existing = map.get(word) || { count: 0, type: 'latin', contexts: new Set() };
      existing.count += 1;
      if (existing.contexts.size < 5) {
        existing.contexts.add(trimmedLine);
      }
      map.set(word, existing);
    }

    // CJK
    while ((match = cjkRegex.exec(trimmedLine)) !== null) {
      const word = match[0];
      const existing = map.get(word) || { count: 0, type: 'cjk', contexts: new Set() };
      existing.count += 1;
      if (existing.contexts.size < 5) {
        existing.contexts.add(trimmedLine);
      }
      map.set(word, existing);
    }
  }

  return Array.from(map.entries())
    .map(([word, data]) => ({
      word,
      count: data.count,
      type: data.type,
      contexts: Array.from(data.contexts),
    }))
    .sort((a, b) => b.count - a.count);
}
