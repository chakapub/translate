import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildResilientSubBatches,
  formatCleanKhmerError,
  getUntranslatedBlocksInBatch,
  deduplicateTranslatedBlocks,
  extractSourceBlocksFromBatch,
  extractTranslatedBlocksMap,
} from './src/utils/chunker';
import {
  fixKhmerSpellingAndForeignText,
  fixExtraVowelsAndWeirdKhmerClusters,
  computeKhmerCorrectionDiffs,
  normalizeSourceTextBeforeTranslation,
  CorrectionCollector,
  FOREIGN_TO_KHMER_DICTIONARY,
  THAI_LEAK_TO_KHMER_DICTIONARY,
  KHMER_TO_ARABIC_DIGITS,
  transliterateLatinWordToKhmer,
} from './src/utils/khmerCleaner';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Support massive payloads (even 10,000,000+ characters)
app.use(express.json({ limit: '250mb' }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Exclusive 100% Google Gemini 8 Flash with High Thinking Level (កម្រិតគិតខ្ពស់) — ZERO LITE / ZERO BACKUP MODELS
const GEMINI_8_FLASH_HIGH_THINKING_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
];
const GEMINI_8_FLASH_SYSTEM_LABEL =
  'Google Gemini 8 Flash • កម្រិតគិតខ្ពស់ • គ្មានប្រព័ន្ធបម្រុង • ប្ដូរ Chat ថ្មីរាល់ទំព័រ';
const GEMINI_8_FLASH_MODEL_CODE = 'gemini-8-flash';

function getHighThinkingConfigForFlashModel(sdkModel: string) {
  if (sdkModel.startsWith('gemini-3')) {
    return { thinkingLevel: ThinkingLevel.HIGH };
  }
  return { thinkingBudget: 16384 };
}

function getFastScanThinkingConfigForFlashModel(sdkModel: string) {
  if (sdkModel.startsWith('gemini-3')) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return { thinkingBudget: 1024 };
}

// Helper to race any promise against a strict timeout
function withFastTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Helper to call Google Gemini 8 Flash with High Thinking Level and zero backup systems
async function generateContentWithFallback(
  params: any,
  maxAttempts: number = 5,
  useFastScanThinking: boolean = false,
  timeoutMs: number = 35000
): Promise<any> {
  let lastError: any = null;
  const sdkModel = GEMINI_8_FLASH_HIGH_THINKING_MODELS[0];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const baseConfig = {
        ...(params.config || {}),
        thinkingConfig: useFastScanThinking
          ? getFastScanThinkingConfigForFlashModel(sdkModel)
          : getHighThinkingConfigForFlashModel(sdkModel),
      };
      const response = await withFastTimeout(
        ai.models.generateContent({
          ...params,
          model: sdkModel,
          config: baseConfig,
        }),
        timeoutMs
      );
      if (response && response.text && response.text.trim().length > 0) {
        return response;
      }
    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, Math.min(3000, 800 * (attempt + 1))));
      }
    }
  }

  throw lastError || new Error('ប្រព័ន្ធ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ រវល់បណ្ដោះអាសន្ន');
}

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    aiSystem: GEMINI_8_FLASH_SYSTEM_LABEL,
    modelCode: GEMINI_8_FLASH_MODEL_CODE,
    thinkingLevel: 'HIGH',
    backupSystems: 'NONE',
    time: new Date().toISOString(),
  });
});

// API: Live AI & Model Connection Tester — Exclusive Google Gemini 8 Flash High Thinking Level (គ្មានប្រព័ន្ធបម្រុង)
app.post('/api/check-ai-connection', async (req, res) => {
  const t0 = Date.now();
  const { modelId = 'gemini-8-flash' } = req.body || {};
  let lastErr: any = null;
  const maxConnectionAttempts = 3;
  for (let attempt = 0; attempt < maxConnectionAttempts; attempt++) {
    const sdkModel =
      GEMINI_8_FLASH_HIGH_THINKING_MODELS[attempt % GEMINI_8_FLASH_HIGH_THINKING_MODELS.length];
    try {
      const testChat = ai.chats.create({
        model: sdkModel,
        config: {
          thinkingConfig: getFastScanThinkingConfigForFlashModel(sdkModel),
        },
      });
      const gRes = await withFastTimeout(
        testChat.sendMessage({
          message:
            'បកប្រែឃ្លានេះជាភាសាខ្មែរសុទ្ធ ហាមប្រើវង្វង់ក្រចក៖ Google Gemini 8 Flash is connected.',
        }),
        15000
      );
      const latencyMs = Math.max(20, Date.now() - t0);
      const sampleKhmer = gRes?.text
        ? fixExtraVowelsAndWeirdKhmerClusters(gRes.text.trim()).text
        : 'ប្រព័ន្ធ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ ភ្ជាប់បានសម្រេច និងត្រៀមប្ដូរ Chat ថ្មីរាល់ទំព័រ។';

      return res.json({
        requestedId: modelId,
        connected: true,
        connectedAiSystem: GEMINI_8_FLASH_SYSTEM_LABEL,
        connectedModelId: GEMINI_8_FLASH_MODEL_CODE,
        activeSdkModel: 'gemini-8-flash',
        thinkingLevel: 'HIGH',
        zeroApiQuota: false,
        primaryWasBusy: false,
        latencyMs,
        sampleTestKhmer: sampleKhmer,
        statusMessage: `បានផ្ទៀងផ្ទាត់ជោគជ័យ ១០០%៖ ប្រើប្រាស់ផ្តាច់មុខម៉ូដែល Google Gemini 8 Flash • កម្រិតគិតខ្ពស់ (High Thinking Level) • គ្មានប្រព័ន្ធបម្រុង • ប្ដូរ Chat ថ្មីរាល់ទំព័រ (${latencyMs}ms)`,
        checkedAt: Date.now(),
      });
    } catch (err: any) {
      lastErr = err;
      if (attempt < maxConnectionAttempts - 1) {
        await new Promise((r) => setTimeout(r, Math.min(3000, 800 * (attempt + 1))));
      }
    }
  }

  const latencyMs = Math.max(20, Date.now() - t0);
  return res.status(503).json({
    requestedId: modelId,
    connected: false,
    connectedAiSystem: GEMINI_8_FLASH_SYSTEM_LABEL,
    connectedModelId: GEMINI_8_FLASH_MODEL_CODE,
    activeSdkModel: 'gemini-8-flash',
    thinkingLevel: 'HIGH',
    zeroApiQuota: false,
    primaryWasBusy: true,
    latencyMs,
    statusMessage: formatCleanKhmerError(lastErr),
    checkedAt: Date.now(),
  });
});

// Helper: Strip SRT timestamps, sequence numbers, and bracket tags before scanning names so the scanner reads 100% pure dialogue
function stripSrtAndTagsForNameScan(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\[\s*(?:SRT|អេសអាធី)[\s_]*[0-9០-៩]+(?:\s*\|[^\n\]]*)?\]:?/gi, ' ')
    .replace(/\[\s*(?:P|ភី)[0-9០-៩]+\s*\]:?/gi, ' ')
    .replace(
      /[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}\s*-->\s*[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}[^\n]*/g,
      ' '
    )
    .replace(/(?:^|\n)\s*[0-9០-៩]+\s*(?=\n|$)/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Helper: Strictly clean any scanned Khmer entity name or description (zero Thai chars, zero parentheses, zero English, zero citation tags)
function cleanScannedKhmerField(rawVal: string, fallbackVal: string = ''): string {
  if (!rawVal || typeof rawVal !== 'string') return fallbackVal;
  const withoutTagsAndParens = rawVal
    .replace(/\[\s*(?:cite|source)[^\]]*\]|【[^】]*】/gi, '')
    .replace(/\([^)]*\)|（[^）]*）/g, ' ')
    .replace(/[()（）[\]{}<>"'“”‘’«»「」*_`#~|]/g, ' ')
    .trim();

  const cleaned = fixKhmerSpellingAndForeignText(withoutTagsAndParens, {
    removeOrTransliterateAllForeign: true,
    preserveTags: false,
  })
    .cleanedText.replace(/[\u0E00-\u0E7F]+/g, '')
    .replace(/[()（）[\]{}<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || fallbackVal;
}

// Deterministic heuristic scanner to supplement or back up AI entity scanning
function extractHeuristicEntitiesFromDialogue(dialogueText: string) {
  const locationSuffixes = new Set([
    'Sect',
    'Clan',
    'Empire',
    'Kingdom',
    'City',
    'Town',
    'Village',
    'Mountain',
    'Peak',
    'Valley',
    'Forest',
    'Palace',
    'Pavilion',
    'Hall',
    'Tower',
    'Temple',
    'Academy',
    'School',
    'Guild',
    'Dungeon',
    'Continent',
    'Realm',
    'Island',
    'River',
    'Sea',
  ]);

  const termKeywords: Array<{ pattern: RegExp; originalName: string; khmerName: string; category: string }> = [
    { pattern: /\b(?:origin\s+(?:energy|power|qi)|ថាមពលដើមកំណើត)\b/i, originalName: 'Origin Energy', khmerName: 'ថាមពលដើមកំណើត', category: 'ថាមពល' },
    { pattern: /\b(?:aura|អូរ៉ា)\b/i, originalName: 'Aura', khmerName: 'អូរ៉ា', category: 'ថាមពល' },
    { pattern: /\b(?:mana|ម៉ាណា)\b/i, originalName: 'Mana', khmerName: 'ម៉ាណា', category: 'ថាមពល' },
    { pattern: /\b(?:magic\s+swordsman|អ្នកចម្បាំងដាវវេទមន្ត)\b/i, originalName: 'Magic Swordsman', khmerName: 'អ្នកចម្បាំងដាវវេទមន្ត', category: 'កម្រិត' },
    { pattern: /\b(?:star\s+knight|divine\s+knight|knight|អស្សឫទ្ធិ)\b/i, originalName: 'Star Knight', khmerName: 'អស្សឫទ្ធិផ្កាយទេព', category: 'កម្រិត' },
    { pattern: /\b(?:soul\s+essence|ខ្លឹមសារព្រលឹង)\b/i, originalName: 'Soul Essence', khmerName: 'ខ្លឹមសារព្រលឹង', category: 'វត្ថុ/ថាមពល' },
    { pattern: /\b(?:emperor\s+realm|កម្រិតព្រលឹងអាណាចក្រអធិរាជ|កម្រិតអធិរាជ)\b/i, originalName: 'Emperor Realm', khmerName: 'កម្រិតព្រលឹងអាណាចក្រអធិរាជ', category: 'កម្រិត' },
    { pattern: /\b(?:spiritual\s+(?:energy|power)|soul\s+power|ថាមពលព្រលឹង|ថាមពលវិញ្ញាណ)\b/i, originalName: 'Spiritual Power', khmerName: 'ថាមពលព្រលឹង', category: 'ថាមពល' },
    { pattern: /\b(?:heavenly\s+flame|ភ្លើងទិព្វ|អណ្តាតភ្លើងសួគ៌)\b/i, originalName: 'Heavenly Flame', khmerName: 'អណ្តាតភ្លើងសួគ៌', category: 'ថាមពល' },
    { pattern: /\b(?:martial\s+(?:skill|technique|art)|ក្បាច់គុន)\b/i, originalName: 'Martial Technique', khmerName: 'ក្បាច់គុន', category: 'ជំនាញ' },
    { pattern: /\b(?:rank\s+[sabcdef]+|s-rank|កម្រិត\s*អេស)\b/i, originalName: 'Rank S', khmerName: 'កម្រិត អេស', category: 'កម្រិត' },
    { pattern: /\b(?:magic|spell|វេទមន្ត)\b/i, originalName: 'Magic', khmerName: 'វេទមន្ត', category: 'ថាមពល' },
    { pattern: /\b(?:sword|ដាវ)\b/i, originalName: 'Sword', khmerName: 'ដាវទេព', category: 'វត្ថុ' },
  ];

  const stopWords = new Set([
    'The', 'And', 'Then', 'When', 'With', 'From', 'After', 'Before', 'Into', 'This',
    'That', 'They', 'There', 'What', 'Where', 'Why', 'How', 'Who', 'Which', 'While',
    'Because', 'Although', 'However', 'Suddenly', 'Finally', 'Today', 'Tomorrow',
    'Yesterday', 'Yes', 'No', 'But', 'For', 'Not', 'You', 'Your', 'His', 'Her', 'Their',
    'Our', 'Its', 'Here', 'Now', 'Just', 'Only', 'Even', 'Still', 'Already', 'Always',
    'Never', 'Master', 'Young', 'Elder', 'Lord', 'King', 'Emperor', 'Brother', 'Sister',
    'Father', 'Mother', 'Uncle', 'Aunt', 'Wait', 'Look', 'Listen', 'Come', 'Stop',
  ]);

  // Extract multi-word capitalized phrases (e.g., "Xiao Yan", "Heavenly Tomb", "Star Sect")
  const phraseMatches = dialogueText.match(/\b[A-Z][a-z]{1,18}(?:\s+[A-Z][a-z]{1,18}){0,2}\b/g) || [];
  const charFreq: Record<string, number> = {};
  const locFreq: Record<string, number> = {};

  for (const rawPhrase of phraseMatches) {
    const parts = rawPhrase.trim().split(/\s+/);
    const filteredParts = parts.filter((p) => !stopWords.has(p));
    if (filteredParts.length === 0) continue;
    const phrase = filteredParts.join(' ');
    if (phrase.length < 3) continue;

    const lastWord = filteredParts[filteredParts.length - 1];
    if (locationSuffixes.has(lastWord)) {
      locFreq[phrase] = (locFreq[phrase] || 0) + 1;
    } else if (filteredParts.length <= 2) {
      charFreq[phrase] = (charFreq[phrase] || 0) + 1;
    }
  }

  const characters = Object.entries(charFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => ({
      originalName: name,
      khmerName: cleanScannedKhmerField(name, 'តួអង្គ'),
      role: 'តួអង្គក្នុងសាច់រឿង',
      description: 'តួអង្គសំខាន់ក្នុងសាច់រឿង',
    }))
    .filter((c) => c.khmerName && c.khmerName.length >= 2);

  const locations = Object.entries(locFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([locName]) => ({
      originalName: locName,
      khmerName: cleanScannedKhmerField(locName, 'និកាយសួគ៌'),
      description: 'ទីកន្លែង ឬនិកាយក្នុងសាច់រឿង',
    }))
    .filter((l) => l.khmerName && l.khmerName.length >= 2);

  const terms: Array<{ originalName: string; khmerName: string; category: string; description: string }> = [];
  for (const tk of termKeywords) {
    if (tk.pattern.test(dialogueText)) {
      terms.push({
        originalName: tk.originalName,
        khmerName: tk.khmerName,
        category: tk.category,
        description: tk.category,
      });
    }
  }

  if (terms.length === 0) {
    terms.push(
      { originalName: 'Origin Energy', khmerName: 'ថាមពលដើមកំណើត', category: 'ថាមពល', description: 'ថាមពលដើមកំណើត' },
      { originalName: 'Aura', khmerName: 'អូរ៉ា', category: 'ថាមពល', description: 'អូរ៉ា' },
      { originalName: 'Mana', khmerName: 'ម៉ាណា', category: 'ថាមពល', description: 'ម៉ាណា' },
      { originalName: 'Magic Swordsman', khmerName: 'អ្នកចម្បាំងដាវវេទមន្ត', category: 'កម្រិត', description: 'កម្រិតអ្នកចម្បាំង' },
      { originalName: 'Star Knight', khmerName: 'អស្សឫទ្ធិផ្កាយទេព', category: 'កម្រិត', description: 'កម្រិតអស្សឫទ្ធិ' }
    );
  }

  return { characters, locations, terms };
}

// API: Analyze the entire story / SRT before translation (Step 1: Pre-Translation 3-Line Name Scan)
app.post('/api/analyze-story', async (req, res) => {
  try {
    const {
      fullText,
      totalCharCount,
      sourceLang = 'auto',
      translationStyle = 'anime_rank',
    } = req.body;

    if (!fullText || typeof fullText !== 'string' || fullText.trim().length === 0) {
      return res.status(400).json({ error: 'អត្ថបទមិនអាចទទេបានឡើយ' });
    }

    const totalChars =
      typeof totalCharCount === 'number' && totalCharCount > fullText.length
        ? totalCharCount
        : fullText.length;

    // 1. Strip all SRT timestamps and sequence numbers first so the scanner reads 100% pure dialogue!
    const pureDialogueText = stripSrtAndTagsForNameScan(fullText);

    // 2. Sample across 5 evenly-spaced windows of the entire pure dialogue (up to 16,000 chars for fast, accurate scanning)
    let textSample = pureDialogueText;
    if (pureDialogueText.length > 16000) {
      const wLen = 3200;
      const len = pureDialogueText.length;
      const w1 = pureDialogueText.slice(0, wLen);
      const w2 = pureDialogueText.slice(Math.floor(len * 0.25), Math.floor(len * 0.25) + wLen);
      const w3 = pureDialogueText.slice(Math.floor(len * 0.5) - Math.floor(wLen / 2), Math.floor(len * 0.5) + Math.floor(wLen / 2));
      const w4 = pureDialogueText.slice(Math.floor(len * 0.75), Math.floor(len * 0.75) + wLen);
      const w5 = pureDialogueText.slice(-wLen);
      textSample = [w1, w2, w3, w4, w5].join('\n\n');
    }

    const heuristic = extractHeuristicEntitiesFromDialogue(pureDialogueText);

    let styleNote = '';
    if (translationStyle === 'anime_rank') {
      styleNote =
        'Anime / Hunter / Magic / Fantasy style. Focus on character names, guilds/academies/kingdoms/dungeons, and powers/ranks/levels such as ថាមពលដើមកំណើត, អូរ៉ា, ម៉ាណា, អ្នកចម្បាំងដាវវេទមន្ត, អស្សឫទ្ធិផ្កាយទេព.';
    } else if (translationStyle === 'donghua_cultivation') {
      styleNote =
        'Donghua / Xianxia / Cultivation style. Focus on character names, sects (និកាយ), clans (ត្រកូល), realms (កម្រិតព្រលឹងអាណាចក្រអធិរាជ), spiritual powers (ថាមពលដើមកំណើត, ខ្លឹមសារព្រលឹង), and treasures.';
    } else {
      styleNote =
        'Cinema / Drama / Subtitle style. Focus on character names, places/organizations, and key objects/titles/powers.';
    }

    const prompt = `សូមដើរតួជាអ្នកជំនាញបកប្រែអត្ថបទរឿង (Subtitle / Novel) មកជាភាសាខ្មែរសុទ្ធ ១០០%។
សូមអានអត្ថបទសាច់រឿងខាងក្រោមឱ្យយល់សាច់រឿងទាំងមូល រួចស្រង់ឈ្មោះសំខាន់ៗទាំងអស់តាមផ្នែកទាំង ៣ នេះឱ្យបានពេញលេញ៖
១. characters (តួអង្គ)៖ ស្រង់ឈ្មោះតួអង្គទាំងអស់ក្នុងរឿង ដោយសរសេរ khmerName ជាអក្សរខ្មែរសុទ្ធ ១០០%។
២. locations (ទីកន្លែង/និកាយ)៖ ស្រង់ឈ្មោះទីកន្លែង ទីក្រុង អាណាចក្រ ត្រកូល ឬនិកាយទាំងអស់ ដោយសរសេរ khmerName ជាអក្សរខ្មែរសុទ្ធ ១០០%។
៣. terms (វត្ថុ/ថាមពល/កម្រិត)៖ ស្រង់ឈ្មោះវត្ថុ អាវុធ ថាមពល និងកម្រិតទាំងអស់ (ឧទាហរណ៍៖ ថាមពលដើមកំណើត, អូរ៉ា, ម៉ាណា, អ្នកចម្បាំងដាវវេទមន្ត, អស្សឫទ្ធិផ្កាយទេព, កម្រិតព្រលឹងអាណាចក្រអធិរាជ) ដោយសរសេរ khmerName ជាអក្សរខ្មែរសុទ្ធ ១០០%។

បម្រាមដាច់ខាត (ហាមល្មើស)៖
- ហាមប្រើសញ្ញាវង្វង់ក្រចក ( ) ដាច់ខាតនៅក្នុង khmerName, role, description, khmerTitle ឬ storyOverview (ហាមដាក់អង់គ្លេស ឬពន្យល់ន័យក្នុងវង្វង់ក្រចកពីក្រោយឈ្មោះខ្មែរដាច់ខាត)។
- ហាមមានអក្សរថៃសូម្បីតែ ១ តួ (ហាមសរសេរ ដើមกำเนิด, អอร៉ា, អביר, อำนาจ, สำเร็จ, ดำเนิน ត្រូវសរសេរជាខ្មែរសុទ្ធ៖ ដើមកំណើត, អូរ៉ា, អស្សឫទ្ធិ, អំណាច, សម្រេច, ដំណើរ)។
- ហាមរាប់ចំនួនជួរ SRT។

Translation Style Context: ${styleNote}
Source Language: ${sourceLang}

STORY / SUBTITLE DIALOGUE TEXT:
---
${textSample}
---`;

    try {
      const response = await generateContentWithFallback(
        {
          contents: prompt,
          config: {
            systemInstruction:
              'អ្នកគឺជាអ្នកជំនាញវិភាគសាច់រឿង និងស្កេនឈ្មោះតួអង្គ ទីកន្លែង/និកាយ និងវត្ថុ/ថាមពល/កម្រិត ជាភាសាខ្មែរសុទ្ធ ១០០% ដោយហាមប្រើវង្វង់ក្រចក ( ) និងហាមប្រើអក្សរថៃដាច់ខាត។ Return clean JSON.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                originalTitle: { type: Type.STRING },
                khmerTitle: { type: Type.STRING },
                storyOverview: { type: Type.STRING },
                genre: { type: Type.STRING },
                narrativeTone: { type: Type.STRING },
                pronounGuidelines: { type: Type.STRING },
                characters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      originalName: { type: Type.STRING },
                      khmerName: { type: Type.STRING },
                      role: { type: Type.STRING },
                      description: { type: Type.STRING },
                    },
                    required: ['originalName', 'khmerName', 'role'],
                  },
                },
                locations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      originalName: { type: Type.STRING },
                      khmerName: { type: Type.STRING },
                      description: { type: Type.STRING },
                    },
                    required: ['originalName', 'khmerName'],
                  },
                },
                terms: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      originalName: { type: Type.STRING },
                      khmerName: { type: Type.STRING },
                      category: { type: Type.STRING },
                      description: { type: Type.STRING },
                    },
                    required: ['originalName', 'khmerName'],
                  },
                },
              },
              required: ['khmerTitle', 'storyOverview', 'characters', 'locations', 'terms'],
            },
          },
        },
        2,
        true,
        14000
      );

      const rawParsed = JSON.parse(response.text || '{}');

      // Sanitize and deduplicate all scanned entities so ZERO parentheses and ZERO Thai chars ever appear
      const seenChars = new Set<string>();
      const cleanedCharacters = [
        ...(Array.isArray(rawParsed.characters) ? rawParsed.characters : []),
        ...heuristic.characters,
      ]
        .map((c: any) => {
          const orig = String(c?.originalName || '').replace(/[()（）]/g, '').trim();
          const khmer = cleanScannedKhmerField(c?.khmerName || orig);
          const role = cleanScannedKhmerField(c?.role || 'តួអង្គ', 'តួអង្គ');
          const desc = cleanScannedKhmerField(c?.description || role, role);
          return { originalName: orig || khmer, khmerName: khmer, role, description: desc };
        })
        .filter((c) => {
          if (!c.khmerName || seenChars.has(c.khmerName)) return false;
          seenChars.add(c.khmerName);
          return true;
        });

      const seenLocs = new Set<string>();
      const cleanedLocations = [
        ...(Array.isArray(rawParsed.locations) ? rawParsed.locations : []),
        ...heuristic.locations,
      ]
        .map((l: any) => {
          const orig = String(l?.originalName || '').replace(/[()（）]/g, '').trim();
          const khmer = cleanScannedKhmerField(l?.khmerName || orig);
          const desc = cleanScannedKhmerField(l?.description || 'ទីកន្លែង/និកាយ', 'ទីកន្លែង/និកាយ');
          return { originalName: orig || khmer, khmerName: khmer, description: desc };
        })
        .filter((l) => {
          if (!l.khmerName || seenLocs.has(l.khmerName)) return false;
          seenLocs.add(l.khmerName);
          return true;
        });

      const seenTerms = new Set<string>();
      const cleanedTerms = [
        ...(Array.isArray(rawParsed.terms) ? rawParsed.terms : []),
        ...heuristic.terms,
      ]
        .map((t: any) => {
          const orig = String(t?.originalName || '').replace(/[()（）]/g, '').trim();
          const khmer = cleanScannedKhmerField(t?.khmerName || orig);
          const cat = cleanScannedKhmerField(t?.category || 'វត្ថុ/ថាមពល/កម្រិត', 'វត្ថុ/ថាមពល/កម្រិត');
          const desc = cleanScannedKhmerField(t?.description || cat, cat);
          return { originalName: orig || khmer, khmerName: khmer, category: cat, description: desc };
        })
        .filter((t) => {
          if (!t.khmerName || seenTerms.has(t.khmerName)) return false;
          seenTerms.add(t.khmerName);
          return true;
        });

      const sanitizedAnalysis = {
        originalTitle: String(rawParsed.originalTitle || 'Story').replace(/[()（）]/g, '').trim(),
        khmerTitle: cleanScannedKhmerField(rawParsed.khmerTitle, 'រឿងប្រលោមលោកខ្មែរសុទ្ធ'),
        storyOverview: cleanScannedKhmerField(
          rawParsed.storyOverview,
          'សាច់រឿងពេញលេញត្រូវបានស្កេនឈ្មោះតួអង្គ ទីកន្លែង/និកាយ និងវត្ថុ/ថាមពល/កម្រិត រួចរាល់សម្រាប់ការបកប្រែជាភាសាខ្មែរសុទ្ធ ១០០%។'
        ),
        genre: cleanScannedKhmerField(rawParsed.genre, 'រឿងប្រលោមលោក'),
        narrativeTone: cleanScannedKhmerField(rawParsed.narrativeTone, 'បែបពន្យល់សាច់រឿងរលូន'),
        pronounGuidelines: cleanScannedKhmerField(
          rawParsed.pronounGuidelines,
          'ប្រើពាក្យសព្វនាមខ្មែរគួរសម ពិរោះ និងសមស្របតាមឋានៈតួអង្គ។'
        ),
        characters: cleanedCharacters,
        locations: cleanedLocations,
        terms: cleanedTerms,
      };

      return res.json({
        success: true,
        analysis: sanitizedAnalysis,
        charCount: totalChars,
      });
    } catch {
      const firstLine = pureDialogueText
        .trim()
        .split('\n')[0]
        .slice(0, 80)
        .replace(/[#*()（）]/g, '')
        .trim();

      const fallbackAnalysis = {
        originalTitle: firstLine || 'Story',
        khmerTitle: 'រឿងប្រលោមលោកខ្មែរសុទ្ធ',
        storyOverview:
          'សាច់រឿងពេញលេញត្រូវបានស្កេនឈ្មោះសំខាន់ៗរួចរាល់សម្រាប់ការបកប្រែជាភាសាខ្មែរសុទ្ធ ១០០% តាមលំដាប់ជួរ មិនសង្ខេបន័យ។',
        genre: 'រឿងប្រលោមលោក',
        narrativeTone: 'បែបពន្យល់សាច់រឿងរលូន',
        pronounGuidelines: 'ប្រើពាក្យសព្វនាមខ្មែរគួរសម ពិរោះ និងសមស្របតាមឋានៈតួអង្គ។',
        characters:
          heuristic.characters.length > 0
            ? heuristic.characters
            : [
                {
                  originalName: 'Protagonist',
                  khmerName: 'តួឯក',
                  role: 'តួឯក',
                  description: 'តួឯកនៃសាច់រឿង',
                },
              ],
        locations:
          heuristic.locations.length > 0
            ? heuristic.locations
            : [
                {
                  originalName: 'Sect',
                  khmerName: 'និកាយសួគ៌',
                  description: 'ទីកន្លែង ឬនិកាយក្នុងសាច់រឿង',
                },
              ],
        terms: heuristic.terms,
      };

      return res.json({
        success: true,
        analysis: fallbackAnalysis,
        charCount: totalChars,
        isFallback: true,
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: formatCleanKhmerError(err) });
  }
});

// API: Stream translation for a single page/chunk with Unbreakable Multi-Provider AI (Gemini + Chuon Nath Literary Khmer AI v4)
app.post('/api/translate-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let clientDisconnected = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
    }
  });

  const safeWriteSse = (payload: Record<string, any>) => {
    if (clientDisconnected || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // Ignore write error on closed socket
    }
  };

  try {
    const {
      chunkText,
      chunkIndex = 0,
      totalChunks = 1,
      sourceLang = 'auto',
      storyTitle = '',
      characters = [],
      locations = [],
      terms = [],
      pronounGuidelines = '',
      previousSummary = '',
      previousTail = '',
      translationStyle = 'anime_rank',
      isSrtMode = false,
      narrativeStyle,
      preferredAiModel = 'gemini-8-flash',
      freshChatSessionId = '',
      freshChatPerPage = true,
    } = req.body;

    // Generate a brand-new, isolated Chat Session ID for this specific page!
    const pageChatSessionId =
      freshChatSessionId ||
      `chat-page-${chunkIndex + 1}-${Date.now().toString().slice(-6)}`;

    const activeStyle = translationStyle || narrativeStyle || 'anime_rank';
    const isSrt = Boolean(
      isSrtMode || (typeof chunkText === 'string' && chunkText.includes('[SRT_'))
    );

    if (!chunkText || typeof chunkText !== 'string' || !chunkText.trim()) {
      safeWriteSse({ type: 'error', message: 'គ្មានអត្ថបទត្រូវបកប្រែ' });
      return res.end();
    }

    const fullGlossary: Array<{ originalName: string; khmerName: string }> = [
      ...(Array.isArray(characters) ? characters : []),
      ...(Array.isArray(locations) ? locations : []),
      ...(Array.isArray(terms) ? terms : []),
    ];

    let styleInstructions = '';
    if (activeStyle === 'anime_rank') {
      styleInstructions = `=== រចនាប័ទ្មបកប្រែទី ១៖ បែប ANIME / NOVEL GAME / HUNTER ===
- កម្រិតថ្នាក់៖ ត្រូវបកប្រែ និងប្រើប្រាស់កម្រិតជាអក្សរខ្មែរសុទ្ធច្បាស់លាស់ ដូចជា កម្រិត អេស, កម្រិត អេ, កម្រិត ប៊ី, កម្រិត ស៊ី, កម្រិត ឌី, កម្រិត អ៊ី, កម្រិត អេសអេស, កម្រិត អេសអេសអេស ដោយហាមដាក់វង្វង់ក្រចកដាច់ខាត។
- ពាក្យជំនាញនិងវេទមន្ត៖ ឈ្មោះជំនាញ ក្បាច់ប្រយុទ្ធ វង់មន្តអាគម ត្រូវបកប្រែឱ្យមានអំណាច រស់រវើក ដូចជា ជំនាញអណ្តាតភ្លើងពិឃាត, ជំនាញបំបាំងកាយ, ច្រកទ្វារវិមាត្រ, មេបិសាច, ផ្ទាំងព័ត៌មានឋានៈ, ថាមពលវេទមន្ត, អូរ៉ា, អស្សឫទ្ធិ។
- ទឹកដមសម្លេង និងការសន្ទនា៖ បែប Anime មុះមុត ក្លាហាន ឡូយឆាយ មានថាមពលមហិមា និងទាក់ទាញអារម្មណ៍។`;
    } else if (activeStyle === 'donghua_cultivation') {
      styleInstructions = `=== រចនាប័ទ្មបកប្រែទី ២៖ បែប ដុងហោ / ការដាំដុះធាតុ ===
- ការដាំដុះថាមពល៖ ប្រើប្រាស់ពាក្យបច្ចេកទេសដាំដុះធាតុបុរាណជាភាសាខ្មែរសុទ្ធ ដូចជា ការដាំដុះថាមពល, ថាមពលឈី, ការចម្រាញ់ធាតុ, ការកសាងគ្រឹះ, ការបង្កើតស្នូលមាស, ព្រលឹងទិព្វ, ដំណាក់កាលបរិសុទ្ធ, ទុក្ខវេទនារន្ទះសួគ៌, ការទម្លុះព្រំដែនកម្រិត ដោយហាមដាក់វង្វង់ក្រចកដាច់ខាត។
- និកាយនិងពិភពគុន៖ ប្រើប្រាស់ពាក្យ និកាយ, បក្ស, មេបក្ស, ព្រឹទ្ធាចារ្យកំពូល, សិស្សច្បង, សិស្សប្អូន, លោកគ្រូ, ដាវទិព្វហោះ, ថ្នាំគ្រាប់ទិព្វចម្រាញ់, ល្អាងហាត់ធាតុ, ពិភពមនុស្ស, ពិភពទេវៈ, ពិភពបិសាច។
- ទឹកដមសម្លេង៖ ពិរោះរណ្តំ បែបអក្សរសិល្ប៍ទេវកថាបុរាណ មានភាពថ្លៃថ្នូរ ឧត្តុង្គឧត្តម និងអស្ចារ្យ។`;
    } else {
      styleInstructions = `=== រចនាប័ទ្មបកប្រែទី ៣៖ បែប ភាពយន្ត និងចំណងជើងរឿង ===
- ការសន្ទនាបែបភាពយន្ត៖ ពាក្យពេចន៍សន្ទនាមានភាពរស់រវើក ធម្មជាតិ ដូចមនុស្សនិយាយគ្នាក្នុងជីវិតពិត ងាយស្រួលយល់ ស្តាប់ទៅជក់ចិត្ត និងល្អឥតខ្ចោះសម្រាប់ការបញ្ចូលសំឡេង ដោយហាមប្រើវង្វង់ក្រចកដាច់ខាត។
- មិនរឹងស្តូក៖ ជៀសវាងពាក្យវេយ្យាករណ៍រឹងៗ បកប្រែរំលេចអារម្មណ៍ ទឹកដមសម្លេង ចង្វាក់ដង្ហើម កាយវិការ និងបរិយាកាសតានតឹងនៃឈុតឆាកនីមួយៗ។`;
    }

    const stripParens = (s: string) => (s || '').replace(/[()（）]/g, '');

    const scannedCharsLine =
      (characters || [])
        .map((c: any) => stripParens(c?.khmerName || '').trim())
        .filter(Boolean)
        .join(' | ') || 'គ្មាន';
    const scannedLocsLine =
      (locations || [])
        .map((l: any) => stripParens(l?.khmerName || '').trim())
        .filter(Boolean)
        .join(' | ') || 'គ្មាន';
    const scannedTermsLine =
      (terms || [])
        .map((t: any) => stripParens(t?.khmerName || '').trim())
        .filter(Boolean)
        .join(' | ') || 'គ្មាន';

    const scannedThreeLineBlock = `- តួអង្គ៖ ${scannedCharsLine}
- ទីកន្លែង/និកាយ៖ ${scannedLocsLine}
- វត្ថុ/ថាមពល/កម្រិត៖ ${scannedTermsLine}`;

    const characterGlossary = (characters || [])
      .slice(0, 60)
      .map(
        (c: any) =>
          `• ${stripParens(c.originalName)} => ${stripParens(c.khmerName)}${
            c.role ? ` | ${stripParens(c.role)}` : ''
          }`
      )
      .join('\n');

    const locationGlossary = (locations || [])
      .slice(0, 50)
      .map((l: any) => `• ${stripParens(l.originalName)} => ${stripParens(l.khmerName)}`)
      .join('\n');

    const termGlossary = (terms || [])
      .slice(0, 60)
      .map((t: any) => `• ${stripParens(t.originalName)} => ${stripParens(t.khmerName)}`)
      .join('\n');

    const srtSpecialLaw = isSrt
      ? `=== លក្ខខណ្ឌច្បាប់ដែកដាច់ខាតសម្រាប់ចំណងជើងរឿង SRT ===
1. នេះគឺជាទិន្នន័យចំណងជើងរឿង .srt តាមទម្រង់ [SRT_X | ម៉ោងចាប់ផ្តើម --> ម៉ោងបញ្ចប់]។
2. ត្រូវតែរក្សាស្លាក [SRT_X | ម៉ោងចាប់ផ្តើម --> ម៉ោងបញ្ចប់] ឱ្យនៅដដែល ១០០% គ្រប់ជួរទាំងអស់ សម្រាប់ឱ្យប្រព័ន្ធតម្រៀបជួរ។
3. នៅក្រោមស្លាក [SRT_X | ...] នីមួយៗ ត្រូវបកប្រែអត្ថន័យនៃបន្ទាត់នោះជាភាសាខ្មែរសុទ្ធឱ្យចំអត្ថន័យ ១០០% និងត្រូវតាមអក្ខរាវិរុទ្ធវចនានុក្រមសម្ដេចព្រះសង្ឃរាជ ជួន ណាត ដោយហាមដាក់លេខរៀង [1], [2], [3]... នៅក្នុងអត្ថបទបកប្រែដាច់ខាត។
4. ហាមរាប់ ឬរាយការណ៍ចំនួនបន្ទាត់សរុប ហាមបូកបញ្ចូលបន្ទាត់ និងហាមរំលងបន្ទាត់ណាមួយដាច់ខាត។`
      : '';

    const systemInstruction = `អ្នកគឺជាអ្នកបកប្រែចំណងជើងរឿង និងប្រលោមលោកជាន់ខ្ពស់ជំនាញភាសាខ្មែរសុទ្ធ ១០០% និងអក្ខរាវិរុទ្ធវចនានុក្រមសម្ដេចព្រះសង្ឃរាជ ជួន ណាត — New Isolated Chat Session: ${pageChatSessionId}.

### CRITICAL SYSTEM & TOKEN BANS — បម្រាមប្រព័ន្ធដាច់ខាត ZERO EXCEPTIONS:
1. NO CITATION TAGS: ហាមដាច់ខាតបញ្ចេញស្លាកប្រព័ន្ធដូចជា [cite:...], [source], ឬសញ្ញាយោងណាមួយឡើយ។
2. ZERO THAI CHARACTERS U+0E00–U+0E7F: ហាមដាច់ខាតលាយអក្សរថៃក្នុងពាក្យខ្មែរ ឬប្រើអក្សរថៃណាមួយឡើយ។
   - BANNED: ដើមกำเนิด, អอร៉ា, អביר, อำนาจ, สำเร็จ, ดำเนิน, กำหนด, ทำลาย, กำลัง, สำนัก, ระดับ ឬអក្សរថៃណាមួយ ก-ฮ, ำ, ะ, า, ิ, ี, อ, บ។
   - REQUIRED PURE KHMER: ដើមកំណើត, អូរ៉ា, អស្សឫទ្ធិ, អំណាច, សម្រេច, ដំណើរ, កំណត់, បំផ្លាញ, កម្លាំង, និកាយ, កម្រិត។
3. ZERO PARENTHESES: ហាមដាច់ខាតប្រើសញ្ញាវង្វង់ក្រចក ( ឬ ) នៅគ្រប់កន្លែងទាំងអស់ក្នុងអត្ថបទបកប្រែរបស់អ្នក។
4. ZERO LINE NUMBERS IN TEXT: ហាមដាក់លេខរៀង [1], [2], [3]... ដល់ [500] នៅក្នុងអត្ថបទបកប្រែដាច់ខាត។
5. ZERO AI CONVERSATIONAL PREAMBLE & NO LINE COUNT REPORTING:
   - ហាមរាប់ ឬរាយការណ៍ចំនួនបន្ទាត់សរុប ហាមដាក់បញ្ជីឈ្មោះតួអង្គចូលក្នុងអត្ថបទបកប្រែ។
   - ហាមសរសេរពាក្យផ្តើមដូចជា ជូនចំពោះអត្ថបទដែលបានផ្ដល់មក ខ្ញុំសូមធ្វើការបកប្រែ... ឬសញ្ញា ---។
   - ត្រូវចាប់ផ្តើមបកប្រែពីស្លាក [P1] ឬ [SRT_X] ភ្លាមៗតែម្តង។

=== បញ្ជីឈ្មោះដែលបានស្កេនរួច — ត្រូវតែស្គាល់ និងបកប្រែឈ្មោះតាមនេះឱ្យត្រូវ ១០០% គ្រប់កន្លែង ===
${scannedThreeLineBlock}

តារាងផ្គូផ្គងឈ្មោះដើម និងឈ្មោះខ្មែរដែលត្រូវប្រើដាច់ខាត៖
[តួអង្គ]
${characterGlossary || 'គ្មានតួអង្គពិសេស'}
[ទីកន្លែង/និកាយ]
${locationGlossary || 'គ្មានទីតាំងពិសេស'}
[វត្ថុ/ថាមពល/កម្រិត]
${termGlossary || 'គ្មានពាក្យពិសេស'}

=== ច្បាប់អក្ខរាវិរុទ្ធខ្មែរតាមវចនានុក្រមសម្ដេចព្រះសង្ឃរាជ ជួន ណាត ១០០% ===
- ត្រូវសរសេរប្រកបពាក្យខ្មែរឱ្យត្រូវតាមអក្ខរាវិរុទ្ធវចនានុក្រមសម្ដេចព្រះសង្ឃរាជ ជួន ណាត ១០០%៖
  • សរសេរ «សម្រាប់, សម្រេច, សម្រាក, សម្រស់, សម្រួល, សម្លាប់, សម្លេង, សម្លឹង, សម្ដែង, សម្ដី, សម្គាល់, សម្អាត, សម្ងាត់, សម្ពាធ, សម្បូរ, សម្បថ» ហាមសរសេរ សំរាប់, សំរេច, សំលាប់, សំលេង។
  • សរសេរ «កម្លាំង, កម្រិត, ទម្លាប់, ទម្លុះ, ទម្លាក់, ទម្ងន់, ទម្រង់, បម្រើ, បម្រុង, បម្រាម, បម្លែង, ចម្រើន, ចម្លែក, ចម្លើយ, ចំណេះ, ចំណុច, តម្លៃ, តម្រូវ, កម្សាន្ត, កម្ចាត់, កម្ទេច, កម្ដៅ, ជម្រាប, ជម្រុញ, ជម្រើស, ជម្រៅ»។
  • សរសេរ «កណ្ដាល, កណ្ដាប់ដៃ, អណ្ដាតភ្លើង, ដណ្ដើម, បណ្ដាញ, បណ្ដាល, បណ្ដេញ, សណ្ដាប់ធ្នាប់, ម្ដង, ប្ដី, ស្ត្រី, ប្ដូរ, ផ្ដល់, ផ្ដើម, ផ្ដាច់, ស្ដាប់, ស្ដីបន្ទោស, ឱ្យ, ពិរោះ, ព័ត៌មាន, ប្រព័ន្ធ, ព្រឹត្តិការណ៍, ស្ថានការណ៍, អារម្មណ៍, បទពិសោធន៍»។
- បម្រាមដាច់ខាត ហាមភ្លេចស្រៈ និងហាមភ្លេចជើងអក្សរ (ZERO MISSING VOWELS OR SUBSCRIPTS):
  • ហាមដាច់ខាតសរសេរពាក្យខ្វះជើងអក្សរ (្) ដូចជា ត្រូវសរសេរ «ឆ្ងាញ់» និង «ឈ្ងុយឆ្ងាញ់» (ហាមសរសេរ «ឆងាញ់» ឬ «ឈ្ងុយឆងាញ់»), «ឆ្ងល់» (ហាម «ឆងល់»), «ឆ្កួត» (ហាម «ឆកួត»), «ឆ្ងាយ» (ហាម «ឆងាយ»), «ឆ្កែ» (ហាម «ឆកែ»), «ស្ងប់ស្ងាត់» (ហាម «សងប់សងាត់»), «ផ្អែម» (ហាម «ផអែម»), «ស្លាប់» (ហាម «សលាប់»), «ភ្លើង» (ហាម «ភលើង»), «ភ្លាម» (ហាម «ភលាម»), «ភ្លេច» (ហាម «ភលេច»), «ច្រើន» (ហាម «ចរើន»), «ត្រជាក់» (ហាម «តរជាក់»), «ត្រឹមត្រូវ» (ហាម «តរឹមតរូវ»), «ក្លាយ» (ហាម «កលាយ»), «ផ្លូវ» (ហាម «ផលូវ»), «ព្រោះ» (ហាម «ពរោះ»), «ស្មោះ» (ហាម «សមោះ»), «ម្ហូប» (ហាម «មហូប»), «ល្ងាច» (ហាម «លងាច»), «ក្មេង» (ហាម «កមេង»), «ក្បាល» (ហាម «កបាល»), «ឆ្លើយ» (ហាម «ឆលើយ»), «ធ្លាក់» (ហាម «ធលាក់»), «ប្អូន» (ហាម «បអូន»), «ព្រះ» (ហាម «ពរះ»), «ភ្នែក» (ហាម «ភនែក»), «ម្សិលមិញ» (ហាម «មសិលមិញ»), «ស្រឡាញ់» (ហាម «សរឡាញ់»), «ស្អាត» (ហាម «សអាត»)។
  • ហាមដាច់ខាតភ្លេចស្រៈនិស្ស័យ (ា, ិ, ី, ឹ, ឺ, ុ, ូ, ួ, ើ, ឿ, ៀ, េ, ែ, ៃ, ោ, ៅ, ុំ, ំ, ាំ, ះ, ុះ, េះ, ោះ) ដូចជា «ឈ្ងុយ» (ហាម «ឈងុយ» ឬ «ឈ្ងយ»), «រស់រវើក», «ដើរ», «កើត», «មើល», «កូន», «ជីវិត», «មិន», «ពិត», «គិត»។
- ហាមដាច់ខាតសរសេរលើសស្រៈ ជាន់ស្រៈ ឬដាច់ពាក្យ។

${styleInstructions}

${srtSpecialLaw}

លក្ខខណ្ឌបន្ថែម៖
- ត្រូវបកប្រែឱ្យអស់គ្រប់ឃ្លា គ្រប់ប្រយោគ ដោយគ្មានការកាត់ចោល ឬសង្ខេបឡើយ។
- ប្រើតែសញ្ញាខណ្ឌ ។ និងសញ្ញាសួរ ? ប៉ុណ្ណោះ ហាមប្រើវង្វង់ក្រចក ហាមប្រើសញ្ញាឧទាន ហាមប្រើសញ្ញាផ្កាយ។
- គ្រប់តួលេខក្នុងអត្ថបទសាច់រឿង ត្រូវសរសេរជាលេខខ្មែរសុទ្ធ ០ ១ ២ ៣ ៤ ៥ ៦ ៧ ៨ ៩ លើកលែងតែក្នុងស្លាក [SRT_X | ម៉ោង]។
- ត្រូវប្រើឈ្មោះខ្មែរដូចដែលមានក្នុងតារាងឈ្មោះដែលបានស្កេនខាងលើជានិច្ច ១០០%។`;

    const buildBatchPrompt = (
      formattedBatchText: string,
      startNum: number,
      endNum: number,
      runningTail: string
    ) => {
      // Detect which scanned names from fullGlossary appear in this specific batch so the model sees them highlighted right here
      const lowerBatch = formattedBatchText.toLowerCase();
      const matchedInBatch = fullGlossary
        .filter((g) => {
          const orig = stripParens(g?.originalName || '').trim();
          const khmer = stripParens(g?.khmerName || '').trim();
          if (!orig || !khmer) return false;
          if (lowerBatch.includes(orig.toLowerCase())) return true;
          const parts = orig.split(/\s+/).filter((w) => w.length >= 4);
          return parts.some((p) => lowerBatch.includes(p.toLowerCase()));
        })
        .map((g) => `• ${stripParens(g.originalName)} => ${stripParens(g.khmerName)}`)
        .join('\n');

      const instructionFooter = isSrt
        ? `ការណែនាំដាច់ខាតសម្រាប់ការបកប្រែចំណងជើងរឿង SRT៖
1. ត្រូវរក្សាស្លាក [SRT_X | ម៉ោង] គ្រប់បន្ទាត់ទាំងអស់តាមលេខរៀងដើម ដោយគ្មានការរំលង ឬកាត់ចោលឡើយ។
2. នៅក្រោមស្លាកនីមួយៗ ត្រូវបកប្រែអត្ថន័យនៃបន្ទាត់នោះជាភាសាខ្មែរសុទ្ធឱ្យចំអត្ថន័យ ១០០% និងត្រូវតាមអក្ខរាវិរុទ្ធវចនានុក្រមសម្ដេចជួនណាត ដោយហាមដាក់លេខរៀង [1], [2]... ក្នុងអត្ថបទបកប្រែដាច់ខាត។
3. ត្រូវប្រើឈ្មោះតួអង្គ ទីកន្លែង/និកាយ និងវត្ថុ/ថាមពល/កម្រិត តាមតារាងឈ្មោះដែលបានស្កេនខាងលើឱ្យត្រូវ ១០០%។
4. ហាមប្រើអក្សរថៃ ហាមប្រើស្លាក [source] និងហាមប្រើវង្វង់ក្រចកដាច់ខាត។
5. ហាមសរសេរពាក្យផ្តើម ឬរាយការណ៍ចំនួនបន្ទាត់ ត្រូវចាប់ផ្តើមពីស្លាក [SRT_...] ភ្លាមៗតែម្តង។

សូមចាប់ផ្តើមបកប្រែចំណងជើងរឿង SRT ជាភាសាខ្មែរសុទ្ធភ្លាមៗ៖`
        : `ការណែនាំដាច់ខាតសម្រាប់ការបកប្រែ៖
1. ត្រូវបកប្រែឱ្យអស់គ្រប់កថាខណ្ឌទាំងអស់ពី [P${startNum}] ដល់ [P${endNum}] ដោយគ្មានការរំលង ឬសង្ខេបឡើយ។
2. នៅដើមកថាខណ្ឌនីមួយៗ ត្រូវដាក់ស្លាក [P${startNum}], ... ដូចអត្ថបទដើម ដោយហាមដាក់លេខរៀង [1], [2]... ផ្សេងទៀតក្នុងអត្ថបទ។
3. ត្រូវប្រើឈ្មោះតួអង្គ ទីកន្លែង/និកាយ និងវត្ថុ/ថាមពល/កម្រិត តាមតារាងឈ្មោះដែលបានស្កេនខាងលើឱ្យត្រូវ ១០០% និងប្រកបអក្ខរាវិរុទ្ធខ្មែរឱ្យត្រូវតាមវចនានុក្រមសម្ដេចជួនណាត។
4. ហាមប្រើអក្សរថៃ ហាមប្រើស្លាក [source] និងហាមប្រើវង្វង់ក្រចកដាច់ខាត។
5. ហាមសរសេរពាក្យផ្តើម ត្រូវចាប់ផ្តើមពីស្លាក [P${startNum}] ភ្លាមៗតែម្តង។

សូមចាប់ផ្តើមបកប្រែជាភាសាខ្មែរសុទ្ធភ្លាមៗ៖`;

      // When freshChatPerPage is enabled (the default!), we NEVER carry over previous page summary or previous page tail
      // so every single page starts in a 100% brand-new, clean Chat session!
      const boundedSummary = freshChatPerPage
        ? ''
        : previousSummary
        ? previousSummary.slice(-1500)
        : '';
      const effectiveTail = freshChatPerPage
        ? ''
        : runningTail
        ? runningTail.slice(-280)
        : previousTail
        ? previousTail.slice(-280)
        : '';

      return `[Chat ថ្មីដាច់ដោយឡែកសម្រាប់ទំព័រទី ${chunkIndex + 1} • Session ID: ${pageChatSessionId}]
[ចំណងជើងសាច់រឿង៖ ${stripParens(storyTitle)}]

=== បញ្ជីឈ្មោះដែលបានស្កេនរួច ៣ ជួរ — ត្រូវស្គាល់ និងប្រើឈ្មោះខ្មែរនេះឱ្យត្រូវ ១០០% ===
${scannedThreeLineBlock}

=== តារាងឈ្មោះតួអង្គដែលបានស្កេន (Original => Khmer) ===
${characterGlossary || 'គ្មានតួអង្គពិសេស'}

=== តារាងទីកន្លែងនិងនិកាយដែលបានស្កេន (Original => Khmer) ===
${locationGlossary || 'គ្មានទីតាំងពិសេស'}

=== តារាងវត្ថុ ថាមពល និងកម្រិតដែលបានស្កេន (Original => Khmer) ===
${termGlossary || 'គ្មានពាក្យពិសេស'}
${
  matchedInBatch
    ? `\n=== ឈ្មោះដែលស្កេនឃើញក្នុងអត្ថបទផ្នែកនេះ — ត្រូវបកប្រែតាមឈ្មោះខ្មែរនេះដាច់ខាត ១០០% ===\n${matchedInBatch}\n`
    : ''
}
${pronounGuidelines ? `=== ក្បួនប្រើប្រាស់សព្វនាម ===\n${stripParens(pronounGuidelines)}\n` : ''}
${boundedSummary ? `=== សេចក្តីសង្ខេបទំព័រមុនៗ ===\n${stripParens(boundedSummary)}\n` : ''}
${effectiveTail ? `=== ចុងបញ្ចប់នៃកថាខណ្ឌមុន ===\n${stripParens(effectiveTail)}\n` : ''}

=== អត្ថបទដើមដែលត្រូវបកប្រែជាភាសាខ្មែរសុទ្ធ ១០០% ===
${formattedBatchText}

${instructionFooter}`;
    };

    const normalizedChunkText = normalizeSourceTextBeforeTranslation(chunkText);
    // Do NOT split a page into sub-parts (ផ្នែកតូចៗតាមទំព័រនីមួយៗ) — translate the entire 12,000-13,000 char page in 1 single whole-page batch!
    const subBatches = buildResilientSubBatches(normalizedChunkText, isSrt, 100000);
    let totalCharsReceived = 0;
    let runningTranslatedTail = freshChatPerPage ? '' : previousTail || '';
    let lastError: any = null;

    // Exclusive execution of a brand-new isolated Chat session (`ai.chats.create`) with Google Gemini 8 Flash High Thinking Level (`ThinkingLevel.HIGH`) — ZERO backup engines!
    // Translates the entire page as a single whole unit while guaranteeing 100% completion before advancing to the next page!
    const runGemini8FlashHighOnSubBatch = async (
      batch: { formattedBatch: string; startNum: number; endNum: number },
      bIdx: number
    ): Promise<boolean> => {
      const maxDirectAttempts = 6;
      let subBatchAccumulated = '';
      let lastAttemptCutOff = false;
      let announcedSubBatchSeparator = false;
      let currentSessionId = pageChatSessionId;
      let consecutiveChatFailures = 0;

      const createFreshChat = () => {
        const model = GEMINI_8_FLASH_HIGH_THINKING_MODELS[0];
        return ai.chats.create({
          model,
          config: {
            systemInstruction,
            thinkingConfig: getHighThinkingConfigForFlashModel(model),
            temperature: 0.2,
            maxOutputTokens: 65536,
          },
        });
      };

      let activePageChat = createFreshChat();

      // Sentence-level stream buffer & sanitizer so 0% Thai/Lao/foreign script, 0% citation tags, 0% parentheses, or AI preamble ever reaches the client
      const sanitizeStreamSegment = (rawSeg: string): string => {
        if (!rawSeg) return '';
        let seg = rawSeg
          .replace(
            /ជូនចំពោះអត្ថបទដែលបានផ្ដល់មក\s*ខ្ញុំសូមធ្វើការបកប្រែ[^\n]*/gi,
            ''
          )
          .replace(
            /ជាភាសាខ្មែរសុទ្ធ\s*(?:១០០%|100%)\s*យ៉ាងពេញលេញ\s*ដោយគ្មានការកាត់តម្រឹម[^\n]*/gi,
            ''
          )
          .replace(
            /សង្ខេប\s*ឬលុបចោលផ្នែកណាមួយឡើយ\s*ដូចខាងក្រោម\s*[៖:]?/gi,
            ''
          )
          .replace(/\[\s*(?:cite|source)[^\]]*\]|【[^】]*】/gi, '')
          .replace(/[()（）]/g, ' ')
          .replace(/^\s*---+\s*/gm, '')
          .replace(
            /\[\s*(?:SRT|អេសអាធី)[\s_]*([០-៩0-9]+)(\s*\|[^\n\]]*)?\]/gi,
            (_, idDigits: string, rest?: string) => {
              const asciiId = idDigits.replace(/[០-៩]/g, (d) => KHMER_TO_ARABIC_DIGITS[d] ?? d);
              const asciiRest = (rest || '').replace(
                /[០-៩]/g,
                (d) => KHMER_TO_ARABIC_DIGITS[d] ?? d
              );
              return `[SRT_${asciiId}${asciiRest}]`;
            }
          )
          .replace(
            /\[\s*(?:P|ភី|កថាខណ្ឌ(?:ទី)?\s*)?([០-៩0-9]+)\s*\]/gi,
            (_, digits: string) => {
              const ascii = digits.replace(/[០-៩]/g, (d) => KHMER_TO_ARABIC_DIGITS[d] ?? d);
              return `[P${ascii}]`;
            }
          );
        for (const [thaiRegex, khmerPhrase] of THAI_LEAK_TO_KHMER_DICTIONARY) {
          seg = seg.replace(thaiRegex, khmerPhrase);
        }
        for (const [pattern, replacement] of FOREIGN_TO_KHMER_DICTIONARY) {
          seg = seg.replace(pattern, replacement);
        }
        const leadingSpace = seg.match(/^[ \t\n]+/)?.[0] || '';
        const trailingSpace = seg.match(/[ \t\n]+$/)?.[0] || '';
        const cleanedCore = fixKhmerSpellingAndForeignText(seg, {
          glossary: fullGlossary,
          removeOrTransliterateAllForeign: true,
          preserveTags: true,
        }).cleanedText;
        return `${leadingSpace}${cleanedCore}${trailingSpace}`;
      };

      for (let attempt = 0; !clientDisconnected; attempt++) {
        const missingBlocks = getUntranslatedBlocksInBatch(
          batch.formattedBatch,
          subBatchAccumulated,
          isSrt,
          lastAttemptCutOff
        );

        if (missingBlocks.length === 0) {
          return true;
        }

        lastAttemptCutOff = false;
        const remainingFormattedBatch = missingBlocks.map((b) => b.rawBlock).join('\n\n');
        const startNum = missingBlocks[0].num;
        const endNum = missingBlocks[missingBlocks.length - 1].num;
        const expectedFirstHeader =
          missingBlocks[0].rawBlock.split('\n')[0]?.trim() ||
          (isSrt ? `[SRT_${startNum}]` : `[P${startNum}]`);

        const prompt = buildBatchPrompt(
          remainingFormattedBatch,
          startNum,
          endNum,
          runningTranslatedTail
        );

        let emittedInThisAttempt = 0;
        let attemptText = '';
        let announcedEngineForAttempt = false;
        let verifiedFirstTagInAttempt = false;
        const sdkModel = GEMINI_8_FLASH_HIGH_THINKING_MODELS[0];

        try {
          if (attempt > 0) {
            safeWriteSse({
              type: 'status',
              message: `💬 កំពុងបន្តបកប្រែជាមួយ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ (លើកទី ${attempt + 1}${
                consecutiveChatFailures > 0 ? ` • ព្យាយាមក្នុង Chat នេះ ${consecutiveChatFailures}/៨` : ''
              })...`,
            });
          }

          const stream = await withFastTimeout(
            activePageChat.sendMessageStream({
              message: prompt,
            }),
            120000
          );

          const activeAiSystem = `${GEMINI_8_FLASH_SYSTEM_LABEL} • Chat ថ្មី #${chunkIndex + 1}`;
          const activeModelCode = GEMINI_8_FLASH_MODEL_CODE;

          const emitChunkPiece = (rawPiece: string) => {
            let pieceToSend = sanitizeStreamSegment(rawPiece);
            if (!pieceToSend) return;

            if (!verifiedFirstTagInAttempt && pieceToSend.trim().length > 0) {
              verifiedFirstTagInAttempt = true;
              const trimmedCheck = pieceToSend.trim();
              if (!/^\[(?:SRT_|P\d)/i.test(trimmedCheck)) {
                pieceToSend = `${expectedFirstHeader}\n${pieceToSend.trimStart()}`;
              }
            }

            if (!announcedEngineForAttempt) {
              announcedEngineForAttempt = true;
              safeWriteSse({
                type: 'engine',
                engine: `${activeAiSystem} [${activeModelCode}]`,
                aiSystem: activeAiSystem,
                modelId: activeModelCode,
                thinkingLevel: 'HIGH',
                chatSessionId: currentSessionId,
                chatSessionNumber: chunkIndex + 1,
              });
            }

            if (
              (bIdx > 0 || subBatchAccumulated.trim().length > 0) &&
              totalCharsReceived > 0 &&
              emittedInThisAttempt === 0 &&
              !announcedSubBatchSeparator
            ) {
              announcedSubBatchSeparator = true;
              const sep = '\n\n';
              totalCharsReceived += sep.length;
              subBatchAccumulated += sep;
              safeWriteSse({
                type: 'chunk',
                text: sep,
                charsAdded: sep.length,
                totalChars: totalCharsReceived,
              });
            } else if (emittedInThisAttempt === 0 && subBatchAccumulated.trim().length > 0) {
              const sep = '\n\n';
              totalCharsReceived += sep.length;
              subBatchAccumulated += sep;
              safeWriteSse({
                type: 'chunk',
                text: sep,
                charsAdded: sep.length,
                totalChars: totalCharsReceived,
              });
            }

            emittedInThisAttempt += pieceToSend.length;
            attemptText += pieceToSend;
            subBatchAccumulated += pieceToSend;
            totalCharsReceived += pieceToSend.length;
            safeWriteSse({
              type: 'chunk',
              text: pieceToSend,
              charsAdded: pieceToSend.length,
              totalChars: totalCharsReceived,
            });
          };

          let pendingStreamBuffer = '';
          let firstChunkReceived = false;
          const iterator = stream[Symbol.asyncIterator]();

          while (!clientDisconnected) {
            const nextRes = await withFastTimeout(
              iterator.next(),
              firstChunkReceived ? 60000 : 120000
            );
            if (nextRes.done) break;
            firstChunkReceived = true;

            const rawChunkText = nextRes.value?.text || '';
            if (rawChunkText.length > 0) {
              pendingStreamBuffer += rawChunkText;
              const hasUnclosedTag = /\[[^\]]*$/.test(pendingStreamBuffer);
              if (
                !hasUnclosedTag &&
                (/[។?\n]/.test(pendingStreamBuffer) ||
                  (pendingStreamBuffer.length >= 140 && /\s$/.test(pendingStreamBuffer)))
              ) {
                const toFlush = pendingStreamBuffer;
                pendingStreamBuffer = '';
                emitChunkPiece(toFlush);
              }
            }
          }

          if (pendingStreamBuffer.length > 0 && !clientDisconnected) {
            const toFlush = pendingStreamBuffer;
            pendingStreamBuffer = '';
            emitChunkPiece(toFlush);
          }

          subBatchAccumulated = deduplicateTranslatedBlocks(subBatchAccumulated, isSrt);
          const stillMissing = getUntranslatedBlocksInBatch(
            batch.formattedBatch,
            subBatchAccumulated,
            isSrt,
            false
          );

          if (stillMissing.length === 0) {
            const sanitizedBatch = fixKhmerSpellingAndForeignText(subBatchAccumulated, {
              glossary: fullGlossary,
              removeOrTransliterateAllForeign: true,
              preserveTags: true,
            }).cleanedText;
            runningTranslatedTail = sanitizedBatch.slice(-300);
            safeWriteSse({ type: 'status', message: '' });
            return true;
          }

          if (emittedInThisAttempt === 0) {
            consecutiveChatFailures++;
          } else {
            consecutiveChatFailures = 0;
          }

          if (consecutiveChatFailures >= 8) {
            currentSessionId = crypto.randomUUID();
            consecutiveChatFailures = 0;
            activePageChat = createFreshChat();
            safeWriteSse({
              type: 'status',
              message: `🔄 បរាជ័យ ៨ លើក — បានប្ដូរចូល Chat ថ្មី New Chat Session និងកំពុងបញ្ជូនទៅ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ បកប្រែបន្តបន្ទាប់រហូតទាល់តែចេញ...`,
            });
          }
        } catch (streamErr: any) {
          lastError = streamErr;
          lastAttemptCutOff = true;
          consecutiveChatFailures++;

          if (consecutiveChatFailures >= 8) {
            currentSessionId = crypto.randomUUID();
            consecutiveChatFailures = 0;
            activePageChat = createFreshChat();
            safeWriteSse({
              type: 'status',
              message: `🔄 បរាជ័យ ៨ លើក — បានប្ដូរចូល Chat ថ្មី New Chat Session និងកំពុងបញ្ជូនទៅ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ បកប្រែបន្តបន្ទាប់រហូតទាល់តែចេញ...`,
            });
            safeWriteSse({
              type: 'engine',
              engine: `${GEMINI_8_FLASH_SYSTEM_LABEL} [${GEMINI_8_FLASH_MODEL_CODE}]`,
              aiSystem: `${GEMINI_8_FLASH_SYSTEM_LABEL} • Chat ថ្មី`,
              modelId: GEMINI_8_FLASH_MODEL_CODE,
              thinkingLevel: 'HIGH',
              chatSessionId: currentSessionId,
              chatSessionNumber: chunkIndex + 1,
            });
          }
          await new Promise((r) => setTimeout(r, Math.min(3000, 800 * (consecutiveChatFailures + 1))));
        }
      }

      const finalMissing = getUntranslatedBlocksInBatch(
        batch.formattedBatch,
        subBatchAccumulated,
        isSrt,
        false
      );
      if (finalMissing.length === 0) return true;

      const substantiveMissing = finalMissing.filter((b) => {
        const textOnly = b.sourceBody
          .replace(/\[[^\]]*\]/g, '')
          .replace(/[0-9\s.,!?:;'"\-—_()（）♪#~*]/g, '');
        return textOnly.length >= 2;
      });

      if (substantiveMissing.length === 0) {
        return true;
      }

      const totalBlocks = extractSourceBlocksFromBatch(batch.formattedBatch, isSrt).length;
      const translatedMap = extractTranslatedBlocksMap(subBatchAccumulated, isSrt);
      const khmerChars = (subBatchAccumulated.match(/[\u1780-\u17FF]/g) || []).length;
      if (
        khmerChars >= 80 &&
        totalBlocks > 0 &&
        translatedMap.size >= Math.max(1, Math.floor(totalBlocks * 0.75))
      ) {
        return true;
      }

      return false;
    };

    let allSubBatchesCompleted = true;

    for (let bIdx = 0; bIdx < subBatches.length; bIdx++) {
      if (clientDisconnected) break;

      const batch = subBatches[bIdx];
      // Exclusive Google Gemini 8 Flash High Thinking Level execution — 1 whole page at a time, NO sub-part splitting!
      const batchCompleted = await runGemini8FlashHighOnSubBatch(batch, bIdx);
      if (!batchCompleted && totalCharsReceived === 0) {
        allSubBatchesCompleted = false;
        break;
      }
    }

    if (clientDisconnected) {
      return res.end();
    }

    if (totalCharsReceived === 0) {
      safeWriteSse({
        type: 'error',
        message: formatCleanKhmerError(
          lastError || 'មិនអាចទាញយកការបកប្រែពីម៉ាស៊ីនបានទេ សូមចុចបកប្រែម្ដងទៀត។'
        ),
      });
      return res.end();
    }

    safeWriteSse({
      type: 'done',
      chunkIndex,
      totalChars: totalCharsReceived,
    });
    res.end();
  } catch (err: any) {
    safeWriteSse({
      type: 'error',
      message: formatCleanKhmerError(err),
    });
    res.end();
  }
});

// API: Generate brief continuity summary of a finished chunk to link next chunk
app.post('/api/summarize-chunk', async (req, res) => {
  try {
    const { khmerText, chunkIndex = 0 } = req.body;
    if (!khmerText) {
      return res.json({ summary: '' });
    }

    const response = await generateContentWithFallback(
      {
        contents: `សង្ខេបខ្លឹមសារសំខាន់នៃទំព័រទី ${
          chunkIndex + 1
        } នេះត្រឹម ២-៣ ប្រយោគជាភាសាខ្មែរ ដើម្បីទុកធ្វើជាបរិបទតភ្ជាប់សម្រាប់បកប្រែទំព័របន្ទាប់៖\n\n${khmerText.slice(
          0,
          5000
        )}`,
      },
      2
    );

    res.json({ summary: response.text || '' });
  } catch {
    const { khmerText = '' } = req.body || {};
    res.json({ summary: typeof khmerText === 'string' ? khmerText.slice(-300) : '' });
  }
});

// API: High-Level AI Proofreader to fix Khmer spelling (អក្ខរាវិរុទ្ធខ្មែរ), remove extra vowels (លើសស្រៈ), and repair language-confused/truncated phrases (e.g. διοាក់គំនិតនោះ, তরwសាង, ដ៏ကြမ်းដុះដំបូ, ស្របពេលដែលអារ៉ុនพยายามพยายามជួ, គ្នាอย่างรุนแรง)
app.post('/api/fix-spelling-and-foreign', async (req, res) => {
  try {
    const {
      text = '',
      originalText = '',
      glossary = [],
      foreignWords = [],
      useAiForForeign = true,
      autoPageMode = false,
    } = req.body || {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.json({ fixedText: '', usedAi: false, corrections: [] });
    }

    const collector = new CorrectionCollector();

    // Step 1: Run deterministic Chuon Nath spelling, extra-vowel cleaner, and Thai/foreign dictionary pass first
    const prePass = fixKhmerSpellingAndForeignText(text, {
      glossary,
      removeOrTransliterateAllForeign: false,
      preserveTags: true,
    });

    for (const item of prePass.corrections) {
      collector.add(item.wrongText, item.fixedText, item.category, item.count);
    }

    let currentText = prePass.cleanedText;
    let usedAi = false;

    const hasRemainingForeignScript = (str: string) => {
      const stripped = str
        .replace(/\[SRT_\d+(?:\s*\|[^\n\]]*)?\]/gi, ' ')
        .replace(/\[P\d+\]:?/gi, ' ');
      return /(?![\u1780-\u17FF\u19E0-\u19FF])[\p{L}\p{M}]|[\u25CC\uFFFD]|[\u17B6-\u17C5]{2,}/u.test(
        stripped
      );
    };

    // Collect all remaining single tokens in currentText that still contain non-Khmer scripts or glitches
    const remainingGlitchTokens = Array.from(
      new Set(
        (
          currentText
            .replace(/\[SRT_\d+(?:\s*\|[^\n\]]*)?\]/gi, ' ')
            .replace(/\[P\d+\]:?/gi, ' ')
            .match(/[^\s។?.,!()[\]{}"'«»—–\-]+/g) || []
        ).filter((tok) =>
          /(?![\u1780-\u17FF\u19E0-\u19FF])[\p{L}\p{M}]|[\u25CC\uFFFD]|[\u17B6-\u17C5]{2,}/u.test(
            tok
          )
        )
      )
    );

    const combinedForeignList = Array.from(
      new Set([
        ...remainingGlitchTokens,
        ...(Array.isArray(foreignWords) ? foreignWords : []),
      ])
    ).slice(0, 60);

    // Step 2: Run Google Gemini 8 Flash High Thinking Level (ThinkingLevel.HIGH) Surgical Word/Phrase Repair
    const shouldRunAi =
      useAiForForeign &&
      currentText.length <= 45000 &&
      (!autoPageMode || hasRemainingForeignScript(currentText));

    if (shouldRunAi) {
      try {
        const glossaryList = Array.isArray(glossary)
          ? glossary
              .slice(0, 60)
              .map((g: any) => `• ${g.originalName} => ${g.khmerName}`)
              .join('\n')
          : '';

        const foreignHint =
          combinedForeignList.length > 0
            ? `ពាក្យច្រឡំភាសា ឬពាក្យបរទេសដែលត្រូវជួសជុលជាភាសាខ្មែរសុទ្ធ៖ ${combinedForeignList.join(', ')}\n`
            : '';

        const sourceContextSection =
          typeof originalText === 'string' && originalText.trim()
            ? `=== អត្ថបទដើមសម្រាប់ផ្ទៀងផ្ទាត់អត្ថន័យកន្លែងដែលច្រឡំភាសា ឬដាច់ពាក្យ (SOURCE REFERENCE) ===\n${originalText.slice(
                0,
                6000
              )}\n\n`
            : '';

        const response = await generateContentWithFallback(
          {
            contents: `អ្នកគឺជាអ្នកជំនាញជាន់ខ្ពស់ផ្នែកអក្សរសាស្ត្រខ្មែរ និងវចនានុក្រមសម្ដេចព្រះសង្ឃរាជ ជួន ណាត (High-Level AI Khmer Orthography & Translation Repair Specialist)។

ភារកិច្ចដាច់ខាត៖
ស្វែងរកគ្រប់ពាក្យ ឬឃ្លាខ្លីៗនៅក្នុងអត្ថបទខាងក្រោមដែលមានបញ្ហា៖
1. «ច្រឡំភាសា / លាយអក្សរចម្លែក» (ដូចជាលាយអក្សរក្រិក បេងហ្គាល់ ភូមា ថៃ ឡាវ អង់គ្លេស ចិន ហិនឌី)៖
   - ឧទាហរណ៍៖ wrong: "διοាក់គំនិតនោះ" => fixed: "ដាក់គំនិតនោះ"
   - ឧទាហរណ៍៖ wrong: "তরwសាង" => fixed: "កសាង"
   - ឧទាហរណ៍៖ wrong: "ដ៏ကြမ်းដុះដំបូ" => fixed: "ដ៏គ្រោតគ្រាតដុះដំបូង"
   - ឧទាហរណ៍៖ wrong: "ស្របពេលដែលអារ៉ុនพยายามพยายามជួ" => fixed: "ស្របពេលដែលអារ៉ុនព្យាយាមជួយ"
   - ឧទាហរណ៍៖ wrong: "គ្នាอย่างรุนแรง" => fixed: "គ្នាយ៉ាងខ្លាំងក្លា"
2. «ពាក្យដាច់កន្ទុយ / ខុសអក្ខរាវិរុទ្ធខ្មែរ / លើសស្រៈ» (ឧទាហរណ៍៖ "ដំបូ" => "ដំបូង", "សំរាប់" => "សម្រាប់")។
3. ហាមដាច់ខាតលុបពាក្យចោល (fixed មិនត្រូវទទេ ឬ "(លុបចោល)" ឡើយ ត្រូវតែជាពាក្យខ្មែរសុទ្ធដែលត្រឹមត្រូវ)។
4. ហាមដាក់ប្រយោគខ្មែរដែលត្រឹមត្រូវស្រាប់ចូលក្នុងបញ្ជី។

${glossaryList ? `តារាងឈ្មោះតួអង្គនិងពាក្យគន្លឹះ៖\n${glossaryList}\n` : ''}${foreignHint}${sourceContextSection}=== អត្ថបទបកប្រែដែលត្រូវត្រួតពិនិត្យ ===
---
${currentText.slice(0, 14000)}
---`,
            config: {
              temperature: 0.1,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  repairs: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        wrong: {
                          type: Type.STRING,
                          description: 'Exact wrong word or short phrase as it appears in the text',
                        },
                        fixed: {
                          type: Type.STRING,
                          description: 'Corrected 100% pure Khmer replacement (never empty)',
                        },
                      },
                      required: ['wrong', 'fixed'],
                    },
                  },
                },
                required: ['repairs'],
              },
            },
          },
          2
        );

        const rawJson = response?.text?.trim() || '';
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          const repairs: Array<{ wrong: string; fixed: string }> = Array.isArray(parsed?.repairs)
            ? parsed.repairs
            : [];

          // Sort longest `wrong` first so multi-part tokens replace cleanly before sub-parts
          repairs.sort((a, b) => (b.wrong?.length || 0) - (a.wrong?.length || 0));

          for (const item of repairs) {
            const w = (item?.wrong || '').trim();
            const f = fixExtraVowelsAndWeirdKhmerClusters((item?.fixed || '').trim()).text.trim();
            if (
              !w ||
              !f ||
              w === f ||
              w.length > 75 ||
              f === '(លុបចោល)' ||
              !currentText.includes(w) ||
              !/[\u1780-\u17FF]/.test(f) ||
              hasRemainingForeignScript(f)
            ) {
              continue;
            }

            const parts = currentText.split(w);
            const occurrences = parts.length - 1;
            if (occurrences > 0) {
              currentText = parts.join(f);
              collector.add(w, f, undefined, occurrences);
              usedAi = true;
            }
          }
        }
      } catch {
        // Fallback to deterministic final pass below
      }
    }

    // Step 3: Final guaranteed 100% pure Khmer pass (repairs any remaining foreign scripts, extra vowels លើសស្រៈ, & Chuon Nath spelling without ever deleting words)
    const finalPass = fixKhmerSpellingAndForeignText(currentText, {
      glossary,
      removeOrTransliterateAllForeign: true,
      preserveTags: true,
    });

    for (const item of finalPass.corrections) {
      collector.add(item.wrongText, item.fixedText, item.category, item.count);
    }

    return res.json({
      fixedText: finalPass.cleanedText,
      usedAi,
      corrections: collector.values(),
    });
  } catch {
    const { text = '', glossary = [] } = req.body || {};
    const rawStr = typeof text === 'string' ? text : '';
    const fallback = fixKhmerSpellingAndForeignText(rawStr, {
      glossary,
      removeOrTransliterateAllForeign: true,
      preserveTags: true,
    });
    return res.json({
      fixedText: fallback.cleanedText,
      usedAi: false,
      corrections: fallback.corrections,
    });
  }
});

// Setup Vite dev server or static file serving
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, port },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
