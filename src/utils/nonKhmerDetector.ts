/**
 * Utility for detecting and inspecting non-Khmer text, glued foreign scripts
 * (e.g. គ្នាอย่างรุนแรง, διοាក់គំនិតនោះ, তরwសាង, ដ៏ကြမ်းដុះដំបូ, ស្របពេលដែលអារ៉ុនพยายามพยายามជួ),
 * and extra-vowel / weird character anomalies (លើសស្រៈ / អក្សរចម្លែកៗ) in translations.
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
 * (including Greek, Bengali, Burmese/Myanmar, Thai, Lao, Latin, CJK, Hindi, Cyrillic, Arabic, etc.)
 * or extra-vowel / weird character anomalies (ignoring standard tags, punctuation, whitespace, and numbers)
 */
export function hasNonKhmerWords(text: string): boolean {
  if (!text) return false;
  const sanitized = text
    .replace(/\[SRT_\d+(?:\s*\|[^\n\]]*)?\]/gi, ' ')
    .replace(/\[P\d+\]:?/gi, ' ');
  // Match ANY Unicode letter or mark outside Khmer blocks (\u1780-\u17FF, \u19E0-\u19FF),
  // OR replacement/dotted-circle glitches (\u25CC, \uFFFD), OR stacked Khmer dependent vowels (លើសស្រៈ)
  const nonKhmerOrWeirdRegex =
    /(?![\u1780-\u17FF\u19E0-\u19FF])[\p{L}\p{M}]|[\u25cc\ufffd]|[\u17b6-\u17c5]{2,}/u;
  return nonKhmerOrWeirdRegex.test(sanitized);
}

/**
 * Extracts all non-Khmer words, glued mixed-script tokens (e.g. διοាក់គំនិតនោះ, তরwសាង, ដ៏ကြမ်းដុះដំបូ),
 * and extra-vowel/weird clusters from text (excluding SRT tags, timestamps, and standard symbols)
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

  // 1. Standalone Latin words (not glued to Khmer)
  const standaloneLatinRegex = /(?<![\u1780-\u17ff\p{L}\p{M}])[a-zA-Z][a-zA-Z0-9_\-']*(?![\u1780-\u17ff\p{L}\p{M}])/gu;

  // 2. Any non-Khmer script characters (Greek, Bengali, Myanmar, Thai, Lao, CJK, Hindi, Latin glued to Khmer, etc.)
  // Captures the whole corrupted token including any attached Khmer prefix/suffix (e.g., διοាក់គំនិតនោះ, তরwសាង, ដ៏ကြမ်းដុះដំបូ)
  const universalForeignOrGluedRegex =
    /[\u1780-\u17ff]*(?:(?![\u1780-\u17ff\u19e0-\u19ff])[\p{L}\p{M}])+[\u1780-\u17ff\p{L}\p{M}]*/gu;

  // 3. Extra/stacked Khmer vowels (លើសស្រៈ) or replacement chars
  const extraVowelRegex = /[\u1780-\u17ff]*[\u17b6-\u17c5]{2,}[\u1780-\u17ff]*/g;

  const map = new Map<
    string,
    { count: number; type: 'latin' | 'cjk' | 'foreign_symbol' | 'other'; contexts: Set<string> }
  >();

  const lines = sanitized.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    let match: RegExpExecArray | null;

    // 1. Standalone Latin words
    while ((match = standaloneLatinRegex.exec(trimmedLine)) !== null) {
      const word = match[0];
      if (/^(srt|timecode|http|https|www)$/i.test(word)) continue;

      const existing = map.get(word) || { count: 0, type: 'latin', contexts: new Set() };
      existing.count += 1;
      if (existing.contexts.size < 5) {
        existing.contexts.add(trimmedLine);
      }
      map.set(word, existing);
    }

    // 2. Universal foreign scripts & glued mixed-script tokens (Greek, Bengali, Myanmar, Thai, CJK, Hindi, glued Latin, etc.)
    while ((match = universalForeignOrGluedRegex.exec(trimmedLine)) !== null) {
      const word = match[0];
      if (/^(srt|timecode|http|https|www)$/i.test(word)) continue;
      // Skip if already counted as a standalone pure-ASCII word without Khmer attached
      if (/^[a-zA-Z][a-zA-Z0-9_\-']*$/.test(word) && map.has(word)) continue;

      const existing = map.get(word) || { count: 0, type: 'cjk', contexts: new Set() };
      existing.count += 1;
      if (existing.contexts.size < 5) {
        existing.contexts.add(trimmedLine);
      }
      map.set(word, existing);
    }

    // 3. Extra/stacked Khmer vowels (លើសស្រៈ)
    while ((match = extraVowelRegex.exec(trimmedLine)) !== null) {
      const word = match[0];
      const existing = map.get(word) || { count: 0, type: 'foreign_symbol', contexts: new Set() };
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

