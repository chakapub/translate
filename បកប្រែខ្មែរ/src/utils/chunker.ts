import { SrtCue, formatCuesForTranslation } from './srtParser';

export interface PageChunk {
  id: string;
  index: number;
  originalText: string;
  charCount: number;
  wordCount: number;
  translatedText: string;
  translatedChars: number;
  status: 'idle' | 'translating' | 'completed' | 'error';
  summary?: string;
  error?: string;
  isSrtChunk?: boolean;
  srtCues?: SrtCue[];
}

export interface ChunkOptions {
  targetChars?: number;  // default 12500 (ចន្លោះ 12000 ទៅ 13000 តួអក្សរ)
  minChars?: number;     // default 12000
  maxChars?: number;     // default 13000
  hardMaxLimit?: number; // STRICT CEILING: 50,000
}

export const ABSOLUTE_MAX_PAGE_CHARS = 50000;

/**
 * Splits long story text (even 350,000+ characters) into neat story pages/chunks.
 * Default page size: 12,000 to 13,000 characters per page.
 * IRONCLAD LAW: Under NO circumstance can any page exceed 50,000 characters.
 * Cuts cleanly at paragraph (\n\n) or sentence (.?!។) boundaries.
 */
export function splitIntoPages(text: string, options: ChunkOptions = {}): PageChunk[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const cleanText = text.replace(/\r\n/g, '\n');
  const hardMaxLimit = Math.min(options.hardMaxLimit || ABSOLUTE_MAX_PAGE_CHARS, ABSOLUTE_MAX_PAGE_CHARS);
  const targetChars = Math.min(options.targetChars || 12500, hardMaxLimit);
  const maxChars = Math.min(options.maxChars || 13000, hardMaxLimit);
  const minChars = Math.min(options.minChars || 12000, maxChars);

  // If text is already strictly within maxChars and <= 50,000, return as single page
  if (cleanText.length <= maxChars && cleanText.length <= ABSOLUTE_MAX_PAGE_CHARS) {
    return [
      {
        id: 'page-1',
        index: 0,
        originalText: cleanText,
        charCount: cleanText.length,
        wordCount: countWords(cleanText),
        translatedText: '',
        translatedChars: 0,
        status: 'idle',
      },
    ];
  }

  const rawChunks: string[] = [];
  let remaining = cleanText;

  // Window-based multi-tier sentence/paragraph boundary slicer
  while (remaining.length > 0) {
    // If what remains is within maxChars and strictly <= 50,000, finalize it as the last chunk
    if (remaining.length <= maxChars && remaining.length <= ABSOLUTE_MAX_PAGE_CHARS) {
      rawChunks.push(remaining.trim());
      break;
    }

    const searchEnd = Math.min(remaining.length, maxChars, ABSOLUTE_MAX_PAGE_CHARS);
    const searchStart = Math.min(minChars, Math.max(0, searchEnd - 1000));
    const sliceWindow = remaining.slice(0, searchEnd);

    let splitIdx = -1;

    // 1. Try finding double newline \n\n (Paragraph boundary)
    const doubleNewlineIdx = sliceWindow.lastIndexOf('\n\n');
    if (doubleNewlineIdx >= searchStart) {
      splitIdx = doubleNewlineIdx + 2;
    }

    // 2. Try finding single newline \n (Line boundary)
    if (splitIdx === -1) {
      const singleNewlineIdx = sliceWindow.lastIndexOf('\n');
      if (singleNewlineIdx >= searchStart) {
        splitIdx = singleNewlineIdx + 1;
      }
    }

    // 3. Try finding sentence ending: . or ? or ! or Hindi । or Khmer ។ or with quotes
    if (splitIdx === -1) {
      const sentenceRegex = /[.?!।។][\"\')\]»”’]?(\s+|$)/g;
      let lastMatchIdx = -1;
      let match: RegExpExecArray | null;
      while ((match = sentenceRegex.exec(sliceWindow)) !== null) {
        const endOfSentence = match.index + match[0].length;
        if (endOfSentence >= searchStart && endOfSentence <= searchEnd) {
          lastMatchIdx = endOfSentence;
        }
      }
      if (lastMatchIdx !== -1) {
        splitIdx = lastMatchIdx;
      }
    }

    // 4. Try finding comma, semicolon, dash or colon with space
    if (splitIdx === -1) {
      const commaRegex = /[,;:\—–](\s+)/g;
      let lastMatchIdx = -1;
      let match: RegExpExecArray | null;
      while ((match = commaRegex.exec(sliceWindow)) !== null) {
        const endOfClause = match.index + match[0].length;
        if (endOfClause >= searchStart && endOfClause <= searchEnd) {
          lastMatchIdx = endOfClause;
        }
      }
      if (lastMatchIdx !== -1) {
        splitIdx = lastMatchIdx;
      }
    }

    // 5. Try finding space
    if (splitIdx === -1) {
      const spaceIdx = sliceWindow.lastIndexOf(' ');
      if (spaceIdx >= searchStart) {
        splitIdx = spaceIdx + 1;
      }
    }

    // 6. Hard cut if no punctuation, strictly capped at searchEnd (which is <= 50,000)
    if (splitIdx === -1 || splitIdx <= 0) {
      splitIdx = searchEnd;
    }

    // Ensure splitIdx NEVER exceeds 50,000
    splitIdx = Math.min(splitIdx, ABSOLUTE_MAX_PAGE_CHARS);

    const chunk = remaining.slice(0, splitIdx).trim();
    if (chunk.length > 0) {
      rawChunks.push(chunk);
    }
    remaining = remaining.slice(splitIdx).trimStart();
  }

  // Final validation pass: ensure every single chunk is strictly <= 50,000 characters
  const validatedChunks: string[] = [];
  for (const chunk of rawChunks) {
    if (chunk.length <= ABSOLUTE_MAX_PAGE_CHARS) {
      validatedChunks.push(chunk);
    } else {
      // Sub-divide any oversized chunk if it ever occurs
      let subRemain = chunk;
      while (subRemain.length > 0) {
        const takeSize = Math.min(subRemain.length, ABSOLUTE_MAX_PAGE_CHARS);
        let cut = takeSize;
        if (takeSize < subRemain.length) {
          const lastSpace = subRemain.lastIndexOf(' ', takeSize);
          if (lastSpace > takeSize * 0.7) {
            cut = lastSpace + 1;
          }
        }
        validatedChunks.push(subRemain.slice(0, cut).trim());
        subRemain = subRemain.slice(cut).trimStart();
      }
    }
  }

  return validatedChunks.map((chunkText, idx) => ({
    id: `page-${idx + 1}`,
    index: idx,
    originalText: chunkText,
    charCount: chunkText.length,
    wordCount: countWords(chunkText),
    translatedText: '',
    translatedChars: 0,
    status: 'idle',
  }));
}

/**
 * Splits text into sentences by punctuation (. ? ! or Hindi ।)
 */
function splitBySentences(text: string): string[] {
  const parts = text.split(/(?<=[.?!।])\s+/);
  return parts.filter((s) => s.trim().length > 0);
}

export function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Splits a page's text into tracking paragraphs or logical sections (e.g. 500-1,500 chars each)
 * so that both the AI translator and the UI can follow along sentence-by-sentence / paragraph-by-paragraph.
 */
export function getPageParagraphs(text: string): string[] {
  if (!text) return [];

  const rawBlocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const result: string[] = [];

  for (const block of rawBlocks) {
    if (block.length <= 1500) {
      result.push(block);
    } else {
      const sentences = splitBySentences(block);
      let acc = '';
      for (const sent of sentences) {
        if ((acc + ' ' + sent).length > 1200 && acc.length >= 600) {
          result.push(acc.trim());
          acc = sent;
        } else {
          acc = acc ? acc + ' ' + sent : sent;
        }
      }
      if (acc.trim()) {
        result.push(acc.trim());
      }
    }
  }

  return result.length > 0 ? result : [text];
}

/**
 * Splits an array of SrtCue objects into balanced pages/chunks.
 * Preserves every cue without cutting across cue boundaries,
 * keeping hardMaxLimit <= 50,000 characters.
 */
export function splitSrtIntoPages(cues: SrtCue[], options: ChunkOptions = {}): PageChunk[] {
  if (!cues || cues.length === 0) return [];

  const hardMaxLimit = Math.min(options.hardMaxLimit || ABSOLUTE_MAX_PAGE_CHARS, ABSOLUTE_MAX_PAGE_CHARS);
  const targetChars = Math.max(12000, Math.min(options.targetChars || 12500, hardMaxLimit));
  const minChars = Math.min(options.minChars || 12000, targetChars);
  const maxChars = Math.min(options.maxChars || 13000, hardMaxLimit);

  const pages: PageChunk[] = [];
  let currentPageCues: SrtCue[] = [];
  let currentDialogueChars = 0;
  let currentFormattedChars = 0;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const dialogueLen = (cue.originalText || '').length;
    const formattedLen = `[SRT_${cue.id} | ${cue.timecode}]\n${cue.originalText}\n\n`.length;

    // Start a new page if dialogue reached between minChars (12000) and maxChars (13000),
    // or if formatted text approaches hard limit (48000)
    if (
      currentPageCues.length >= 5 &&
      (currentDialogueChars + dialogueLen >= minChars || currentFormattedChars + formattedLen >= 48000)
    ) {
      if (
        currentDialogueChars >= targetChars ||
        currentDialogueChars + dialogueLen > maxChars ||
        currentFormattedChars + formattedLen >= 48000
      ) {
        const pageText = formatCuesForTranslation(currentPageCues);
        pages.push({
          id: `page-${pages.length + 1}`,
          index: pages.length,
          originalText: pageText,
          charCount: currentDialogueChars,
          wordCount: countWords(pageText),
          translatedText: '',
          translatedChars: 0,
          status: 'idle',
          isSrtChunk: true,
          srtCues: [...currentPageCues],
        });
        currentPageCues = [cue];
        currentDialogueChars = dialogueLen;
        currentFormattedChars = formattedLen;
        continue;
      }
    }

    currentPageCues.push(cue);
    currentDialogueChars += dialogueLen;
    currentFormattedChars += formattedLen;
  }

  if (currentPageCues.length > 0) {
    const pageText = formatCuesForTranslation(currentPageCues);
    pages.push({
      id: `page-${pages.length + 1}`,
      index: pages.length,
      originalText: pageText,
      charCount: currentDialogueChars,
      wordCount: countWords(pageText),
      translatedText: '',
      translatedChars: 0,
      status: 'idle',
      isSrtChunk: true,
      srtCues: [...currentPageCues],
    });
  }

  return pages;
}
