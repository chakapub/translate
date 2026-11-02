export interface SrtCue {
  id: number;
  startTime: string;
  endTime: string;
  timecode: string;
  originalText: string;
  sourceOriginalText?: string;
  translatedText?: string;
}

export type SrtAlignmentMode = 'auto' | 'line_by_line' | 'proportional';

/**
 * Checks if the text looks like an SRT file (contains timestamp arrows like 00:00:01,000 --> 00:00:04,000)
 */
export function isSrtContent(text: string): boolean {
  if (!text || text.length < 10) return false;
  const timecodeRegex = /\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}/;
  return timecodeRegex.test(text);
}

/**
 * Checks if a text string is already predominantly Khmer script (so we don't need to re-translate it)
 */
export function isMostlyKhmerText(text: string): boolean {
  if (!text || !text.trim()) return false;
  const khmerMatches = text.match(/[\u1780-\u17FF]/g);
  const khmerCount = khmerMatches ? khmerMatches.length : 0;
  if (khmerCount < 3) return false;
  const foreignMatches = text.match(/[A-Za-z\u0900-\u097F]/g);
  const foreignCount = foreignMatches ? foreignMatches.length : 0;
  return khmerCount >= foreignCount * 0.35;
}

/**
 * Parses an SRT timestamp (00:01:02,340) into milliseconds
 */
export function parseSrtTimeToMs(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().replace('.', ',');
  const parts = clean.split(':');
  if (parts.length < 3) return 0;
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  const [secStr, msStr] = parts[2].split(',');
  const seconds = parseInt(secStr, 10) || 0;
  const ms = parseInt((msStr || '0').padEnd(3, '0').slice(0, 3), 10) || 0;
  return ((hours * 3600 + minutes * 60 + seconds) * 1000) + ms;
}

/**
 * Formats milliseconds into standard SRT timestamp (HH:MM:SS,mmm)
 */
export function formatMsToSrtTime(totalMs: number): string {
  const clamped = Math.max(0, Math.round(totalMs));
  const hours = Math.floor(clamped / 3600000);
  const minutes = Math.floor((clamped % 3600000) / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const ms = clamped % 1000;
  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0') +
    ',' +
    String(ms).padStart(3, '0')
  );
}

/**
 * Parses raw SRT string into an array of SrtCue objects
 */
export function parseSrt(rawSrt: string): SrtCue[] {
  if (!rawSrt || !rawSrt.trim()) return [];

  const normalized = rawSrt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const timecodeRegex = /(\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3})/;

  const blocks = normalized.split(/\n\s*\n/);
  const cues: SrtCue[] = [];
  let currentId = 1;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) continue;

    let timecodeLineIdx = -1;
    let match: RegExpMatchArray | null = null;

    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      match = lines[i].match(timecodeRegex);
      if (match) {
        timecodeLineIdx = i;
        break;
      }
    }

    if (timecodeLineIdx === -1 || !match) continue;

    const startTime = match[1].replace('.', ',');
    const endTime = match[2].replace('.', ',');
    const timecode = `${startTime} --> ${endTime}`;

    const textLines = lines.slice(timecodeLineIdx + 1);
    const originalText = textLines.join('\n').trim();

    if (originalText.length > 0) {
      const isAlreadyKhmer = isMostlyKhmerText(originalText);
      const sequentialId = cues.length + 1;
      cues.push({
        id: sequentialId,
        startTime,
        endTime,
        timecode,
        originalText,
        sourceOriginalText: originalText,
        translatedText: isAlreadyKhmer ? originalText : '',
      });
      currentId = sequentialId + 1;
    }
  }

  return cues;
}

/**
 * Formats translated SrtCue array into a single continuous pure Khmer paragraph WITHOUT line numbers:
 * Removes all [1] [2] line numbers, timestamps, line breaks, parentheses ( ), Thai characters, and system citation tags.
 */
export function formatCuesAsBracketedSingleParagraph(cues: SrtCue[]): string {
  if (!cues || cues.length === 0) return '';

  const segments: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const raw = (cue.translatedText || '').trim();
    if (!raw) continue;

    const cleanedLine = raw
      .replace(/\[\s*(?:cite|source)[^\]]*\]|【[^】]*】/gi, '')
      .replace(/\[\s*(?:SRT|អេសអាធី)[\s_]*[0-9០-៩]+(?:\s*\|[^\n\]]*)?\]:?/gi, '')
      .replace(/\[\s*(?:P|ភី)[0-9០-៩]+\s*\]:?/gi, '')
      .replace(/\[\s*[0-9០-៩]+\s*\]/g, ' ')
      .replace(/[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}\s*-->\s*[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}[^\n]*/g, '')
      .replace(/[\u0E00-\u0E7F]+/g, '')
      .replace(/[()（）[\]{}<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanedLine.length > 0) {
      segments.push(cleanedLine);
    }
  }

  return segments.join(' ');
}

/**
 * Builds standard, clean SRT file content from SrtCue array
 */
export function buildSrt(cues: SrtCue[], useTranslated: boolean = true): string {
  if (!cues || cues.length === 0) return '';

  return cues
    .map((cue, idx) => {
      const hasRealTranslation = Boolean(
        cue.translatedText &&
          cue.translatedText.trim().length > 0 &&
          /[\p{L}\p{M}0-9០-៩]/u.test(cue.translatedText)
      );

      const rawText = useTranslated
        ? (hasRealTranslation ? cue.translatedText! : cue.originalText || '').trim()
        : (cue.sourceOriginalText || cue.originalText || '').trim();

      const text = rawText
        .replace(/\[\s*(?:cite|source)[^\]]*\]|【[^】]*】/gi, '')
        .replace(/[\u0E00-\u0E7F]+/g, '')
        .replace(/[()（）]/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();

      const seqId = idx + 1;
      return `${seqId}\n${cue.timecode}\n${text}`;
    })
    .join('\n\n');
}

/**
 * Extracts plain text from all SRT cues
 */
export function extractCleanTextFromCues(cues: SrtCue[]): string {
  if (!cues || cues.length === 0) return '';
  return cues
    .map((c) => (c.sourceOriginalText || c.originalText).replace(/\r?\n+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Parses raw SRT string and returns both the SrtCue[] array and the pure extracted text for the input box
 */
export function parseSrtAndExtractCleanText(rawSrt: string): { cues: SrtCue[]; cleanText: string } {
  const cues = parseSrt(rawSrt);
  const cleanText = extractCleanTextFromCues(cues);
  return { cues, cleanText };
}

/**
 * Splits a continuous Khmer or mixed string into safe atomic tokens/phrases without ever breaking
 * inside a Khmer orthographic syllable cluster (consonant + subscript + vowel/diacritic).
 */
function splitIntoSafeKhmerTokens(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  // First split by spaces, newlines, or major Khmer punctuation while keeping punctuation attached to the preceding token
  const rawSegments = cleaned
    .replace(/([។៕?!,،;:])\s*/g, '$1\u200B')
    .split(/[\s\u200B]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // If any segment is still very long (> 35 chars without spaces, typical in continuous Khmer text),
  // split it further at safe Khmer orthographic cluster boundaries every ~12-18 chars
  const result: string[] = [];
  const khmerClusterRegex =
    /[\u1780-\u17A2](?:\u17D2[\u1780-\u17A2])*[\u17B6-\u17D3\u17DD]*|[។៕?!,0-9០-៩]+|[^\u1780-\u17FF\s]+/g;

  for (const seg of rawSegments) {
    if (seg.length <= 28) {
      result.push(seg);
      continue;
    }
    const clusters = seg.match(khmerClusterRegex);
    if (!clusters || clusters.length <= 3) {
      result.push(seg);
      continue;
    }
    let currentChunk = '';
    for (const cl of clusters) {
      if (currentChunk.length >= 12 && (currentChunk.length + cl.length > 22 || /[។៕?!,]/.test(currentChunk))) {
        result.push(currentChunk);
        currentChunk = cl;
      } else {
        currentChunk += cl;
      }
    }
    if (currentChunk) {
      result.push(currentChunk);
    }
  }

  return result;
}

/**
 * Cleans a single line of user-pasted text before placing into an SRT cue
 */
function cleanSingleSubtitleLine(line: string): string {
  if (!line) return '';
  return line
    .replace(/^\[\s*(?:SRT|អេសអាធី)[\s_]*[0-9០-៩]+[^\]]*\]\s*/i, '')
    .replace(/^[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}\s*-->\s*[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}\s*/, '')
    .replace(/\[\s*(?:P|ភី)[0-9០-៩]+\s*\]:?\s*/gi, '')
    .trim();
}

/**
 * Aligns already-translated text from the input box directly into the original SRT cues (preserving 100% of original timestamps!).
 * Supports:
 * - Tagged [SRT_1] or full SRT blocks
 * - Exact 1-to-1 line matching when line count == cue count
 * - Smart line splitting/merging when line count is close to cue count
 * - Proportional distribution by original cue length & duration when user pastes paragraphs/story text
 */
export function alignTranslatedTextToSrtCues(
  cues: SrtCue[],
  text: string,
  mode: SrtAlignmentMode = 'auto'
): SrtCue[] {
  if (!cues || cues.length === 0) return cues;
  if (!text || !text.trim()) {
    return cues.map((cue) => ({
      ...cue,
      originalText: cue.sourceOriginalText || cue.originalText,
      translatedText: '',
    }));
  }

  const totalCues = cues.length;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 1. Check if text contains [SRT_...] tags or raw SRT timestamp blocks
  const hasExplicitTags = /\[\s*(?:SRT|អេសអាធី)[\s_]*[0-9០-៩]+/i.test(normalized);
  if (hasExplicitTags || isSrtContent(normalized)) {
    const mapped = parseTranslatedCuesIntoMap(normalized, cues);
    if (mapped.size > 0) {
      return cues.map((cue) => {
        const baseOrig = cue.sourceOriginalText || cue.originalText;
        const t = mapped.get(cue.id);
        return {
          ...cue,
          originalText: baseOrig,
          sourceOriginalText: baseOrig,
          translatedText: t || cue.translatedText || '',
        };
      });
    }
  }

  const rawLines = normalized.split('\n').map((l) => cleanSingleSubtitleLine(l));
  const nonEmptyLines = rawLines.filter((l) => l.length > 0);

  if (nonEmptyLines.length === 0) {
    return cues;
  }

  // 2. Exact 1-to-1 match on non-empty lines
  if (nonEmptyLines.length === totalCues) {
    return cues.map((cue, idx) => {
      const baseOrig = cue.sourceOriginalText || cue.originalText;
      return {
        ...cue,
        originalText: baseOrig,
        sourceOriginalText: baseOrig,
        translatedText: nonEmptyLines[idx],
      };
    });
  }

  // 3. Exact 1-to-1 match on raw lines (if user had deliberate blank lines matching cue count)
  if (rawLines.length === totalCues && mode !== 'proportional') {
    return cues.map((cue, idx) => {
      const baseOrig = cue.sourceOriginalText || cue.originalText;
      return {
        ...cue,
        originalText: baseOrig,
        sourceOriginalText: baseOrig,
        translatedText: rawLines[idx] || nonEmptyLines[Math.min(idx, nonEmptyLines.length - 1)] || '',
      };
    });
  }

  // 4. Explicit Line-by-Line mode
  if (mode === 'line_by_line') {
    if (nonEmptyLines.length <= totalCues) {
      return cues.map((cue, idx) => {
        const baseOrig = cue.sourceOriginalText || cue.originalText;
        return {
          ...cue,
          originalText: baseOrig,
          sourceOriginalText: baseOrig,
          translatedText: idx < nonEmptyLines.length ? nonEmptyLines[idx] : '',
        };
      });
    } else {
      // More lines than cues: group lines sequentially so no lines at the bottom are lost
      return cues.map((cue, idx) => {
        const baseOrig = cue.sourceOriginalText || cue.originalText;
        const startLine = Math.floor((idx * nonEmptyLines.length) / totalCues);
        const endLine = Math.max(
          startLine + 1,
          Math.floor(((idx + 1) * nonEmptyLines.length) / totalCues)
        );
        const slice = nonEmptyLines.slice(startLine, endLine).join(' ');
        return {
          ...cue,
          originalText: baseOrig,
          sourceOriginalText: baseOrig,
          translatedText: slice,
        };
      });
    }
  }

  // 5. Smart Auto / Proportional Alignment when line count != cue count
  // Compute weight for each cue based on original text length + timestamp duration
  const weights = cues.map((cue) => {
    const orig = (cue.sourceOriginalText || cue.originalText || '').trim();
    const charWeight = Math.max(6, orig.length);
    const durMs = Math.max(800, parseSrtTimeToMs(cue.endTime) - parseSrtTimeToMs(cue.startTime));
    const durWeight = Math.round(durMs / 180); // ~5.5 chars per second equivalent
    return charWeight * 0.7 + durWeight * 0.3;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || totalCues;

  // Case 5a: More non-empty lines than cues -> group lines proportionally across cues
  if (nonEmptyLines.length > totalCues && mode === 'auto') {
    const lineLengths = nonEmptyLines.map((l) => Math.max(4, l.length));
    const totalLineLen = lineLengths.reduce((a, b) => a + b, 0) || nonEmptyLines.length;

    const assigned: string[] = new Array(totalCues).fill('');
    let lineIdx = 0;
    let accumWeight = 0;
    let accumLineLen = 0;

    for (let cIdx = 0; cIdx < totalCues; cIdx++) {
      accumWeight += weights[cIdx];
      const targetLineLen = (accumWeight / totalWeight) * totalLineLen;
      const remainingCues = totalCues - 1 - cIdx;
      const picked: string[] = [];

      while (lineIdx < nonEmptyLines.length - remainingCues) {
        picked.push(nonEmptyLines[lineIdx]);
        accumLineLen += lineLengths[lineIdx];
        lineIdx++;
        if (accumLineLen >= targetLineLen && picked.length >= 1) {
          break;
        }
      }
      assigned[cIdx] = picked.join(' ').trim();
    }
    // Append any leftover lines to the last cue
    if (lineIdx < nonEmptyLines.length) {
      const rest = nonEmptyLines.slice(lineIdx).join(' ').trim();
      assigned[totalCues - 1] = [assigned[totalCues - 1], rest].filter(Boolean).join(' ');
    }

    return cues.map((cue, idx) => {
      const baseOrig = cue.sourceOriginalText || cue.originalText;
      return {
        ...cue,
        originalText: baseOrig,
        sourceOriginalText: baseOrig,
        translatedText: assigned[idx] || '',
      };
    });
  }

  // Case 5b: Fewer lines than cues (e.g., continuous paragraph/story text or fewer lines)
  // Tokenize into safe Khmer phrases/words and distribute proportionally across all cues
  const tokens = splitIntoSafeKhmerTokens(nonEmptyLines.join(' '));
  if (tokens.length === 0) return cues;

  if (tokens.length <= totalCues) {
    // Even atomic tokens are fewer than or equal to cues
    return cues.map((cue, idx) => {
      const baseOrig = cue.sourceOriginalText || cue.originalText;
      return {
        ...cue,
        originalText: baseOrig,
        sourceOriginalText: baseOrig,
        translatedText: tokens[idx] || tokens[tokens.length - 1] || '',
      };
    });
  }

  const tokenLengths = tokens.map((t) => Math.max(2, t.length));
  const totalTokenLen = tokenLengths.reduce((a, b) => a + b, 0) || tokens.length;

  const cueTranslations: string[] = new Array(totalCues).fill('');
  let tokIdx = 0;
  let accumWeight = 0;
  let accumTokLen = 0;

  for (let cIdx = 0; cIdx < totalCues; cIdx++) {
    accumWeight += weights[cIdx];
    const targetTokLen = (accumWeight / totalWeight) * totalTokenLen;
    const remainingCues = totalCues - 1 - cIdx;
    const picked: string[] = [];

    if (cIdx === totalCues - 1) {
      // Last cue takes all remaining tokens so zero text is ever lost
      while (tokIdx < tokens.length) {
        picked.push(tokens[tokIdx]);
        tokIdx++;
      }
    } else {
      while (tokIdx < tokens.length - remainingCues) {
        const tok = tokens[tokIdx];
        picked.push(tok);
        accumTokLen += tokenLengths[tokIdx];
        tokIdx++;

        // Stop if we reached target length, or slightly before target if token ends with sentence punctuation ។ / ? / !
        const endsWithPunct = /[។៕?!,]$/.test(tok);
        if (accumTokLen >= targetTokLen) {
          break;
        }
        if (endsWithPunct && accumTokLen >= targetTokLen - tokenLengths[Math.min(tokIdx, tokens.length - 1)] * 0.8) {
          break;
        }
      }
    }

    cueTranslations[cIdx] = picked.join(' ').replace(/\s+([។៕?!,])/g, '$1').trim();
  }

  return cues.map((cue, idx) => {
    const baseOrig = cue.sourceOriginalText || cue.originalText;
    return {
      ...cue,
      originalText: baseOrig,
      sourceOriginalText: baseOrig,
      translatedText: cueTranslations[idx] || '',
    };
  });
}

/**
 * Generates standard SRT cues with automatic timestamps from plain text if the user doesn't have an original .srt file
 */
export function generateSrtCuesFromPlainText(text: string): SrtCue[] {
  if (!text || !text.trim()) return [];
  const rawLines = text
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((l) => cleanSingleSubtitleLine(l))
    .filter(Boolean);

  // If user pasted 1-3 huge paragraphs, split by sentence punctuation (។ / . / ? / !) into subtitle-sized lines
  let subtitleLines: string[] = [];
  for (const line of rawLines) {
    if (line.length <= 110) {
      subtitleLines.push(line);
    } else {
      const sentences = line
        .replace(/([។៕.?!]+)\s*/g, '$1\n')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const s of sentences) {
        if (s.length <= 110) {
          subtitleLines.push(s);
        } else {
          const toks = splitIntoSafeKhmerTokens(s);
          let cur = '';
          for (const t of toks) {
            if (cur.length + t.length > 75 && cur.length > 0) {
              subtitleLines.push(cur.trim());
              cur = t;
            } else {
              cur = cur ? `${cur} ${t}` : t;
            }
          }
          if (cur.trim()) subtitleLines.push(cur.trim());
        }
      }
    }
  }

  let currentMs = 1000;
  return subtitleLines.map((line, idx) => {
    // ~14 chars per second reading speed, clamped between 2.2s and 6.5s
    const durationMs = Math.min(6500, Math.max(2200, Math.round((line.length / 14) * 1000)));
    const startTime = formatMsToSrtTime(currentMs);
    const endTime = formatMsToSrtTime(currentMs + durationMs);
    currentMs += durationMs + 250; // 250ms gap between subtitles
    return {
      id: idx + 1,
      startTime,
      endTime,
      timecode: `${startTime} --> ${endTime}`,
      originalText: line,
      sourceOriginalText: line,
      translatedText: line,
    };
  });
}

/**
 * Synchronizes cues when the user edits or pastes text in the input box.
 * If the text in the box is already Khmer (or if cues already have sourceOriginalText),
 * aligns the text into translatedText while preserving the original SRT cues & timestamps!
 */
export function syncCuesWithTextLines(
  cues: SrtCue[],
  text: string,
  mode: SrtAlignmentMode = 'auto'
): SrtCue[] {
  if (!cues || cues.length === 0) return cues;
  if (!text || !text.trim()) return cues;

  const extractedOrig = extractCleanTextFromCues(cues).trim();
  const trimmedInput = text.trim();

  // If the text in the box is identical to the extracted original text and not Khmer, keep originalText as-is
  if (trimmedInput === extractedOrig && !isMostlyKhmerText(trimmedInput)) {
    return cues;
  }

  // If the user pasted/edited Khmer text in the box, or modified the text to align with SRT,
  // align it into translatedText so original timestamps and sourceOriginalText are 100% preserved!
  if (isMostlyKhmerText(trimmedInput)) {
    return alignTranslatedTextToSrtCues(cues, trimmedInput, mode);
  }

  // If the user edited foreign lines and line count matches, update originalText
  const lines = trimmedInput.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === cues.length) {
    return cues.map((cue, idx) => ({
      ...cue,
      originalText: lines[idx],
      sourceOriginalText: cue.sourceOriginalText || cue.originalText,
    }));
  }

  return alignTranslatedTextToSrtCues(cues, trimmedInput, mode);
}

/**
 * Extracts plain text from all SRT cues
 */
export function extractPlainTextFromCues(cues: SrtCue[], useTranslated: boolean = false): string {
  if (!cues || cues.length === 0) return '';
  return cues
    .map((cue) => (useTranslated ? cue.translatedText || cue.originalText : cue.originalText))
    .filter(Boolean)
    .join('\n');
}

/**
 * Formats cues for a translation chunk, giving each cue a clear tag:
 * [SRT_1 | 00:00:01,000 --> 00:00:04,000]
 * Original line text
 */
export function formatCuesForTranslation(cues: SrtCue[]): string {
  return cues
    .map((c) => `[SRT_${c.id} | ${c.timecode}]\n${c.originalText}`)
    .join('\n\n');
}

/**
 * Parses the translated text returned by Gemini and maps translated lines back to cues by id.
 */
export function parseTranslatedCuesIntoMap(
  translatedText: string,
  targetCues: SrtCue[]
): Map<number, string> {
  const result = new Map<number, string>();
  if (!translatedText || targetCues.length === 0) return result;

  const khmerDigitMap: Record<string, string> = {
    '០': '0',
    '១': '1',
    '២': '2',
    '៣': '3',
    '៤': '4',
    '៥': '5',
    '៦': '6',
    '៧': '7',
    '៨': '8',
    '៩': '9',
  };
  const toAsciiDigits = (s: string) =>
    s.replace(/[០-៩]/g, (d) => khmerDigitMap[d] ?? d);

  const normalized = translatedText
    .replace(/\r\n/g, '\n')
    .replace(
      /\[\s*(?:SRT|អេសអាធី)[\s_]*([0-9០-៩]+)(\s*\|[^\n\]]*)?\]/gi,
      (_, idStr: string, rest?: string) =>
        `[SRT_${toAsciiDigits(idStr)}${rest ? toAsciiDigits(rest) : ''}]`
    );

  // Strategy 1: [SRT_1 | ...] or [SRT_1] tags
  const tagRegex = /\[SRT_(\d+)(?:\s*\|[^\n\]]*)?\]\s*\n?/gi;
  const tagMatches: { cueId: number; matchIndex: number; textStart: number }[] = [];
  let m: RegExpExecArray | null;

  while ((m = tagRegex.exec(normalized)) !== null) {
    const cueId = parseInt(m[1], 10);
    if (!isNaN(cueId)) {
      tagMatches.push({
        cueId,
        matchIndex: m.index,
        textStart: m.index + m[0].length,
      });
    }
  }

  if (tagMatches.length > 0) {
    for (let i = 0; i < tagMatches.length; i++) {
      const current = tagMatches[i];
      const nextMatchIndex =
        i + 1 < tagMatches.length ? tagMatches[i + 1].matchIndex : normalized.length;
      const rawSlice = normalized.slice(current.textStart, nextMatchIndex);
      const clean = cleanCueTranslation(rawSlice);
      if (clean) {
        result.set(current.cueId, clean);
      }
    }
    if (result.size > 0) {
      return result;
    }
  }

  // Strategy 2: Standard SRT blocks
  const timecodeBlockRegex =
    /(?:^|\n)\s*([0-9០-៩]+)\s*\n\s*([0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}\s*-->\s*[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3})\s*\n?/g;
  const tcMatches: { idNum: number; matchIndex: number; textStart: number }[] = [];
  while ((m = timecodeBlockRegex.exec(normalized)) !== null) {
    const idNum = parseInt(toAsciiDigits(m[1]), 10);
    tcMatches.push({
      idNum,
      matchIndex: m.index,
      textStart: m.index + m[0].length,
    });
  }

  if (tcMatches.length > 0) {
    for (let i = 0; i < tcMatches.length; i++) {
      const current = tcMatches[i];
      const nextMatchIndex =
        i + 1 < tcMatches.length ? tcMatches[i + 1].matchIndex : normalized.length;
      const rawSlice = normalized.slice(current.textStart, nextMatchIndex);
      const clean = cleanCueTranslation(rawSlice);
      const targetCue = targetCues.find((c) => c.id === current.idNum) || targetCues[i];
      if (targetCue && clean) {
        result.set(targetCue.id, clean);
      }
    }
    if (result.size > 0) {
      return result;
    }
  }

  // Strategy 3: Numbered lines
  const numberedLineRegex = /(?:^|\n)\s*(?:#|\[)?([0-9០-៩]+)(?:\]|\.|\))\s+([^\n]+)/g;
  const numMatches: { id: number; text: string }[] = [];
  while ((m = numberedLineRegex.exec(normalized)) !== null) {
    const id = parseInt(toAsciiDigits(m[1]), 10);
    const text = cleanCueTranslation(m[2]);
    if (!isNaN(id) && text) {
      numMatches.push({ id, text });
    }
  }

  if (numMatches.length >= Math.min(3, targetCues.length)) {
    for (let idx = 0; idx < numMatches.length; idx++) {
      const item = numMatches[idx];
      const targetCue =
        targetCues.find((c) => c.id === item.id) ||
        (idx < targetCues.length ? targetCues[idx] : undefined);
      if (targetCue) {
        result.set(targetCue.id, item.text);
      }
    }
    if (result.size > 0) {
      return result;
    }
  }

  // Strategy 4: Paragraph or single-line sequential matching fallback
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => cleanCueTranslation(p))
    .filter((p) => p.length > 0);

  if (paragraphs.length >= targetCues.length) {
    for (let i = 0; i < targetCues.length && i < paragraphs.length; i++) {
      result.set(targetCues[i].id, paragraphs[i]);
    }
    return result;
  }

  const singleLines = normalized
    .split('\n')
    .map((l) => cleanCueTranslation(l))
    .filter((l) => l.length > 0);

  for (let i = 0; i < targetCues.length && i < singleLines.length; i++) {
    result.set(targetCues[i].id, singleLines[i]);
  }

  return result;
}

/**
 * Checks if a text snippet looks like an AI preamble/disclaimer rather than real subtitle dialogue
 * (e.g., "ជូនចំពោះអត្ថបទដែលបានផ្ដល់មក ខ្ញុំសូមធ្វើការបកប្រែ", "ជាភាសាខ្មែរសុទ្ធ១០០% យ៉ាងពេញលេញ", "ដូចខាងក្រោម៖")
 */
export function isAiPreambleText(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  const preamblePatterns = [
    /^ជូនចំពោះអត្ថបទ/i,
    /ខ្ញុំសូមធ្វើការបកប្រែ/i,
    /ជាភាសាខ្មែរសុទ្ធ\s*១០០%/i,
    /ដោយគ្មានការកាត់តម្រឹម/i,
    /សង្ខេប\s*ឬលុបចោលផ្នែកណាមួយឡើយ/i,
    /ដូចខាងក្រោម(?:\s*[:៖])?/i,
    /^ខាងក្រោមនេះជាការបកប្រែ/i,
    /^នេះជាការបកប្រែ/i,
    /^ការបកប្រែជាភាសាខ្មែរ(?:\s*[:៖])?/i,
    /^អត្ថបទបកប្រែ(?:\s*[:៖])?/i,
    /^សូមអរគុណ/i,
    /Here is the (?:translation|Khmer translation)/i,
    /Translated into Khmer/i,
    /^[-•*]?\s*\*?\*?តួអង្គ\s*[៖:]/i,
    /^[-•*]?\s*\*?\*?ទីកន្លែង(?:\s*\/\s*និកាយ)?\s*[៖:]/i,
    /^[-•*]?\s*\*?\*?វត្ថុ(?:\s*\/\s*ថាមពល)?(?:\s*\/\s*កម្រិត)?\s*[៖:]/i,
  ];

  return preamblePatterns.some((pattern) => pattern.test(t));
}

/**
 * Filters out initial cues that are purely AI preambles or boilerplate disclaimers
 */
export function filterPreambleCues(cues: SrtCue[]): SrtCue[] {
  if (!cues || cues.length === 0) return [];
  // Find where actual dialogue starts
  let firstValidIdx = 0;
  while (firstValidIdx < Math.min(5, cues.length)) {
    const cueText = cues[firstValidIdx].originalText || cues[firstValidIdx].translatedText || '';
    if (isAiPreambleText(cueText)) {
      firstValidIdx++;
    } else {
      break;
    }
  }

  if (firstValidIdx === 0) return cues;

  return cues.slice(firstValidIdx);
}

/**
 * Cleans individual cue translation (removes residual tags, strips citation tags & parentheses, fixes AI leaks)
 */
export function cleanCueTranslation(text: string): string {
  if (!text) return '';
  let cleaned = text
    .replace(/^\[\s*(?:SRT|អេសអាធី)[\s_]*[0-9០-៩]+[^\]]*\]/i, '')
    .replace(/^[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}\s*-->\s*[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}/, '')
    .replace(/^(?:#|\[)?[0-9០-៩]+(?:\]|\.|\))\s*/, '')
    .replace(/={2,}[^=]*={2,}/g, '')
    .replace(/\[\s*(?:P|ភី)[0-9០-៩]+\s*\]:?/gi, '')
    .replace(/\[\s*(?:cite|source)[^\]]*\]|【[^】]*】/gi, '')
    .replace(/^[-•*]?\s*\*?\*?(?:តួអង្គ|ទីកន្លែង(?:\s*\/\s*និកាយ)?|វត្ថុ(?:\s*\/\s*ថាមពល)?(?:\s*\/\s*កម្រិត)?)\s*[៖:][^\n]*/gim, '')
    .replace(/[()（）]/g, '')
    .replace(/^---\s*/, '')
    .replace(/\s*មែនតk!/g, ' មែនទែន!')
    .replace(/[ \t]+/g, ' ')
    .trim();

  // If this text is an AI preamble disclaimer, discard it so it doesn't pollute subtitles
  if (isAiPreambleText(cleaned)) {
    return '';
  }

  // If text contains ONLY punctuation marks (e.g. ",", "។", ".", "-", "?") and no letters/digits,
  // it is invalid and must not be treated as a completed cue translation!
  if (!/[\p{L}\p{M}0-9០-៩]/u.test(cleaned)) {
    return '';
  }

  return cleaned;
}
