import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Copy,
  Check,
  Download,
  Volume2,
  VolumeX,
  Type,
  BookOpen,
  Split,
  Eye,
  Sparkles,
  ArrowDown,
  Navigation,
  Compass,
  Film,
  Code,
  FileText,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { PageChunk, getPageParagraphs } from '../utils/chunker';
import {
  cleanKhmerPunctuation,
  formatAsContinuousStoryText,
  extractActiveParagraphIndex,
  extractActiveSrtCueId,
  toKhmerNumerals,
} from '../utils/khmerCleaner';
import { ReaderFont, ReaderTheme, ViewMode, TranslationStyle } from '../types';
import { SrtCue, buildSrt } from '../utils/srtParser';
import { SrtSideBySideStudio } from './SrtSideBySideStudio';
import { NonKhmerInspector } from './NonKhmerInspector';
import { extractNonKhmerWords } from '../utils/nonKhmerDetector';
import { Languages } from 'lucide-react';

interface TranslationReaderProps {
  page: PageChunk;
  pageIndex: number;
  totalPages: number;
  isTranslating: boolean;
  liveCharsReceived: number;
  liveKhmerChars: number;
  translationSpeed: number; // chars per second
  onCopyAll: () => void;
  onDownloadAll: () => void;
  storyTitle: string;
  translationStyle?: TranslationStyle;
  onUpdateCue?: (cueId: number, newKhmerText: string) => void;
  allSrtCues?: SrtCue[];
  onTranslateCurrentPage?: () => void;
}

export const TranslationReader: React.FC<TranslationReaderProps> = React.memo(({
  page,
  pageIndex,
  totalPages,
  isTranslating,
  liveCharsReceived,
  liveKhmerChars,
  translationSpeed,
  onCopyAll,
  onDownloadAll,
  storyTitle,
  translationStyle = 'anime_rank',
  onUpdateCue,
  allSrtCues = [],
  onTranslateCurrentPage,
}) => {
  const isSrtPage = Boolean(page.isSrtChunk || (page.srtCues && page.srtCues.length > 0) || allSrtCues.length > 0);
  const [srtScope, setSrtScope] = useState<'all' | 'page'>('all');
  // Default to pure text (khmer_only) or split so user sees pure text immediately in the text box
  const [viewMode, setViewMode] = useState<ViewMode>('khmer_only');
  const [theme, setTheme] = useState<ReaderTheme>('dark');
  const [font, setFont] = useState<ReaderFont>('hanuman');
  const [fontSize, setFontSize] = useState<number>(18);
  const [copiedCurrent, setCopiedCurrent] = useState(false);
  const [copiedSrt, setCopiedSrt] = useState(false);
  const [copiedCueId, setCopiedCueId] = useState<number | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [userScrolledUp, setUserScrolledUp] = useState<boolean>(false);

  const khmerContainerRef = useRef<HTMLDivElement>(null);
  const originalContainerRef = useRef<HTMLDivElement>(null);
  const srtContainerRef = useRef<HTMLDivElement>(null);
  const paragraphRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const cueRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Extract original text paragraphs (memoized)
  const originalParagraphs = useMemo(
    () => getPageParagraphs(page.originalText),
    [page.originalText]
  );

  // Detect which paragraph is actively translating from [P1], [P2] tags
  const activeParagraphIndex = useMemo(
    () => (isTranslating ? extractActiveParagraphIndex(page.translatedText) : -1),
    [isTranslating, page.translatedText]
  );

  // Detect active SRT cue id from [SRT_1 | ...] markers
  const activeSrtCueId = useMemo(
    () => (isTranslating ? extractActiveSrtCueId(page.translatedText) : null),
    [isTranslating, page.translatedText]
  );

  // Formats pure Khmer text as continuous, flowing story paragraphs ("អក្សរមកជាប់គ្នាជាអត្តបទធម្មតាមកស្រួលមើល")
  const continuousKhmerText = useMemo(() => {
    // If page has srtCues with translatedText
    if (page.srtCues && page.srtCues.some((c) => c.translatedText && c.translatedText.trim().length > 0)) {
      const cueLines = page.srtCues
        .map((c) => (c.translatedText || '').trim())
        .filter((t) => t.length > 0);
      if (cueLines.length > 0) {
        return formatAsContinuousStoryText(cueLines.join('\n'));
      }
    }
    return formatAsContinuousStoryText(page.translatedText);
  }, [page.translatedText, page.srtCues]);

  // Clean raw Khmer text for count or fallback
  const cleanedKhmerText = useMemo(
    () => continuousKhmerText || cleanKhmerPunctuation(page.translatedText),
    [continuousKhmerText, page.translatedText]
  );

  // Detect non-Khmer words count in translated text
  const nonKhmerCount = useMemo(() => {
    return extractNonKhmerWords(page.translatedText).length;
  }, [page.translatedText]);

  // Standard SRT format for srt_code view ("srtតម្រៀបក្នុងsrtធម្មតាទៅ")
  const rawSrtText = useMemo(() => {
    if (page.srtCues && page.srtCues.length > 0) {
      return buildSrt(page.srtCues, true);
    }
    return '';
  }, [page.srtCues]);

  // Auto-scroll original text to currently translating paragraph
  useEffect(() => {
    if (isTranslating && activeParagraphIndex >= 0) {
      const activeEl = paragraphRefs.current.get(activeParagraphIndex);
      if (activeEl && originalContainerRef.current) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeParagraphIndex, isTranslating]);

  // Auto-scroll SRT list to currently translating cue
  useEffect(() => {
    if (isTranslating && activeSrtCueId !== null && viewMode === 'srt_rows') {
      const activeCueEl = cueRefs.current.get(activeSrtCueId);
      if (activeCueEl && srtContainerRef.current) {
        activeCueEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeSrtCueId, isTranslating, viewMode]);

  const handleCopySingleCue = (cue: SrtCue) => {
    const text = `${cue.id}\n${cue.timecode}\n${cue.translatedText || cue.originalText}`;
    navigator.clipboard.writeText(text);
    setCopiedCueId(cue.id);
    setTimeout(() => setCopiedCueId(null), 1500);
  };

  // Handle scroll in translated container: detect if user scrolled up manually
  const handleKhmerScroll = () => {
    if (!khmerContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = khmerContainerRef.current;
    const distanceToBottom = scrollHeight - (scrollTop + clientHeight);

    // If user is more than 80px from bottom, they scrolled up
    if (distanceToBottom > 80) {
      setUserScrolledUp(true);
    } else {
      setUserScrolledUp(false);
    }
  };

  // Auto-scroll to bottom of Khmer translation container when streaming
  useEffect(() => {
    if (isTranslating && autoScroll && !userScrolledUp && khmerContainerRef.current) {
      khmerContainerRef.current.scrollTop = khmerContainerRef.current.scrollHeight;
    }
  }, [page.translatedText, isTranslating, autoScroll, userScrolledUp]);

  const resumeAutoScroll = () => {
    setUserScrolledUp(false);
    setAutoScroll(true);
    if (khmerContainerRef.current) {
      khmerContainerRef.current.scrollTo({
        top: khmerContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  const handleCopyCurrent = () => {
    const textToCopy = viewMode === 'srt_code' ? rawSrtText : continuousKhmerText;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopiedCurrent(true);
    setTimeout(() => setCopiedCurrent(false), 2000);
  };

  const handleCopyRawSrt = () => {
    if (!rawSrtText) return;
    navigator.clipboard.writeText(rawSrtText);
    setCopiedSrt(true);
    setTimeout(() => setCopiedSrt(false), 2000);
  };

  const handleDownloadRawSrt = () => {
    if (!rawSrtText) return;
    const blob = new Blob([rawSrtText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${storyTitle || 'subtitles'}_page_${pageIndex + 1}.srt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSpeechToggle = () => {
    if (!('speechSynthesis' in window)) {
      alert('កម្មវិធីរុករករបស់អ្នកមិនគាំទ្រ Text-to-Speech ឡើយ');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    if (!cleanedKhmerText) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanedKhmerText);
    utterance.lang = 'km-KH';
    utterance.rate = 0.95;

    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  // Theme styling classes
  const getThemeClass = () => {
    switch (theme) {
      case 'sepia':
        return 'bg-[#f6f1e7] text-[#3d3226] border-[#dfd5c4] selection:bg-[#dfd5c4]';
      case 'light':
        return 'bg-white text-slate-900 border-slate-200 selection:bg-amber-100';
      case 'dark':
      default:
        return 'bg-slate-950 text-slate-100 border-slate-800 selection:bg-amber-500/20';
    }
  };

  const getFontClass = () => {
    switch (font) {
      case 'hanuman':
        return 'font-khmer-novel';
      case 'battambang':
        return 'font-khmer-classic';
      case 'kantumruy':
      default:
        return 'font-khmer';
    }
  };

  const currentKhmerChars = cleanedKhmerText ? cleanedKhmerText.length : 0;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
      {/* Top Toolbar: View controls, font, theme, copy, audio */}
      <div className="p-3.5 sm:p-4 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: View Mode Toggle */}
        <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setViewMode('khmer_only')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-khmer transition-all ${
              viewMode === 'khmer_only'
                ? 'bg-amber-500 text-slate-950 font-bold shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="អានអត្ថបទធម្មតាជាប់គ្នា ស្រួលមើល"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>អត្ថបទធម្មតា (Pure Text)</span>
          </button>

          <button
            onClick={() => setViewMode('split')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-khmer transition-all ${
              viewMode === 'split'
                ? 'bg-amber-500 text-slate-950 font-bold shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="មើលផ្ទៀងផ្ទាត់ទន្ទឹមគ្នា ដើម និងខ្មែរ"
          >
            <Split className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">មើលទន្ទឹមគ្នា (Split)</span>
          </button>

          {isSrtPage && (
            <>
              <button
                onClick={() => setViewMode('srt_rows')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-khmer transition-all ${
                  viewMode === 'srt_rows'
                    ? 'bg-sky-500 text-slate-950 font-bold shadow'
                    : 'text-sky-300 hover:text-white'
                }`}
                title="ទម្រង់ចំណងជើងរឿង SRT (Side-by-Side មួយចំហៀងម្នាក់)"
              >
                <Film className="w-3.5 h-3.5" />
                <span>ចំណងជើងរឿង SRT (Side-by-Side)</span>
                {allSrtCues.length > 0 && (
                  <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-950/60 text-sky-200">
                    {toKhmerNumerals(allSrtCues.length)}
                  </span>
                )}
              </button>

              <button
                onClick={() => setViewMode('srt_code')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-khmer transition-all ${
                  viewMode === 'srt_code'
                    ? 'bg-sky-500 text-slate-950 font-bold shadow'
                    : 'text-sky-300 hover:text-white'
                }`}
                title="កូដ SRT ស្តង់ដារពេញលេញ សម្រាប់ copy/download"
              >
                <Code className="w-3.5 h-3.5" />
                <span>កូដ SRT (.srt)</span>
              </button>
            </>
          )}

          <button
            onClick={() => setViewMode('original_only')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-khmer transition-all ${
              viewMode === 'original_only'
                ? 'bg-amber-500 text-slate-950 font-bold shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">អត្ថបទដើម (Source)</span>
          </button>

          <button
            onClick={() => setViewMode('non_khmer')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-khmer transition-all ${
              viewMode === 'non_khmer'
                ? 'bg-amber-500 text-slate-950 font-bold shadow'
                : 'text-amber-400/90 hover:text-amber-200'
            }`}
            title="ផ្ទាំងបង្ហាញអក្សរដែលបកប្រែហើយ ដែលមិនមែនជាអក្សរខ្មែរ"
          >
            <Languages className="w-3.5 h-3.5" />
            <span>អក្សរមិនមែនខ្មែរ</span>
            {nonKhmerCount > 0 && (
              <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {toKhmerNumerals(nonKhmerCount)}
              </span>
            )}
          </button>
        </div>

        {/* Middle: Font Style & Size */}
        <div className="flex items-center gap-2">
          {/* Auto Scroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border font-khmer transition-all ${
              autoScroll
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
            title="បិទ/បើក ការរមូរស្វ័យប្រវត្តពេលបកប្រែ"
          >
            <Compass className={`w-3.5 h-3.5 ${autoScroll ? 'animate-spin' : ''}`} />
            <span>ស្វ័យប្រវត្តរមូរ ({autoScroll ? 'បើក' : 'បិទ'})</span>
          </button>

          {/* Font Family selector */}
          <div className="hidden md:flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-[11px]">
            <button
              onClick={() => setFont('hanuman')}
              className={`px-2 py-1 rounded font-khmer-novel transition-all ${
                font === 'hanuman' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
              }`}
            >
              ពុម្ពហនុមាន
            </button>
            <button
              onClick={() => setFont('kantumruy')}
              className={`px-2 py-1 rounded font-khmer transition-all ${
                font === 'kantumruy' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
              }`}
            >
              កន្ទុំរុយ
            </button>
            <button
              onClick={() => setFont('battambang')}
              className={`px-2 py-1 rounded font-khmer-classic transition-all ${
                font === 'battambang' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
              }`}
            >
              បាត់ដំបង
            </button>
          </div>

          {/* Font Size Adjust */}
          <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-xl border border-slate-800 text-slate-300">
            <button
              onClick={() => setFontSize(Math.max(14, fontSize - 1))}
              className="px-1.5 hover:text-amber-400 font-bold text-xs"
              title="បង្រួមអក្សរ"
            >
              A-
            </button>
            <span className="text-[11px] font-mono w-5 text-center text-slate-400">
              {fontSize}
            </span>
            <button
              onClick={() => setFontSize(Math.min(28, fontSize + 1))}
              className="px-1.5 hover:text-amber-400 font-bold text-xs"
              title="ពង្រីកអក្សរ"
            >
              A+
            </button>
          </div>

          {/* Theme Selector */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setTheme('dark')}
              className={`w-5 h-5 rounded-full bg-slate-950 border transition-all ${
                theme === 'dark' ? 'border-amber-400 scale-110 shadow' : 'border-slate-700'
              }`}
              title="Dark Theme"
            />
            <button
              onClick={() => setTheme('sepia')}
              className={`w-5 h-5 rounded-full bg-[#f6f1e7] border transition-all ${
                theme === 'sepia' ? 'border-amber-500 scale-110 shadow' : 'border-stone-400'
              }`}
              title="Sepia Paper Theme"
            />
            <button
              onClick={() => setTheme('light')}
              className={`w-5 h-5 rounded-full bg-white border transition-all ${
                theme === 'light' ? 'border-amber-500 scale-110 shadow' : 'border-slate-300'
              }`}
              title="Light Theme"
            />
          </div>
        </div>

        {/* Right: Audio Read Aloud & Copy/Export */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSpeechToggle}
            className={`p-2 rounded-xl border transition-all ${
              isSpeaking
                ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border-slate-800'
            }`}
            title={isSpeaking ? 'បញ្ឈប់ការអាន' : 'អានជាសំឡេង (Read Aloud)'}
          >
            {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            onClick={handleCopyCurrent}
            disabled={!cleanedKhmerText}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 font-khmer transition-all disabled:opacity-40"
            title="ចម្លងទំព័រនេះ"
          >
            {copiedCurrent ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{copiedCurrent ? 'បានចម្លង' : 'ចម្លងទំព័រនេះ'}</span>
          </button>

          <button
            onClick={onCopyAll}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 font-khmer transition-all"
            title="ចម្លងរឿងទាំងមូល"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">ចម្លងទាំងមូល</span>
          </button>

          <button
            onClick={onDownloadAll}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-khmer font-semibold transition-all shadow"
            title="ទាញយករឿងទាំងមូលជា .txt"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">ទាញយក .txt</span>
          </button>

          {page.srtCues && page.srtCues.length > 0 && (
            <button
              onClick={handleDownloadRawSrt}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-khmer font-semibold transition-all shadow"
              title="ទាញយកចំណងជើងរឿង SRT (.srt) ជាមួយកូដម៉ោងដើម ១០០%"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">ទាញយក .srt</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Streaming & Character Statistics Bar */}
      <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 font-mono text-slate-300">
            <span className="text-[11px] text-slate-400 font-khmer">តួអក្សរដើម (Input):</span>
            <span className="font-bold text-slate-200">{page.charCount.toLocaleString()}</span>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-amber-300">
            <span className="text-[11px] text-slate-400 font-khmer">តួអក្សរខ្មែរបកប្រែ (Khmer Output):</span>
            <span className="font-bold text-amber-400">{toKhmerNumerals(currentKhmerChars.toLocaleString())}</span>
          </div>

          {isTranslating && (
            <div className="flex items-center gap-1.5 text-emerald-400 font-mono text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>
                កថាខណ្ឌទី {toKhmerNumerals(activeParagraphIndex + 1)} នៃ {toKhmerNumerals(originalParagraphs.length)}
                {translationSpeed > 0 ? ` • ~${toKhmerNumerals(translationSpeed)} តួ/វិ` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Punctuation & Rule Badge */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-amber-300 border border-slate-700 font-khmer">
            លេខខ្មែរសុទ្ធ • សញ្ញាវណ្ណយុត្តិ៖ «។» និង «?» តែប៉ុណ្ណោះ
          </span>

          {isTranslating ? (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[11px] font-khmer animate-pulse">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>កំពុងបកប្រែបណ្ដើរ លោតតួអក្សរមកបណ្ដើរ...</span>
            </div>
          ) : page.status === 'completed' && currentKhmerChars > 0 ? (
            <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-khmer">
              <Check className="w-3 h-3" />
              <span>បកប្រែចប់ពេញលេញ (មិនសង្ខេប)</span>
            </div>
          ) : page.status === 'error' ? (
            <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[11px] font-khmer font-bold">
              <AlertCircle className="w-3 h-3 text-rose-400" />
              <span>មិនទាន់ជោគជ័យ (សូមចុចបកប្រែម្ដងទៀត)</span>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400 font-khmer">
              ទំព័រទី {toKhmerNumerals(pageIndex + 1)} នៃ {toKhmerNumerals(totalPages)}
            </span>
          )}
        </div>
      </div>

      {/* Reader Content Area with Smooth Independent/Synced Scroll */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 h-[calc(100vh-270px)] min-h-[550px] relative">
        {/* Left Side: Original Text with Paragraph Tracking Highlight */}
        {(viewMode === 'split' || viewMode === 'original_only') && (
          <div
            ref={originalContainerRef}
            className={`p-6 overflow-y-scroll ${
              viewMode === 'original_only' ? 'md:col-span-2' : ''
            } bg-slate-950/70 space-y-4 select-text scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900`}
          >
            <div className="sticky top-0 z-10 pb-2 mb-3 bg-slate-950/95 backdrop-blur border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 font-mono uppercase tracking-wider flex items-center gap-2">
                <span>Original Story Text • Page {pageIndex + 1}</span>
                <span className="text-[10px] text-slate-500 font-khmer">
                  ({originalParagraphs.length} កថាខណ្ឌ)
                </span>
              </span>
              <span className="text-[11px] text-slate-500 font-mono">
                {page.charCount.toLocaleString()} chars
              </span>
            </div>

            {/* Paragraph list with live tracking indicator */}
            <div className="space-y-4">
              {originalParagraphs.map((paraText, pIdx) => {
                const isActive = isTranslating && activeParagraphIndex === pIdx;
                const isCompleted = isTranslating && activeParagraphIndex > pIdx;

                return (
                  <div
                    key={pIdx}
                    ref={(el) => {
                      if (el) paragraphRefs.current.set(pIdx, el);
                      else paragraphRefs.current.delete(pIdx);
                    }}
                    className={`p-3.5 rounded-xl border text-sm leading-relaxed transition-all duration-300 relative ${
                      isActive
                        ? 'border-amber-400 bg-amber-500/10 shadow-lg shadow-amber-500/10 ring-2 ring-amber-400/40'
                        : isCompleted
                        ? 'border-emerald-500/30 bg-emerald-950/15 text-slate-300'
                        : 'border-slate-800/80 bg-slate-900/40 text-slate-400'
                    }`}
                  >
                    {/* Paragraph header badge */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                        #{pIdx + 1}
                      </span>

                      {isActive && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-bold font-khmer animate-pulse shadow">
                          <Navigation className="w-2.5 h-2.5" />
                          <span>កំពុងបកប្រែកថាខណ្ឌនេះ...</span>
                        </div>
                      )}

                      {isCompleted && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-khmer">
                          <Check className="w-3 h-3" />
                          <span>បកប្រែរួច</span>
                        </span>
                      )}
                    </div>

                    <p className="font-sans whitespace-pre-wrap">{paraText}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Right Side: 100% Pure Khmer Translation */}
        {(viewMode === 'split' || viewMode === 'khmer_only') && (
          <div
            ref={khmerContainerRef}
            onScroll={handleKhmerScroll}
            className={`p-6 sm:p-8 overflow-y-scroll transition-colors duration-200 relative ${
              viewMode === 'khmer_only' ? 'md:col-span-2' : ''
            } ${getThemeClass()} scrollbar-thin scrollbar-thumb-amber-500/40 scrollbar-track-slate-900`}
          >
            <div className="sticky top-0 z-10 pb-2 mb-4 backdrop-blur border-b border-inherit/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold font-khmer opacity-80 flex items-center gap-1.5">
                  <span>អត្ថបទបកប្រែជាភាសាខ្មែរសុទ្ធ {isSrtPage ? '(Pure Text ជាប់គ្នា)' : '១០០%'}</span>
                  <span>• ទំព័រទី {toKhmerNumerals(pageIndex + 1)}</span>
                </span>
                {translationStyle === 'anime_rank' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 font-semibold font-khmer border border-indigo-500/30">
                    🗡️ បែប Anime / កម្រិត Rank
                  </span>
                )}
                {translationStyle === 'donghua_cultivation' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold font-khmer border border-amber-500/30">
                    ☯️ បែប ដុងហោ / ដាំដុះ Qi
                  </span>
                )}
                {translationStyle === 'movie_cinema' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-semibold font-khmer border border-rose-500/30">
                    🎬 បែប ភាពយន្ត / Dubbing
                  </span>
                )}
              </div>
              <span className="text-[11px] font-mono opacity-60">
                {toKhmerNumerals(currentKhmerChars.toLocaleString())} តួអក្សរ
              </span>
            </div>

            {/* Translation Content */}
            {continuousKhmerText ? (
              <div className="space-y-4">
                <div
                  className={`leading-loose whitespace-pre-wrap select-text ${getFontClass()} space-y-4`}
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {continuousKhmerText}
                  {isTranslating && (
                    <span className="inline-block w-2.5 h-5 ml-1.5 bg-amber-400 animate-pulse align-middle" />
                  )}
                </div>

                {isSrtPage && !isTranslating && (
                  <div className="mt-8 pt-4 border-t border-inherit/20 flex flex-wrap items-center justify-between gap-2 text-xs font-khmer opacity-75">
                    <span>💡 អត្ថបទខាងលើជាអត្ថបទធម្មតារត់ជាប់គ្នា។ ចុច "តារាង SRT" ឬ "កូដ SRT" ខាងលើដើម្បីមើលពេលវេលា timecode។</span>
                    <button
                      type="button"
                      onClick={() => setViewMode('srt_rows')}
                      className="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/30 font-semibold transition-all"
                    >
                      មើលតារាងពេលវេលា SRT →
                    </button>
                  </div>
                )}
              </div>
            ) : isTranslating ? (
              <div className="py-24 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-12 h-12 border-4 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                <div>
                  <h4 className="font-bold font-khmer text-slate-200 text-sm">
                    កំពុងបកប្រែទំព័រទី {pageIndex + 1} ជាភាសាខ្មែរសុទ្ធ...
                  </h4>
                  <p className="text-xs text-slate-400 font-khmer mt-1 max-w-sm">
                    ប្រព័ន្ធកំពុងអានអត្ថបទដើម និងបកប្រែពន្យល់សាច់រឿងយ៉ាងរលូន ក្បោះក្បាយ មិនសង្ខេប...
                  </p>
                </div>
              </div>
            ) : page.status === 'error' || Boolean(page.error) ? (
              <div className="py-16 px-4 flex flex-col items-center justify-center text-center space-y-3 bg-rose-950/20 border border-rose-500/30 rounded-2xl p-6 my-4">
                <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h4 className="font-bold font-khmer text-rose-300 text-sm">
                  ការបកប្រែទំព័រទី {toKhmerNumerals(pageIndex + 1)} មិនទាន់ទទួលបានជោគជ័យ
                </h4>
                <p className="text-xs font-khmer text-rose-300/80 max-w-md">
                  {page.error || 'ម៉ាស៊ីនបកប្រែរវល់ ឬគ្មានទិន្នន័យត្រឡប់មកវិញ។ សូមចុចប៊ូតុងខាងក្រោមដើម្បីសាកល្បងម្ដងទៀត។'}
                </p>
                {onTranslateCurrentPage && (
                  <button
                    type="button"
                    onClick={onTranslateCurrentPage}
                    className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 font-khmer text-xs font-bold shadow-lg transition-all active:scale-95"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>សាកល្បងបកប្រែទំព័រនេះឡើងវិញ</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="py-28 flex flex-col items-center justify-center text-center space-y-3 opacity-60">
                <BookOpen className="w-12 h-12 text-slate-500 stroke-[1.5]" />
                <h4 className="font-bold font-khmer text-sm">ទំព័រនេះមិនទាន់បានបកប្រែនៅឡើយ</h4>
                <p className="text-xs font-khmer max-w-sm">
                  ចុចប៊ូតុង "បកប្រែទំព័រនេះ" ឬ "បកប្រែស្វ័យប្រវត្តគ្រប់ទំព័រ" ដើម្បីចាប់ផ្តើមបកប្រែ។
                </p>
                {onTranslateCurrentPage && (
                  <button
                    type="button"
                    onClick={onTranslateCurrentPage}
                    className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-khmer text-xs font-bold shadow transition-all active:scale-95"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>ចាប់ផ្តើមបកប្រែទំព័រនេះឥឡូវនេះ</span>
                  </button>
                )}
              </div>
            )}

            {/* Floating button to resume auto-scroll if user scrolled up while translating */}
            {isTranslating && userScrolledUp && (
              <div className="sticky bottom-4 flex justify-center z-20">
                <button
                  onClick={resumeAutoScroll}
                  className="px-4 py-2 rounded-full bg-amber-500 text-slate-950 font-bold text-xs font-khmer shadow-xl shadow-amber-500/40 flex items-center gap-1.5 hover:bg-amber-400 active:scale-95 transition-all animate-bounce"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                  <span>រមូរទៅតាមពាក្យកំពុងបកប្រែ (Resume Auto-Scroll)</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Full Subtitle Synchronizer Table/Cards for SRT Mode */}
        {viewMode === 'srt_rows' && (
          <div className="col-span-1 md:col-span-2 space-y-4">
            {allSrtCues.length > 0 && (
              <div className="flex items-center justify-between bg-slate-900/90 p-2.5 rounded-xl border border-sky-900/60 text-xs">
                <span className="text-sky-300 font-khmer flex items-center gap-2">
                  <Film className="w-4 h-4 text-sky-400" />
                  <span>ជ្រើសរើសវិសាលភាពបង្ហាញ៖</span>
                </span>
                <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSrtScope('all')}
                    className={`px-3 py-1 rounded font-khmer text-xs transition-all ${
                      srtScope === 'all'
                        ? 'bg-sky-500 text-slate-950 font-bold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    រឿងទាំងមូល ({toKhmerNumerals(allSrtCues.length)} ជួរ)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSrtScope('page')}
                    className={`px-3 py-1 rounded font-khmer text-xs transition-all ${
                      srtScope === 'page'
                        ? 'bg-sky-500 text-slate-950 font-bold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ទំព័រទី {toKhmerNumerals(pageIndex + 1)} ({toKhmerNumerals(page.srtCues?.length || 0)} ជួរ)
                  </button>
                </div>
              </div>
            )}

            <SrtSideBySideStudio
              cues={
                srtScope === 'all' && allSrtCues.length > 0
                  ? allSrtCues
                  : page.srtCues || []
              }
              movieTitle={storyTitle}
              isTranslating={isTranslating}
              activeTranslatingCueId={activeSrtCueId}
              onUpdateCue={(id, text) => {
                if (onUpdateCue) {
                  onUpdateCue(id, text);
                }
              }}
            />
          </div>
        )}

        {/* Full Standard SRT Format Box ("srtតម្រៀបក្នុងsrtធម្មតាទៅ") */}
        {viewMode === 'srt_code' && (
          <div className="col-span-1 md:col-span-2 p-4 sm:p-6 overflow-y-scroll bg-slate-950/95 space-y-4 font-mono text-sm scrollbar-thin scrollbar-thumb-sky-500/30 scrollbar-track-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-sky-400 font-khmer flex items-center gap-1.5">
                  <Code className="w-4 h-4 text-sky-400" />
                  <span>ទម្រង់ឯកសារ SRT ស្តង់ដារ (Standard .SRT Format) • ទំព័រទី {toKhmerNumerals(pageIndex + 1)}</span>
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800">
                  {toKhmerNumerals(page.srtCues?.length || 0)} ជួរ
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyRawSrt}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-xs font-khmer transition-all"
                  title="ចម្លងកូដ SRT ទាំងអស់"
                >
                  {copiedSrt ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSrt ? 'បានចម្លង SRT' : 'ចម្លងកូដ SRT'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadRawSrt}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-khmer transition-all"
                  title="ទាញយកឯកសារ .srt"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>ទាញយក .srt</span>
                </button>
              </div>
            </div>

            {/* Display raw SRT text formatted line by line */}
            {rawSrtText ? (
              <textarea
                readOnly
                value={rawSrtText}
                className="w-full h-[calc(100vh-380px)] min-h-[460px] p-4 bg-slate-900/90 text-amber-200 border border-slate-800 rounded-xl font-mono text-xs sm:text-sm leading-relaxed focus:outline-none resize-none selection:bg-sky-500/30 shadow-inner"
              />
            ) : isTranslating ? (
              <div className="py-24 text-center space-y-3 font-khmer text-sky-400">
                <div className="w-10 h-10 border-4 border-sky-400/30 border-t-sky-400 rounded-full animate-spin mx-auto" />
                <p>កំពុងរៀបចំតម្រៀបទិន្នន័យ SRT តាមលំដាប់ជួរ...</p>
              </div>
            ) : (
              <div className="py-24 text-center text-slate-500 font-khmer">
                មិនទាន់មានទិន្នន័យ SRT បកប្រែក្នុងទំព័រនេះឡើយ
              </div>
            )}
          </div>
        )}

        {/* Dedicated Non-Khmer Text Inspector Panel */}
        {viewMode === 'non_khmer' && (
          <div className="col-span-1 md:col-span-2 p-3 sm:p-5">
            <NonKhmerInspector
              translatedText={page.translatedText}
              originalText={page.originalText}
            />
          </div>
        )}
      </div>

      {/* Footer Info & Quality Assurance note */}
      <div className="p-3 bg-slate-950/80 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-khmer">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>រត់តាមដានកថាខណ្ឌកំពុងបកប្រែដោយស្វ័យប្រវត្តិ</span>
        </div>
        <div className="flex items-center gap-3">
          <span>សញ្ញាវណ្ណយុត្តិស្អាត (តែ «។» និង «?»)</span>
          <span className="text-slate-600">•</span>
          <span className="font-mono text-slate-500">Gemini 3.8 Flash Streaming</span>
        </div>
      </div>
    </div>
  );
});
