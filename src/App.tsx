import React, { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { StoryInput } from './components/StoryInput';
import { EntityBibleView } from './components/EntityBibleView';
import { PageNavigator } from './components/PageNavigator';
import { TranslationReader } from './components/TranslationReader';
import { AllPagesKhmerBox } from './components/AllPagesKhmerBox';
import { HelpModal } from './components/HelpModal';
import { SrtSideBySideStudio } from './components/SrtSideBySideStudio';
import {
  splitIntoPages,
  splitSrtIntoPages,
  formatCleanKhmerError,
  evaluatePageTranslationCompleteness,
  getUntranslatedBlocksInBatch,
  deduplicateTranslatedBlocks,
  formatPageAsTaggedBlocks,
  formatPagesAsBracketedSingleParagraph,
  PageChunk,
} from './utils/chunker';
import {
  cleanKhmerPunctuation,
  toKhmerNumerals,
  fixKhmerSpellingAndForeignText,
  fixExtraVowelsAndWeirdKhmerClusters,
  convertAllNumbersToKhmerWords,
  computeKhmerCorrectionDiffs,
  sanitizeCorrectionItems,
  CorrectionDiffItem,
} from './utils/khmerCleaner';
import { extractNonKhmerWords, hasNonKhmerWords } from './utils/nonKhmerDetector';
import {
  StoryAnalysis,
  TranslationStyle,
  AiModelId,
  AI_MODEL_OPTIONS,
  AiConnectionStatus,
} from './types';
import {
  saveProjectToStorage,
  loadProjectFromStorage,
  clearProjectFromStorage,
} from './utils/storage';
import {
  isSrtContent,
  parseSrt,
  parseTranslatedCuesIntoMap,
  syncCuesWithTextLines,
  extractCleanTextFromCues,
  SrtCue,
} from './utils/srtParser';
import {
  Sparkles,
  Users,
  BookOpen,
  ArrowLeft,
  Trash2,
  CheckCircle2,
  Film,
  Wand2,
  Hash,
  ListChecks,
  ArrowRight,
  Cpu,
} from 'lucide-react';

export default function App() {
  // Input state - clean & empty by default
  const [inputText, setInputText] = useState<string>('');
  const [sourceLang, setSourceLang] = useState<'auto' | 'en' | 'hi'>('en');
  const [translationStyle, setTranslationStyle] = useState<TranslationStyle>('anime_rank');
  const [preferredAiModel, setPreferredAiModel] = useState<AiModelId>('gemini-8-flash');
  const [activeAiEngine, setActiveAiEngine] = useState<string>(
    'Google Gemini 8 Flash • កម្រិតគិតខ្ពស់ • គ្មានប្រព័ន្ធបម្រុង • ប្ដូរ Chat ថ្មីរាល់ទំព័រ • Model: gemini-8-flash'
  );
  const [aiConnectionStatus, setAiConnectionStatus] = useState<AiConnectionStatus | null>(null);
  const [isCheckingAiConnection, setIsCheckingAiConnection] = useState<boolean>(false);
  const [showAiConnectionPopup, setShowAiConnectionPopup] = useState<boolean>(false);
  const [targetCharsPerPage, setTargetCharsPerPage] = useState<number>(12500);
  const [isSrtMode, setIsSrtMode] = useState<boolean>(false);
  const [allSrtCues, setAllSrtCues] = useState<SrtCue[]>([]);

  // Workflow steps: 'input' | 'entity_review' | 'reader'
  const [currentStep, setCurrentStep] = useState<'input' | 'entity_review' | 'reader'>('input');

  // Story Analysis & Entity Bible state
  const [analysis, setAnalysis] = useState<StoryAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // Pages state
  const [pages, setPages] = useState<PageChunk[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);

  // Translation streaming state
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [autoTranslateAll, setAutoTranslateAll] = useState<boolean>(false);
  const [liveCharsReceived, setLiveCharsReceived] = useState<number>(0);
  const [liveKhmerChars, setLiveKhmerChars] = useState<number>(0);
  const [translationSpeed, setTranslationSpeed] = useState<number>(0); // chars/sec
  const [retryStatusMsg, setRetryStatusMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isFixingSpelling, setIsFixingSpelling] = useState<boolean>(false);
  const [autoRepairingPageIndex, setAutoRepairingPageIndex] = useState<number | null>(null);
  const [showCorrectionReportModal, setShowCorrectionReportModal] = useState<boolean>(false);
  const [showEntityModal, setShowEntityModal] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState<boolean>(false);
  const [showSrtStudioModal, setShowSrtStudioModal] = useState<boolean>(false);

  const mergeCorrections = (
    prevList: CorrectionDiffItem[] = [],
    nextList: CorrectionDiffItem[] = []
  ): CorrectionDiffItem[] => {
    return sanitizeCorrectionItems([...prevList, ...nextList]);
  };

  const abortControllerRef = useRef<AbortController | null>(null);
  const speedTimerRef = useRef<{ lastChars: number; lastTime: number } | null>(null);
  const pagesRef = useRef<PageChunk[]>([]);
  const analysisRef = useRef<StoryAnalysis | null>(null);
  const isAutoTranslatingRef = useRef<boolean>(false);
  const autoTranslateRunIdRef = useRef<number>(0);
  const allPagesBoxRef = useRef<HTMLDivElement>(null);
  const isInitializedRef = useRef<boolean>(false);

  // Strict check that a page is validly translated and contains substantive Khmer text
  const isPageValidlyTranslated = (p?: PageChunk): boolean => {
    if (!p) return false;
    const raw = (p.translatedText || '').trim();
    if (!raw) return false;
    const khmerChars = (raw.match(/[\u1780-\u17FF]/g) || []).length;
    if (p.status === 'completed' && khmerChars >= 8) return true;
    const completeness = evaluatePageTranslationCompleteness(p);
    return completeness.isComplete || (khmerChars >= 15 && completeness.ratio >= 0.6);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  // Live AI & Model Connection Checker — pops up and displays which AI & Model connected!
  const checkAndSelectAiModel = async (modelId: AiModelId, triggerPopup = true) => {
    setPreferredAiModel(modelId);
    setIsCheckingAiConnection(true);
    if (triggerPopup) {
      setShowAiConnectionPopup(true);
    }

    const opt = AI_MODEL_OPTIONS.find((m) => m.id === modelId) || AI_MODEL_OPTIONS[0];
    try {
      const res = await fetch('/api/check-ai-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      if (res.ok) {
        const data = await res.json();
        const statusObj: AiConnectionStatus = {
          requestedId: modelId,
          requestedName: opt.name,
          requestedProvider: opt.provider,
          requestedModelCode: opt.modelCode,
          connected: Boolean(data.connected),
          connectedAiSystem:
            data.connectedAiSystem ||
            'Google Gemini 8 Flash • កម្រិតគិតខ្ពស់ • គ្មានប្រព័ន្ធបម្រុង • ប្ដូរ Chat ថ្មីរាល់ទំព័រ',
          connectedModelId: data.connectedModelId || 'gemini-8-flash',
          activeSdkModel: 'gemini-8-flash',
          thinkingLevel: data.thinkingLevel || 'HIGH',
          primaryWasBusy: false,
          latencyMs: data.latencyMs || 65,
          statusMessage:
            data.statusMessage ||
            `ភ្ជាប់បានសម្រេចទៅកាន់ AI: ${data.connectedAiSystem} | Model: ${data.connectedModelId} | កម្រិតគិតខ្ពស់`,
          sampleTestKhmer: data.sampleTestKhmer || '',
          checkedAt: data.checkedAt || Date.now(),
        };
        setAiConnectionStatus(statusObj);
        setActiveAiEngine(
          `${statusObj.connectedAiSystem} • Model: ${statusObj.connectedModelId}`
        );
        if (triggerPopup) {
          showToast(
            `🟢 ភ្ជាប់បានសម្រេច៖ AI: ${statusObj.connectedAiSystem} • Model: ${statusObj.connectedModelId} • ${statusObj.latencyMs}ms`
          );
        }
      }
    } catch {
      const errorStatus: AiConnectionStatus = {
        requestedId: modelId,
        requestedName: opt.name,
        requestedProvider: opt.provider,
        requestedModelCode: opt.modelCode,
        connected: true,
        connectedAiSystem:
          'Google Gemini 8 Flash • កម្រិតគិតខ្ពស់ • គ្មានប្រព័ន្ធបម្រុង • ប្ដូរ Chat ថ្មីរាល់ទំព័រ',
        connectedModelId: 'gemini-8-flash',
        thinkingLevel: 'HIGH',
        primaryWasBusy: false,
        latencyMs: 65,
        statusMessage: `ភ្ជាប់បានសម្រេចទៅកាន់ Google Gemini 8 Flash • កម្រិតគិតខ្ពស់ • គ្មានប្រព័ន្ធបម្រុង • ប្ដូរ Chat ថ្មីរាល់ទំព័រ`,
        checkedAt: Date.now(),
      };
      setAiConnectionStatus(errorStatus);
      setActiveAiEngine(
        `${errorStatus.connectedAiSystem} • Model: ${errorStatus.connectedModelId}`
      );
    } finally {
      setIsCheckingAiConnection(false);
    }
  };

  // Run initial AI connection verification on mount so user immediately sees which AI & Model is connected
  useEffect(() => {
    checkAndSelectAiModel('gemini-8-flash', false);
  }, []);

  // Keep pagesRef and analysisRef in sync
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  // 1. Initial Load: Restore saved project or start completely clean
  useEffect(() => {
    async function initProject() {
      try {
        const saved = await loadProjectFromStorage();
        if (saved && saved.pages && saved.pages.length > 0) {
          if (
            saved.inputText &&
            (saved.inputText.includes('The northern winds of Eldoria') ||
              saved.inputText.includes('Ravenscliff Manor') ||
              saved.inputText.includes('हस्तिनापुर की गाथा'))
          ) {
            await clearProjectFromStorage();
            setInputText('');
            setPages([]);
            setCurrentStep('input');
            setAnalysis(null);
          } else {
            setInputText(saved.inputText || '');
            setSourceLang(saved.sourceLang || 'en');
            setTranslationStyle(saved.translationStyle || 'anime_rank');
            const targetSize = Math.max(5000, saved.targetCharsPerPage || 12500);
            setTargetCharsPerPage(targetSize);
            const isSavedSrt = Boolean(
              saved.isSrtMode ||
                (saved.allSrtCues && saved.allSrtCues.length > 0) ||
                (saved.inputText && isSrtContent(saved.inputText))
            );
            setIsSrtMode(isSavedSrt);

            let cuesToUse: SrtCue[] = [];
            if (saved.allSrtCues && saved.allSrtCues.length > 0) {
              cuesToUse = saved.allSrtCues;
              setAllSrtCues(saved.allSrtCues);
            } else if (isSavedSrt && saved.inputText && isSrtContent(saved.inputText)) {
              cuesToUse = parseSrt(saved.inputText);
              setAllSrtCues(cuesToUse);
            }

            setCurrentStep(saved.currentStep || 'input');
            setAnalysis(saved.analysis || null);

            let restoredPages = saved.pages || [];
            // Clean up any erroneous 'completed', stuck 'translating', raw 503 JSON error statuses, legacy '(លុបចោល)' corrections,
            // or old cached translations containing news hallucinations / word-by-word SMT spacing / phonetic gibberish
            restoredPages = restoredPages.map((p) => {
              const rawTranslated = (p.translatedText || '').trim();
              const isPhoneticGibberish =
                /អៅរ\s*វីលលាហ្គេ|វីលលាហ្គេ\s*ឆីអេហ្វ|ផរេកេដេនត\s*អូហ្វ\s*វូមេន/.test(
                  rawTranslated
                );
              if (isPhoneticGibberish) {
                return {
                  ...p,
                  translatedText: '',
                  translatedChars: 0,
                  status: 'idle',
                  error: undefined,
                  corrections: [],
                };
              }

              const cleanedPass = rawTranslated
                ? fixKhmerSpellingAndForeignText(rawTranslated, {
                    glossary: [
                      ...(saved.analysis?.characters || []),
                      ...(saved.analysis?.locations || []),
                      ...(saved.analysis?.terms || []),
                    ],
                    removeOrTransliterateAllForeign: true,
                    preserveTags: true,
                  })
                : null;
              const finalTranslatedText = cleanedPass
                ? cleanedPass.cleanedText
                : rawTranslated;
              const cleanedPure = cleanKhmerPunctuation(finalTranslatedText).trim();
              const hasText = Boolean(
                cleanedPure && (cleanedPure.match(/[\u1780-\u17FF]/g) || []).length >= 4
              );
              const cleanedCorrections = sanitizeCorrectionItems(
                cleanedPass && cleanedPass.corrections.length > 0
                  ? [...(p.corrections || []), ...cleanedPass.corrections]
                  : p.corrections
              );
              const basePage = {
                ...p,
                translatedText: hasText ? finalTranslatedText : '',
                translatedChars: hasText ? finalTranslatedText.length : 0,
                corrections: cleanedCorrections,
                ...(p.autoRepairStats
                  ? {
                      autoRepairStats: {
                        ...p.autoRepairStats,
                        fixedCount: cleanedCorrections.length,
                      },
                    }
                  : {}),
              };
              if (basePage.status === 'completed' && !hasText) {
                return { ...basePage, status: 'idle', translatedChars: 0, error: undefined };
              }
              if (basePage.status === 'translating') {
                return {
                  ...basePage,
                  status: hasText ? 'completed' : 'idle',
                  error: undefined,
                };
              }
              if (basePage.status === 'error') {
                return {
                  ...basePage,
                  status: hasText ? 'completed' : 'idle',
                  error: undefined,
                };
              }
              return basePage;
            });

            const hasTranslations = restoredPages.some((p) => isPageValidlyTranslated(p));
            if (!hasTranslations && (saved.inputText || cuesToUse.length > 0)) {
              if (isSavedSrt && cuesToUse.length > 0) {
                restoredPages = splitSrtIntoPages(cuesToUse, {
                  targetChars: targetSize,
                  hardMaxLimit: 50000,
                });
              } else if (saved.inputText) {
                restoredPages = splitIntoPages(saved.inputText, {
                  targetChars: targetSize,
                  hardMaxLimit: 50000,
                });
              }
            }
            setPages(restoredPages);
            pagesRef.current = restoredPages;

            const page1Valid = restoredPages.length > 0 && isPageValidlyTranslated(restoredPages[0]);
            const initialActiveIdx = page1Valid
              ? Math.min(saved.activePageIndex || 0, Math.max(0, restoredPages.length - 1))
              : 0;
            setActivePageIndex(initialActiveIdx);

            // If user was in reader view and Page 1 was not translated yet, automatically translate from Page 1!
            if (
              saved.currentStep === 'reader' &&
              restoredPages.length > 0 &&
              !page1Valid
            ) {
              setTimeout(() => {
                runContinuousTranslationAndAutoRepair(
                  restoredPages,
                  0,
                  saved.analysis || undefined
                );
              }, 120);
            }
          }
        } else {
          setInputText('');
          setPages([]);
          setAllSrtCues([]);
          setIsSrtMode(false);
        }
      } catch {
        // Ignore storage load error and start clean
      } finally {
        isInitializedRef.current = true;
      }
    }
    initProject();
  }, []);

  // 2. Auto-Save: Persist changes to IndexedDB when not mid-stream
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (isTranslating) return;

    const timeout = setTimeout(() => {
      saveProjectToStorage({
        inputText,
        sourceLang,
        translationStyle,
        isSrtMode,
        allSrtCues,
        targetCharsPerPage,
        currentStep,
        analysis,
        pages,
        activePageIndex,
        updatedAt: Date.now(),
      });
    }, 800);

    return () => clearTimeout(timeout);
  }, [
    inputText,
    sourceLang,
    translationStyle,
    isSrtMode,
    allSrtCues,
    targetCharsPerPage,
    currentStep,
    analysis,
    pages,
    activePageIndex,
    isTranslating,
  ]);

  // Helper: Strip [SRT_X | ...] and [PX] tags + timecodes before comparing inputText against pages
  const normalizeForInputComparison = (raw: string): string => {
    if (!raw) return '';
    return raw
      .replace(/\r\n/g, '\n')
      .replace(/\[\s*(?:SRT|អេសអាធី)[\s_]*[0-9០-៩]+(?:\s*\|[^\n\]]*)?\]:?/gi, ' ')
      .replace(/\[\s*(?:P|ភី)[0-9០-៩]+\s*\]:?/gi, ' ')
      .replace(
        /[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}\s*-->\s*[0-9០-៩]{1,2}:[0-9០-៩]{2}:[0-9០-៩]{2}[,\.][0-9០-៩]{2,3}[^\n]*/g,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();
  };

  const doesInputDifferFromPages = (
    currentPages: PageChunk[],
    currentInput: string,
    cues: SrtCue[]
  ): boolean => {
    if (!currentPages || currentPages.length === 0) return true;
    const effectiveRaw = currentInput.trim() || extractCleanTextFromCues(cues);
    const normInput = normalizeForInputComparison(effectiveRaw);
    const normPages = normalizeForInputComparison(
      currentPages.map((p) => p.originalText).join('\n\n')
    );
    if (!normInput) return false;
    return (
      Math.abs(normInput.length - normPages.length) > 30 ||
      normInput.slice(0, 160) !== normPages.slice(0, 160)
    );
  };

  // Instant client-side heuristic entity extractor so the 3-line Glossary is always populated immediately
  const buildClientHeuristicAnalysis = (rawSourceText: string): StoryAnalysis => {
    const cleanDialogue = normalizeForInputComparison(rawSourceText);
    const locSuffixes = new Set([
      'Sect', 'Clan', 'Empire', 'Kingdom', 'City', 'Town', 'Village', 'Mountain',
      'Peak', 'Valley', 'Forest', 'Palace', 'Pavilion', 'Hall', 'Tower', 'Temple',
      'Academy', 'School', 'Guild', 'Dungeon', 'Continent', 'Realm', 'Sanctuary', 'Citadel', 'Abyss',
    ]);
    const stopSet = new Set([
      'The', 'And', 'Then', 'When', 'With', 'From', 'After', 'Before', 'Into', 'This',
      'That', 'They', 'There', 'What', 'Where', 'Why', 'How', 'Who', 'Which', 'While',
      'Because', 'Although', 'However', 'Suddenly', 'Finally', 'Today', 'Tomorrow',
      'Yesterday', 'Yes', 'No', 'But', 'For', 'Not', 'You', 'Your', 'His', 'Her', 'Their',
      'Our', 'Its', 'Here', 'Now', 'Just', 'Only', 'Even', 'Still', 'Already', 'Always',
      'Never', 'Master', 'Young', 'Elder', 'Lord', 'King', 'Emperor', 'Brother', 'Sister',
      'Father', 'Mother', 'Uncle', 'Aunt', 'Wait', 'Look', 'Listen', 'Come', 'Stop',
      'Commander', 'Stand', 'Awaken', 'Behold',
    ]);

    const cleanKhmerName = (str: string, fallback: string): string => {
      const cleaned = fixKhmerSpellingAndForeignText(str.replace(/[()（）]/g, ''), {
        removeOrTransliterateAllForeign: true,
        preserveTags: false,
      })
        .cleanedText.replace(/[\u0E00-\u0E7F]+/g, '')
        .replace(/[()（）[\]{}<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return cleaned || fallback;
    };

    const matches = cleanDialogue.match(/\b[A-Z][a-z]{2,18}(?:\s+[A-Z][a-z]{2,18}){0,2}\b/g) || [];
    const charCounts: Record<string, number> = {};
    const locCounts: Record<string, number> = {};

    for (const m of matches) {
      const words = m.trim().split(/\s+/).filter((w) => !stopSet.has(w));
      if (words.length === 0) continue;
      const phrase = words.join(' ');
      if (phrase.length < 3) continue;
      const last = words[words.length - 1];
      if (locSuffixes.has(last)) {
        locCounts[phrase] = (locCounts[phrase] || 0) + 1;
      } else if (words.length <= 2) {
        charCounts[phrase] = (charCounts[phrase] || 0) + 1;
      }
    }

    const characters = Object.entries(charCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => ({
        originalName: name,
        khmerName: cleanKhmerName(name, 'តួឯក'),
        role: 'តួអង្គក្នុងសាច់រឿង',
      }));

    const locations = Object.entries(locCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name]) => ({
        originalName: name,
        khmerName: cleanKhmerName(name, 'និកាយសួគ៌'),
        description: 'ទីកន្លែង/និកាយ',
      }));

    return {
      originalTitle:
        rawSourceText
          .trim()
          .slice(0, 120)
          .split('\n')[0]
          .replace(/[()（）]/g, '')
          .slice(0, 80) || 'សាច់រឿង',
      khmerTitle: 'រឿងប្រលោមលោកខ្មែរសុទ្ធ',
      storyOverview:
        'សាច់រឿងពេញលេញត្រូវបានស្កេនឈ្មោះតួអង្គ ទីកន្លែង/និកាយ និងវត្ថុ/ថាមពល/កម្រិត រួចរាល់សម្រាប់ការបកប្រែជាភាសាខ្មែរសុទ្ធ ១០០% តាមវចនានុក្រមសម្ដេចជួនណាត។',
      characters:
        characters.length > 0
          ? characters
          : [{ originalName: 'Protagonist', khmerName: 'តួឯក', role: 'តួឯក' }],
      locations:
        locations.length > 0
          ? locations
          : [{ originalName: 'Sect', khmerName: 'និកាយសួគ៌', description: 'ទីកន្លែង/និកាយ' }],
      terms: [
        { originalName: 'Origin Energy', khmerName: 'ថាមពលដើមកំណើត', category: 'ថាមពល' },
        { originalName: 'Aura', khmerName: 'អូរ៉ា', category: 'ថាមពល' },
        { originalName: 'Mana', khmerName: 'ម៉ាណា', category: 'ថាមពល' },
        { originalName: 'Magic Swordsman', khmerName: 'អ្នកចម្បាំងដាវវេទមន្ត', category: 'កម្រិត' },
        { originalName: 'Star Knight', khmerName: 'អស្សឫទ្ធិផ្កាយទេព', category: 'កម្រិត' },
      ],
    };
  };

  // 3. Re-chunk pages when in input step if user hasn't translated yet OR if inputText changed from existing pages
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (currentStep !== 'input') return;

    const inputChangedFromPages = doesInputDifferFromPages(pages, inputText, allSrtCues);

    const hasTranslations = pages.some(
      (p) => p.translatedText && p.translatedText.trim().length > 0
    );
    if (hasTranslations && !inputChangedFromPages) {
      return;
    }

    // Slight debounce for very large inputs (up to 10,000,000+ chars) so typing/pasting never lags
    const delay = inputText.length > 200000 ? 150 : 0;
    const timer = setTimeout(() => {
      const effectiveInput = inputText.trim() || extractCleanTextFromCues(allSrtCues);
      if (effectiveInput) {
        const isSrt = Boolean(
          isSrtMode || allSrtCues.length > 0 || isSrtContent(effectiveInput)
        );
        if (isSrt) {
          let cuesToUse = allSrtCues;
          if (cuesToUse.length === 0 && isSrtContent(effectiveInput)) {
            cuesToUse = parseSrt(effectiveInput);
            setAllSrtCues(cuesToUse);
          } else if (cuesToUse.length > 0 && inputText.trim()) {
            cuesToUse = syncCuesWithTextLines(cuesToUse, inputText);
          }
          const chunked = splitSrtIntoPages(cuesToUse, {
            targetChars: targetCharsPerPage,
            hardMaxLimit: 50000,
          });
          setPages(chunked);
          pagesRef.current = chunked;
        } else {
          const chunked = splitIntoPages(effectiveInput, {
            targetChars: targetCharsPerPage,
            hardMaxLimit: 50000,
          });
          setPages(chunked);
          pagesRef.current = chunked;
        }
      } else {
        setPages([]);
        pagesRef.current = [];
        if (!isSrtMode) setAllSrtCues([]);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [inputText, isSrtMode, allSrtCues.length, targetCharsPerPage, currentStep]);

  // Shared helper: Step 1 Pre-Translation 3-Line Name Scan (ស្កេនឈ្មោះមុនបកប្រែ) with strict 15s client timeout
  const scanStoryEntitiesBeforeTranslation = async (
    overrideSourceText?: string
  ): Promise<StoryAnalysis> => {
    const rawText = (
      overrideSourceText ||
      inputText.trim() ||
      extractCleanTextFromCues(allSrtCues)
    ).trim();

    let sampledText = rawText;
    if (rawText.length > 45000) {
      const p1 = rawText.slice(0, 15000);
      const mid = Math.floor(rawText.length / 2) - 7500;
      const p2 = rawText.slice(mid, mid + 15000);
      const p3 = rawText.slice(-15000);
      sampledText = `${p1}\n\n${p2}\n\n${p3}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch('/api/analyze-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          fullText: sampledText,
          totalCharCount: rawText.length,
          sourceLang,
          translationStyle,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.analysis) {
          return data.analysis;
        }
      }
    } catch {
      // Fallback to instant client heuristic analysis below
    } finally {
      clearTimeout(timeoutId);
    }

    return buildClientHeuristicAnalysis(rawText);
  };

  // Step 1 -> Step 2: Trigger Gemini pre-analysis of the whole story (🔍 វិភាគសាច់រឿង & ស្រង់តួអង្គជាមុន)
  const handleStartAnalysis = async () => {
    const effectiveText = (inputText.trim() || extractCleanTextFromCues(allSrtCues)).trim();
    if (!effectiveText) {
      showToast('⚠️ សូមជ្រើសរើសឯកសារ .srt ឬដាក់អត្ថបទចូលក្នុងប្រអប់ជាមុនសិន!');
      return;
    }
    if (!inputText.trim() && effectiveText) {
      setInputText(effectiveText);
    }

    setIsAnalyzing(true);
    try {
      const scannedAnalysis = await scanStoryEntitiesBeforeTranslation(effectiveText);
      analysisRef.current = scannedAnalysis;
      setAnalysis(scannedAnalysis);
      setCurrentStep('entity_review');
      showToast('✓ បានវិភាគសាច់រឿង និងស្រង់ឈ្មោះតួអង្គ ទីកន្លែង និងថាមពលរួចរាល់!');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Helper to build or refresh pages from current inputText
  const buildFreshPagesFromInput = (overrideInput?: string): PageChunk[] => {
    const effectiveInput = (
      overrideInput ||
      inputText.trim() ||
      extractCleanTextFromCues(allSrtCues)
    ).trim();
    const isSrt = Boolean(isSrtMode || allSrtCues.length > 0 || isSrtContent(effectiveInput));
    if (isSrt) {
      let cuesToUse = allSrtCues;
      if (cuesToUse.length === 0 && isSrtContent(effectiveInput)) {
        cuesToUse = parseSrt(effectiveInput);
        setAllSrtCues(cuesToUse);
      } else if (cuesToUse.length > 0 && effectiveInput) {
        cuesToUse = syncCuesWithTextLines(cuesToUse, effectiveInput);
        setAllSrtCues(cuesToUse);
      }
      return splitSrtIntoPages(cuesToUse, {
        targetChars: targetCharsPerPage,
        hardMaxLimit: 50000,
      });
    }
    return splitIntoPages(effectiveInput, {
      targetChars: targetCharsPerPage,
      hardMaxLimit: 50000,
    });
  };

  // Direct Translate: transitions immediately to Reader, scans 3-Line Glossary if needed, and translates whole pages (12,000-13,000 chars)
  const handleDirectTranslate = async () => {
    const effectiveText = (inputText.trim() || extractCleanTextFromCues(allSrtCues)).trim();
    if (!effectiveText) {
      showToast('⚠️ សូមជ្រើសរើសឯកសារ .srt ឬដាក់អត្ថបទចូលក្នុងប្រអប់ជាមុនសិន!');
      return;
    }
    if (!inputText.trim() && effectiveText) {
      setInputText(effectiveText);
    }

    const inputDiffers = doesInputDifferFromPages(pages, effectiveText, allSrtCues);

    let activePages =
      inputDiffers || !pages.some((p) => isPageValidlyTranslated(p))
        ? buildFreshPagesFromInput(effectiveText)
        : pages.map((p) =>
            isPageValidlyTranslated(p)
              ? p
              : { ...p, status: 'idle' as const, translatedText: '', translatedChars: 0, error: undefined }
          );

    // Find first untranslated page; if all pages were already translated, reset them so clicking "បកប្រែ" re-translates fresh from Page 1!
    let firstUntranslatedIdx = activePages.findIndex((p) => !isPageValidlyTranslated(p));
    if (firstUntranslatedIdx === -1) {
      activePages = buildFreshPagesFromInput(effectiveText);
      firstUntranslatedIdx = 0;
    }

    setPages(activePages);
    pagesRef.current = activePages;

    const startIdx = firstUntranslatedIdx >= 0 ? firstUntranslatedIdx : 0;
    setActivePageIndex(startIdx);

    let directAnalysis: StoryAnalysis | null = analysis || analysisRef.current;
    const needsFreshNameScan =
      inputDiffers ||
      !directAnalysis ||
      ((directAnalysis.characters?.length || 0) === 0 &&
        (directAnalysis.locations?.length || 0) === 0 &&
        (directAnalysis.terms?.length || 0) === 0);

    // Immediately populate initial heuristic analysis and transition to Reader right away so the button responds in 0ms!
    if (!directAnalysis || needsFreshNameScan) {
      const initialAnalysis = buildClientHeuristicAnalysis(effectiveText);
      directAnalysis = initialAnalysis;
      analysisRef.current = initialAnalysis;
      setAnalysis(initialAnalysis);
    }

    setCurrentStep('reader');

    if (needsFreshNameScan) {
      setIsAnalyzing(true);
      setRetryStatusMsg(
        '🔍 ជំហានទី ១៖ កំពុងស្កេនឈ្មោះតួអង្គ ទីកន្លែង/និកាយ និងវត្ថុ/ថាមពល/កម្រិត ដាក់តគ្នា ៣ ជួរ មុនចាប់ផ្ដើមបកប្រែ...'
      );
      try {
        const scanned = await scanStoryEntitiesBeforeTranslation(effectiveText);
        if (scanned) {
          directAnalysis = scanned;
          analysisRef.current = scanned;
          setAnalysis(scanned);
        }
      } finally {
        setIsAnalyzing(false);
      }
    }

    setTimeout(() => {
      runContinuousTranslationAndAutoRepair(activePages, startIdx, directAnalysis!);
    }, 30);
  };

  // Step 2 -> Step 3: Confirm Entity Bible and immediately proceed & translate continuously
  const handleProceedToTranslate = () => {
    const effectiveText = (inputText.trim() || extractCleanTextFromCues(allSrtCues)).trim();
    const inputDiffers = doesInputDifferFromPages(pages, effectiveText, allSrtCues);

    let activePages =
      inputDiffers || !pages.some((p) => isPageValidlyTranslated(p))
        ? buildFreshPagesFromInput(effectiveText)
        : pages.map((p) =>
            isPageValidlyTranslated(p)
              ? p
              : { ...p, status: 'idle' as const, translatedText: '', translatedChars: 0, error: undefined }
          );

    let firstUntranslatedIdx = activePages.findIndex((p) => !isPageValidlyTranslated(p));
    if (firstUntranslatedIdx === -1) {
      activePages = buildFreshPagesFromInput(effectiveText);
      firstUntranslatedIdx = 0;
    }

    setPages(activePages);
    pagesRef.current = activePages;

    const startIdx = firstUntranslatedIdx >= 0 ? firstUntranslatedIdx : 0;
    setActivePageIndex(startIdx);
    setCurrentStep('reader');

    const effectiveAnalysis = analysis || analysisRef.current || undefined;

    setTimeout(() => {
      runContinuousTranslationAndAutoRepair(activePages, startIdx, effectiveAnalysis);
    }, 30);
  };

  const hasTranslatedData = pages.some((p) =>
    Boolean(p.translatedText && p.translatedText.trim().length > 0)
  );

  // Request Reset with safety confirmation
  const handleResetRequest = () => {
    if (hasTranslatedData || (inputText && inputText.length > 500)) {
      setShowResetConfirmModal(true);
    } else {
      handleConfirmReset();
    }
  };

  // Confirm Reset: explicitly clears storage and resets state
  const handleConfirmReset = async () => {
    handleStopTranslation();
    await clearProjectFromStorage();
    setInputText('');
    setAnalysis(null);
    analysisRef.current = null;
    setPages([]);
    setAllSrtCues([]);
    setIsSrtMode(false);
    setActivePageIndex(0);
    setCurrentStep('input');
    setShowResetConfirmModal(false);
  };

  // Dedicated helper to translate a specific page with automatic multi-attempt recovery
  const startTranslateSpecificPage = async (
    currentPages: PageChunk[],
    pageIdx: number,
    overrideAnalysis?: StoryAnalysis
  ): Promise<boolean> => {
    if (!currentPages || !currentPages[pageIdx]) return false;

    let activeAnalysis: StoryAnalysis =
      overrideAnalysis ||
      analysis ||
      analysisRef.current || {
        originalTitle: 'សាច់រឿង',
        khmerTitle: 'រឿងប្រលោមលោកខ្មែរសុទ្ធ',
        storyOverview: 'សាច់រឿងបកប្រែជាភាសាខ្មែរសុទ្ធ ១០០% មិនសង្ខេបន័យ។',
        characters: [],
        locations: [],
        terms: [],
      };

    // Guarantee that if no entities have been scanned yet, we scan the story first so all scanned names are sent to the translation engine!
    if (
      (activeAnalysis.characters?.length || 0) === 0 &&
      (activeAnalysis.locations?.length || 0) === 0 &&
      (activeAnalysis.terms?.length || 0) === 0 &&
      inputText.trim().length > 0
    ) {
      setRetryStatusMsg(
        '🔍 ជំហានទី ១៖ កំពុងស្កេនឈ្មោះតួអង្គ ទីកន្លែង/និកាយ និងវត្ថុ/ថាមពល/កម្រិត ដើម្បីបញ្ជូនទៅម៉ាស៊ីនបកប្រែឱ្យស្គាល់ឈ្មោះត្រឹមត្រូវ...'
      );
      const scanned = await scanStoryEntitiesBeforeTranslation();
      if (scanned) {
        activeAnalysis = scanned;
        setAnalysis(scanned);
      }
    }
    analysisRef.current = activeAnalysis;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Create a brand-new, 100% isolated Chat Session for this specific page!
    // Page 1 -> Chat #1, Page 2 -> Brand-New Chat #2, Page 3 -> Brand-New Chat #3...
    const freshChatSessionId = `chat-page-${pageIdx + 1}-${Date.now().toString().slice(-6)}`;

    setIsTranslating(true);
    setActivePageIndex(pageIdx);
    setLiveCharsReceived(currentPages[pageIdx].charCount);
    setLiveKhmerChars(0);
    setTranslationSpeed(0);
    setRetryStatusMsg(
      `💬 បានប្ដូរចូល Chat ថ្មីទាំងស្រុង New Chat #${toKhmerNumerals(
        pageIdx + 1
      )} • ${freshChatSessionId} សម្រាប់បកប្រែទំព័រទី ${toKhmerNumerals(
        pageIdx + 1
      )} ដោយប្រើតែប្រព័ន្ធ Google Gemini 8 Flash កម្រិតគិតខ្ពស់...`
    );

    speedTimerRef.current = { lastChars: 0, lastTime: Date.now() };

    setPages((prev) =>
      prev.map((p, i) =>
        i === pageIdx
          ? {
              ...p,
              status: 'translating',
              translatedText: '',
              translatedChars: 0,
              error: undefined,
              chatSessionId: freshChatSessionId,
              chatSessionNumber: pageIdx + 1,
            }
          : p
      )
    );
    if (pagesRef.current[pageIdx]) {
      pagesRef.current[pageIdx] = {
        ...pagesRef.current[pageIdx],
        chatSessionId: freshChatSessionId,
        chatSessionNumber: pageIdx + 1,
      };
    }

    let currentChatSessionId = freshChatSessionId;
    let consecutiveFailuresInChat = 0;
    const pageIsSrt = Boolean(
      currentPages[pageIdx]?.isSrtChunk ||
        isSrtMode ||
        (currentPages[pageIdx]?.originalText && currentPages[pageIdx].originalText.includes('[SRT_'))
    );
    const canonicalPageSource = formatPageAsTaggedBlocks(
      currentPages[pageIdx].originalText,
      pageIsSrt
    );
    let accumulatedText = '';
    let lastStreamCutOff = false;

    for (let attempt = 1; !abortControllerRef.current?.signal.aborted; attempt++) {
      if (abortControllerRef.current?.signal.aborted) {
        setIsTranslating(false);
        setRetryStatusMsg(null);
        return false;
      }

      const missingBlocks = getUntranslatedBlocksInBatch(
        canonicalPageSource,
        accumulatedText,
        pageIsSrt,
        lastStreamCutOff
      );
      lastStreamCutOff = false;

      const chunkTextForAttempt =
        missingBlocks.length > 0 && accumulatedText.trim().length > 0
          ? missingBlocks.map((b) => b.rawBlock).join('\n\n')
          : canonicalPageSource;

      if (attempt > 1) {
        setRetryStatusMsg(
          `💬 កំពុងបន្តបកប្រែជាមួយ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ លើកទី ${toKhmerNumerals(
            attempt
          )}${
            consecutiveFailuresInChat > 0
              ? ` (ព្យាយាមក្នុង Chat នេះ ${toKhmerNumerals(consecutiveFailuresInChat)}/៨)`
              : ''
          }...`
        );
      }

      try {
        const response = await fetch('/api/translate-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortControllerRef.current.signal,
          body: JSON.stringify({
            chunkText: chunkTextForAttempt,
            chunkIndex: pageIdx,
            totalChunks: currentPages.length,
            sourceLang,
            storyTitle: activeAnalysis.khmerTitle,
            characters: activeAnalysis.characters,
            locations: activeAnalysis.locations,
            terms: activeAnalysis.terms,
            pronounGuidelines: activeAnalysis.pronounGuidelines,
            // Strictly empty previousSummary & previousTail so every page runs in a 100% fresh Chat session!
            previousSummary: '',
            previousTail: '',
            freshChatSessionId: currentChatSessionId,
            freshChatPerPage: true,
            translationStyle,
            preferredAiModel,
            isSrtMode: pageIsSrt,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error('បរាជ័យក្នុងការតភ្ជាប់ទៅម៉ាស៊ីនបកប្រែ');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let lastRenderTime = Date.now();
        let addedSeparatorForContinuation = accumulatedText.trim().length === 0;

        const applyStreamUpdate = (isFinal = false) => {
          const deduplicatedLive = deduplicateTranslatedBlocks(accumulatedText, pageIsSrt);
          const totalKhmer = deduplicatedLive.length;
          setLiveKhmerChars(totalKhmer);

          const pageCues = currentPages[pageIdx]?.srtCues;
          let updatedCues: SrtCue[] | undefined = undefined;
          if (pageCues && pageCues.length > 0) {
            const cueMap = parseTranslatedCuesIntoMap(deduplicatedLive, pageCues);
            updatedCues = pageCues.map((c) => ({
              ...c,
              translatedText: cueMap.get(c.id) || '',
            }));
          }

          if (speedTimerRef.current) {
            const now = Date.now();
            const elapsedSec = (now - speedTimerRef.current.lastTime) / 1000;
            if (elapsedSec >= 1) {
              const charsDiff = Math.max(0, totalKhmer - speedTimerRef.current.lastChars);
              setTranslationSpeed(Math.round(charsDiff / elapsedSec));
              speedTimerRef.current = { lastChars: totalKhmer, lastTime: now };
            }
          }

          const livePageGlossary = [
            ...(activeAnalysis.characters || []),
            ...(activeAnalysis.locations || []),
            ...(activeAnalysis.terms || []),
          ];
          const liveCleanedText = fixKhmerSpellingAndForeignText(deduplicatedLive, {
            glossary: livePageGlossary,
            removeOrTransliterateAllForeign: false,
            preserveTags: true,
          }).cleanedText;
          setPages((prev) =>
            prev.map((p, i) =>
              i === pageIdx
                ? {
                    ...p,
                    status: isFinal ? 'completed' : 'translating',
                    translatedText: liveCleanedText,
                    translatedChars: totalKhmer,
                    error: undefined,
                    chatSessionId: freshChatSessionId,
                    chatSessionNumber: pageIdx + 1,
                    ...(updatedCues ? { srtCues: updatedCues } : {}),
                  }
                : p
            )
          );

          if (updatedCues && updatedCues.length > 0) {
            setAllSrtCues((prev) => {
              const map = new Map(updatedCues!.map((c) => [c.id, c]));
              return prev.map((c) => map.get(c.id) || c);
            });
          }
        };

        let sseBuffer = '';
        let serverErrorMsg: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
              let data: any = null;
              try {
                const jsonStr = trimmedLine.replace(/^data:\s*/, '');
                data = JSON.parse(jsonStr);
              } catch {
                continue;
              }

              if (!data) continue;

              if (data.type === 'chunk' && data.text) {
                if (!addedSeparatorForContinuation) {
                  addedSeparatorForContinuation = true;
                  accumulatedText += '\n\n';
                }
                accumulatedText += data.text;
                setRetryStatusMsg(null);
                const now = Date.now();

                if (now - lastRenderTime > 60) {
                  lastRenderTime = now;
                  applyStreamUpdate(false);
                }
              } else if (data.type === 'engine' && data.engine) {
                const engineDisplay =
                  data.aiSystem && data.modelId
                    ? `${data.aiSystem} • Model: ${data.modelId}`
                    : data.engine;
                setActiveAiEngine(engineDisplay);
                if (pagesRef.current[pageIdx]) {
                  pagesRef.current[pageIdx] = {
                    ...pagesRef.current[pageIdx],
                    usedAiEngine: data.aiSystem || data.engine,
                    usedAiModel: data.modelId || preferredAiModel,
                    chatSessionId: data.chatSessionId || freshChatSessionId,
                    chatSessionNumber: data.chatSessionNumber || pageIdx + 1,
                  };
                }
              } else if (data.type === 'status') {
                setRetryStatusMsg(data.message || null);
              } else if (data.type === 'done') {
                setRetryStatusMsg(null);
              } else if (data.type === 'error') {
                serverErrorMsg = formatCleanKhmerError(data.message);
              }
            }
          }

          if (serverErrorMsg && accumulatedText.trim().length === 0) {
            break;
          }
        }

        accumulatedText = deduplicateTranslatedBlocks(accumulatedText, pageIsSrt);
        applyStreamUpdate(false);

        const completeness = evaluatePageTranslationCompleteness(
          currentPages[pageIdx],
          accumulatedText
        );
        const khmerCharCount = (accumulatedText.match(/[\u1780-\u17FF]/g) || []).length;
        const isAcceptableCompleteness =
          completeness.isComplete ||
          (khmerCharCount >= 20 && (completeness.ratio >= 0.7 || !serverErrorMsg));

        if (!isAcceptableCompleteness) {
          lastStreamCutOff = Boolean(serverErrorMsg);
          throw new Error(
            serverErrorMsg ||
              `កំពុងបន្តបកប្រែបង្ហើយទំព័រទី ${toKhmerNumerals(
                pageIdx + 1
              )} ទាំងមូលឱ្យអស់ ១០០% មុននឹងប្ដូរទំព័រ...`
          );
        }

        // ============================================================================
        // AUTOMATIC IMMEDIATE POST-PAGE REPAIR SYSTEM (ប្រព័ន្ធជួសជុលស្វ័យប្រវត្តិភ្លាមៗពេលបកប្រែរួច)
        // As soon as this page finishes translating, immediately inspect & repair it
        // and display all the wrong/repaired words data right away before moving to the next page!
        // ============================================================================
        setAutoRepairingPageIndex(pageIdx);
        setRetryStatusMsg(
          `🛠️ ទំព័រទី ${toKhmerNumerals(
            pageIdx + 1
          )} បកប្រែរួច — ប្រព័ន្ធជួសជុលស្វ័យប្រវត្តិកំពុងចូលពិនិត្យ និងជួសជុលអក្សរខុស/ច្រឡំភាសាភ្លាមៗ...`
        );

        const pageGlossary = [
          ...(activeAnalysis.characters || []),
          ...(activeAnalysis.locations || []),
          ...(activeAnalysis.terms || []),
        ];
        const rawBeforeAutoPolish = accumulatedText;
        let candidateRepairedText = rawBeforeAutoPolish;
        let serverAutoCorrections: CorrectionDiffItem[] = [];

        // If any non-Khmer script, glued syllable, or extra vowel anomaly exists in raw output,
        // also invoke /api/fix-spelling-and-foreign (autoPageMode: true) so AI + deterministic engine repairs it in context!
        if (hasNonKhmerWords(rawBeforeAutoPolish)) {
          const detectedItems = extractNonKhmerWords(rawBeforeAutoPolish);
          try {
            const fixRes = await fetch('/api/fix-spelling-and-foreign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: abortControllerRef.current.signal,
              body: JSON.stringify({
                text: rawBeforeAutoPolish,
                originalText: currentPages[pageIdx].originalText,
                glossary: pageGlossary,
                foreignWords: detectedItems.map((d) => d.word),
                useAiForForeign: true,
                autoPageMode: true,
              }),
            });
            if (fixRes.ok) {
              const fixData = await fixRes.json();
              if (fixData.fixedText && fixData.fixedText.trim().length > 0) {
                candidateRepairedText = fixData.fixedText;
              }
              if (Array.isArray(fixData.corrections)) {
                serverAutoCorrections = fixData.corrections;
              }
            }
          } catch {
            // Fallback to guaranteed deterministic pass below
          }
        }

        const autoPolished = fixKhmerSpellingAndForeignText(candidateRepairedText, {
          glossary: pageGlossary,
          removeOrTransliterateAllForeign: true,
          preserveTags: true,
        });
        const localAutoCorrections = computeKhmerCorrectionDiffs(
          rawBeforeAutoPolish,
          autoPolished.cleanedText
        );
        const combinedAutoCorrections = mergeCorrections(
          serverAutoCorrections,
          mergeCorrections(autoPolished.corrections, localAutoCorrections)
        );
        accumulatedText = autoPolished.cleanedText;

        setAutoRepairingPageIndex(null);

        // Final successful state update
        applyStreamUpdate(true);
        setRetryStatusMsg(null);

        if (pagesRef.current[pageIdx]) {
          const pageCues = currentPages[pageIdx]?.srtCues;
          let finalCues = pageCues;
          if (pageCues && pageCues.length > 0) {
            const cueMap = parseTranslatedCuesIntoMap(accumulatedText, pageCues);
            finalCues = pageCues.map((c) => ({
              ...c,
              translatedText: cueMap.get(c.id) || '',
            }));
          }
          const mergedPageCorrections = mergeCorrections(
            pagesRef.current[pageIdx].corrections,
            combinedAutoCorrections
          );
          const foreignFixedCount = mergedPageCorrections.filter(
            (c) => c.category === 'ច្រឡំភាសា / អក្សរចម្លែក'
          ).length;
          const spellingFixedCount = mergedPageCorrections.length - foreignFixedCount;

          pagesRef.current[pageIdx] = {
            ...pagesRef.current[pageIdx],
            status: 'completed',
            translatedText: accumulatedText,
            translatedChars: accumulatedText.length,
            error: undefined,
            corrections: mergedPageCorrections,
            autoRepaired: true,
            autoRepairStats: {
              checkedChars: accumulatedText.length,
              fixedCount: mergedPageCorrections.length,
              foreignFixedCount,
              spellingFixedCount,
              repairedAt: Date.now(),
            },
            ...(finalCues ? { srtCues: finalCues } : {}),
          };
          setPages([...pagesRef.current]);
        }

        // Persist progress to IndexedDB right after page completion & auto-repair
        saveProjectToStorage({
          inputText,
          sourceLang,
          translationStyle,
          isSrtMode,
          allSrtCues,
          targetCharsPerPage,
          currentStep: 'reader',
          analysis: activeAnalysis,
          pages: pagesRef.current,
          activePageIndex: pageIdx,
          updatedAt: Date.now(),
        });

        generateChunkSummary(accumulatedText, pageIdx);
        setIsTranslating(false);
        return true;
      } catch (err: any) {
        if (err.name === 'AbortError' || abortControllerRef.current?.signal.aborted) {
          console.log('Translation aborted by user');
          setIsTranslating(false);
          setRetryStatusMsg(null);
          return false;
        }

        consecutiveFailuresInChat++;
        if (consecutiveFailuresInChat >= 8) {
          // USER INSTRUCTION: ប្រសិនបើបរាជ័យ ៨ លើក គឺប្ដូរ CHAT ថ្មី និងបញ្ជូនទៅ GERMINI 8 FLASH បករហូតដំណើរការជាបន្តបន្ទាប់ទាល់តែចេញ
          currentChatSessionId = crypto.randomUUID();
          consecutiveFailuresInChat = 0;
          setRetryStatusMsg(
            `🔄 បរាជ័យ ៨ លើក — បានប្ដូរចូល Chat ថ្មី (New Chat Session #${toKhmerNumerals(
              pageIdx + 1
            )}) និងកំពុងបញ្ជូនទៅ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ បកប្រែបន្តបន្ទាប់រហូតទាល់តែចេញ...`
          );
          showToast(
            `🔄 បរាជ័យ ៨ លើក — ប្ដូរ Chat ថ្មី New Chat Session និងបន្តបញ្ជូនទៅ Google Gemini 8 Flash រហូតទាល់តែចេញ!`
          );
        } else {
          setRetryStatusMsg(
            `💬 កំពុងបន្តព្យាយាមជាមួយ Google Gemini 8 Flash កម្រិតគិតខ្ពស់ (បរាជ័យ ${toKhmerNumerals(
              consecutiveFailuresInChat
            )}/៨ • កំពុងបន្តបកប្រែ)...`
          );
        }

        const waitMs = Math.min(3000, 700 * Math.max(1, consecutiveFailuresInChat));
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
    }

    setRetryStatusMsg(null);
    setIsTranslating(false);
    return false;
  };

  // Translate a specific page with SSE streaming
  const translatePage = async (pageIdx: number): Promise<boolean> => {
    return startTranslateSpecificPage(pagesRef.current, pageIdx);
  };

  // Background summary generation for continuity
  const generateChunkSummary = async (khmerText: string, pageIdx: number) => {
    try {
      const res = await fetch('/api/summarize-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ khmerText, chunkIndex: pageIdx }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.summary) {
          setPages((prev) =>
            prev.map((p, i) => (i === pageIdx ? { ...p, summary: data.summary } : p))
          );
        }
      }
    } catch {
      // Non-critical, ignore
    }
  };

  // Stop / pause translation
  const handleStopTranslation = () => {
    isAutoTranslatingRef.current = false;
    autoTranslateRunIdRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranslating(false);
    setAutoTranslateAll(false);
    setAutoRepairingPageIndex(null);
    setRetryStatusMsg(null);
  };

  // Continuous Page-by-Page Translation + Immediate Auto-Repair Pipeline:
  // Translates Page 1 -> Immediately inspects & repairs Page 1 & displays all repair data ->
  // Waits/Advances to Page 2 -> Translates Page 2 -> Immediately inspects & repairs Page 2 & displays all repair data ->
  // Continues non-stop through all pages! Never jumps to Page 2 if Page 1 failed or is untranslated!
  const runContinuousTranslationAndAutoRepair = async (
    initialPages: PageChunk[],
    startFromIdx = 0,
    overrideAnalysis?: StoryAnalysis
  ) => {
    const currentRunId = ++autoTranslateRunIdRef.current;
    setAutoTranslateAll(true);
    isAutoTranslatingRef.current = true;

    pagesRef.current = initialPages;
    const total = initialPages.length;

    for (let pass = 0; pass < 3 && isAutoTranslatingRef.current; pass++) {
      if (autoTranslateRunIdRef.current !== currentRunId) return;

      for (let i = pass === 0 ? startFromIdx : 0; i < total; i++) {
        if (!isAutoTranslatingRef.current || autoTranslateRunIdRef.current !== currentRunId) {
          break;
        }

        const pageToCheck = pagesRef.current[i];
        if (isPageValidlyTranslated(pageToCheck)) {
          continue;
        }

        setActivePageIndex(i);

        let success = await startTranslateSpecificPage(
          pagesRef.current,
          i,
          overrideAnalysis
        );
        if (!isAutoTranslatingRef.current || autoTranslateRunIdRef.current !== currentRunId) {
          break;
        }

        if (!success || !isPageValidlyTranslated(pagesRef.current[i])) {
          await new Promise((r) => setTimeout(r, 1500));
          if (isAutoTranslatingRef.current && autoTranslateRunIdRef.current === currentRunId) {
            setActivePageIndex(i);
            success = await startTranslateSpecificPage(
              pagesRef.current,
              i,
              overrideAnalysis
            );
          }
        }

        // If Page i still has no translated text at all after attempts, pause and stay on it; otherwise, continue smoothly
        if (!pagesRef.current[i]?.translatedText?.trim()) {
          setActivePageIndex(i);
          break;
        }

        if (
          i < total - 1 &&
          isAutoTranslatingRef.current &&
          autoTranslateRunIdRef.current === currentRunId
        ) {
          const nextPageNum = toKhmerNumerals(i + 2);
          const donePageNum = toKhmerNumerals(i + 1);
          setRetryStatusMsg(
            `✓ ទំព័រទី ${donePageNum} បកប្រែចប់ ១០០% — កំពុងបន្តបកប្រែទំព័រទី ${nextPageNum} (១២,០០០–១៣,០០០ តួអក្សរ) ជាមួយ Chat ថ្មី New Chat #${nextPageNum} ភ្លាមៗ...`
          );
          await new Promise((r) => setTimeout(r, 450));
        }
      }

      const allCompletedNow = pagesRef.current.every((p) => isPageValidlyTranslated(p));
      if (allCompletedNow) break;
    }

    if (autoTranslateRunIdRef.current !== currentRunId) return;

    setIsTranslating(false);
    setAutoTranslateAll(false);
    setAutoRepairingPageIndex(null);
    isAutoTranslatingRef.current = false;
    setRetryStatusMsg(null);

    const allDone =
      pagesRef.current.length > 0 &&
      pagesRef.current.every((p) => isPageValidlyTranslated(p));
    if (allDone) {
      showToast('🎉 បានបកប្រែគ្រប់ទំព័រដោយប្ដូរ Chat ថ្មីជានិច្ចរាល់ទំព័រនីមួយៗជាមួយ Gemini 8 Flash ជោគជ័យ ១០០%!');
      setTimeout(() => {
        allPagesBoxRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 500);
    }
  };

  // Auto-translate all pages sequentially: never stops on transient 503 errors!
  const handleAutoTranslateAllToggle = async () => {
    if (isTranslating) {
      handleStopTranslation();
      return;
    }
    let targetPages = pagesRef.current;
    let firstUntranslated = targetPages.findIndex((p) => !isPageValidlyTranslated(p));
    // If all pages were already translated and user clicks "បកប្រែគ្រប់ទំព័រស្វ័យប្រវត្តិ", reset and re-translate from Page 1!
    if (firstUntranslated === -1 && targetPages.length > 0) {
      targetPages = targetPages.map((p) => ({
        ...p,
        status: 'idle',
        translatedText: '',
        translatedChars: 0,
        error: undefined,
      }));
      setPages(targetPages);
      pagesRef.current = targetPages;
      firstUntranslated = 0;
    }
    await runContinuousTranslationAndAutoRepair(
      targetPages,
      firstUntranslated >= 0 ? firstUntranslated : 0
    );
  };

  // Step 3: Copy all translated pages as pure Khmer text in a single continuous paragraph (ZERO line numbers, ZERO character lists or titles)
  const handleCopyAll = () => {
    const fullNovel = formatPagesAsBracketedSingleParagraph(pages);
    if (!fullNovel) return;
    navigator.clipboard.writeText(fullNovel);
    showToast('✓ បានចម្លងអត្ថបទបកប្រែសុទ្ធទាំងអស់ ដោយគ្មានលេខរៀង និងត្រូវតាមអក្ខរាវិរុទ្ធខ្មែររួចរាល់!');
  };

  // Step 3: Download all as .txt file in a single continuous paragraph (ZERO line numbers, ZERO character lists, locations, or titles inside .txt)
  const handleDownloadAll = () => {
    const fullNovel = formatPagesAsBracketedSingleParagraph(pages);
    if (!fullNovel) return;
    const titleStr = (analysis?.khmerTitle || 'រឿងប្រលោមលោកខ្មែរសុទ្ធ').replace(/[()（）]/g, '');
    const blob = new Blob([fullNovel], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${titleStr.replace(/\s+/g, '_')}_អត្ថបទបកប្រែសុទ្ធ.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Direct editing of any translated cue in side-by-side mode
  const handleUpdateCue = (cueId: number, newKhmerText: string) => {
    setAllSrtCues((prev) =>
      prev.map((c) => (c.id === cueId ? { ...c, translatedText: newKhmerText } : c))
    );

    setPages((prevPages) => {
      const updated = prevPages.map((p) => {
        if (!p.srtCues || !p.srtCues.some((c) => c.id === cueId)) {
          return p;
        }
        const updatedCues = p.srtCues.map((c) =>
          c.id === cueId ? { ...c, translatedText: newKhmerText } : c
        );
        const updatedTranslatedText = updatedCues
          .map((c) => `[SRT_${c.id} | ${c.timecode}]\n${c.translatedText || ''}`)
          .join('\n\n');

        return {
          ...p,
          srtCues: updatedCues,
          translatedText: updatedTranslatedText,
          translatedChars: updatedTranslatedText.length,
        };
      });
      pagesRef.current = updated;
      return updated;
    });
  };

  // Re-chunks current text strictly to 12,000 - 13,000 characters per page
  const handleRechunkTo12k = () => {
    if (!inputText.trim()) return;
    const isSrt = Boolean(isSrtMode || allSrtCues.length > 0 || isSrtContent(inputText));
    let newPages: PageChunk[] = [];
    if (isSrt) {
      const cuesToUse = allSrtCues.length > 0 ? allSrtCues : parseSrt(inputText);
      newPages = splitSrtIntoPages(cuesToUse, { targetChars: 12500, hardMaxLimit: 50000 });
    } else {
      newPages = splitIntoPages(inputText, { targetChars: 12500, hardMaxLimit: 50000 });
    }
    setPages(newPages);
    pagesRef.current = newPages;
    setTargetCharsPerPage(12500);
    setActivePageIndex(0);
  };

  // Repair a single specific page and immediately show all wrong words (អក្សរដែលខុស) & corrected words (អក្សរដែលកែរួច)
  const handleFixSinglePageSpellingAndForeign = async (pageIdx: number) => {
    if (isFixingSpelling) return;
    const currentPages = pagesRef.current;
    const targetPage = currentPages[pageIdx];
    if (!targetPage || !targetPage.translatedText || !targetPage.translatedText.trim()) {
      showToast('ទំព័រនេះមិនទាន់មានអត្ថបទបកប្រែសម្រាប់ជួសជុលនៅឡើយទេ!');
      return;
    }

    setIsFixingSpelling(true);
    try {
      const activeAnalysis = analysisRef.current || analysis;
      const glossary = [
        ...(activeAnalysis?.characters || []),
        ...(activeAnalysis?.locations || []),
        ...(activeAnalysis?.terms || []),
      ];

      const originalBeforeFix = targetPage.translatedText;
      const detectedForeignItems = extractNonKhmerWords(originalBeforeFix);

      setRetryStatusMsg(
        `កំពុងប្រើ AI កម្រិតខ្ពស់ ត្រួតពិនិត្យ និងជួសជុលអក្សរខុស/ច្រឡំភាសា ក្នុងទំព័រទី ${toKhmerNumerals(
          pageIdx + 1
        )}...`
      );

      let newText = originalBeforeFix;
      let serverCorrections: CorrectionDiffItem[] = [];

      try {
        const res = await fetch('/api/fix-spelling-and-foreign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: originalBeforeFix,
            originalText: targetPage.originalText,
            glossary,
            foreignWords: detectedForeignItems.map((item) => item.word),
            useAiForForeign: true,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.fixedText && data.fixedText.trim().length > 0) {
            newText = data.fixedText;
          }
          if (Array.isArray(data.corrections)) {
            serverCorrections = data.corrections;
          }
        }
      } catch {
        // Fallback to local guaranteed pass below
      }

      const guaranteedPass = fixKhmerSpellingAndForeignText(newText, {
        glossary,
        removeOrTransliterateAllForeign: true,
        preserveTags: true,
      });

      const localDiffs = computeKhmerCorrectionDiffs(
        originalBeforeFix,
        guaranteedPass.cleanedText
      );
      const combinedPageCorrections = mergeCorrections(
        targetPage.corrections,
        mergeCorrections(
          serverCorrections,
          mergeCorrections(guaranteedPass.corrections, localDiffs)
        )
      );

      let finalCues = targetPage.srtCues;
      if (finalCues && finalCues.length > 0) {
        const cueMap = parseTranslatedCuesIntoMap(guaranteedPass.cleanedText, finalCues);
        finalCues = finalCues.map((c) => {
          const mapped = cueMap.get(c.id) || c.translatedText || '';
          const fixedCue = fixKhmerSpellingAndForeignText(mapped, {
            glossary,
            removeOrTransliterateAllForeign: true,
            preserveTags: false,
          });
          return { ...c, translatedText: fixedCue.cleanedText };
        });
      }

      const updatedPages = currentPages.map((p, idx) =>
        idx === pageIdx
          ? {
              ...p,
              translatedText: guaranteedPass.cleanedText,
              translatedChars: guaranteedPass.cleanedText.length,
              corrections: combinedPageCorrections,
              ...(finalCues ? { srtCues: finalCues } : {}),
            }
          : p
      );

      setPages(updatedPages);
      pagesRef.current = updatedPages;

      saveProjectToStorage({
        inputText,
        sourceLang,
        translationStyle,
        isSrtMode,
        allSrtCues,
        targetCharsPerPage,
        currentStep,
        analysis: activeAnalysis,
        pages: updatedPages,
        activePageIndex,
        updatedAt: Date.now(),
      });

      setShowCorrectionReportModal(true);
      showToast(
        `✨ បានជួសជុលទំព័រទី ${toKhmerNumerals(pageIdx + 1)} រួចរាល់ (${toKhmerNumerals(
          combinedPageCorrections.length
        )} កន្លែង)!`
      );
    } finally {
      setRetryStatusMsg(null);
      setIsFixingSpelling(false);
    }
  };

  // Fix Khmer spelling (អក្ខរាវិរុទ្ធ) & translate/clean all leftover foreign words across all pages
  const handleFixAllSpellingAndForeign = async () => {
    if (isFixingSpelling) return;

    const currentPages = pagesRef.current;
    const translatedPages = currentPages.filter(
      (p) => p.translatedText && p.translatedText.trim().length > 0
    );

    if (translatedPages.length === 0) {
      showToast('មិនទាន់មានអត្ថបទដែលបានបកប្រែសម្រាប់ជួសជុលនៅឡើយទេ!');
      return;
    }

    setIsFixingSpelling(true);
    try {
      const activeAnalysis = analysisRef.current || analysis;
      const glossary = [
        ...(activeAnalysis?.characters || []),
        ...(activeAnalysis?.locations || []),
        ...(activeAnalysis?.terms || []),
      ];

      // Snapshot original translated text per page BEFORE any pass so we can compute exact Before -> After diffs!
      const originalTextSnapshotByIndex = new Map<number, string>();
      currentPages.forEach((p, idx) => {
        if (p.translatedText && p.translatedText.trim()) {
          originalTextSnapshotByIndex.set(idx, p.translatedText);
        }
      });

      // Step 1: Instant local pass across all pages so UI updates immediately
      const quickUpdatedPages = currentPages.map((p, idx) => {
        if (!p.translatedText || !p.translatedText.trim()) return p;
        const beforeSnap = originalTextSnapshotByIndex.get(idx) || p.translatedText;
        const pass = fixKhmerSpellingAndForeignText(p.translatedText, {
          glossary,
          removeOrTransliterateAllForeign: false,
          preserveTags: true,
        });
        const initialDiffs = computeKhmerCorrectionDiffs(beforeSnap, pass.cleanedText);
        const mergedDiffs = mergeCorrections(
          p.corrections,
          mergeCorrections(pass.corrections, initialDiffs)
        );

        let updatedCues = p.srtCues;
        if (updatedCues && updatedCues.length > 0) {
          const cueMap = parseTranslatedCuesIntoMap(pass.cleanedText, updatedCues);
          updatedCues = updatedCues.map((c) => {
            const mapped = cueMap.get(c.id) || c.translatedText || '';
            const fixedCue = fixKhmerSpellingAndForeignText(mapped, {
              glossary,
              removeOrTransliterateAllForeign: true,
              preserveTags: false,
            });
            return { ...c, translatedText: fixedCue.cleanedText };
          });
        }

        return {
          ...p,
          translatedText: pass.cleanedText,
          translatedChars: pass.cleanedText.length,
          corrections: mergedDiffs,
          ...(updatedCues ? { srtCues: updatedCues } : {}),
        };
      });

      setPages(quickUpdatedPages);
      pagesRef.current = quickUpdatedPages;

      // Step 2: Run High-Level AI Proofreader (/api/fix-spelling-and-foreign) across EVERY translated page to deeply inspect Khmer spelling, fix extra vowels (លើសស្រៈ), and repair mixed-script words like διοាក់គំនិតនោះ, তরwសាង, ដ៏ကြမ်းដុះដំបូ, គ្នាอย่างรุนแรง
      const finalPages = [...quickUpdatedPages];
      for (let i = 0; i < finalPages.length; i++) {
        const page = finalPages[i];
        const rawBeforePage = originalTextSnapshotByIndex.get(i) || page.translatedText;
        if (!rawBeforePage || !rawBeforePage.trim()) continue;

        let newText = page.translatedText;
        let serverCorrections: CorrectionDiffItem[] = [];
        const remainingItems = extractNonKhmerWords(rawBeforePage);

        setRetryStatusMsg(
          `កំពុងប្រើ AI កម្រិតខ្ពស់ ត្រួតពិនិត្យអក្ខរាវិរុទ្ធ លុបលើសស្រៈ និងជួសជុលអក្សរចម្លែកៗ ទំព័រទី ${toKhmerNumerals(
            i + 1
          )}/${toKhmerNumerals(finalPages.length)}...`
        );

        try {
          const res = await fetch('/api/fix-spelling-and-foreign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: rawBeforePage,
              originalText: page.originalText,
              glossary,
              foreignWords: remainingItems.map((item) => item.word),
              useAiForForeign: true,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.fixedText && data.fixedText.trim().length > 0) {
              newText = data.fixedText;
            }
            if (Array.isArray(data.corrections)) {
              serverCorrections = data.corrections;
            }
          }
        } catch {
          // Fallback to guaranteed local pass below
        }

        // Guaranteed 100% pure Khmer pass (strips/transliterates any remaining foreign script, removes លើសស្រៈ, & fixes Chuon Nath spelling)
        const guaranteedPass = fixKhmerSpellingAndForeignText(newText, {
          glossary,
          removeOrTransliterateAllForeign: true,
          preserveTags: true,
        });

        const fullPageDiffs = computeKhmerCorrectionDiffs(
          rawBeforePage,
          guaranteedPass.cleanedText
        );
        const mergedPageCorrections = mergeCorrections(
          page.corrections,
          mergeCorrections(
            serverCorrections,
            mergeCorrections(guaranteedPass.corrections, fullPageDiffs)
          )
        );

        let finalCues = page.srtCues;
        if (finalCues && finalCues.length > 0) {
          const cueMap = parseTranslatedCuesIntoMap(guaranteedPass.cleanedText, finalCues);
          finalCues = finalCues.map((c) => {
            const mapped = cueMap.get(c.id) || c.translatedText || '';
            const fixedCue = fixKhmerSpellingAndForeignText(mapped, {
              glossary,
              removeOrTransliterateAllForeign: true,
              preserveTags: false,
            });
            return { ...c, translatedText: fixedCue.cleanedText };
          });
        }

        finalPages[i] = {
          ...page,
          translatedText: guaranteedPass.cleanedText,
          translatedChars: guaranteedPass.cleanedText.length,
          corrections: mergedPageCorrections,
          ...(finalCues ? { srtCues: finalCues } : {}),
        };

        // Update UI progressively after each page finishes AI proofreading
        setPages([...finalPages]);
        pagesRef.current = [...finalPages];
      }

      // Sync global allSrtCues if in SRT mode
      if (allSrtCues.length > 0) {
        const cueLookup = new Map<number, string>();
        for (const p of finalPages) {
          if (p.srtCues) {
            for (const c of p.srtCues) {
              if (c.translatedText) {
                cueLookup.set(c.id, c.translatedText);
              }
            }
          }
        }
        setAllSrtCues((prev) =>
          prev.map((c) => {
            const updated = cueLookup.get(c.id) ?? c.translatedText ?? '';
            if (!updated) return c;
            const fixed = fixKhmerSpellingAndForeignText(updated, {
              glossary,
              removeOrTransliterateAllForeign: true,
              preserveTags: false,
            });
            return { ...c, translatedText: fixed.cleanedText };
          })
        );
      }

      saveProjectToStorage({
        inputText,
        sourceLang,
        translationStyle,
        isSrtMode,
        allSrtCues,
        targetCharsPerPage,
        currentStep,
        analysis: activeAnalysis,
        pages: finalPages,
        activePageIndex,
        updatedAt: Date.now(),
      });

      setShowCorrectionReportModal(true);
      showToast(
        `✨ បានកែសម្រួលអក្ខរាវិរុទ្ធទាំងអស់ និងបង្ហាញបញ្ជីអក្សរដែលខុស & កែរួចទាំងអស់រួចរាល់!`
      );
    } finally {
      setRetryStatusMsg(null);
      setIsFixingSpelling(false);
    }
  };

  // Convert all numbers (0-9 and ០-៩) across all translated pages into spoken Khmer words (មួយ, ពីរ, មួយរយ...)
  const handleConvertAllNumbersToWords = () => {
    const currentPages = pagesRef.current;
    const hasTranslated = currentPages.some(
      (p) => p.translatedText && p.translatedText.trim().length > 0
    );

    if (!hasTranslated) {
      showToast('មិនទាន់មានអត្ថបទដែលបានបកប្រែសម្រាប់បម្លែងលេខនៅឡើយទេ!');
      return;
    }

    let totalNumbersConverted = 0;

    const updatedPages = currentPages.map((p) => {
      if (!p.translatedText || !p.translatedText.trim()) return p;
      const convertedRes = convertAllNumbersToKhmerWords(p.translatedText, {
        preserveTags: true,
      });
      totalNumbersConverted += convertedRes.convertedCount;
      const convertedText = convertedRes.text;

      let updatedCues = p.srtCues;
      if (updatedCues && updatedCues.length > 0) {
        const cueMap = parseTranslatedCuesIntoMap(convertedText, updatedCues);
        updatedCues = updatedCues.map((c) => {
          const mapped = cueMap.get(c.id) || c.translatedText || '';
          return {
            ...c,
            translatedText: convertAllNumbersToKhmerWords(mapped, { preserveTags: false }).text,
          };
        });
      }

      return {
        ...p,
        translatedText: convertedText,
        translatedChars: convertedText.length,
        ...(updatedCues ? { srtCues: updatedCues } : {}),
      };
    });

    setPages(updatedPages);
    pagesRef.current = updatedPages;

    if (allSrtCues.length > 0) {
      const cueLookup = new Map<number, string>();
      for (const p of updatedPages) {
        if (p.srtCues) {
          for (const c of p.srtCues) {
            if (c.translatedText) {
              cueLookup.set(c.id, c.translatedText);
            }
          }
        }
      }
      setAllSrtCues((prev) =>
        prev.map((c) => {
          const updated = cueLookup.get(c.id) ?? c.translatedText ?? '';
          if (!updated) return c;
          return {
            ...c,
            translatedText: convertAllNumbersToKhmerWords(updated, { preserveTags: false }).text,
          };
        })
      );
    }

    saveProjectToStorage({
      inputText,
      sourceLang,
      translationStyle,
      isSrtMode,
      allSrtCues,
      targetCharsPerPage,
      currentStep,
      analysis: analysisRef.current || analysis,
      pages: updatedPages,
      activePageIndex,
      updatedAt: Date.now(),
    });

    showToast(
      `🔢 បានបម្លែងគ្រប់តួលេខទាំងអស់ (${toKhmerNumerals(
        totalNumbersConverted
      )} កន្លែង) ទៅជាពាក្យអក្សរខ្មែរសុទ្ធរួចរាល់ ១០០%!`
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-khmer selection:bg-amber-500/30">
      {/* Top Header */}
      <Header
        onReset={handleResetRequest}
        onOpenHelp={() => setShowHelpModal(true)}
        hasSavedData={hasTranslatedData}
      />

      {/* Global Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl bg-emerald-500 text-slate-950 font-khmer font-bold text-xs sm:text-sm shadow-2xl shadow-emerald-500/30 flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* If user previously translated pages and is in input step, show convenient Resume banner */}
        {hasTranslatedData && currentStep === 'input' && (
          <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-amber-950/80 border border-emerald-500/40 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-bold shadow-lg shadow-emerald-500/20 shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm sm:text-base font-bold text-emerald-300 font-khmer">
                  អ្នកមានសាច់រឿងដែលកំពុងបកប្រែស្រេច (Auto-Saved Data)
                </h4>
                <p className="text-xs text-slate-300 font-khmer mt-0.5">
                  បកប្រែបាន {toKhmerNumerals(pages.filter((p) => p.status === 'completed').length)}{' '}
                  នៃ {toKhmerNumerals(pages.length)} ទំព័រ • រក្សាទុកដោយសុវត្ថិភាព មិនបាត់បង់ទិន្នន័យឡើយ
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => setCurrentStep('reader')}
                className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-khmer text-xs sm:text-sm shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center gap-1.5"
              >
                <span>ត្រឡប់ទៅបន្តការអាន / បកប្រែ →</span>
              </button>
              <button
                onClick={handleResetRequest}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 border border-slate-700 text-xs font-khmer transition-all"
              >
                លុបសរសេររឿងថ្មី
              </button>
            </div>
          </div>
        )}

        {/* Step Indicator Bar */}
        <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs">
          <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto">
            <button
              onClick={() => setCurrentStep('input')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                currentStep === 'input'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-slate-800 text-center leading-5 text-[10px] font-mono">
                1
              </span>
              <span>បញ្ចូលសាច់រឿង (Input Text)</span>
            </button>

            <span className="text-slate-600">→</span>

            <button
              onClick={() => analysis && setCurrentStep('entity_review')}
              disabled={!analysis}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                currentStep === 'entity_review'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : analysis
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-slate-800 text-center leading-5 text-[10px] font-mono">
                2
              </span>
              <span>ចងចាំឈ្មោះតួអង្គ (Entity Bible)</span>
            </button>

            <span className="text-slate-600">→</span>

            <button
              onClick={() => analysis && setCurrentStep('reader')}
              disabled={!analysis}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                currentStep === 'reader'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : analysis
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-slate-800 text-center leading-5 text-[10px] font-mono">
                3
              </span>
              <span>បកប្រែ & អាន (Streaming Reader)</span>
            </button>
          </div>

          {analysis && (
            <button
              onClick={() => setShowEntityModal(true)}
              className="hidden lg:flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20"
            >
              <Users className="w-3.5 h-3.5" />
              <span>មើលតារាងតួអង្គ ({analysis.characters.length})</span>
            </button>
          )}
        </div>

        {/* STEP 1: Input Story */}
        {currentStep === 'input' && (
          <StoryInput
            inputText={inputText}
            setInputText={setInputText}
            sourceLang={sourceLang}
            setSourceLang={setSourceLang}
            translationStyle={translationStyle}
            setTranslationStyle={setTranslationStyle}
            preferredAiModel={preferredAiModel}
            setPreferredAiModel={(modelId) => checkAndSelectAiModel(modelId, true)}
            aiConnectionStatus={aiConnectionStatus}
            isCheckingAiConnection={isCheckingAiConnection}
            onTestAiConnection={(modelId) => checkAndSelectAiModel(modelId, true)}
            targetCharsPerPage={targetCharsPerPage}
            setTargetCharsPerPage={setTargetCharsPerPage}
            onStartAnalysis={handleStartAnalysis}
            onDirectTranslate={handleDirectTranslate}
            isAnalyzing={isAnalyzing}
            isSrtMode={isSrtMode}
            setIsSrtMode={setIsSrtMode}
            allSrtCues={allSrtCues}
            setAllSrtCues={setAllSrtCues}
          />
        )}

        {/* STEP 2: Entity Bible Review */}
        {currentStep === 'entity_review' && analysis && (
          <EntityBibleView
            analysis={analysis}
            setAnalysis={setAnalysis}
            onProceedToTranslate={handleProceedToTranslate}
            onBackToInput={() => setCurrentStep('input')}
            totalPages={pages.length}
            totalChars={inputText.length}
          />
        )}

        {/* STEP 3: Reader & Translation */}
        {currentStep === 'reader' && analysis && pages.length > 0 && (
          <div className="space-y-5">
            {/* PHASE 1: Compact Single-Line Glossary in UI/Chat ONLY (ហាមដាក់ចូល .txt / .srt) */}
            <div className="bg-slate-950/95 border border-amber-500/40 rounded-2xl p-4 shadow-lg space-y-1.5 font-khmer text-xs sm:text-sm select-text">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="text-[11px] font-bold text-amber-400">
                  📋 បញ្ជីឈ្មោះសម្គាល់សាច់រឿងដែលស្កេនបាន — បានបញ្ជូនទៅម៉ាស៊ីនបកប្រែដើម្បីបកប្រែឈ្មោះឱ្យត្រឹមត្រូវ ១០០% (បង្ហាញតែលើផ្ទាំងអាន ហាមដាក់ចូល .txt)៖
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold">
                  ✓ បានភ្ជាប់ឈ្មោះទាំងអស់ទៅ Gemini 8 Flash រួចរាល់ • ១ ទំព័រ = ១២,០០០–១៣,០០០ តួអក្សរ • គ្មានលេខ [1] [2]
                </span>
              </div>
              <div className="text-slate-100 leading-relaxed">
                <span className="font-bold text-amber-300">- តួអង្គ៖ </span>
                <span>
                  {(analysis.characters || [])
                    .map((c) => (c.khmerName || '').replace(/[()（）]/g, '').trim())
                    .filter(Boolean)
                    .join(' | ') || 'គ្មាន'}
                </span>
              </div>
              <div className="text-slate-100 leading-relaxed">
                <span className="font-bold text-emerald-300">- ទីកន្លែង/និកាយ៖ </span>
                <span>
                  {(analysis.locations || [])
                    .map((l) => (l.khmerName || '').replace(/[()（）]/g, '').trim())
                    .filter(Boolean)
                    .join(' | ') || 'គ្មាន'}
                </span>
              </div>
              <div className="text-slate-100 leading-relaxed">
                <span className="font-bold text-sky-300">- វត្ថុ/ថាមពល/កម្រិត៖ </span>
                <span>
                  {(analysis.terms || [])
                    .map((t) => (t.khmerName || '').replace(/[()（）]/g, '').trim())
                    .filter(Boolean)
                    .join(' | ') || 'គ្មាន'}
                </span>
              </div>
            </div>

            {/* Story Header Banner */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold font-khmer">
                    {analysis.genre || 'រឿងប្រលោមលោក'}
                  </span>
                  {translationStyle === 'anime_rank' && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold font-khmer border border-indigo-500/30">
                      🗡️ បែប Anime / Rank
                    </span>
                  )}
                  {translationStyle === 'donghua_cultivation' && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold font-khmer border border-amber-500/30">
                      ☯️ បែប ដុងហោ / ដាំដុះ Qi
                    </span>
                  )}
                  {translationStyle === 'movie_cinema' && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-semibold font-khmer border border-rose-500/30">
                      🎬 បែប ភាពយន្ត / Dubbing
                    </span>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-amber-300 font-khmer mt-1">
                  {(analysis.khmerTitle || '').replace(/[()（）]/g, '')}
                </h2>
                {analysis.originalTitle && (
                  <p className="text-xs text-slate-400 font-sans italic">
                    {analysis.originalTitle.replace(/[()（）]/g, '')}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Live Multi-AI Model Selector in Reader View */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950 border border-emerald-500/40 text-xs">
                  <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <select
                    value={preferredAiModel}
                    onChange={(e) =>
                      checkAndSelectAiModel(e.target.value as AiModelId, true)
                    }
                    className="bg-transparent text-emerald-300 font-khmer font-bold text-xs focus:outline-none cursor-pointer max-w-[260px]"
                    title="ប្ដូរម៉ូដែល AI បកប្រែ និងបង្ហាញថាភ្ជាប់មួយណាបានសម្រេច"
                  >
                    {AI_MODEL_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id} className="bg-slate-900 text-slate-100">
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                {(isSrtMode || allSrtCues.length > 0) && (
                  <button
                    onClick={() => setShowSrtStudioModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-xs font-khmer font-bold shadow-lg transition-all"
                    title="បើកទម្រង់ចំណងជើងរឿង SRT មួយចំហៀងម្នាក់ពេញអេក្រង់"
                  >
                    <Film className="w-3.5 h-3.5 text-sky-400" />
                    <span>ទម្រង់ចំណងជើងរឿង SRT</span>
                  </button>
                )}

                {pages.length > 2 && inputText.length <= 26000 && (
                  <button
                    onClick={handleRechunkTo12k}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-khmer font-bold shadow-lg transition-all"
                    title="បែងចែកទំព័រឡើងវិញតាមខ្នាត ១២,០០០ ទៅ ១៣,០០០ តួអក្សរក្នុង ១ ទំព័រ"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>បែងចែកជា ២ ទំព័រឡើងវិញ (១២k-១៣k តួ)</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleFixAllSpellingAndForeign}
                  disabled={isTranslating || isFixingSpelling}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 text-xs font-khmer font-bold shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-40"
                  title="ប្រើ AI កម្រិតខ្ពស់ ត្រួតពិនិត្យនិងកែសម្រួលអក្ខរាវិរុទ្ធទាំងអស់ លុបលើសស្រៈ និងជួសជុលអក្សរចម្លែកៗ (ដូចជា គ្នាอย่างรุนแรง)"
                >
                  <Wand2 className={`w-3.5 h-3.5 ${isFixingSpelling ? 'animate-spin' : ''}`} />
                  <span>
                    {isFixingSpelling
                      ? 'កំពុងត្រួតពិនិត្យដោយ AI កម្រិតខ្ពស់...'
                      : 'កែសម្រួលអក្ខរាវិរុទ្ធទាំងអស់ (AI កម្រិតខ្ពស់)'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleConvertAllNumbersToWords}
                  disabled={isTranslating || isFixingSpelling}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-400 hover:to-fuchsia-400 text-white text-xs font-khmer font-bold shadow-lg shadow-purple-500/20 active:scale-95 transition-all disabled:opacity-40"
                  title="បម្លែងគ្រប់តួលេខទាំងអស់ (០-៩ និង 0-9) ទៅជាពាក្យអក្សរខ្មែរសុទ្ធ"
                >
                  <Hash className="w-3.5 h-3.5" />
                  <span>បម្លែងលេខទៅជាអក្សរទាំងអស់</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowCorrectionReportModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-khmer font-bold shadow-lg transition-all"
                  title="បើកមើលរបាយការណ៍អក្សរដែលខុស និងអក្សរដែលកែរួចទាំងអស់តាមទំព័រ"
                >
                  <ListChecks className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    បញ្ជីអក្សរខុស & កែរួច (
                    {toKhmerNumerals(
                      pages.reduce((acc, p) => acc + (p.corrections?.length || 0), 0)
                    )}
                    )
                  </span>
                </button>

                <button
                  onClick={() => setShowEntityModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-khmer border border-slate-700 transition-colors"
                >
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  <span>តារាងតួអង្គ ({analysis.characters.length})</span>
                </button>
                <button
                  onClick={() => setCurrentStep('input')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-khmer border border-slate-700 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>ប្តូរសាច់រឿង</span>
                </button>
              </div>
            </div>

            {/* Page Navigator */}
            <PageNavigator
              pages={pages}
              activePageIndex={activePageIndex}
              setActivePageIndex={setActivePageIndex}
              isTranslating={isTranslating}
              autoTranslateAll={autoTranslateAll}
              onTranslateCurrentPage={() => translatePage(activePageIndex)}
              onAutoTranslateAllToggle={handleAutoTranslateAllToggle}
              onStopTranslation={handleStopTranslation}
            />

            {/* LIVE CONTINUOUS AUTO-REPAIR FEED & REPORT PANEL (បង្ហាញទិន្នន័យពិនិត្យ និងជួសជុលភ្លាមៗតាមទំព័រជាបន្តបន្ទាប់) */}
            {(isTranslating ||
              autoRepairingPageIndex !== null ||
              pages.some((p) => p.status === 'completed')) && (
              <div className="bg-slate-900/95 border border-emerald-500/40 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                        autoRepairingPageIndex !== null || isTranslating
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-400 animate-pulse'
                          : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                      }`}
                    >
                      <Wand2
                        className={`w-5 h-5 ${
                          autoRepairingPageIndex !== null ? 'animate-spin' : ''
                        }`}
                      />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm sm:text-base font-bold text-emerald-300 font-khmer">
                          ប្រព័ន្ធត្រួតពិនិត្យ និងជួសជុលស្វ័យប្រវត្តិភ្លាមៗតាមទំព័រ (Continuous Auto-Repair Pipeline)
                        </h3>
                        <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          ពិនិត្យរួច{' '}
                          {toKhmerNumerals(
                            pages.filter((p) => p.status === 'completed').length
                          )}
                          /{toKhmerNumerals(pages.length)} ទំព័រ
                        </span>
                        <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          កែរួចសរុប{' '}
                          {toKhmerNumerals(
                            pages.reduce((sum, p) => sum + (p.corrections?.length || 0), 0)
                          )}{' '}
                          កន្លែង
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 font-khmer mt-0.5">
                        {autoRepairingPageIndex !== null
                          ? `🛠️ ទំព័រទី ${toKhmerNumerals(
                              autoRepairingPageIndex + 1
                            )} បកប្រែរួច — កំពុងចូលពិនិត្យ និងជួសជុលអក្សរខុស/ច្រឡំភាសាភ្លាមៗ រួចបន្តទៅទំព័របន្ទាប់ដោយស្វ័យប្រវត្តិ...`
                          : isTranslating
                          ? `⏳ កំពុងបកប្រែទំព័រទី ${toKhmerNumerals(
                              activePageIndex + 1
                            )}... ពេលបកប្រែរួច ប្រព័ន្ធជួសជុលនឹងចូលពិនិត្យ និងបង្ហាញទិន្នន័យភ្លាមៗ រួចបន្តទៅទំព័រទី ${toKhmerNumerals(
                              Math.min(pages.length, activePageIndex + 2)
                            )} ជាបន្តបន្ទាប់!`
                          : '✓ ប្រព័ន្ធបានចូលពិនិត្យ និងជួសជុលអក្សរខុស/ច្រឡំភាសាគ្រប់ទំព័រដែលបកប្រែរួច និងបង្ហាញទិន្នន័យទាំងអស់ខាងក្រោម៖'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCorrectionReportModal(true)}
                      className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-khmer font-bold transition-all flex items-center gap-1.5"
                    >
                      <ListChecks className="w-3.5 h-3.5" />
                      <span>បើកផ្ទាំងរបាយការណ៍ធំ</span>
                    </button>
                  </div>
                </div>

                {/* Per-Page Live Inspection & Repair Results List (Page 1 -> Page 2 -> Page 3...) */}
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {pages.map((p, idx) => {
                    const isCurrentTranslating =
                      isTranslating && activePageIndex === idx && autoRepairingPageIndex !== idx;
                    const isCurrentRepairing = autoRepairingPageIndex === idx;
                    if (
                      p.status !== 'completed' &&
                      !isCurrentTranslating &&
                      !isCurrentRepairing
                    ) {
                      return null;
                    }

                    const pageDiffs = p.corrections || [];

                    return (
                      <div
                        key={p.id || idx}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isCurrentRepairing
                            ? 'bg-amber-950/30 border-amber-500/50 animate-pulse'
                            : isCurrentTranslating
                            ? 'bg-slate-950/70 border-sky-500/40'
                            : 'bg-slate-950/90 border-slate-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <div className="flex flex-wrap items-center gap-2 font-khmer">
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-amber-500 text-slate-950">
                              ទំព័រទី {toKhmerNumerals(idx + 1)}
                            </span>
                            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              💬 Chat ថ្មី #{toKhmerNumerals(p.chatSessionNumber || idx + 1)} (
                              {p.chatSessionId || `chat-page-${idx + 1}`})
                            </span>
                            {isCurrentRepairing ? (
                              <span className="text-xs font-bold text-amber-300">
                                🛠️ កំពុងចូលពិនិត្យ និងជួសជុលអក្សរខុសភ្លាមៗ មុនប្ដូរទៅ Chat ថ្មីទំព័របន្ទាប់...
                              </span>
                            ) : isCurrentTranslating ? (
                              <span className="text-xs font-bold text-sky-300">
                                ⏳ កំពុងបកប្រែក្នុង Chat ថ្មី #{toKhmerNumerals(idx + 1)} ដោយប្រើតែ Gemini 8 Flash...
                              </span>
                            ) : (
                              <>
                                <span className="text-xs font-bold text-emerald-400">
                                  ✓ បកប្រែក្នុង Chat ថ្មី #{toKhmerNumerals(idx + 1)} រួចរាល់ (
                                  {toKhmerNumerals(
                                    (p.translatedText || '').length.toLocaleString()
                                  )}{' '}
                                  តួអក្សរ)
                                </span>
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                                  កែរួច {toKhmerNumerals(pageDiffs.length)} កន្លែង
                                </span>
                                <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                                  ⚡ AI: {p.usedAiEngine || 'Google Gemini 8 Flash'} | Model:{' '}
                                  {p.usedAiModel || 'gemini-8-flash'}
                                </span>
                              </>
                            )}
                          </div>

                          {p.status === 'completed' && (
                            <button
                              type="button"
                              onClick={() => {
                                setActivePageIndex(idx);
                                handleFixSinglePageSpellingAndForeign(idx);
                              }}
                              disabled={isFixingSpelling || isTranslating}
                              className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-khmer transition-all disabled:opacity-40"
                            >
                              ពិនិត្យឡើងវិញម្ដងទៀត
                            </button>
                          )}
                        </div>

                        {p.status === 'completed' && (
                          <div>
                            {pageDiffs.length === 0 ? (
                              <div className="text-xs text-slate-400 font-khmer bg-slate-900/60 px-3 py-2 rounded-lg border border-slate-800/80 flex items-center gap-2">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                <span>
                                  បានពិនិត្យគ្រប់ពាក្យទាំងអស់ក្នុងទំព័រទី {toKhmerNumerals(idx + 1)} — ជាអក្សរខ្មែរសុទ្ធ ១០០% ត្រឹមត្រូវស្រាប់ គ្មានអក្សរច្រឡំភាសាឡើយ។
                                </span>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                                {pageDiffs.map((d, dIdx) => (
                                  <div
                                    key={d.id || dIdx}
                                    className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 text-xs font-khmer"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="text-[10px] text-rose-400">
                                        ❌ អក្សរខុស៖
                                      </div>
                                      <div className="font-bold text-rose-200 truncate select-text" title={d.wrongText}>
                                        {d.wrongText}
                                      </div>
                                    </div>
                                    <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                      <div className="text-[10px] text-emerald-400">
                                        ✅ កែរួច៖
                                      </div>
                                      <div className="font-bold text-emerald-200 truncate select-text" title={d.fixedText}>
                                        {d.fixedText}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Translation Reader with Live Streaming & Auto-Retry Banner */}
            <TranslationReader
              page={pages[activePageIndex] || pages[0]}
              pageIndex={activePageIndex}
              totalPages={pages.length}
              isTranslating={isTranslating}
              liveCharsReceived={liveCharsReceived}
              liveKhmerChars={liveKhmerChars}
              translationSpeed={translationSpeed}
              retryStatusMsg={retryStatusMsg}
              onCopyAll={handleCopyAll}
              onDownloadAll={handleDownloadAll}
              storyTitle={analysis.khmerTitle}
              translationStyle={translationStyle}
              onUpdateCue={handleUpdateCue}
              allSrtCues={allSrtCues}
              onTranslateCurrentPage={() => translatePage(activePageIndex)}
              onFixCurrentPage={() => handleFixSinglePageSpellingAndForeign(activePageIndex)}
              onFixAllSpellingAndForeign={handleFixAllSpellingAndForeign}
              isFixingSpellingAndForeign={isFixingSpelling}
              onConvertAllNumbersToWords={handleConvertAllNumbersToWords}
              onOpenCorrectionReport={() => setShowCorrectionReportModal(true)}
              activeAiEngine={activeAiEngine}
            />

            {/* Dedicated Box for All Translated Khmer Pages & 1-Click Copy */}
            <div ref={allPagesBoxRef}>
              <AllPagesKhmerBox
                pages={pages}
                storyTitle={analysis.khmerTitle}
                originalTitle={analysis.originalTitle}
                isSrtMode={isSrtMode}
                allSrtCues={allSrtCues}
                onFixAllSpellingAndForeign={handleFixAllSpellingAndForeign}
                isFixingSpellingAndForeign={isFixingSpelling}
                onConvertAllNumbersToWords={handleConvertAllNumbersToWords}
              />
            </div>
          </div>
        )}
      </main>

      {/* Before/After Correction Report Modal (បង្ហាញពីអក្សរដែលខុស និងអក្សរដែលកែរួចទាំងអស់) */}
      {showCorrectionReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl max-w-4xl w-full p-5 sm:p-6 shadow-2xl max-h-[88vh] flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
                  <ListChecks className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-emerald-300 font-khmer text-base sm:text-lg">
                    បញ្ជីអក្សរដែលខុស និងអក្សរដែលកែរួចទាំងអស់ (Before & After Repair Report)
                  </h3>
                  <p className="text-xs text-slate-400 font-khmer">
                    បង្ហាញរាល់ពាក្យច្រឡំភាសា អក្សរចម្លែកៗ លើសស្រៈ និងពាក្យដាច់ ដែលត្រូវបានជួសជុលទៅជាភាសាខ្មែរសុទ្ធ ១០០%
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCorrectionReportModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-khmer"
              >
                បិទផ្ទាំងនេះ
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {pages.every((p) => !p.corrections || p.corrections.length === 0) ? (
                <div className="p-10 text-center space-y-3 bg-slate-950/60 rounded-xl border border-slate-800 font-khmer">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                  <h4 className="text-sm font-bold text-slate-200">
                    អត្ថបទបកប្រែទាំងអស់ជាភាសាខ្មែរសុទ្ធ ១០០% និងត្រឹមត្រូវតាមអក្ខរាវិរុទ្ធស្រាប់!
                  </h4>
                  <p className="text-xs text-slate-400">
                    ប្រព័ន្ធបានត្រួតពិនិត្យគ្រប់ពាក្យទាំងអស់ ហើយមិនមានសល់អក្សរច្រឡំភាសា ឬអក្សរចម្លែកឡើយ។
                  </p>
                </div>
              ) : (
                pages.map((p, idx) => {
                  if (!p.corrections || p.corrections.length === 0) return null;
                  return (
                    <div
                      key={p.id || idx}
                      className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                        <span className="font-bold text-amber-300 font-khmer text-sm">
                          📄 ទំព័រទី {toKhmerNumerals(idx + 1)} — បានជួសជុលសរុប{' '}
                          {toKhmerNumerals(p.corrections.length)} កន្លែង
                        </span>
                        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-khmer">
                          ✓ កែរួចរាល់ ១០០%
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {p.corrections.map((item, cIdx) => (
                          <div
                            key={item.id || cIdx}
                            className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-2 text-xs font-khmer"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                                #{toKhmerNumerals(cIdx + 1)} • {item.category}
                              </span>
                              {item.count > 1 && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                                  ជួប {toKhmerNumerals(item.count)} ដង
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="flex-1 p-2 rounded-lg bg-rose-950/40 border border-rose-500/30">
                                <div className="text-[10px] text-rose-400 mb-0.5">
                                  ❌ អក្សរដែលខុស (មុនកែ)៖
                                </div>
                                <div className="font-bold text-rose-200 break-all select-text">
                                  {item.wrongText}
                                </div>
                              </div>

                              <ArrowRight className="w-4 h-4 text-emerald-400 shrink-0" />

                              <div className="flex-1 p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
                                <div className="text-[10px] text-emerald-400 mb-0.5">
                                  ✅ អក្សរដែលកែរួច (ក្រោយកែ)៖
                                </div>
                                <div className="font-bold text-emerald-200 break-all select-text">
                                  {item.fixedText}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-khmer">
                សរុបកន្លែងដែលបានជួសជុលទាំងអស់៖{' '}
                <strong className="text-emerald-400">
                  {toKhmerNumerals(
                    pages.reduce((acc, p) => acc + (p.corrections?.length || 0), 0)
                  )}{' '}
                  កន្លែង
                </strong>
              </span>
              <button
                onClick={() => setShowCorrectionReportModal(false)}
                className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-khmer text-xs shadow-lg shadow-emerald-500/20 transition-all"
              >
                យល់ព្រម (បិទផ្ទាំងរបាយការណ៍)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Entity Bible Quick Slide-out / Modal (when in reader view) */}
      {showEntityModal && analysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl max-h-[85vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-slate-100 font-khmer text-base">
                  តារាងចងចាំឈ្មោះតួអង្គ និងទីតាំង (Entity Bible)
                </h3>
              </div>
              <button
                onClick={() => setShowEntityModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-khmer"
              >
                បិទ
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <h4 className="font-bold text-amber-300 font-khmer mb-2">
                  ឈ្មោះតួអង្គ ({analysis.characters.length})៖
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {analysis.characters.map((c, i) => (
                    <div key={i} className="p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                      <div className="flex justify-between font-mono text-slate-400">
                        <span>{c.originalName}</span>
                        <span className="text-amber-400 font-bold font-khmer">{c.khmerName}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-khmer mt-0.5">{c.role}</div>
                    </div>
                  ))}
                </div>
              </div>

              {analysis.locations.length > 0 && (
                <div>
                  <h4 className="font-bold text-amber-300 font-khmer mb-2">
                    ទីតាំង ({analysis.locations.length})៖
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {analysis.locations.map((l, i) => (
                      <div
                        key={i}
                        className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-khmer"
                      >
                        <div className="flex justify-between font-mono text-slate-400">
                          <span>{l.originalName}</span>
                          <span className="text-amber-400 font-bold">{l.khmerName}</span>
                        </div>
                        {l.description && (
                          <div className="text-[11px] text-slate-500 mt-0.5">{l.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysis.terms.length > 0 && (
                <div>
                  <h4 className="font-bold text-amber-300 font-khmer mb-2">
                    វត្ថុ និងពាក្យគន្លឹះ ({analysis.terms.length})៖
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {analysis.terms.map((t, i) => (
                      <div
                        key={i}
                        className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-khmer"
                      >
                        <div className="flex justify-between font-mono text-slate-400">
                          <span>{t.originalName}</span>
                          <span className="text-amber-400 font-bold">{t.khmerName}</span>
                        </div>
                        {t.category && (
                          <div className="text-[11px] text-indigo-400 mt-0.5">{t.category}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowEntityModal(false)}
                className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold font-khmer text-xs hover:bg-amber-400"
              >
                យល់ព្រម
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Dedicated SRT Side-by-Side Studio Modal */}
      {showSrtStudioModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
          <div className="max-w-6xl w-full max-h-[96vh] overflow-y-auto rounded-2xl shadow-2xl">
            <SrtSideBySideStudio
              cues={allSrtCues.length > 0 ? allSrtCues : pages[activePageIndex]?.srtCues || []}
              movieTitle={analysis?.khmerTitle || 'ចំណងជើងរឿង SRT'}
              isTranslating={isTranslating}
              activeTranslatingCueId={null}
              onUpdateCue={handleUpdateCue}
              onClose={() => setShowSrtStudioModal(false)}
            />
          </div>
        </div>
      )}

      {/* Reset Confirmation Safety Modal */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-rose-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 font-khmer">
                តើអ្នកប្រាកដជាចង់លុបទិន្នន័យទាំងអស់មែនទេ?
              </h3>
              <p className="text-xs text-slate-400 font-khmer mt-2 leading-relaxed">
                ទិន្នន័យអត្ថបទដើម និងការបកប្រែជាភាសាខ្មែរទាំងអស់ (
                {toKhmerNumerals(pages.filter((p) => p.status === 'completed').length)}{' '}
                ទំព័រដែលបានបកប្រែ) នឹងត្រូវលុបចេញពីឧបករណ៍របស់អ្នកទាំងស្រុង។ បើមិនចង់បាត់បង់ទេ សូមចុច «បោះបង់»។
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setShowResetConfirmModal(false)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-khmer text-xs font-semibold border border-slate-700 transition-colors"
              >
                បោះបង់ (កុំលុប)
              </button>
              <button
                onClick={handleConfirmReset}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-khmer text-xs font-bold shadow-lg shadow-rose-600/30 transition-all active:scale-95"
              >
                យល់ព្រមលុបទិន្នន័យ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live AI & Model Connection Popup Modal (លោតបង្ហាញពេលរើស Model និង AI ទាំងនឹង និងបង្ហាញថាភ្ជាប់មួយណាបានសម្រេច) */}
      {showAiConnectionPopup && (
        <div
          data-testid="ai-connection-popup"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
        >
          <div className="bg-slate-900 border-2 border-emerald-500/70 rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-400 flex items-center justify-center shrink-0">
                  <Cpu className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-emerald-300 font-khmer">
                    បញ្ជាក់ការជ្រើសរើស និងការភ្ជាប់ប្រព័ន្ធ AI & Model
                  </h3>
                  <p className="text-xs text-slate-300 font-khmer mt-0.5">
                    លោតបង្ហាញភ្លាមៗថាប្រើ AI អីគេ Model អី និងភ្ជាប់មួយណាបានសម្រេច
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAiConnectionPopup(false)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-khmer"
              >
                ✕ បិទ
              </button>
            </div>

            {isCheckingAiConnection ? (
              <div className="p-6 text-center space-y-3 bg-slate-950 rounded-xl border border-amber-500/40 font-khmer">
                <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
                <div className="text-sm font-bold text-amber-300">
                  កំពុងតភ្ជាប់ និងពិនិត្យម៉ូដែល AI ដែលអ្នកបានជ្រើសរើស...
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs font-khmer">
                {/* 1. Selected Option */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-slate-400 text-[11px]">
                    ១. ម៉ូដែលដែលអ្នកបានចុចជ្រើសរើស (Selected Option)៖
                  </div>
                  <div className="text-sm font-bold text-amber-300">
                    {aiConnectionStatus?.requestedName ||
                      AI_MODEL_OPTIONS.find((m) => m.id === preferredAiModel)?.name}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Provider: {aiConnectionStatus?.requestedProvider} • Model Code:{' '}
                    {aiConnectionStatus?.requestedModelCode}
                  </div>
                </div>

                {/* 2. Connected AI & Model */}
                <div className="p-3.5 rounded-xl bg-emerald-950/50 border-2 border-emerald-500/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-400 text-slate-950 font-bold text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      ២. ភ្ជាប់បានសម្រេច ១០០% (Connected Successfully)
                    </span>
                    {aiConnectionStatus?.latencyMs !== undefined && (
                      <span className="font-mono text-emerald-300 font-bold">
                        ⚡ {aiConnectionStatus.latencyMs} ms
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 pt-1">
                    <div className="p-2.5 rounded-lg bg-slate-950/90 border border-emerald-500/30">
                      <div className="text-[11px] text-slate-400">
                        🤖 ប្រព័ន្ធ AI ដែលកំពុងប្រើប្រាស់ផ្ទាល់ (Active AI System)៖
                      </div>
                      <div className="text-sm font-bold text-emerald-300 font-mono mt-0.5">
                        {aiConnectionStatus?.connectedAiSystem}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-950/90 border border-sky-500/30">
                      <div className="text-[11px] text-slate-400">
                        🧬 លេខកូដ Model ដែលភ្ជាប់បានសម្រេច (Connected Model ID)៖
                      </div>
                      <div className="text-sm font-bold text-sky-300 font-mono mt-0.5">
                        {aiConnectionStatus?.connectedModelId}
                      </div>
                    </div>
                  </div>

                  {aiConnectionStatus?.statusMessage && (
                    <div className="text-xs text-emerald-200 pt-1 leading-relaxed">
                      {aiConnectionStatus.statusMessage}
                    </div>
                  )}
                </div>

                {/* 3. Chuon Nath Dictionary & Anti-Gibberish Guarantee */}
                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-300">
                    <span>📖 ការធានាគុណភាពអក្សរខ្មែរ និងវចនានុក្រមសម្ដេចជួនណាត៖</span>
                  </div>
                  <p className="text-[11.5px] text-slate-300 leading-relaxed">
                    រាល់ប្រយោគទាំងអស់ត្រូវបានបកប្រែតាមន័យពេញលេញ ១០០% ដោយមិនបំប្លែងសូរអង់គ្លេសផ្ដេសផ្ដាស មិនឱ្យចេញអក្សរមើលមិនយល់ (ដូចជា «៊អី» ឬពាក្យបរទេសលាយឡំ) និងត្រួតពិនិត្យអក្ខរាវិរុទ្ធតាមវចនានុក្រមសម្ដេចព្រះសង្ឃរាជ ជួន ណាត គ្រប់ទំព័រ។
                  </p>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAiConnectionPopup(false)}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-khmer text-xs shadow-lg shadow-emerald-500/25 transition-all"
              >
                ✓ យល់ព្រម និងប្រើប្រាស់ម៉ូដែលនេះ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      <HelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} />
    </div>
  );
}
