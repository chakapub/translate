import { SrtCue, formatCuesForTranslation } from './srtParser';
import { CorrectionDiffItem } from './khmerCleaner';

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
  corrections?: CorrectionDiffItem[];
  autoRepaired?: boolean;
  autoRepairStats?: {
    checkedChars: number;
    fixedCount: number;
    foreignFixedCount: number;
    spellingFixedCount: number;
    repairedAt: number;
  };
  usedAiEngine?: string;
  usedAiModel?: string;
  chatSessionId?: string;
  chatSessionNumber?: number;
}

export interface ChunkOptions {
  targetChars?: number;     // default 12500 (ចន្លោះ 12000 ទៅ 13000 តួអក្សរ)
  minChars?: number;        // default 12000
  maxChars?: number;        // default 13000
  hardMaxLimit?: number;    // STRICT CEILING: 50,000
  maxCuesPerPage?: number;  // default 500 (បកប្រែម្ដង ៥០០ ជួរ៖ [1] ដល់ [500], [501] ដល់ [1000]...)
}

export const ABSOLUTE_MAX_PAGE_CHARS = 50000;

/**
 * Fast O(N) word counter with zero array allocation.
 * Safe for 10,000,000+ character strings without triggering GC pauses.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  let count = 0;
  let inWord = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    // Whitespace: space (32), tab (9), newline (10), VT (11), FF (12), CR (13), NBSP (160)
    const isWs =
      code === 32 ||
      (code >= 9 && code <= 13) ||
      code === 160 ||
      code === 0x200b;
    if (!isWs) {
      if (!inWord) {
        inWord = true;
        count++;
      }
    } else {
      inWord = false;
    }
  }
  return count;
}

/**
 * Splits long story text (even 10,000,000+ characters) into neat story pages/chunks
 * using O(N) zero-copy index cursor slicing so memory stays flat.
 * Default page size: 12,000 to 13,000 characters per page.
 * IRONCLAD LAW: Under NO circumstance can any page exceed 50,000 characters.
 * Cuts cleanly at paragraph (\n\n) or sentence (.?!។) boundaries.
 */
export function splitIntoPages(text: string, options: ChunkOptions = {}): PageChunk[] {
  if (!text) {
    return [];
  }

  const cleanText = text.indexOf('\r') !== -1 ? text.replace(/\r\n/g, '\n') : text;
  const totalLen = cleanText.length;

  // Skip leading whitespace
  let offset = 0;
  while (offset < totalLen && cleanText.charCodeAt(offset) <= 32) {
    offset++;
  }
  if (offset >= totalLen) {
    return [];
  }

  const hardMaxLimit = Math.min(options.hardMaxLimit || ABSOLUTE_MAX_PAGE_CHARS, ABSOLUTE_MAX_PAGE_CHARS);
  const targetChars = Math.min(options.targetChars || 12500, hardMaxLimit);
  const maxChars = Math.min(options.maxChars || Math.max(targetChars + 500, 13000), hardMaxLimit);
  const minChars = Math.min(options.minChars || Math.max(1000, targetChars - 500), maxChars);

  // If text is already strictly within maxChars and <= 50,000, return as single page
  const trimmedInitialLen = totalLen - offset;
  if (trimmedInitialLen <= maxChars && trimmedInitialLen <= ABSOLUTE_MAX_PAGE_CHARS) {
    const singleChunk = cleanText.slice(offset).trim();
    if (!singleChunk) return [];
    return [
      {
        id: 'page-1',
        index: 0,
        originalText: singleChunk,
        charCount: singleChunk.length,
        wordCount: countWords(singleChunk),
        translatedText: '',
        translatedChars: 0,
        status: 'idle',
      },
    ];
  }

  const rawChunks: string[] = [];

  // O(N) cursor-based window slicer — never copies the remaining multi-MB string
  while (offset < totalLen) {
    // Advance past any leading whitespace at current offset
    while (offset < totalLen && cleanText.charCodeAt(offset) <= 32) {
      offset++;
    }
    if (offset >= totalLen) break;

    const remainingLen = totalLen - offset;

    // If what remains is within maxChars and strictly <= 50,000, finalize as the last chunk
    if (remainingLen <= maxChars && remainingLen <= ABSOLUTE_MAX_PAGE_CHARS) {
      const tailChunk = cleanText.slice(offset).trim();
      if (tailChunk.length > 0) {
        rawChunks.push(tailChunk);
      }
      break;
    }

    const searchEnd = Math.min(remainingLen, maxChars, ABSOLUTE_MAX_PAGE_CHARS);
    const searchStart = Math.min(minChars, Math.max(0, searchEnd - 1500));
    const sliceWindow = cleanText.slice(offset, offset + searchEnd);

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

    const chunk = sliceWindow.slice(0, splitIdx).trim();
    if (chunk.length > 0) {
      rawChunks.push(chunk);
    }
    offset += splitIdx;
  }

  return rawChunks.map((chunkText, idx) => ({
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
 * Splits text into sentences by punctuation (. ? ! or Hindi । or newlines),
 * and further splits any unpunctuated run-on transcript segment (> 500 chars)
 * at clause or word boundaries so no single segment is ever too long.
 */
function splitBySentences(text: string): string[] {
  const rawParts = text.split(/(?<=[.?!।។])\s+|\n+/);
  const result: string[] = [];

  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 500) {
      result.push(trimmed);
      continue;
    }

    // Further split unpunctuated run-on transcript by commas/clauses or word boundaries (<= 450 chars)
    const clauses = trimmed.split(/(?<=[,;:\—–])\s+/);
    let current = '';
    for (const clause of clauses) {
      if (clause.length > 450) {
        if (current.trim()) {
          result.push(current.trim());
          current = '';
        }
        const words = clause.split(/\s+/);
        let wordAcc = '';
        for (const w of words) {
          if ((wordAcc + ' ' + w).length > 420 && wordAcc.length > 0) {
            result.push(wordAcc.trim());
            wordAcc = w;
          } else {
            wordAcc = wordAcc ? wordAcc + ' ' + w : w;
          }
        }
        if (wordAcc.trim()) {
          current = wordAcc.trim();
        }
      } else if ((current + ' ' + clause).length > 450 && current.length > 0) {
        result.push(current.trim());
        current = clause;
      } else {
        current = current ? current + ' ' + clause : clause;
      }
    }
    if (current.trim()) {
      result.push(current.trim());
    }
  }

  return result;
}

/**
 * Splits a page's text into tracking paragraphs or logical sections (e.g. 400-1,000 chars each)
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
    if (block.length <= 950) {
      result.push(block);
    } else {
      const sentences = splitBySentences(block);
      let acc = '';
      for (const sent of sentences) {
        if ((acc + ' ' + sent).length > 900 && acc.length >= 350) {
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
 * Groups paragraphs or SRT blocks into smaller resilient sub-batches (e.g. ~3500 chars)
 * so that if a 12,500-char page encounters a 503 high-demand spike, the server can
 * translate the page in compact sub-batches without ever failing or losing paragraph tags!
 */
export interface SourceBlockItem {
  key: string;
  num: number;
  rawBlock: string;
  sourceBody: string;
}

const KHMER_DIGIT_TO_ASCII: Record<string, string> = {
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

function toAsciiDigits(str: string): string {
  return (str || '').replace(/[០-៩]/g, (d) => KHMER_DIGIT_TO_ASCII[d] ?? d);
}

/**
 * Formats a page's original text into canonical [SRT_X | ...] or [P1]..[Pn] tagged blocks.
 */
export function formatPageAsTaggedBlocks(chunkText: string, isSrt: boolean): string {
  if (!chunkText || !chunkText.trim()) return '';
  if (isSrt || chunkText.includes('[SRT_')) {
    return chunkText.trim();
  }
  if (/^\s*\[P\d+\]/m.test(chunkText)) {
    return chunkText.trim();
  }
  const rawParagraphs = getPageParagraphs(chunkText);
  return rawParagraphs.map((p, idx) => `[P${idx + 1}]\n${p}`).join('\n\n');
}

/**
 * Extracts structured source blocks ([SRT_X] or [P_X]) from a formatted batch or page.
 */
export function extractSourceBlocksFromBatch(
  formattedBatch: string,
  isSrt: boolean
): SourceBlockItem[] {
  if (!formattedBatch || !formattedBatch.trim()) return [];
  const effectiveIsSrt = Boolean(isSrt || formattedBatch.includes('[SRT_'));

  if (effectiveIsSrt) {
    const blocks = formattedBatch
      .split(/(?=\[\s*(?:SRT|អេសអាធី)[\s_]*[០-៩0-9]+)/gi)
      .map((b) => b.trim())
      .filter(Boolean);

    const items: SourceBlockItem[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const m = b.match(/^\[\s*(?:SRT|អេសអាធី)[\s_]*([០-៩0-9]+)(?:\s*\|[^\]]*)?\]\s*([\s\S]*)$/i);
      if (m) {
        const num = parseInt(toAsciiDigits(m[1]), 10) || i + 1;
        items.push({
          key: `SRT_${num}`,
          num,
          rawBlock: b,
          sourceBody: (m[2] || '').trim(),
        });
      } else {
        const num = i + 1;
        items.push({
          key: `SRT_${num}`,
          num,
          rawBlock: `[SRT_${num}]\n${b}`,
          sourceBody: b.trim(),
        });
      }
    }
    return items;
  }

  const taggedText = formatPageAsTaggedBlocks(formattedBatch, false);
  const blocks = taggedText
    .split(/(?=\[\s*P[០-៩0-9]+\s*\])/gi)
    .map((b) => b.trim())
    .filter(Boolean);

  const items: SourceBlockItem[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const m = b.match(/^\[\s*P([០-៩0-9]+)\s*\]\s*([\s\S]*)$/i);
    if (m) {
      const num = parseInt(toAsciiDigits(m[1]), 10) || i + 1;
      items.push({
        key: `P${num}`,
        num,
        rawBlock: `[P${num}]\n${(m[2] || '').trim()}`,
        sourceBody: (m[2] || '').trim(),
      });
    } else {
      const num = i + 1;
      items.push({
        key: `P${num}`,
        num,
        rawBlock: `[P${num}]\n${b}`,
        sourceBody: b.trim(),
      });
    }
  }
  return items;
}

/**
 * Extracts a map of translated blocks ([SRT_X] or [P_X]) from translated output.
 * If a block appears multiple times (e.g. from a continuation retry), keeps the one with the most Khmer characters.
 */
export function extractTranslatedBlocksMap(
  translatedText: string,
  isSrt: boolean
): Map<string, { num: number; headerTag: string; body: string; khmerChars: number }> {
  const map = new Map<string, { num: number; headerTag: string; body: string; khmerChars: number }>();
  if (!translatedText || !translatedText.trim()) return map;

  const normalized = translatedText
    .replace(
      /\[\s*(?:SRT|អេសអាធី)[\s_]*([០-៩0-9]+)(\s*\|[^\n\]]*)?\]/gi,
      (_, idDigits: string, rest?: string) => `[SRT_${toAsciiDigits(idDigits)}${toAsciiDigits(rest || '')}]`
    )
    .replace(
      /\[\s*(?:P|ភី|កថាខណ្ឌ(?:ទី)?\s*)([០-៩0-9]+)\s*\]/gi,
      (_, digits: string) => `[P${toAsciiDigits(digits)}]`
    );

  const effectiveIsSrt = Boolean(isSrt || normalized.includes('[SRT_'));

  if (effectiveIsSrt) {
    const regex = /(\[SRT_(\d+)(?:\s*\|[^\]]*)?\])([\s\S]*?)(?=\[SRT_\d+|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(normalized)) !== null) {
      const headerTag = m[1].trim();
      const num = parseInt(m[2], 10);
      const body = (m[3] || '').trim();
      const khmerChars = (body.match(/[\u1780-\u17FF]/g) || []).length;
      const key = `SRT_${num}`;
      const existing = map.get(key);
      if (!existing || khmerChars >= existing.khmerChars) {
        map.set(key, { num, headerTag, body, khmerChars });
      }
    }
    return map;
  }

  const regex = /(\[P(\d+)\])([\s\S]*?)(?=\[P\d+\]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(normalized)) !== null) {
    const headerTag = `[P${m[2]}]`;
    const num = parseInt(m[2], 10);
    const body = (m[3] || '').trim();
    const khmerChars = (body.match(/[\u1780-\u17FF]/g) || []).length;
    const key = `P${num}`;
    const existing = map.get(key);
    if (!existing || khmerChars >= existing.khmerChars) {
      map.set(key, { num, headerTag, body, khmerChars });
    }
  }
  return map;
}

/**
 * Deduplicates translated blocks ([SRT_X] or [P_X]) in ascending block order,
 * keeping the most complete translation of each block so retries never duplicate paragraphs or cues.
 */
export function deduplicateTranslatedBlocks(translatedText: string, isSrt: boolean): string {
  if (!translatedText || !translatedText.trim()) return translatedText;
  const map = extractTranslatedBlocksMap(translatedText, isSrt);
  if (map.size === 0) return translatedText;

  const sorted = Array.from(map.values()).sort((a, b) => a.num - b.num);
  return sorted
    .map((item) => (item.body ? `${item.headerTag}\n${item.body}` : item.headerTag))
    .join('\n\n');
}

/**
 * Returns the exact list of source blocks in a batch or page that have NOT yet been completely translated.
 */
export function getUntranslatedBlocksInBatch(
  formattedBatch: string,
  translatedText: string,
  isSrt: boolean,
  dropLastTranslatedIfCutOff = false
): SourceBlockItem[] {
  const effectiveIsSrt = Boolean(isSrt || formattedBatch.includes('[SRT_'));
  const sourceBlocks = extractSourceBlocksFromBatch(formattedBatch, effectiveIsSrt);
  if (sourceBlocks.length === 0) return [];

  const translatedMap = extractTranslatedBlocksMap(translatedText, effectiveIsSrt);

  if (dropLastTranslatedIfCutOff && translatedMap.size > 0) {
    const keys = Array.from(translatedMap.keys());
    const lastKey = keys[keys.length - 1];
    if (lastKey) {
      translatedMap.delete(lastKey);
    }
  }

  return sourceBlocks.filter((sb) => {
    const sourceAlphaCount = (
      sb.sourceBody.match(/[a-zA-Z\u0900-\u097F\u4E00-\u9FFF\u1780-\u17FF]/g) || []
    ).length;
    if (sourceAlphaCount === 0) {
      return false;
    }
    const tr = translatedMap.get(sb.key);
    if (!tr) return true;

    const minKhmerRequired = effectiveIsSrt
      ? 1
      : Math.min(8, Math.max(2, Math.floor(sourceAlphaCount * 0.1)));
    return tr.khmerChars < minKhmerRequired;
  });
}

/**
 * Strictly evaluates whether an entire page has been 100% translated (all cues or all paragraphs, including the end of the page).
 */
export function evaluatePageTranslationCompleteness(
  page: {
    originalText: string;
    charCount: number;
    translatedText?: string;
    isSrtChunk?: boolean;
    srtCues?: Array<{ id: number; originalText: string; translatedText?: string }>;
  },
  candidateTranslatedText?: string
): {
  isComplete: boolean;
  translatedBlocks: number;
  totalBlocks: number;
  ratio: number;
  khmerCharCount: number;
} {
  const rawText = (candidateTranslatedText ?? page.translatedText ?? '').trim();
  const khmerCharCount = (rawText.match(/[\u1780-\u17FF]/g) || []).length;
  if (!rawText || khmerCharCount < 4) {
    return { isComplete: false, translatedBlocks: 0, totalBlocks: 1, ratio: 0, khmerCharCount };
  }

  const effectiveIsSrt = Boolean(
    page.isSrtChunk ||
      (page.srtCues && page.srtCues.length > 0) ||
      (page.originalText && page.originalText.includes('[SRT_'))
  );

  const sourceBlocks = extractSourceBlocksFromBatch(page.originalText || '', effectiveIsSrt).filter(
    (sb) =>
      (sb.sourceBody.match(/[a-zA-Z\u0900-\u097F\u4E00-\u9FFF\u1780-\u17FF]/g) || []).length > 0
  );
  const totalBlocks = Math.max(1, sourceBlocks.length);
  const translatedMap = extractTranslatedBlocksMap(rawText, effectiveIsSrt);

  if (effectiveIsSrt) {
    let translatedCount = 0;
    for (const sb of sourceBlocks) {
      const tr = translatedMap.get(sb.key);
      if (tr && tr.khmerChars >= 1) {
        translatedCount++;
      } else if (page.srtCues && page.srtCues.length > 0) {
        const matchingCue = page.srtCues.find((c) => c.id === sb.num);
        if (matchingCue?.translatedText && /[\u1780-\u17FF]/.test(matchingCue.translatedText)) {
          translatedCount++;
        }
      }
    }

    const lastBlock = sourceBlocks[sourceBlocks.length - 1];
    const lastBlockTranslated = lastBlock
      ? Boolean(
          (translatedMap.get(lastBlock.key)?.khmerChars || 0) >= 1 ||
            page.srtCues?.some(
              (c) =>
                c.id === lastBlock.num &&
                c.translatedText &&
                /[\u1780-\u17FF]/.test(c.translatedText)
            )
        )
      : true;

    const ratio = translatedCount / totalBlocks;
    const minBlocksRequired =
      totalBlocks <= 15 ? totalBlocks : Math.max(totalBlocks - 1, Math.ceil(totalBlocks * 0.96));
    const isComplete = translatedCount >= minBlocksRequired && lastBlockTranslated;

    return {
      isComplete,
      translatedBlocks: translatedCount,
      totalBlocks,
      ratio,
      khmerCharCount,
    };
  }

  // Story / Novel mode
  if (translatedMap.size > 0 && sourceBlocks.length > 0) {
    let translatedCount = 0;
    for (const sb of sourceBlocks) {
      const tr = translatedMap.get(sb.key);
      const sourceAlpha = (
        sb.sourceBody.match(/[a-zA-Z\u0900-\u097F\u4E00-\u9FFF\u1780-\u17FF]/g) || []
      ).length;
      const minChars = Math.min(8, Math.max(2, Math.floor(sourceAlpha * 0.1)));
      if (tr && tr.khmerChars >= minChars) {
        translatedCount++;
      }
    }
    const lastBlock = sourceBlocks[sourceBlocks.length - 1];
    const lastBlockTranslated = lastBlock
      ? (translatedMap.get(lastBlock.key)?.khmerChars || 0) >= 2
      : true;
    const ratio = translatedCount / totalBlocks;
    const minBlocksRequired =
      totalBlocks <= 12 ? totalBlocks : Math.max(totalBlocks - 1, Math.ceil(totalBlocks * 0.95));
    const minKhmerForPage = Math.max(10, Math.floor((page.charCount || 30) * 0.3));
    const isComplete =
      translatedCount >= minBlocksRequired &&
      lastBlockTranslated &&
      khmerCharCount >= minKhmerForPage;

    return {
      isComplete,
      translatedBlocks: translatedCount,
      totalBlocks,
      ratio,
      khmerCharCount,
    };
  }

  // Fallback when [P_X] tags were already stripped in stored text: require realistic Khmer character ratio
  const minRequiredKhmer = Math.max(15, Math.floor((page.charCount || 30) * 0.42));
  const ratio = Math.min(1, khmerCharCount / Math.max(1, minRequiredKhmer));
  return {
    isComplete: khmerCharCount >= minRequiredKhmer,
    translatedBlocks: khmerCharCount >= minRequiredKhmer ? totalBlocks : Math.floor(totalBlocks * ratio),
    totalBlocks,
    ratio,
    khmerCharCount,
  };
}

export function buildResilientSubBatches(
  chunkText: string,
  isSrt: boolean,
  maxSubBatchChars: number = 2500
): { formattedBatch: string; startNum: number; endNum: number }[] {
  if (!chunkText || !chunkText.trim()) return [];
  const effectiveIsSrt = Boolean(isSrt || chunkText.includes('[SRT_'));
  const sourceBlocks = extractSourceBlocksFromBatch(chunkText, effectiveIsSrt);

  if (sourceBlocks.length === 0) {
    return [{ formattedBatch: chunkText, startNum: 1, endNum: 1 }];
  }

  const batches: { formattedBatch: string; startNum: number; endNum: number }[] = [];
  let currentBlocks: SourceBlockItem[] = [];
  let currentLen = 0;

  for (let i = 0; i < sourceBlocks.length; i++) {
    const b = sourceBlocks[i];
    if (currentBlocks.length > 0 && currentLen + b.rawBlock.length > maxSubBatchChars) {
      batches.push({
        formattedBatch: currentBlocks.map((item) => item.rawBlock).join('\n\n'),
        startNum: currentBlocks[0].num,
        endNum: currentBlocks[currentBlocks.length - 1].num,
      });
      currentBlocks = [b];
      currentLen = b.rawBlock.length;
    } else {
      currentBlocks.push(b);
      currentLen += b.rawBlock.length;
    }
  }

  if (currentBlocks.length > 0) {
    batches.push({
      formattedBatch: currentBlocks.map((item) => item.rawBlock).join('\n\n'),
      startNum: currentBlocks[0].num,
      endNum: currentBlocks[currentBlocks.length - 1].num,
    });
  }

  return batches;
}

/**
 * Formats raw API errors (such as nested 503 JSON strings) into clean, friendly Khmer messages with zero parentheses.
 */
export function formatCleanKhmerError(rawError: unknown): string {
  const str =
    typeof rawError === 'string'
      ? rawError
      : (rawError as any)?.message || String(rawError || '');

  if (
    str.includes('503') ||
    str.includes('UNAVAILABLE') ||
    str.includes('high demand') ||
    str.includes('overloaded') ||
    str.includes('Service Unavailable')
  ) {
    return 'ម៉ាស៊ីនបកប្រែ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ មានអ្នកប្រើប្រាស់ច្រើនក្នុងពេលតែមួយ 503 High Demand — កំពុងបន្តបកប្រែបង្ហើយទំព័រនេះដោយស្វ័យប្រវត្តិ។';
  }

  if (
    str.includes('429') ||
    str.includes('RESOURCE_EXHAUSTED') ||
    str.toLowerCase().includes('quota')
  ) {
    return 'ម៉ាស៊ីនបកប្រែ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ ដល់កម្រិតល្បឿនបណ្ដោះអាសន្ន 429 — កំពុងបន្តបកប្រែបង្ហើយទំព័រនេះដោយស្វ័យប្រវត្តិ។';
  }

  if (str.trim().startsWith('{') && str.includes('"error"')) {
    return 'មានការរអាក់រអួលបណ្ដាញបណ្ដោះអាសន្ន — សូមចុចបកប្រែម្ដងទៀត ប្រព័ន្ធនឹងបន្តភ្លាមៗ។';
  }

  return (str || 'មានបញ្ហាក្នុងដំណើរការបកប្រែ សូមសាកល្បងម្ដងទៀត។').replace(/[()（）]/g, '');
}

/**
 * Splits an array of SrtCue objects into pages of 12,000 to 13,000 characters per page by default
 * (or by maxCuesPerPage if explicitly specified).
 * Renumbers cues sequentially (1, 2, 3...) without skipping any number, and preserves every cue
 * while keeping hardMaxLimit <= 50,000 characters.
 */
export function splitSrtIntoPages(cues: SrtCue[], options: ChunkOptions = {}): PageChunk[] {
  if (!cues || cues.length === 0) return [];

  const hardMaxLimit = Math.min(options.hardMaxLimit || ABSOLUTE_MAX_PAGE_CHARS, ABSOLUTE_MAX_PAGE_CHARS);
  const targetChars = Math.min(options.targetChars || 12500, hardMaxLimit);
  const maxChars = Math.min(options.maxChars || Math.max(targetChars + 500, 13000), hardMaxLimit);
  const minChars = Math.min(options.minChars || Math.max(1000, targetChars - 500), maxChars);
  const explicitMaxCues = options.maxCuesPerPage && options.maxCuesPerPage > 0 ? options.maxCuesPerPage : 0;

  const normalizedCues = cues.map((c, idx) => ({
    ...c,
    id: idx + 1,
  }));

  const pages: PageChunk[] = [];
  let currentPageCues: SrtCue[] = [];
  let currentDialogueChars = 0;
  let currentFormattedChars = 0;

  for (let i = 0; i < normalizedCues.length; i++) {
    const cue = normalizedCues[i];
    const dialogueText = (cue.originalText || '').trim();
    const dialogueLen = dialogueText.length + (currentPageCues.length > 0 ? 1 : 0);
    const formattedLen = `[SRT_${cue.id} | ${cue.timecode}]\n${cue.originalText}\n\n`.length;

    const reachedExplicitCueCap =
      explicitMaxCues > 0 && currentPageCues.length >= explicitMaxCues;

    const endsWithSentencePunct = /[.?!।។]["')\]»”’]?\s*$/.test(
      currentPageCues[currentPageCues.length - 1]?.originalText || ''
    );

    const reachedCharWindow =
      explicitMaxCues === 0 &&
      currentPageCues.length >= 1 &&
      (currentDialogueChars + dialogueLen > maxChars ||
        (currentDialogueChars >= minChars &&
          currentDialogueChars + dialogueLen >= targetChars &&
          endsWithSentencePunct));

    const reachedHardFormattedCeiling =
      currentPageCues.length >= 3 && currentFormattedChars + formattedLen >= 48000;

    if (reachedExplicitCueCap || reachedCharWindow || reachedHardFormattedCeiling) {
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
      currentDialogueChars = dialogueText.length;
      currentFormattedChars = formattedLen;
      continue;
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

/**
 * Cleans a single translated line/clause for pure Khmer paragraph output:
 * - Zero line numbers ([1], [2], [500]...)
 * - Zero citation tags ([cite:...], [source])
 * - Zero Thai characters (U+0E00–U+0E7F)
 * - Zero parentheses ( ) or brackets [ ] inside the text
 * - Zero timestamps
 * - Single-line normalized spaces
 */
export function cleanSingleBracketedLineText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\[\s*(?:cite|source)[^\]]*\]|【[^】]*】/gi, '')
    .replace(/\[\s*(?:SRT|អេសអាធី)[\s_]*[0-9០-៩]+(?:\s*\|[^\n\]]*)?\]:?/gi, '')
    .replace(/\[\s*(?:P|ភី)[0-9០-៩]+\s*\]:?/gi, '')
    .replace(/\[\s*[0-9០-៩]+\s*\]/g, ' ')
    .replace(
      /[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}\s*-->\s*[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}[^\n]*/g,
      ''
    )
    .replace(/[\u0E00-\u0E7F]+/g, '')
    .replace(/[()（）[\]{}<>"'“”‘’«»「」*_`#~]/g, ' ')
    .replace(/!+/g, '។')
    .replace(/\.{2,}/g, '។')
    .replace(/[។\s]*។[។\s]*/g, '។ ')
    .replace(/[?\s]*\?[?\s]*/g, '? ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats a single PageChunk as a pure continuous Khmer paragraph WITHOUT line numbers ([1], [2]...),
 * separated by a single space (' '), with zero timestamps, zero line breaks, zero parentheses, and zero Thai chars.
 */
export function formatPageAsBracketedSingleParagraph(
  page: PageChunk,
  startNumberOffset: number = 0
): { text: string; nextNumberOffset: number } {
  if (!page) return { text: '', nextNumberOffset: startNumberOffset };

  const isSrt = Boolean(
    page.isSrtChunk ||
      (page.srtCues && page.srtCues.length > 0) ||
      (page.originalText && page.originalText.includes('[SRT_'))
  );

  const segments: string[] = [];
  let currentOffset = startNumberOffset;

  if (page.srtCues && page.srtCues.length > 0) {
    const liveMap = page.translatedText
      ? extractTranslatedBlocksMap(page.translatedText, true)
      : null;

    for (let i = 0; i < page.srtCues.length; i++) {
      const cue = page.srtCues[i];
      const seqId = typeof cue.id === 'number' && cue.id > 0 ? cue.id : currentOffset + 1;
      currentOffset = Math.max(currentOffset, seqId);

      const rawText = (cue.translatedText || liveMap?.get(`SRT_${cue.id}`)?.body || '').trim();
      if (!rawText) continue;

      const cleaned = cleanSingleBracketedLineText(rawText);
      if (cleaned.length > 0) {
        segments.push(cleaned);
      }
    }
    return { text: segments.join(' '), nextNumberOffset: currentOffset };
  }

  // Fallback for raw [SRT_N] or [PN] blocks in page.translatedText
  const sourceBlocks = extractSourceBlocksFromBatch(
    formatPageAsTaggedBlocks(page.originalText || '', isSrt),
    isSrt
  );
  const translatedMap = extractTranslatedBlocksMap(page.translatedText || '', isSrt);

  if (translatedMap.size > 0 && sourceBlocks.length > 0) {
    for (let i = 0; i < sourceBlocks.length; i++) {
      const sb = sourceBlocks[i];
      const rawEntry = translatedMap.get(sb.key);
      if (!rawEntry || !rawEntry.body) continue;
      const cleaned = cleanSingleBracketedLineText(rawEntry.body);
      if (cleaned.length > 0) {
        segments.push(cleaned);
      }
    }
    return {
      text: segments.join(' '),
      nextNumberOffset: currentOffset + sourceBlocks.length,
    };
  }

  // Fallback if translatedText has plain lines
  if (page.translatedText && page.translatedText.trim().length > 0) {
    const lines = page.translatedText
      .split(/\n+/)
      .map((l) => cleanSingleBracketedLineText(l))
      .filter((l) => l.length > 0);
    for (const line of lines) {
      currentOffset += 1;
      segments.push(line);
    }
  }

  return { text: segments.join(' '), nextNumberOffset: currentOffset };
}

/**
 * Formats all translated pages into a pure continuous Khmer paragraph WITHOUT line numbers ([1], [2]...):
 * Strictly contains ZERO line numbers, ZERO headers, ZERO character lists, ZERO timestamps, ZERO parentheses, and ZERO Thai characters.
 */
export function formatPagesAsBracketedSingleParagraph(pages: PageChunk[]): string {
  if (!pages || pages.length === 0) return '';

  const pageSegments: string[] = [];
  let runningOffset = 0;

  for (let i = 0; i < pages.length; i++) {
    const { text, nextNumberOffset } = formatPageAsBracketedSingleParagraph(
      pages[i],
      runningOffset
    );
    runningOffset = nextNumberOffset;
    if (text.length > 0) {
      pageSegments.push(text);
    }
  }

  return pageSegments.join(' ').trim();
}


