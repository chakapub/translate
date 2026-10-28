export interface SrtCue {
  id: number;
  startTime: string;
  endTime: string;
  timecode: string;
  originalText: string;
  translatedText?: string;
}

/**
 * Checks if the text looks like an SRT file (contains timestamp arrows like 00:00:01,000 --> 00:00:04,000)
 */
export function isSrtContent(text: string): boolean {
  if (!text || text.length < 10) return false;
  const timecodeRegex = /\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}/;
  return timecodeRegex.test(text);
}

/**
 * Parses raw SRT string into an array of SrtCue objects
 */
export function parseSrt(rawSrt: string): SrtCue[] {
  if (!rawSrt || !rawSrt.trim()) return [];

  // Normalize line endings
  const normalized = rawSrt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Match cue blocks: Index (optional), Timecode, Text
  const timecodeRegex = /(\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3})/;

  // Split by double newlines or blocks
  const blocks = normalized.split(/\n\s*\n/);
  const cues: SrtCue[] = [];
  let currentId = 1;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) continue;

    // Check if line 0 or line 1 has timecode
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

    // Index from previous line if integer, or auto-increment
    let parsedId = currentId;
    if (timecodeLineIdx > 0) {
      const maybeId = parseInt(lines[0], 10);
      if (!isNaN(maybeId)) {
        parsedId = maybeId;
      }
    }

    // Text is everything after the timecode line
    const textLines = lines.slice(timecodeLineIdx + 1);
    const originalText = textLines.join('\n').trim();

    if (originalText.length > 0) {
      cues.push({
        id: parsedId,
        startTime,
        endTime,
        timecode,
        originalText,
        translatedText: '',
      });
      currentId = parsedId + 1;
    }
  }

  return cues;
}

/**
 * Builds standard, clean SRT file content from SrtCue array
 */
export function buildSrt(cues: SrtCue[], useTranslated: boolean = true): string {
  if (!cues || cues.length === 0) return '';

  return cues
    .map((cue, idx) => {
      const text = useTranslated
        ? (cue.translatedText || cue.originalText || '').trim()
        : (cue.originalText || '').trim();

      return `${idx + 1}\n${cue.timecode}\n${text}`;
    })
    .join('\n\n');
}

/**
 * Extracts plain text from all SRT cues (for story analysis or pure text input box)
 * Each cue is represented cleanly on its own line.
 */
export function extractCleanTextFromCues(cues: SrtCue[]): string {
  if (!cues || cues.length === 0) return '';
  return cues
    .map((c) => c.originalText.replace(/\r?\n+/g, ' ').trim())
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
 * Synchronizes cues if the user edits text in the input box line-by-line
 */
export function syncCuesWithTextLines(cues: SrtCue[], text: string): SrtCue[] {
  if (!cues || cues.length === 0) return cues;
  const lines = text.split('\n');
  return cues.map((cue, idx) => {
    if (idx < lines.length && lines[idx].trim().length > 0) {
      return { ...cue, originalText: lines[idx].trim() };
    }
    return cue;
  });
}

/**
 * Extracts plain text from all SRT cues (for story analysis or plain text reading)
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
 * Handles:
 * 1) [SRT_1 | 00:00:01,000 --> 00:00:04,000] \n <Khmer text>
 * 2) [SRT_1] \n <Khmer text>
 * 3) Standard SRT format: 1 \n 00:00... \n <Khmer text>
 * 4) Numbered lines: 1. Text or #1 Text or [1] Text
 * 5) Fallback sequential line / paragraph mapping
 */
export function parseTranslatedCuesIntoMap(
  translatedText: string,
  targetCues: SrtCue[]
): Map<number, string> {
  const result = new Map<number, string>();
  if (!translatedText || targetCues.length === 0) return result;

  const normalized = translatedText.replace(/\r\n/g, '\n');

  // Strategy 1: [SRT_1 | ...] or [SRT_1] tags (even when streaming live)
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
    return result;
  }

  // Strategy 2: Standard SRT blocks (1 \n 00:00:01,000 --> 00:00:04,000 \n Text)
  const timecodeBlockRegex =
    /(?:^|\n)\s*(\d+)\s*\n\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3})\s*\n?/g;
  const tcMatches: { idNum: number; matchIndex: number; textStart: number }[] = [];
  while ((m = timecodeBlockRegex.exec(normalized)) !== null) {
    const idNum = parseInt(m[1], 10);
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
      const targetCue =
        targetCues.find((c) => c.id === current.idNum) || targetCues[i];
      if (targetCue && clean) {
        result.set(targetCue.id, clean);
      }
    }
    return result;
  }

  // Strategy 3: Numbered lines e.g. "1. Text" or "1) Text" or "[1] Text" or "#1 Text"
  const numberedLineRegex = /(?:^|\n)\s*(?:#|\[)?(\d+)(?:\]|\.|\))\s+([^\n]+)/g;
  const numMatches: { id: number; text: string }[] = [];
  while ((m = numberedLineRegex.exec(normalized)) !== null) {
    const id = parseInt(m[1], 10);
    const text = cleanCueTranslation(m[2]);
    if (!isNaN(id) && text) {
      numMatches.push({ id, text });
    }
  }

  if (numMatches.length >= Math.min(3, targetCues.length)) {
    for (const item of numMatches) {
      const targetCue = targetCues.find((c) => c.id === item.id) || targetCues[item.id - 1];
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

  // Fallback to single line splitting
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
 * Cleans individual cue translation (removes residual tags, strips excessive symbols)
 */
export function cleanCueTranslation(text: string): string {
  if (!text) return '';
  return text
    .replace(/^\[SRT_\d+[^\]]*\]/i, '')
    .replace(/^\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}/, '')
    .replace(/^(?:#|\[)?\d+(?:\]|\.|\))\s*/, '')
    .replace(/={2,}[^=]*={2,}/g, '')
    .replace(/\[P\d+\]:?/gi, '')
    .trim();
}
