/**
 * Utility to clean Khmer translation text according to user's strict rules:
 * - Only use Khmer full stop '។' and question mark '?'
 * - No complex/foreign symbols like quotes "", parentheses (), asterisks **, colons :, exclamation marks !, dashes -, etc.
 * - Extracts and strips paragraph tracking tags [P1], [P2], etc.
 */

export const KHMER_DIGITS: { [key: string]: string } = {
  '0': '០',
  '1': '១',
  '2': '២',
  '3': '៣',
  '4': '៤',
  '5': '៥',
  '6': '៦',
  '7': '៧',
  '8': '៨',
  '9': '៩',
};

/**
 * Converts any Arabic numerals (0-9) to pure Khmer numerals (០-៩)
 */
export function toKhmerNumerals(textOrNumber: string | number): string {
  if (textOrNumber === null || textOrNumber === undefined) return '';
  return String(textOrNumber).replace(/[0-9]/g, (d) => KHMER_DIGITS[d] || d);
}

export function stripSrtFormatting(text: string): string {
  if (!text) return '';
  let cleaned = text;

  // 1. Remove markdown code blocks
  cleaned = cleaned.replace(/```(?:srt|text)?/gi, '');
  cleaned = cleaned.replace(/```/g, '');

  // 2. Remove page markers
  cleaned = cleaned.replace(/={2,}\s*ទំព័រទី[^\n=]*={2,}/gi, '');
  cleaned = cleaned.replace(/={2,}\s*Page[^\n=]*={2,}/gi, '');
  cleaned = cleaned.replace(/\[ទំព័រទី\s*[\d០-៩]+[^\]]*\]/gi, '');

  // 3. Remove partial tags at the end of streaming buffer
  cleaned = cleaned.replace(/\[(?:SRT_\d*|P\d*)[^\]]*$/gi, '');

  // 4. Remove complete SRT tags: [SRT_1 | 00:00:01,000 --> 00:00:04,000] or [SRT_1]
  cleaned = cleaned.replace(/\[SRT_\d+(?:\s*\|[^\n\]]*)?\]/gi, '');
  cleaned = cleaned.replace(/\[P\d+\]:?/gi, '');
  cleaned = cleaned.replace(/\[កថាខណ្ឌ\s*\d+\]:?/gi, '');

  // 5. Remove standard SRT blocks: index number + timecode line
  // e.g. 1\n00:00:01,000 --> 00:00:04,000
  cleaned = cleaned.replace(
    /(?:^|\n)\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}[^\n]*/g,
    '\n'
  );

  // 6. Remove standalone timecode lines (in case cue number was already removed)
  cleaned = cleaned.replace(
    /\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}[^\n]*/g,
    ''
  );

  // 7. Remove standalone numbers that were cue indices on their own line
  cleaned = cleaned.replace(/(?:^|\n)\s*\d+\s*(?=\n|$)/g, '\n');

  return cleaned;
}

export function cleanKhmerPunctuation(text: string): string {
  if (!text) return '';

  // First strip SRT formatting, tags, timecodes, and page markers
  let cleaned = stripSrtFormatting(text);

  // 2. Convert all Arabic numbers to 100% pure Khmer numbers
  cleaned = toKhmerNumerals(cleaned);

  // 3. Remove markdown asterisks, hashes, backticks
  cleaned = cleaned.replace(/[\*\_`#~]/g, '');

  // 4. Remove quotation marks: "", '', “”, ‘’, «», 「」
  cleaned = cleaned.replace(/["'“”‘’«»「」]/g, ' ');

  // 5. Remove brackets and braces: (), [], {}, <>
  cleaned = cleaned.replace(/[()[\]{}<>]/g, ' ');

  // 6. Remove dashes, hyphens, colons, semicolons: —, –, -, :, ;
  cleaned = cleaned.replace(/[—–\-:;]/g, ' ');

  // 7. Convert exclamation marks '!' or standard periods '.' to Khmer khan '។'
  cleaned = cleaned.replace(/!+/g, '។');
  cleaned = cleaned.replace(/\.+/g, '។');

  // 8. Normalize multiple spaces into single space
  cleaned = cleaned.replace(/[ \t]+/g, ' ');

  // 9. Normalize multiple consecutive '។' (e.g. ។។, ។ ។) to single '។'
  cleaned = cleaned.replace(/[។\s]*។[។\s]*/g, '។ ');

  // 10. Normalize multiple consecutive '?' to single '?'
  cleaned = cleaned.replace(/[?\s]*\?[?\s]*/g, '? ');

  // 11. Clean line breaks
  cleaned = cleaned
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Formats translation as continuous, cohesive reading text where dialogue and sentences
 * flow connected together as a smooth, readable story ("អក្សរមកជាប់គ្នាជាអត្ថបទធម្មតាស្រួលមើល").
 */
export function formatAsContinuousStoryText(text: string): string {
  if (!text) return '';

  const cleaned = cleanKhmerPunctuation(text);
  if (!cleaned) return '';

  const rawLines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) return '';

  const paragraphs: string[] = [];
  let currentPara = '';
  let sentenceCount = 0;

  for (const line of rawLines) {
    if (!currentPara) {
      currentPara = line;
    } else {
      const endsWithKhmerPunct = currentPara.endsWith('។') || currentPara.endsWith('?');
      if (endsWithKhmerPunct) {
        currentPara += ' ' + line;
        sentenceCount++;
      } else {
        // Line broke mid-sentence: connect smoothly with space
        currentPara += ' ' + line;
      }
    }

    // After 3-4 full sentences or 320+ characters ending in '។' or '?', break into next paragraph
    const endsWithPunct = currentPara.endsWith('។') || currentPara.endsWith('?');
    if (endsWithPunct && (sentenceCount >= 3 || currentPara.length >= 320)) {
      paragraphs.push(currentPara);
      currentPara = '';
      sentenceCount = 0;
    }
  }

  if (currentPara) {
    paragraphs.push(currentPara);
  }

  return paragraphs.join('\n\n');
}

/**
 * Extracts active paragraph index from raw streaming text that contains [P1], [P2], etc.
 * Returns the 0-based paragraph index, or null if none found.
 */
export function extractActiveParagraphIndex(rawStreamText: string): number {
  if (!rawStreamText) return 0;
  const matches = [...rawStreamText.matchAll(/\[P(\d+)\]/gi)];
  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    const pNum = parseInt(lastMatch[1], 10);
    return Math.max(0, pNum - 1);
  }
  return 0;
}

/**
 * Extracts active SRT cue id from raw streaming text that contains [SRT_X ...].
 * Returns the cue id number, or null if none found.
 */
export function extractActiveSrtCueId(rawStreamText: string): number | null {
  if (!rawStreamText) return null;
  const matches = [...rawStreamText.matchAll(/\[SRT_(\d+)/gi)];
  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    const cueId = parseInt(lastMatch[1], 10);
    return isNaN(cueId) ? null : cueId;
  }
  const srtMatches = [...rawStreamText.matchAll(/(?:^|\n)\s*(\d+)\s*\n\s*\d{1,2}:\d{2}:\d{2}/g)];
  if (srtMatches.length > 0) {
    const lastMatch = srtMatches[srtMatches.length - 1];
    const cueId = parseInt(lastMatch[1], 10);
    return isNaN(cueId) ? null : cueId;
  }
  return null;
}

