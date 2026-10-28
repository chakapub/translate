import React, { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { StoryInput } from './components/StoryInput';
import { EntityBibleView } from './components/EntityBibleView';
import { PageNavigator } from './components/PageNavigator';
import { TranslationReader } from './components/TranslationReader';
import { AllPagesKhmerBox } from './components/AllPagesKhmerBox';
import { HelpModal } from './components/HelpModal';
import { SrtSideBySideStudio } from './components/SrtSideBySideStudio';
import { splitIntoPages, splitSrtIntoPages, PageChunk } from './utils/chunker';
import { cleanKhmerPunctuation, toKhmerNumerals } from './utils/khmerCleaner';
import { StoryAnalysis, TranslationStyle } from './types';
import {
  saveProjectToStorage,
  loadProjectFromStorage,
  clearProjectFromStorage,
  SavedStoryProject,
} from './utils/storage';
import {
  isSrtContent,
  parseSrt,
  parseTranslatedCuesIntoMap,
  syncCuesWithTextLines,
  buildSrt,
  SrtCue,
} from './utils/srtParser';
import { Sparkles, Users, BookOpen, AlertCircle, ArrowLeft, Trash2, CheckCircle2, Film } from 'lucide-react';

export default function App() {
  // Input state - clean & empty by default as requested
  const [inputText, setInputText] = useState<string>('');
  const [sourceLang, setSourceLang] = useState<'auto' | 'en' | 'hi'>('en');
  const [translationStyle, setTranslationStyle] = useState<TranslationStyle>('anime_rank');
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
  const [showEntityModal, setShowEntityModal] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState<boolean>(false);
  const [showSrtStudioModal, setShowSrtStudioModal] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const speedTimerRef = useRef<{ lastChars: number; lastTime: number } | null>(null);
  const pagesRef = useRef<PageChunk[]>([]);
  const analysisRef = useRef<StoryAnalysis | null>(null);
  const isAutoTranslatingRef = useRef<boolean>(false);
  const allPagesBoxRef = useRef<HTMLDivElement>(null);
  const isInitializedRef = useRef<boolean>(false);

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
          // If stored text contains old sample story, purge it completely
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
            const targetSize = Math.max(12000, saved.targetCharsPerPage || 12500);
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
            // Clean up any erroneous 'completed' status on pages that have no actual translated text
            restoredPages = restoredPages.map((p) => {
              if (p.status === 'completed' && (!p.translatedText || p.translatedText.trim().length === 0)) {
                return { ...p, status: 'idle', translatedChars: 0 };
              }
              return p;
            });

            // If pages were saved with old smaller chunk sizes (e.g. 14,047 chars split into 4 pages)
            // and no translations have been done yet, re-chunk to 12,000 - 13,000 chars!
            const hasTranslations = restoredPages.some((p) => p.translatedText && p.translatedText.trim().length > 0);
            if (!hasTranslations && (saved.inputText || cuesToUse.length > 0)) {
              if (isSavedSrt && cuesToUse.length > 0) {
                restoredPages = splitSrtIntoPages(cuesToUse, { targetChars: 12500, hardMaxLimit: 50000 });
              } else if (saved.inputText) {
                restoredPages = splitIntoPages(saved.inputText, { targetChars: 12500, hardMaxLimit: 50000 });
              }
            }
            setPages(restoredPages);
            setActivePageIndex(saved.activePageIndex || 0);
          }
        } else {
          // Fresh clean start - no preloaded sample story
          setInputText('');
          setPages([]);
          setAllSrtCues([]);
          setIsSrtMode(false);
        }
      } catch (err) {
        console.warn('Error loading saved project:', err);
      } finally {
        isInitializedRef.current = true;
      }
    }
    initProject();
  }, []);

  // 2. Auto-Save: Automatically persist changes to IndexedDB only when NOT actively translating
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (isTranslating) return; // Do NOT block main thread with IndexedDB writes during active stream!

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
    }, 1000);

    return () => clearTimeout(timeout);
  }, [inputText, sourceLang, translationStyle, isSrtMode, allSrtCues, targetCharsPerPage, currentStep, analysis, pages, activePageIndex, isTranslating]);

  // 3. Re-chunk pages ONLY when in input step AND user has NOT translated any pages yet
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (currentStep !== 'input') return;

    // Do NOT wipe pages if translated text already exists!
    const hasTranslations = pages.some((p) => p.translatedText && p.translatedText.trim().length > 0);
    if (hasTranslations) {
      return;
    }

    if (inputText.trim()) {
      const isSrt = Boolean(isSrtMode || allSrtCues.length > 0 || isSrtContent(inputText));
      if (isSrt) {
        let cuesToUse = allSrtCues;
        if (cuesToUse.length === 0 && isSrtContent(inputText)) {
          cuesToUse = parseSrt(inputText);
          setAllSrtCues(cuesToUse);
        } else if (cuesToUse.length > 0) {
          cuesToUse = syncCuesWithTextLines(cuesToUse, inputText);
        }
        const chunked = splitSrtIntoPages(cuesToUse, { targetChars: targetCharsPerPage, hardMaxLimit: 50000 });
        setPages(chunked);
      } else {
        const chunked = splitIntoPages(inputText, { targetChars: targetCharsPerPage, hardMaxLimit: 50000 });
        setPages(chunked);
      }
    } else {
      setPages([]);
      if (!isSrtMode) setAllSrtCues([]);
    }
  }, [inputText, isSrtMode, allSrtCues.length, targetCharsPerPage, currentStep]);

  // Step 1 -> Step 2: Trigger Gemini pre-analysis of the whole story (up to 350k+ chars)
  const handleStartAnalysis = async () => {
    if (!inputText.trim()) return;

    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/analyze-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullText: inputText,
          sourceLang,
          translationStyle,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'ការវិភាគសាច់រឿងបរាជ័យ');
      }

      const data = await res.json();
      setAnalysis(data.analysis);
      setCurrentStep('entity_review');
    } catch (err: any) {
      console.warn('Analysis error caught, falling back to quick setup:', err);
      // Fallback setup so user is NEVER blocked
      const fallbackAnalysis: StoryAnalysis = {
        originalTitle: inputText.trim().split('\n')[0].slice(0, 80) || 'សាច់រឿង',
        khmerTitle: 'រឿងប្រលោមលោកខ្មែរសុទ្ធ',
        storyOverview: 'សាច់រឿងពេញលេញត្រូវបានរៀបចំរួចរាល់សម្រាប់ការបកប្រែជាភាសាខ្មែរសុទ្ធ ១០០% តាមលំដាប់ទំព័រ មិនសង្ខេបន័យ។',
        characters: [],
        locations: [],
        terms: [],
      };
      setAnalysis(fallbackAnalysis);
      setCurrentStep('entity_review');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Direct Translate: bypass analysis and start translating immediately
  const handleDirectTranslate = () => {
    if (!inputText.trim()) return;

    const directAnalysis: StoryAnalysis = analysis || analysisRef.current || {
      originalTitle: inputText.trim().split('\n')[0].slice(0, 80) || 'សាច់រឿង',
      khmerTitle: 'រឿងប្រលោមលោកខ្មែរសុទ្ធ',
      storyOverview: 'សាច់រឿងបកប្រែជាភាសាខ្មែរសុទ្ធ ១០០% មិនសង្ខេបន័យ។',
      characters: [],
      locations: [],
      terms: [],
    };
    analysisRef.current = directAnalysis;
    setAnalysis(directAnalysis);

    const isSrt = Boolean(isSrtMode || allSrtCues.length > 0 || isSrtContent(inputText));
    let activePages = pages;
    // Only re-chunk if no translated pages exist yet
    if (activePages.length === 0 || !activePages.some((p) => p.translatedText)) {
      if (isSrt) {
        let cuesToUse = allSrtCues;
        if (cuesToUse.length === 0 && isSrtContent(inputText)) {
          cuesToUse = parseSrt(inputText);
          setAllSrtCues(cuesToUse);
        } else if (cuesToUse.length > 0) {
          cuesToUse = syncCuesWithTextLines(cuesToUse, inputText);
          setAllSrtCues(cuesToUse);
        }
        activePages = splitSrtIntoPages(cuesToUse, { targetChars: targetCharsPerPage, hardMaxLimit: 50000 });
      } else {
        activePages = splitIntoPages(inputText, { targetChars: targetCharsPerPage, hardMaxLimit: 50000 });
      }
      setPages(activePages);
    }

    setActivePageIndex(0);
    setCurrentStep('reader');

    // Only start translation on Page 1 if it is not already completed
    if (!activePages[0]?.translatedText) {
      setTimeout(() => {
        startTranslateSpecificPage(activePages, 0, directAnalysis);
      }, 100);
    }
  };

  // Step 2 -> Step 3: Confirm Entity Bible and immediately proceed & translate Page 1
  const handleProceedToTranslate = () => {
    const isSrt = Boolean(isSrtMode || allSrtCues.length > 0 || isSrtContent(inputText));
    let activePages = pages;
    // Only re-chunk if no translated pages exist yet
    if (activePages.length === 0 || !activePages.some((p) => p.translatedText)) {
      if (isSrt) {
        let cuesToUse = allSrtCues;
        if (cuesToUse.length === 0 && isSrtContent(inputText)) {
          cuesToUse = parseSrt(inputText);
          setAllSrtCues(cuesToUse);
        } else if (cuesToUse.length > 0) {
          cuesToUse = syncCuesWithTextLines(cuesToUse, inputText);
          setAllSrtCues(cuesToUse);
        }
        activePages = splitSrtIntoPages(cuesToUse, { targetChars: targetCharsPerPage, hardMaxLimit: 50000 });
      } else {
        activePages = splitIntoPages(inputText, { targetChars: targetCharsPerPage, hardMaxLimit: 50000 });
      }
      setPages(activePages);
    }

    setActivePageIndex(0);
    setCurrentStep('reader');

    const effectiveAnalysis = analysis || analysisRef.current || undefined;

    // Only trigger translation for Page 1 if not already translated
    if (!activePages[0]?.translatedText) {
      setTimeout(() => {
        startTranslateSpecificPage(activePages, 0, effectiveAnalysis);
      }, 100);
    }
  };

  const hasTranslatedData = pages.some((p) => Boolean(p.translatedText && p.translatedText.trim().length > 0));

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

  // Dedicated helper to start translation on a specific page with explicit pages array
  const startTranslateSpecificPage = async (
    currentPages: PageChunk[],
    pageIdx: number,
    overrideAnalysis?: StoryAnalysis
  ): Promise<boolean> => {
    if (!currentPages || !currentPages[pageIdx]) return false;

    const activeAnalysis: StoryAnalysis =
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
    analysisRef.current = activeAnalysis;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsTranslating(true);
    setActivePageIndex(pageIdx);
    setLiveCharsReceived(currentPages[pageIdx].charCount);
    setLiveKhmerChars(0);
    setTranslationSpeed(0);

    speedTimerRef.current = { lastChars: 0, lastTime: Date.now() };

    setPages((prev) =>
      prev.map((p, i) =>
        i === pageIdx
          ? { ...p, status: 'translating', translatedText: '', translatedChars: 0 }
          : p
      )
    );

    const previousSummaries = currentPages
      .slice(0, pageIdx)
      .map((p, i) => `[ទំព័រទី ${i + 1}]: ${p.summary || p.translatedText.slice(0, 150) + '...'}`)
      .join('\n');

    const previousTail =
      pageIdx > 0 && currentPages[pageIdx - 1]?.translatedText
        ? currentPages[pageIdx - 1].translatedText.slice(-250)
        : '';

    try {
      const response = await fetch('/api/translate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          chunkText: currentPages[pageIdx].originalText,
          chunkIndex: pageIdx,
          totalChunks: currentPages.length,
          sourceLang,
          storyTitle: activeAnalysis.khmerTitle,
          characters: activeAnalysis.characters,
          locations: activeAnalysis.locations,
          terms: activeAnalysis.terms,
          pronounGuidelines: activeAnalysis.pronounGuidelines,
          previousSummary: previousSummaries,
          previousTail,
          translationStyle,
          isSrtMode: Boolean(currentPages[pageIdx]?.isSrtChunk || isSrtMode),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('បរាជ័យក្នុងការតភ្ជាប់ទៅម៉ាស៊ីនបកប្រែ');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedText = '';
      let lastRenderTime = Date.now();

      const applyStreamUpdate = (isFinal = false) => {
        const totalKhmer = accumulatedText.length;
        setLiveKhmerChars(totalKhmer);

        const pageCues = currentPages[pageIdx]?.srtCues;
        let updatedCues: SrtCue[] | undefined = undefined;
        if (pageCues && pageCues.length > 0) {
          const cueMap = parseTranslatedCuesIntoMap(accumulatedText, pageCues);
          updatedCues = pageCues.map((c) => ({
            ...c,
            translatedText: cueMap.get(c.id) || '',
          }));
        }

        if (speedTimerRef.current) {
          const now = Date.now();
          const elapsedSec = (now - speedTimerRef.current.lastTime) / 1000;
          if (elapsedSec >= 1) {
            const charsDiff = totalKhmer - speedTimerRef.current.lastChars;
            setTranslationSpeed(Math.round(charsDiff / elapsedSec));
            speedTimerRef.current = { lastChars: totalKhmer, lastTime: now };
          }
        }

        setPages((prev) =>
          prev.map((p, i) =>
            i === pageIdx
              ? {
                  ...p,
                  status: isFinal ? 'completed' : 'translating',
                  translatedText: accumulatedText,
                  translatedChars: totalKhmer,
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
        // The last line may be incomplete until next network chunk
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ')) {
            let data: any = null;
            try {
              const jsonStr = trimmedLine.replace(/^data:\s*/, '');
              data = JSON.parse(jsonStr);
            } catch {
              continue; // partial JSON parse, ignore
            }

            if (!data) continue;

            if (data.type === 'chunk' && data.text) {
              accumulatedText += data.text;
              const now = Date.now();

              // Throttle state update to ~60ms (~16fps) for buttery smooth streaming
              if (now - lastRenderTime > 60) {
                lastRenderTime = now;
                applyStreamUpdate(false);
              }
            } else if (data.type === 'done') {
              // Mark that server signaled completion
            } else if (data.type === 'error') {
              serverErrorMsg = data.message || 'មានបញ្ហាក្នុងការបកប្រែ';
            }
          }
        }

        if (serverErrorMsg) {
          break;
        }
      }

      // If server sent an explicit error, propagate it
      if (serverErrorMsg) {
        throw new Error(serverErrorMsg);
      }

      // If the stream finished but 0 characters or almost no characters were received, it's an error!
      const totalKhmer = accumulatedText.trim().length;
      if (totalKhmer === 0) {
        throw new Error('មិនទាន់ទទួលបានអត្ថបទបកប្រែពីម៉ាស៊ីនបកប្រែឡើយ (សូមចុចបកប្រែទំព័រនេះឡើងវិញ)');
      }

      // Final successful state update
      applyStreamUpdate(true);

      // Update pagesRef immediately so next page has fresh state
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
        pagesRef.current[pageIdx] = {
          ...pagesRef.current[pageIdx],
          status: 'completed',
          translatedText: accumulatedText,
          translatedChars: totalKhmer,
          ...(finalCues ? { srtCues: finalCues } : {}),
        };
      }

      generateChunkSummary(accumulatedText, pageIdx);
      setIsTranslating(false);
      return true;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Translation aborted by user');
      } else {
        console.error('Translation error on page', pageIdx + 1, err);
        const errMsg = err.message || 'មានបញ្ហាក្នុងដំណើរការបកប្រែ';
        setPages((prev) =>
          prev.map((p, i) => (i === pageIdx ? { ...p, status: 'error', error: errMsg } : p))
        );
        if (pagesRef.current[pageIdx]) {
          pagesRef.current[pageIdx] = {
            ...pagesRef.current[pageIdx],
            status: 'error',
            error: errMsg,
          };
        }
      }
      setIsTranslating(false);
      return false;
    }
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
    } catch (e) {
      // Non-critical, ignore
    }
  };

  // Stop / pause translation
  const handleStopTranslation = () => {
    isAutoTranslatingRef.current = false;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranslating(false);
    setAutoTranslateAll(false);
  };

  // Auto-translate all pages sequentially: starts from Page 1 and continuously jumps page by page until all are done!
  const handleAutoTranslateAllToggle = async () => {
    if (isTranslating) {
      handleStopTranslation();
      return;
    }

    setAutoTranslateAll(true);
    isAutoTranslatingRef.current = true;

    const total = pagesRef.current.length;
    // Iterate from Page 1 (index 0) through all pages
    for (let i = 0; i < total; i++) {
      if (!isAutoTranslatingRef.current) break;

      // Skip only already completed pages that have genuine translated text (>20 characters)
      const pageToCheck = pagesRef.current[i];
      if (
        pageToCheck?.status === 'completed' &&
        pageToCheck?.translatedText &&
        pageToCheck.translatedText.trim().length > 20
      ) {
        continue;
      }

      // Automatically jump active page so user watches the screen jump to next page live!
      setActivePageIndex(i);

      const success = await startTranslateSpecificPage(pagesRef.current, i);
      if (!success || !isAutoTranslatingRef.current) {
        console.warn(`Translation of page ${i + 1} stopped or encountered an error. Stopping auto-translate.`);
        break;
      }

      // Small pause between pages so user sees page completion before auto jumping to next
      if (i < total - 1 && isAutoTranslatingRef.current) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    setIsTranslating(false);
    setAutoTranslateAll(false);
    isAutoTranslatingRef.current = false;

    // Check if all pages are truly completed with genuine text
    const allDone =
      pagesRef.current.length > 0 &&
      pagesRef.current.every(
        (p) => p.status === 'completed' && p.translatedText && p.translatedText.trim().length > 20
      );
    if (allDone) {
      setTimeout(() => {
        allPagesBoxRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 500);
    }
  };

  // Copy all translated pages (cleaned with only '។' and '?', pure story text only)
  const handleCopyAll = () => {
    const fullNovel = pages
      .map((p) => (p.translatedText ? cleanKhmerPunctuation(p.translatedText) : ''))
      .filter((t) => t.trim().length > 0)
      .join('\n\n');

    if (!fullNovel) return;
    navigator.clipboard.writeText(fullNovel);
    alert('បានចម្លងអត្ថបទបកប្រែសុទ្ធទាំងអស់រួចរាល់!');
  };

  // Download all as .txt file (pure translated text only)
  const handleDownloadAll = () => {
    const fullNovel = pages
      .map((p) => (p.translatedText ? cleanKhmerPunctuation(p.translatedText) : ''))
      .filter((t) => t.trim().length > 0)
      .join('\n\n');

    if (!fullNovel) return;
    const titleStr = analysis?.khmerTitle || 'រឿងប្រលោមលោកខ្មែរសុទ្ធ';
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

  // Direct editing of any translated cue in side-by-side mode (updates allSrtCues, pages, and storage)
  const handleUpdateCue = (cueId: number, newKhmerText: string) => {
    // 1. Update in allSrtCues
    setAllSrtCues((prev) =>
      prev.map((c) => (c.id === cueId ? { ...c, translatedText: newKhmerText } : c))
    );

    // 2. Update inside relevant page chunk
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-khmer selection:bg-amber-500/30">
      {/* Top Header */}
      <Header
        onReset={handleResetRequest}
        onOpenHelp={() => setShowHelpModal(true)}
        hasSavedData={hasTranslatedData}
      />

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
                  បកប្រែបាន {toKhmerNumerals(pages.filter((p) => p.status === 'completed').length)} នៃ {toKhmerNumerals(pages.length)} ទំព័រ • រក្សាទុកដោយសុវត្ថិភាព មិនបាត់បង់ទិន្នន័យឡើយ
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
            {/* Story Header Banner */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
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
                  <span className="text-xs text-slate-400">
                    • {inputText.length.toLocaleString()} តួអក្សរសរុប ({pages.length} ទំព័រត្រឹមខណ្ឌ)
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-amber-300 font-khmer mt-1">
                  {analysis.khmerTitle}
                </h2>
                {analysis.originalTitle && (
                  <p className="text-xs text-slate-400 font-sans italic">{analysis.originalTitle}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(isSrtMode || allSrtCues.length > 0) && (
                  <button
                    onClick={() => setShowSrtStudioModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-xs font-khmer font-bold shadow-lg transition-all"
                    title="បើកទម្រង់ចំណងជើងរឿង SRT មួយចំហៀងម្នាក់ពេញអេក្រង់"
                  >
                    <Film className="w-3.5 h-3.5 text-sky-400" />
                    <span>
                      ទម្រង់ចំណងជើងរឿង SRT ({toKhmerNumerals(allSrtCues.filter((c) => c.translatedText && c.translatedText.trim().length > 0).length)}/{toKhmerNumerals(allSrtCues.length)} ជួរ)
                    </span>
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

            {/* Translation Reader with Live Streaming */}
            <TranslationReader
              page={pages[activePageIndex] || pages[0]}
              pageIndex={activePageIndex}
              totalPages={pages.length}
              isTranslating={isTranslating}
              liveCharsReceived={liveCharsReceived}
              liveKhmerChars={liveKhmerChars}
              translationSpeed={translationSpeed}
              onCopyAll={handleCopyAll}
              onDownloadAll={handleDownloadAll}
              storyTitle={analysis.khmerTitle}
              translationStyle={translationStyle}
              onUpdateCue={handleUpdateCue}
              allSrtCues={allSrtCues}
              onTranslateCurrentPage={() => translatePage(activePageIndex)}
            />

            {/* Dedicated Box for All Translated Khmer Pages & 1-Click Copy */}
            <div ref={allPagesBoxRef}>
              <AllPagesKhmerBox
                pages={pages}
                storyTitle={analysis.khmerTitle}
                originalTitle={analysis.originalTitle}
                isSrtMode={isSrtMode}
                allSrtCues={allSrtCues}
              />
            </div>
          </div>
        )}
      </main>

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
                ទិន្នន័យអត្ថបទដើម និងការបកប្រែជាភាសាខ្មែរទាំងអស់ ({toKhmerNumerals(pages.filter((p) => p.status === 'completed').length)} ទំព័រដែលបានបកប្រែ) នឹងត្រូវលុបចេញពីឧបករណ៍របស់អ្នកទាំងស្រុង។ បើមិនចង់បាត់បង់ទេ សូមចុច «បោះបង់»។
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

      {/* Help Modal */}
      <HelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} />
    </div>
  );
}
