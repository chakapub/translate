import React, { useState, useMemo } from 'react';
import {
  Copy,
  Check,
  Download,
  BookOpen,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp,
  Film,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { PageChunk, formatPagesAsBracketedSingleParagraph } from '../utils/chunker';
import { toKhmerNumerals } from '../utils/khmerCleaner';
import { buildSrt, SrtCue } from '../utils/srtParser';
import { NonKhmerInspector } from './NonKhmerInspector';
import { extractNonKhmerWords } from '../utils/nonKhmerDetector';
import { Languages, Hash } from 'lucide-react';

interface AllPagesKhmerBoxProps {
  pages: PageChunk[];
  storyTitle: string;
  originalTitle?: string;
  isSrtMode?: boolean;
  allSrtCues?: SrtCue[];
  onFixAllSpellingAndForeign?: () => void;
  isFixingSpellingAndForeign?: boolean;
  onConvertAllNumbersToWords?: () => void;
}

export const AllPagesKhmerBox: React.FC<AllPagesKhmerBoxProps> = React.memo(({
  pages,
  storyTitle,
  originalTitle,
  isSrtMode = false,
  allSrtCues = [],
  onFixAllSpellingAndForeign,
  isFixingSpellingAndForeign = false,
  onConvertAllNumbersToWords,
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedSrt, setCopiedSrt] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [activeTab, setActiveTab] = useState<'text' | 'srt' | 'non_khmer'>('text');

  // Compute stats
  const totalPages = pages.length;
  const completedPages = useMemo(
    () => pages.filter((p) => p.status === 'completed' && p.translatedText && p.translatedText.trim().length > 0).length,
    [pages]
  );

  // Collect all SRT cues across pages or from allSrtCues prop
  const effectiveCues: SrtCue[] = useMemo(() => {
    const fromPages = pages.flatMap((p) => p.srtCues || []);
    if (fromPages.length > 0) return fromPages;
    return allSrtCues;
  }, [pages, allSrtCues]);

  const hasSrtData = effectiveCues.length > 0 || isSrtMode;
  const translatedCuesCount = useMemo(
    () => effectiveCues.filter((c) => c.translatedText && c.translatedText.trim().length > 0).length,
    [effectiveCues]
  );

  // Generate full valid .srt string with exact original timestamps
  const combinedSrtText = useMemo(() => {
    if (effectiveCues.length === 0) return '';
    return buildSrt(effectiveCues, true);
  }, [effectiveCues]);

  // Step 2 & Step 3: Format all translated pages into a single continuous paragraph starting strictly at [1]
  // ("[1] អត្ថបទបកប្រែជួរទី១... [2] អត្ថបទបកប្រែជួរទី២... [3] អត្ថបទបកប្រែជួរទី៣...")
  // Strictly ZERO character lists, ZERO titles, ZERO timestamps, ZERO parentheses ( ), and ZERO Thai characters!
  const { combinedText, totalKhmerChars } = useMemo(() => {
    const formatted = formatPagesAsBracketedSingleParagraph(pages);
    return {
      combinedText: formatted,
      totalKhmerChars: formatted.length,
    };
  }, [pages]);

  const combinedOriginalText = useMemo(() => {
    if (activeTab !== 'non_khmer') return '';
    return pages.map((p) => p.originalText).filter(Boolean).join('\n\n');
  }, [pages, activeTab]);

  const allNonKhmerWordsCount = useMemo(() => {
    return extractNonKhmerWords(combinedText).length;
  }, [combinedText]);

  const handleCopyAll = () => {
    if (!combinedText.trim()) return;
    navigator.clipboard.writeText(combinedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopySrt = () => {
    if (!combinedSrtText.trim()) return;
    navigator.clipboard.writeText(combinedSrtText);
    setCopiedSrt(true);
    setTimeout(() => setCopiedSrt(false), 2500);
  };

  const handleDownloadTxt = () => {
    if (!combinedText.trim()) return;
    const blob = new Blob([combinedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(storyTitle || 'រឿងបកប្រែខ្មែរសុទ្ធ').replace(/\s+/g, '_')}_អត្ថបទបកប្រែសុទ្ធ.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadSrt = () => {
    if (!combinedSrtText.trim()) return;
    const blob = new Blob([combinedSrtText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(storyTitle || 'ចំណងជើងរឿង_Khmer').replace(/\s+/g, '_')}_Subtitles.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`bg-slate-900 border-2 border-amber-500/50 rounded-2xl shadow-2xl transition-all duration-300 overflow-hidden ${
        isFullScreen ? 'fixed inset-4 z-50 flex flex-col bg-slate-950' : 'relative'
      }`}
    >
      {/* Box Header Banner */}
      <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-indigo-950/80 p-4 sm:p-5 border-b border-amber-500/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold shadow-lg shadow-amber-500/30">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-amber-300 font-khmer">
                  ប្រអប់អត្ថបទខ្មែរបកប្រែសុទ្ធគ្រប់ទំព័រ (Pure Translated Text Only)
                </h3>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-khmer">
                  បកបាន {toKhmerNumerals(completedPages)}/{toKhmerNumerals(totalPages)} ទំព័រ
                </span>
              </div>
              <p className="text-xs text-slate-400 font-khmer mt-0.5">
                រួមបញ្ចូលតែអត្ថបទបកប្រែសុទ្ធ ១០០% មិនមានសញ្ញា ឬលេខក្បាលទំព័រឡើយ អាចកុបពីយកទៅប្រើបានភ្លាមៗ
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons: Copy All, Download, Fullscreen, Collapse */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* SRT Export Buttons (Shown if SRT data exists) */}
          {hasSrtData && (
            <>
              <button
                onClick={handleDownloadSrt}
                disabled={!combinedSrtText.trim()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-slate-950 font-bold font-khmer text-xs shadow-lg shadow-sky-600/30 transition-all active:scale-95 disabled:opacity-40"
                title="ទាញយកជាឯកសារចំណងជើងរឿង .srt"
              >
                <Film className="w-3.5 h-3.5" />
                <span>ទាញយក SRT (.srt)</span>
              </button>

              <button
                onClick={handleCopySrt}
                disabled={!combinedSrtText.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-950 hover:bg-sky-900 text-sky-200 border border-sky-600/70 font-khmer text-xs transition-all active:scale-95 disabled:opacity-40"
                title="ចម្លងទម្រង់ SRT ពេញលេញ"
              >
                {copiedSrt ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSrt ? 'បានចម្លង SRT!' : 'កុបពីទម្រង់ SRT'}</span>
              </button>
            </>
          )}

          {/* Fix All Spelling (AI High-Level) & Clean/Translate Foreign Text Button */}
          {onFixAllSpellingAndForeign && (
            <button
              type="button"
              onClick={onFixAllSpellingAndForeign}
              disabled={totalKhmerChars === 0 || isFixingSpellingAndForeign}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-khmer font-bold text-xs sm:text-sm shadow-xl shadow-emerald-500/25 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              title="ប្រើ AI កម្រិតខ្ពស់ ត្រួតពិនិត្យនិងកែសម្រួលអក្ខរាវិរុទ្ធទាំងអស់ លុបលើសស្រៈ និងជួសជុលអក្សរចម្លែកៗ (ដូចជា គ្នាอย่างรุนแรง)"
            >
              <Wand2 className={`w-4 h-4 stroke-[2.5] ${isFixingSpellingAndForeign ? 'animate-spin' : ''}`} />
              <span>
                {isFixingSpellingAndForeign
                  ? 'កំពុងត្រួតពិនិត្យដោយ AI កម្រិតខ្ពស់...'
                  : 'កែសម្រួលអក្ខរាវិរុទ្ធទាំងអស់ (AI កម្រិតខ្ពស់)'}
              </span>
              {allNonKhmerWordsCount > 0 && !isFixingSpellingAndForeign && (
                <span className="px-1.5 py-0.5 rounded-full bg-slate-950/80 text-amber-300 font-mono text-[10px]">
                  {toKhmerNumerals(allNonKhmerWordsCount)}
                </span>
              )}
            </button>
          )}

          {/* Convert All Numbers to Khmer Words Button */}
          {onConvertAllNumbersToWords && (
            <button
              type="button"
              onClick={onConvertAllNumbersToWords}
              disabled={totalKhmerChars === 0 || isFixingSpellingAndForeign}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 hover:from-violet-400 hover:to-fuchsia-400 text-white font-khmer font-bold text-xs sm:text-sm shadow-xl shadow-purple-500/25 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              title="បម្លែងគ្រប់តួលេខទាំងអស់ (០-៩ និង 0-9) ទៅជាពាក្យអក្សរខ្មែរសុទ្ធ (ឧ. ១០០ -> មួយរយ)"
            >
              <Hash className="w-4 h-4 stroke-[2.5]" />
              <span>បម្លែងលេខទៅជាអក្សរទាំងអស់</span>
            </button>
          )}

          {/* Copy All Pure Text Button */}
          <button
            onClick={handleCopyAll}
            disabled={totalKhmerChars === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-khmer font-bold text-xs sm:text-sm shadow-xl transition-all active:scale-95 ${
              copied
                ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/30 ring-2 ring-emerald-400'
                : totalKhmerChars === 0
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-gradient-to-r from-amber-400 via-amber-500 to-rose-500 hover:from-amber-300 hover:to-rose-400 text-slate-950 shadow-amber-500/30'
            }`}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 stroke-[3]" />
                <span>បានចម្លងអត្ថបទខ្មែរ!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 stroke-[2.5]" />
                <span>កុបពីអត្ថបទសុទ្ធ (Copy Pure Text)</span>
              </>
            )}
          </button>

          {/* Download txt button */}
          <button
            onClick={handleDownloadTxt}
            disabled={totalKhmerChars === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 font-khmer text-xs transition-all disabled:opacity-40"
            title="ទាញយកជាឯកសារ .txt"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">ទាញយក .txt</span>
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            title={isFullScreen ? 'បង្រួមធម្មតា' : 'ពង្រីកពេញអេក្រង់'}
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Collapse/Expand Toggle */}
          {!isFullScreen && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              title={isExpanded ? 'បិទប្រអប់' : 'បើកប្រអប់'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded Content Area */}
      {isExpanded && (
        <div className={`p-4 sm:p-6 space-y-4 ${isFullScreen ? 'flex-1 overflow-y-auto' : ''}`}>
          {/* Tabs for switching between Pure Text, SRT format, and Non-Khmer text */}
          <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-2 gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('text')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-khmer font-bold transition-all ${
                  activeTab === 'text'
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>អត្ថបទបកប្រែសុទ្ធ (Pure Text)</span>
              </button>

              {hasSrtData && (
                <button
                  type="button"
                  onClick={() => setActiveTab('srt')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-khmer font-bold transition-all ${
                    activeTab === 'srt'
                      ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>
                    ទម្រង់ចំណងជើងរឿង SRT ({toKhmerNumerals(translatedCuesCount)}/{toKhmerNumerals(effectiveCues.length)} ជួរ)
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTab('non_khmer')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-khmer font-bold transition-all ${
                  activeTab === 'non_khmer'
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                    : 'bg-slate-800/80 text-amber-400/90 hover:text-amber-200'
                }`}
              >
                <Languages className="w-3.5 h-3.5" />
                <span>អក្សរមិនមែនខ្មែរ (Non-Khmer Text)</span>
                {allNonKhmerWordsCount > 0 && (
                  <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {toKhmerNumerals(allNonKhmerWordsCount)}
                  </span>
                )}
              </button>
            </div>

            <span className="text-[11px] text-amber-400 font-khmer hidden sm:inline-block">
              {activeTab === 'non_khmer'
                ? '🔍 ផ្ទាំងបង្ហាញអក្សរដែលបកប្រែហើយ ដែលមិនមែនជាអក្សរខ្មែរ'
                : hasSrtData
                ? '✓ ពេលវេលានិងជួរនីមួយៗត្រូវបានតម្រៀបដូច SRT ដើម ១០០%'
                : '✓ អត្ថបទបកប្រែសុទ្ធ ១០០% គ្មានក្បាលទំព័រ'}
            </span>
          </div>

          {/* Quick Info Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/80 rounded-xl p-3 border border-slate-800 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-khmer">អក្សរខ្មែរបកបានសរុប៖</span>
              <span className="font-bold font-mono text-amber-400 text-sm">
                {toKhmerNumerals(totalKhmerChars.toLocaleString())} តួ
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-khmer">ចំនួនទំព័របកបាន៖</span>
              <span className="font-bold font-mono text-emerald-400">
                {toKhmerNumerals(completedPages)} / {toKhmerNumerals(totalPages)} ទំព័រ
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-khmer">
                {hasSrtData ? 'ចំនួនជួរ SRT៖' : 'លក្ខណៈអត្ថបទ៖'}
              </span>
              <span className="font-bold text-emerald-400 font-khmer">
                {hasSrtData
                  ? `${toKhmerNumerals(translatedCuesCount)} ជួរបានបក`
                  : 'អត្ថបទបកប្រែសុទ្ធ (គ្មានលេខក្បាលទំព័រ)'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-khmer">ពាក្យមិនមែនខ្មែរ៖</span>
              <span className="font-bold font-mono text-amber-400">
                {toKhmerNumerals(allNonKhmerWordsCount)} ពាក្យ
              </span>
            </div>
          </div>

          {/* Content Area: If non_khmer, show NonKhmerInspector; otherwise show textarea */}
          {activeTab === 'non_khmer' ? (
            <NonKhmerInspector
              translatedText={combinedText}
              originalText={combinedOriginalText}
              onFixAllSpellingAndForeign={onFixAllSpellingAndForeign}
              isFixingSpellingAndForeign={isFixingSpellingAndForeign}
            />
          ) : (
            <div className="relative">
              <textarea
                readOnly
                value={activeTab === 'srt' && hasSrtData ? combinedSrtText : combinedText}
                placeholder={
                  activeTab === 'srt'
                    ? 'ទម្រង់ SRT ដែលបកប្រែបាននឹងបង្ហាញនៅទីនេះ...'
                    : 'អត្ថបទខ្មែរដែលបកប្រែបាននឹងបង្ហាញនៅទីនេះ...'
                }
                className={`w-full bg-slate-950 border border-slate-800 rounded-xl p-5 text-sm sm:text-base text-slate-200 leading-loose focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-y select-text scrollbar-thin scrollbar-thumb-amber-500/30 scrollbar-track-slate-900 ${
                  activeTab === 'srt' ? 'font-mono text-xs sm:text-sm text-sky-200' : 'font-khmer-novel'
                } ${isFullScreen ? 'h-[calc(100vh-280px)]' : 'h-96'}`}
              />

            {/* Floating Quick Copy button at corner of textarea */}
            <div className="absolute right-4 bottom-5">
              {activeTab === 'srt' && hasSrtData ? (
                <button
                  onClick={handleCopySrt}
                  disabled={!combinedSrtText.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold font-khmer text-xs shadow-lg shadow-sky-500/30 active:scale-95 transition-all disabled:opacity-40"
                >
                  {copiedSrt ? <Check className="w-4 h-4 stroke-[3]" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedSrt ? 'បានចម្លង SRT!' : 'កុបពី SRT'}</span>
                </button>
              ) : (
                <button
                  onClick={handleCopyAll}
                  disabled={totalKhmerChars === 0}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-khmer text-xs shadow-lg shadow-amber-500/30 active:scale-95 transition-all disabled:opacity-40"
                >
                  {copied ? <Check className="w-4 h-4 stroke-[3]" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'បានចម្លង!' : 'កុបពីទាំងអស់'}</span>
                </button>
              )}
            </div>
          </div>
        )}

          {/* Footer Quality Note */}
          <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-khmer pt-1">
            <span>
              {hasSrtData
                ? '🎬 ឯកសារ SRT ត្រូវបានផ្គូផ្គងលេខកូដពេលវេលា (Timecode) និងអត្ថន័យតាមជួរនីមួយៗឱ្យដូច SRT ដើម ១០០%។'
                : '💡 ក្នុងប្រអប់នេះមានតែ **អត្ថបទបកប្រែសុទ្ធ ១០០%** មិនមានស្លាកក្បាលទំព័រឡើយ អាចកុបពីយកទៅប្រើប្រាស់បានភ្លាមៗ។'}
            </span>
            <span className="text-amber-400/80">
              * លេខខ្មែរសុទ្ធ ១០០% • សញ្ញាវណ្ណយុត្តិស្អាត (តែ «។» និង «?»)
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
