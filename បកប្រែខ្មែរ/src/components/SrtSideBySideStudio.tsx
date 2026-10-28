import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Film,
  Search,
  ArrowLeft,
  ArrowRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Copy,
  Check,
  Sparkles,
  Edit3,
  CheckCircle2,
  Clock,
  Filter,
  Maximize2,
  Minimize2,
  FileText,
  Navigation,
} from 'lucide-react';
import { SrtCue, buildSrt } from '../utils/srtParser';
import { toKhmerNumerals } from '../utils/khmerCleaner';
import { hasNonKhmerWords } from '../utils/nonKhmerDetector';

interface SrtSideBySideStudioProps {
  cues: SrtCue[];
  movieTitle?: string;
  isTranslating?: boolean;
  activeTranslatingCueId?: number | null;
  onUpdateCue: (cueId: number, newKhmerText: string) => void;
  onClose?: () => void;
  isFullScreenMode?: boolean;
  onToggleFullScreen?: () => void;
}

export const SrtSideBySideStudio: React.FC<SrtSideBySideStudioProps> = ({
  cues,
  movieTitle = 'ចំណងជើងរឿង SRT',
  isTranslating = false,
  activeTranslatingCueId = null,
  onUpdateCue,
  onClose,
  isFullScreenMode = false,
  onToggleFullScreen,
}) => {
  // Pagination & Filtering state
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [jumpCueInput, setJumpCueInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'translated' | 'untranslated' | 'non_khmer'>('all');
  const [copiedCueId, setCopiedCueId] = useState<number | null>(null);
  const [copiedAllSrt, setCopiedAllSrt] = useState<boolean>(false);
  const [highlightedCueId, setHighlightedCueId] = useState<number | null>(null);

  const cueCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Statistics
  const totalCues = cues.length;
  const translatedCount = useMemo(
    () => cues.filter((c) => c.translatedText && c.translatedText.trim().length > 0).length,
    [cues]
  );
  const pendingCount = totalCues - translatedCount;
  const nonKhmerCuesCount = useMemo(
    () => cues.filter((c) => c.translatedText && hasNonKhmerWords(c.translatedText)).length,
    [cues]
  );
  const progressPercent = totalCues > 0 ? Math.round((translatedCount / totalCues) * 100) : 0;

  // Filtered Cues
  const filteredCues = useMemo(() => {
    let result = cues;

    if (filterMode === 'translated') {
      result = result.filter((c) => c.translatedText && c.translatedText.trim().length > 0);
    } else if (filterMode === 'untranslated') {
      result = result.filter((c) => !c.translatedText || c.translatedText.trim().length === 0);
    } else if (filterMode === 'non_khmer') {
      result = result.filter((c) => c.translatedText && hasNonKhmerWords(c.translatedText));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.id.toString().includes(q) ||
          c.timecode.toLowerCase().includes(q) ||
          c.originalText.toLowerCase().includes(q) ||
          (c.translatedText && c.translatedText.toLowerCase().includes(q))
      );
    }

    return result;
  }, [cues, filterMode, searchQuery]);

  // Total pages
  const totalPages = Math.max(1, Math.ceil(filteredCues.length / pageSize));

  // Current page cues
  const pagedCues = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCues.slice(start, start + pageSize);
  }, [filteredCues, currentPage, pageSize]);

  // Adjust current page if filter shrinks total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  // Jump to cue function
  const handleJumpToCue = (targetIdStr?: string) => {
    const val = targetIdStr !== undefined ? targetIdStr : jumpCueInput;
    const targetId = parseInt(val.trim(), 10);
    if (isNaN(targetId) || targetId <= 0) return;

    // Find the index of this cue in filteredCues
    const cueIndex = filteredCues.findIndex((c) => c.id === targetId);
    if (cueIndex === -1) {
      // If not in current filtered list, check if it exists in all cues
      const existsInAll = cues.some((c) => c.id === targetId);
      if (existsInAll && filterMode !== 'all') {
        setFilterMode('all');
        setSearchQuery('');
        setTimeout(() => handleJumpToCue(targetId.toString()), 50);
        return;
      }
      alert(`រកមិនឃើញជួរ SRT លេខ #${targetId} ឡើយ`);
      return;
    }

    const targetPage = Math.floor(cueIndex / pageSize) + 1;
    setCurrentPage(targetPage);
    setHighlightedCueId(targetId);

    setTimeout(() => {
      const cardEl = cueCardRefs.current.get(targetId);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  };

  // Jump to next untranslated cue
  const handleJumpToNextUntranslated = () => {
    const firstUntranslated = cues.find(
      (c) => !c.translatedText || c.translatedText.trim().length === 0
    );
    if (!firstUntranslated) {
      alert('បានបកប្រែគ្រប់ជួរ SRT ទាំងអស់រួចរាល់ហើយ!');
      return;
    }
    if (filterMode === 'translated') {
      setFilterMode('all');
    }
    handleJumpToCue(firstUntranslated.id.toString());
  };

  // Copy single cue in SRT format
  const handleCopySingleCue = (cue: SrtCue) => {
    const srtBlock = `${cue.id}\n${cue.timecode}\n${(cue.translatedText || cue.originalText).trim()}`;
    navigator.clipboard.writeText(srtBlock);
    setCopiedCueId(cue.id);
    setTimeout(() => setCopiedCueId(null), 1500);
  };

  // Copy all translated SRT
  const handleCopyAllSrt = () => {
    const fullSrt = buildSrt(cues, true);
    if (!fullSrt) return;
    navigator.clipboard.writeText(fullSrt);
    setCopiedAllSrt(true);
    setTimeout(() => setCopiedAllSrt(false), 2000);
  };

  // Download translated SRT
  const handleDownloadTranslatedSrt = () => {
    const srtContent = buildSrt(cues, true);
    if (!srtContent) return;
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(movieTitle || 'subtitle').replace(/\s+/g, '_')}_Khmer_Subtitles.srt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Download original SRT
  const handleDownloadOriginalSrt = () => {
    const srtContent = buildSrt(cues, false);
    if (!srtContent) return;
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(movieTitle || 'subtitle').replace(/\s+/g, '_')}_Original.srt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Download pure translated dialogue as text
  const handleDownloadPureKhmerText = () => {
    const pureKhmer = cues
      .map((c) => (c.translatedText || '').trim())
      .filter((t) => t.length > 0)
      .join('\n\n');
    if (!pureKhmer) return;
    const blob = new Blob([pureKhmer], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(movieTitle || 'subtitle').replace(/\s+/g, '_')}_អត្ថបទខ្មែរសុទ្ធ.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Active cue index within range for current display
  const startCueIndex = (currentPage - 1) * pageSize + 1;
  const endCueIndex = Math.min(currentPage * pageSize, filteredCues.length);

  return (
    <div
      ref={containerRef}
      className={`bg-slate-950 border border-sky-900/60 rounded-2xl flex flex-col shadow-2xl transition-all ${
        isFullScreenMode ? 'fixed inset-0 z-50 rounded-none border-none' : 'w-full my-4'
      }`}
    >
      {/* 1. Header: Movie Title & Cue Counter Status (ទម្រង់ចំណងជើងរឿង SRT) */}
      <div className="bg-gradient-to-r from-slate-950 via-sky-950/70 to-slate-950 p-4 sm:p-5 border-b border-sky-800/60 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Title & Counter Badge */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="p-2 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
                <Film className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-sky-300 font-khmer flex flex-wrap items-center gap-2">
                  <span>ទម្រង់ចំណងជើងរឿង SRT</span>
                  <span className="text-amber-400 font-mono text-sm sm:text-base font-extrabold px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30">
                    ({toKhmerNumerals(translatedCount)}/{toKhmerNumerals(totalCues)} ជួរ • {progressPercent}%)
                  </span>
                </h3>
                <p className="text-xs text-slate-400 font-khmer">
                  {movieTitle} • បង្ហាញ SRT ដើម និង SRT បកប្រែមួយចំហៀងម្នាក់ ផ្ទៀងផ្ទាត់កូដម៉ោងដើម ១០០%
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions (Export & Fullscreen) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDownloadTranslatedSrt}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-xs font-khmer font-semibold transition-all shadow"
              title="ទាញយក SRT ខ្មែរ (.srt)"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>ទាញយក SRT ខ្មែរ</span>
            </button>

            <button
              onClick={handleCopyAllSrt}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-khmer transition-all"
              title="ចម្លង SRT ខ្មែរទាំងអស់"
            >
              {copiedAllSrt ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedAllSrt ? 'បានចម្លង SRT' : 'ចម្លង SRT'}</span>
            </button>

            <button
              onClick={handleDownloadPureKhmerText}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-khmer transition-all"
              title="ទាញយកអត្ថបទខ្មែរសុទ្ធ (.txt)"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">អត្ថបទសុទ្ធ .txt</span>
            </button>

            {onToggleFullScreen && (
              <button
                onClick={onToggleFullScreen}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-all"
                title={isFullScreenMode ? 'បង្រួមធម្មតា' : 'ពង្រីកពេញអេក្រង់'}
              >
                {isFullScreenMode ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            )}

            {onClose && (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-khmer transition-all"
              >
                បិទ
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar & Subtitle Integrity Badges */}
        <div className="space-y-2">
          <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 h-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-slate-400 font-khmer flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-sky-400" />
                <span>សរុប៖ </span>
                <strong className="text-slate-200 font-mono">{toKhmerNumerals(totalCues)}</strong> ជួរ
              </span>

              <span className="text-emerald-400 font-khmer flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>បកប្រែរួច៖ </span>
                <strong className="font-mono">{toKhmerNumerals(translatedCount)}</strong> ជួរ
              </span>

              <span className="text-slate-400 font-khmer flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-500" />
                <span>នៅសល់៖ </span>
                <strong className="font-mono text-slate-300">{toKhmerNumerals(pendingCount)}</strong> ជួរ
              </span>

              {isTranslating && (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-khmer animate-pulse">
                  <Sparkles className="w-3 h-3 text-sky-400 animate-spin" />
                  <span>
                    កំពុងបកប្រែជួរ #{toKhmerNumerals(activeTranslatingCueId || 0)}...
                  </span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-sky-950/80 text-sky-300 border border-sky-800/80 font-mono">
                ⏱️ 100% Original Timestamps Locked
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Controls Bar: Jump to Cue (ផ្លោះទៅជួរ #171), Page Navigation, Filter & Search */}
      <div className="bg-slate-900/90 p-3 sm:p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Jump to Cue Input & Quick Untranslated */}
        <div className="flex flex-wrap items-center gap-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleJumpToCue();
            }}
            className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-sky-800/70 focus-within:border-sky-400 shadow-inner"
          >
            <span className="text-sky-400 font-khmer font-semibold text-[11px] flex items-center gap-1">
              <Navigation className="w-3 h-3" />
              <span>ផ្លោះទៅជួរ #</span>
            </span>
            <input
              type="number"
              min="1"
              max={totalCues || 99999}
              placeholder="171"
              value={jumpCueInput}
              onChange={(e) => setJumpCueInput(e.target.value)}
              className="w-16 bg-transparent text-amber-300 font-mono font-bold text-center outline-none"
            />
            <button
              type="submit"
              className="px-2 py-0.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold font-khmer text-[11px] transition-all"
            >
              ទៅកាន់
            </button>
          </form>

          {pendingCount > 0 && (
            <button
              onClick={handleJumpToNextUntranslated}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-khmer transition-all"
              title="រត់ទៅជួរដែលមិនទាន់បានបកប្រែបន្ទាប់"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>ទៅជួរមិនទាន់ប្រែបន្ទាប់</span>
            </button>
          )}

          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-2 py-1 rounded-lg font-khmer text-[11px] transition-all ${
                filterMode === 'all'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ទាំងអស់ ({toKhmerNumerals(totalCues)})
            </button>
            <button
              onClick={() => setFilterMode('translated')}
              className={`px-2 py-1 rounded-lg font-khmer text-[11px] transition-all ${
                filterMode === 'translated'
                  ? 'bg-emerald-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              បកប្រែរួច ({toKhmerNumerals(translatedCount)})
            </button>
            <button
              onClick={() => setFilterMode('untranslated')}
              className={`px-2 py-1 rounded-lg font-khmer text-[11px] transition-all ${
                filterMode === 'untranslated'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              នៅសល់ ({toKhmerNumerals(pendingCount)})
            </button>
            <button
              onClick={() => setFilterMode('non_khmer')}
              className={`px-2 py-1 rounded-lg font-khmer text-[11px] transition-all ${
                filterMode === 'non_khmer'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-amber-400 hover:text-amber-200'
              }`}
              title="បង្ហាញតែជួរ SRT ណាដែលមានអក្សរ ឬពាក្យមិនមែនខ្មែរ"
            >
              អក្សរមិនមែនខ្មែរ ({toKhmerNumerals(nonKhmerCuesCount)})
            </button>
          </div>
        </div>

        {/* Right: Search & Pagination Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-slate-300">
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="ស្វែងរកពាក្យក្នុង SRT..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-transparent text-xs text-slate-200 placeholder-slate-500 outline-none w-36 sm:w-44 font-khmer"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-slate-500 hover:text-slate-300 text-xs px-1"
              >
                ✕
              </button>
            )}
          </div>

          {/* Page Size Dropdown */}
          <div className="flex items-center gap-1 text-slate-400 font-khmer">
            <span>ជួរ/ទំព័រ៖</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-slate-950 text-slate-200 border border-slate-800 rounded-lg px-2 py-1 text-xs outline-none font-mono"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>

          {/* Pagination Navigation */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
              title="ទំព័រដំបូង"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
              title="ទំព័រមុន"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <span className="px-2 font-mono text-xs text-sky-300 font-bold">
              {toKhmerNumerals(currentPage)} / {toKhmerNumerals(totalPages)}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
              title="ទំព័របន្ទាប់"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
              title="ទំព័រចុងក្រោយ"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Range Status Sub-bar */}
      <div className="bg-slate-950/70 px-4 py-2 border-b border-slate-800/80 flex flex-wrap items-center justify-between text-[11px] text-slate-400">
        <div>
          <span>កំពុងបង្ហាញពីជួរ </span>
          <strong className="text-sky-300 font-mono">#{toKhmerNumerals(startCueIndex)}</strong>
          <span> ដល់ </span>
          <strong className="text-sky-300 font-mono">#{toKhmerNumerals(endCueIndex)}</strong>
          <span> (នៃសរុប </span>
          <strong className="text-slate-200 font-mono">{toKhmerNumerals(filteredCues.length)}</strong> ជួរ)
        </div>
        <div className="text-sky-400/90 font-khmer">
          💡 ចុចលើប្រអប់អត្ថបទខ្មែរ (ចំហៀងស្ដាំ) ដើម្បីកែប្រែដោយផ្ទាល់
        </div>
      </div>

      {/* 3. Main List: Side-by-Side Cards (មួយចំហៀងម្នាក់) */}
      <div className="p-3 sm:p-5 overflow-y-auto max-h-[75vh] space-y-4 scrollbar-thin scrollbar-thumb-sky-500/30 scrollbar-track-slate-900">
        {pagedCues.length === 0 ? (
          <div className="p-12 text-center text-slate-400 font-khmer space-y-2">
            <Filter className="w-8 h-8 text-slate-600 mx-auto" />
            <p>មិនមានជួរ SRT ណាត្រូវនឹងការស្វែងរក ឬ Filter ឡើយ</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setFilterMode('all');
              }}
              className="px-3 py-1 rounded-lg bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs"
            >
              ត្រឡប់មកបង្ហាញទាំងអស់
            </button>
          </div>
        ) : (
          pagedCues.map((cue) => {
            const hasKhmer = Boolean(cue.translatedText && cue.translatedText.trim().length > 0);
            const isLive = isTranslating && activeTranslatingCueId === cue.id;
            const isHighlighted = highlightedCueId === cue.id;

            return (
              <div
                key={cue.id}
                ref={(el) => {
                  if (el) cueCardRefs.current.set(cue.id, el);
                  else cueCardRefs.current.delete(cue.id);
                }}
                className={`rounded-xl border transition-all duration-200 ${
                  isHighlighted
                    ? 'ring-2 ring-amber-400 border-amber-400 bg-amber-950/20 shadow-2xl'
                    : isLive
                    ? 'ring-2 ring-sky-400 border-sky-400 bg-sky-950/30 shadow-xl'
                    : hasKhmer
                    ? 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                    : 'border-slate-800/60 bg-slate-950/40 opacity-75'
                }`}
              >
                {/* Card Cue Bar: Index, Timecode, Status, Actions */}
                <div className="px-4 py-2.5 bg-slate-950/90 border-b border-slate-800/80 rounded-t-xl flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono font-bold px-2.5 py-0.5 rounded-lg border shadow-sm ${
                        isHighlighted
                          ? 'bg-amber-400 text-slate-950 border-amber-300'
                          : 'bg-sky-950 text-sky-400 border-sky-800'
                      }`}
                    >
                      #{cue.id}
                    </span>
                    <span className="font-mono text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-sky-400" />
                      <span>{cue.timecode}</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isLive && (
                      <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-sky-400 text-slate-950 text-[10px] font-bold font-khmer animate-pulse">
                        <Navigation className="w-2.5 h-2.5" />
                        <span>កំពុងបកប្រែជួរនេះ</span>
                      </span>
                    )}

                    {hasKhmer ? (
                      <span className="text-[11px] text-emerald-400 font-khmer flex items-center gap-1 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/50">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>បកប្រែរួច</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500 font-khmer bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        ⏳ នៅសល់
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleCopySingleCue(cue)}
                      className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-all text-xs"
                      title="ចម្លងប្លុក SRT នេះ"
                    >
                      {copiedCueId === cue.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Split 2-Column Grid: Original Dialogue (Left) vs Translated Khmer Dialogue (Right) */}
                <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  {/* Left Column: Original Dialogue */}
                  <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-800/60">
                        <span className="text-[10px] uppercase font-mono text-slate-500 font-semibold">
                          អត្ថបទដើម (Original Dialogue):
                        </span>
                        <span className="text-[10px] font-mono text-slate-600">
                          {cue.originalText.length} តួ
                        </span>
                      </div>
                      <p className="font-sans text-slate-200 text-sm leading-relaxed whitespace-pre-wrap select-text">
                        {cue.originalText}
                      </p>
                    </div>
                  </div>

                  {/* Right Column: Translated Khmer Dialogue (Directly Editable) */}
                  <div
                    className={`p-3.5 rounded-xl border flex flex-col justify-between transition-all ${
                      hasKhmer
                        ? 'bg-slate-950 border-amber-500/30'
                        : 'bg-slate-950/60 border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-800/60">
                        <span className="text-[10px] uppercase font-mono text-amber-400 font-semibold flex items-center gap-1">
                          <Edit3 className="w-3 h-3" />
                          <span>បកប្រែជាភាសាខ្មែរ (Khmer Dialogue - កែប្រែផ្ទាល់):</span>
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {cue.translatedText ? `${cue.translatedText.length} តួ` : '០ តួ'}
                        </span>
                      </div>

                      <textarea
                        value={cue.translatedText || ''}
                        placeholder="ចុចទីនេះដើម្បីសរសេរ ឬកែសម្រួលពាក្យបកប្រែខ្មែរ..."
                        rows={Math.max(2, (cue.translatedText || '').split('\n').length)}
                        onChange={(e) => onUpdateCue(cue.id, e.target.value)}
                        className="w-full bg-slate-900/50 hover:bg-slate-900 focus:bg-slate-900 border border-slate-800 focus:border-amber-400 rounded-lg p-2.5 text-sm font-khmer font-khmer-novel text-amber-200 placeholder-slate-600 outline-none transition-all resize-y leading-relaxed"
                      />
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-800/50 text-[10px] text-slate-500 font-khmer">
                      <span>✓ រក្សាទុកស្វ័យប្រវត្តិចូល SRT</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (cue.translatedText) {
                            navigator.clipboard.writeText(cue.translatedText);
                            setCopiedCueId(cue.id);
                            setTimeout(() => setCopiedCueId(null), 1500);
                          }
                        }}
                        className="hover:text-amber-300 transition-colors"
                      >
                        ចម្លងតែអត្ថបទខ្មែរ
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. Bottom Footer with Pagination & Summary */}
      <div className="bg-slate-950 p-3.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-slate-400">
            ទំព័រ {toKhmerNumerals(currentPage)} នៃ {toKhmerNumerals(totalPages)}
          </span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400 font-khmer">
            {toKhmerNumerals(translatedCount)} / {toKhmerNumerals(totalCues)} ជួរបានបកប្រែ
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCurrentPage((p) => Math.max(1, p - 1));
              containerRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 disabled:opacity-40 font-khmer text-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>ទំព័រមុន</span>
          </button>
          <button
            onClick={() => {
              setCurrentPage((p) => Math.min(totalPages, p + 1));
              containerRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            disabled={currentPage === totalPages}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 disabled:opacity-40 font-khmer text-xs font-semibold"
          >
            <span>ទំព័របន្ទាប់</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
