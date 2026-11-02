import React, { useMemo } from 'react';
import {
  Play,
  Pause,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  BookMarked,
  FastForward,
} from 'lucide-react';
import { PageChunk } from '../utils/chunker';
import { toKhmerNumerals } from '../utils/khmerCleaner';

interface PageNavigatorProps {
  pages: PageChunk[];
  activePageIndex: number;
  setActivePageIndex: (index: number) => void;
  isTranslating: boolean;
  autoTranslateAll: boolean;
  onTranslateCurrentPage: () => void;
  onAutoTranslateAllToggle: () => void;
  onStopTranslation: () => void;
}

export const PageNavigator: React.FC<PageNavigatorProps> = React.memo(({
  pages,
  activePageIndex,
  setActivePageIndex,
  isTranslating,
  autoTranslateAll,
  onTranslateCurrentPage,
  onAutoTranslateAllToggle,
  onStopTranslation,
}) => {
  const totalPages = pages.length;
  const completedPages = useMemo(
    () =>
      pages.filter(
        (p) => p.status === 'completed' && p.translatedText && p.translatedText.trim().length > 0
      ).length,
    [pages]
  );
  const totalTranslatedChars = useMemo(
    () => pages.reduce((acc, p) => acc + p.translatedChars, 0),
    [pages]
  );
  const progressPercent = totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;

  // Windowed page tabs when totalPages > 60 (e.g., 800+ pages for 10,000,000 characters)
  const visiblePageIndices = useMemo(() => {
    if (totalPages <= 60) {
      return Array.from({ length: totalPages }, (_, i) => i);
    }
    const indices = new Set<number>();
    indices.add(0);
    indices.add(totalPages - 1);
    const start = Math.max(0, activePageIndex - 15);
    const end = Math.min(totalPages - 1, activePageIndex + 15);
    for (let i = start; i <= end; i++) {
      indices.add(i);
    }
    return Array.from(indices).sort((a, b) => a - b);
  }, [totalPages, activePageIndex]);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
      {/* Top row: Page statistics & Action buttons */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BookMarked className="w-4 h-4 text-amber-400" />
            <span className="font-bold text-slate-100 font-khmer text-sm">
              ការរុករកទំព័រ (Pages Navigation)
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-amber-300 font-bold font-khmer border border-slate-700">
              ទំព័រទី {toKhmerNumerals(activePageIndex + 1)} / {toKhmerNumerals(totalPages)}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-bold font-khmer border border-emerald-500/40">
              💬 Chat ថ្មី #{toKhmerNumerals(activePageIndex + 1)} • ⚡ Gemini 8 Flash
            </span>

            {totalPages > 10 && (
              <select
                aria-label="ជ្រើសរើសទំព័រ"
                value={activePageIndex}
                onChange={(e) => setActivePageIndex(Number(e.target.value))}
                className="bg-slate-950 border border-slate-700 text-amber-300 text-xs rounded-lg px-2 py-1 font-khmer focus:outline-none focus:border-amber-400"
              >
                {pages.map((p, idx) => (
                  <option key={p.id} value={idx}>
                    ទំព័រទី {toKhmerNumerals(idx + 1)} • Chat ថ្មី #{toKhmerNumerals(idx + 1)} (
                    {p.status === 'completed' ? '✓ បករួច' : 'មិនទាន់បក'})
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="text-xs text-slate-400 font-khmer mt-0.5">
            បកប្រែបាន {toKhmerNumerals(completedPages)} នៃ {toKhmerNumerals(totalPages)} ទំព័រ (
            {toKhmerNumerals(progressPercent)}%) • សរុប{' '}
            {toKhmerNumerals(totalTranslatedChars.toLocaleString())} តួអក្សរខ្មែរ •{' '}
            <span className="text-emerald-300 font-semibold">
              ប្ដូរ Chat ថ្មីជានិច្ចរាល់ទំព័រនីមួយៗដោយប្រើតែ Gemini 8 Flash
            </span>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {isTranslating ? (
            <div className="flex items-center gap-2">
              {autoTranslateAll && (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-khmer animate-pulse">
                  <FastForward className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                  <span>
                    កំពុងបកស្វ័យប្រវត្តក្នុង Chat ថ្មី #{toKhmerNumerals(activePageIndex + 1)} (ទំព័រទី{' '}
                    {toKhmerNumerals(activePageIndex + 1)}/{toKhmerNumerals(totalPages)} • Gemini 8 Flash)
                  </span>
                </div>
              )}
              <button
                onClick={onStopTranslation}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-khmer text-xs font-bold shadow-lg shadow-rose-600/20 active:scale-95 transition-all"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>ផ្អាក / បញ្ឈប់</span>
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={onTranslateCurrentPage}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 hover:border-amber-500/60 font-khmer text-xs font-bold shadow transition-all active:scale-95"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  បកប្រែទំព័រទី {toKhmerNumerals(activePageIndex + 1)} (Chat ថ្មី #
                  {toKhmerNumerals(activePageIndex + 1)})
                </span>
              </button>

              <button
                onClick={onAutoTranslateAllToggle}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 font-khmer text-xs font-bold shadow-lg shadow-amber-500/25 active:scale-95 transition-all"
                title="ចាប់ផ្តើមបកប្រែពីទំព័រទី ១ ដល់ចប់ ដោយប្ដូរ Chat ថ្មីជានិច្ចរាល់ទំព័រនីមួយៗជាមួយ Gemini 8 Flash"
              >
                <Sparkles className="w-3.5 h-3.5 text-slate-950" />
                <span>បកប្រែគ្រប់ទំព័រ (ប្ដូរ Chat ថ្មីរាល់ទំព័រ • Gemini 8 Flash)</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
        <div
          className="bg-gradient-to-r from-amber-500 via-rose-500 to-emerald-400 h-full transition-all duration-300 rounded-full"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Page Tabs / Badges */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        <button
          onClick={() => setActivePageIndex(Math.max(0, activePageIndex - 1))}
          disabled={activePageIndex === 0}
          aria-label="ទំព័រមុន"
          className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {visiblePageIndices.map((idx, pos) => {
          const p = pages[idx];
          if (!p) return null;
          const isActive = idx === activePageIndex;
          const isTranslatingThis = p.status === 'translating';
          const isDone =
            p.status === 'completed' &&
            Boolean(p.translatedText && p.translatedText.trim().length > 0);
          const isErr = p.status === 'error';
          const prevIdx = pos > 0 ? visiblePageIndices[pos - 1] : idx;
          const showGap = pos > 0 && idx - prevIdx > 1;

          return (
            <React.Fragment key={p.id}>
              {showGap && (
                <span className="text-xs text-slate-500 px-1 select-none font-mono">...</span>
              )}
              <button
                onClick={() => setActivePageIndex(idx)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-khmer transition-all shrink-0 border ${
                  isActive
                    ? 'bg-amber-500/15 border-amber-500/80 text-amber-300 shadow-md ring-1 ring-amber-500/30'
                    : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                {isTranslatingThis ? (
                  <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                ) : isDone ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : isErr ? (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-600" />
                )}
                <span className="font-semibold">ទំព័រទី {toKhmerNumerals(idx + 1)}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                  Chat #{toKhmerNumerals(idx + 1)}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  ({toKhmerNumerals(Math.max(1, Math.round(p.charCount / 1000)))}k តួ)
                </span>
              </button>
            </React.Fragment>
          );
        })}

        <button
          onClick={() => setActivePageIndex(Math.min(totalPages - 1, activePageIndex + 1))}
          disabled={activePageIndex === totalPages - 1}
          aria-label="ទំព័របន្ទាប់"
          className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});
