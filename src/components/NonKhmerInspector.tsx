import React, { useState, useMemo } from 'react';
import {
  Copy,
  Check,
  Search,
  Sparkles,
  Languages,
  CheckCircle2,
  Wand2,
  ArrowRight,
  ListChecks,
} from 'lucide-react';
import { extractNonKhmerWords, NonKhmerItem } from '../utils/nonKhmerDetector';
import { toKhmerNumerals, CorrectionDiffItem } from '../utils/khmerCleaner';

interface NonKhmerInspectorProps {
  translatedText: string;
  originalText?: string;
  corrections?: CorrectionDiffItem[];
  onSelectWord?: (word: string) => void;
  onFixCurrentPage?: () => void;
  onFixAllSpellingAndForeign?: () => void;
  isFixingSpellingAndForeign?: boolean;
}

export const NonKhmerInspector: React.FC<NonKhmerInspectorProps> = ({
  translatedText,
  originalText = '',
  corrections = [],
  onSelectWord,
  onFixCurrentPage,
  onFixAllSpellingAndForeign,
  isFixingSpellingAndForeign = false,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [copiedWord, setCopiedWord] = useState<string | null>(null);
  const [copiedAllWords, setCopiedAllWords] = useState<boolean>(false);
  const [copiedOriginal, setCopiedOriginal] = useState<boolean>(false);
  const [viewTab, setViewTab] = useState<'corrections' | 'words' | 'original'>(
    corrections.length > 0 ? 'corrections' : 'words'
  );

  // Extract all non-Khmer words from the translated text
  const nonKhmerItems: NonKhmerItem[] = useMemo(() => {
    return extractNonKhmerWords(translatedText);
  }, [translatedText]);

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return nonKhmerItems;
    const q = searchQuery.toLowerCase().trim();
    return nonKhmerItems.filter(
      (item) =>
        item.word.toLowerCase().includes(q) ||
        item.contexts.some((c) => c.toLowerCase().includes(q))
    );
  }, [nonKhmerItems, searchQuery]);

  const totalNonKhmerWordsCount = nonKhmerItems.length;
  const totalOccurrences = useMemo(
    () => nonKhmerItems.reduce((acc, curr) => acc + curr.count, 0),
    [nonKhmerItems]
  );

  const handleCopyWord = (word: string) => {
    navigator.clipboard.writeText(word);
    setCopiedWord(word);
    setTimeout(() => setCopiedWord(null), 1500);
  };

  const handleCopyAllWords = () => {
    const list = nonKhmerItems.map((item) => `${item.word} (${item.count} ដង)`).join('\n');
    if (!list) return;
    navigator.clipboard.writeText(list);
    setCopiedAllWords(true);
    setTimeout(() => setCopiedAllWords(false), 2000);
  };

  const activeItem = useMemo(() => {
    if (!selectedWord) return filteredItems[0] || null;
    return nonKhmerItems.find((item) => item.word === selectedWord) || filteredItems[0] || null;
  }, [selectedWord, nonKhmerItems, filteredItems]);

  return (
    <div className="bg-slate-950 border border-amber-500/30 rounded-2xl overflow-hidden shadow-2xl flex flex-col space-y-4">
      {/* Header Bar */}
      <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-950 p-4 sm:p-5 border-b border-amber-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center font-bold shadow-lg shadow-amber-500/10">
            <Languages className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-amber-300 font-khmer flex flex-wrap items-center gap-2">
              <span>ផ្ទាំងត្រួតពិនិត្យអក្សរដែលខុស និងអក្សរដែលកែរួចទាំងអស់</span>
              <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                កែរួច {toKhmerNumerals(corrections.length)} កន្លែង
              </span>
              {totalNonKhmerWordsCount > 0 && (
                <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                  នៅសល់ {toKhmerNumerals(totalNonKhmerWordsCount)} ពាក្យ ({toKhmerNumerals(totalOccurrences)} ដង)
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400 font-khmer mt-0.5">
              បង្ហាញរាល់អក្សរខុស/ច្រឡំភាសា (ដូចជា διοាក់គំនិតនោះ, তরwសាង, ដ៏ကြမ်းដុះដំបូ, พยายาม) និងអក្សរខ្មែរសុទ្ធដែលបានកែរួច
            </p>
          </div>
        </div>

        {/* Tab & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {onFixCurrentPage && (
            <button
              type="button"
              onClick={onFixCurrentPage}
              disabled={isFixingSpellingAndForeign}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-xs font-khmer shadow-lg shadow-amber-500/25 active:scale-95 transition-all disabled:opacity-50"
            >
              <Wand2 className={`w-3.5 h-3.5 ${isFixingSpellingAndForeign ? 'animate-spin' : ''}`} />
              <span>ជួសជុលទំព័រនេះ & បង្ហាញកំណែ</span>
            </button>
          )}

          {onFixAllSpellingAndForeign && (
            <button
              type="button"
              onClick={onFixAllSpellingAndForeign}
              disabled={isFixingSpellingAndForeign}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs font-khmer shadow-lg shadow-emerald-500/25 active:scale-95 transition-all disabled:opacity-50"
            >
              <Wand2 className={`w-3.5 h-3.5 ${isFixingSpellingAndForeign ? 'animate-spin' : ''}`} />
              <span>
                {isFixingSpellingAndForeign
                  ? 'កំពុងជួសជុលអក្ខរាវិរុទ្ធ & ជម្រះពាក្យបរទេស...'
                  : 'ជួសជុលគ្រប់ទំព័រទាំងអស់'}
              </span>
            </button>
          )}

          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setViewTab('corrections')}
              className={`px-3 py-1.5 rounded-lg font-khmer transition-all flex items-center gap-1.5 ${
                viewTab === 'corrections'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                  : 'text-emerald-400 hover:text-emerald-200'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span>អក្សរខុស & កែរួច ({toKhmerNumerals(corrections.length)})</span>
            </button>
            <button
              onClick={() => setViewTab('words')}
              className={`px-3 py-1.5 rounded-lg font-khmer transition-all ${
                viewTab === 'words'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ពាក្យមិនមែនខ្មែរ ({toKhmerNumerals(totalNonKhmerWordsCount)})
            </button>
            <button
              onClick={() => setViewTab('original')}
              className={`px-3 py-1.5 rounded-lg font-khmer transition-all ${
                viewTab === 'original'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              អត្ថបទដើមបរទេស
            </button>
          </div>

          {totalNonKhmerWordsCount > 0 && viewTab === 'words' && (
            <button
              onClick={handleCopyAllWords}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-khmer transition-all"
              title="ចម្លងបញ្ជីពាក្យមិនមែនខ្មែរទាំងអស់"
            >
              {copiedAllWords ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedAllWords ? 'បានចម្លងបញ្ជី' : 'ចម្លងបញ្ជី'}</span>
            </button>
          )}
        </div>
      </div>

      {viewTab === 'corrections' ? (
        <div className="p-4 sm:p-5 pt-0 space-y-4">
          {corrections.length === 0 ? (
            <div className="p-10 text-center text-slate-400 font-khmer bg-slate-900/40 rounded-xl border border-slate-800 space-y-3">
              <ListChecks className="w-8 h-8 text-amber-400 mx-auto" />
              <h4 className="text-sm font-bold text-slate-200">
                មិនទាន់មានបញ្ជីកំណែសម្រាប់ទំព័រនេះ ឬអត្ថបទទំព័រនេះត្រឹមត្រូវស្រាប់
              </h4>
              <p className="text-xs text-slate-400">
                សូមចុចប៊ូតុង «ជួសជុលទំព័រនេះ & បង្ហាញកំណែ» ដើម្បីឱ្យប្រព័ន្ធពិនិត្យ និងបង្ហាញរាល់អក្សរដែលខុស និងអក្សរដែលកែរួចទាំងអស់។
              </p>
              {onFixCurrentPage && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onFixCurrentPage}
                    disabled={isFixingSpellingAndForeign}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-khmer font-bold shadow-lg transition-all"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>ពិនិត្យ និងជួសជុលទំព័រនេះឥឡូវនេះ</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-khmer text-slate-300 bg-slate-900/80 px-3.5 py-2.5 rounded-xl border border-slate-800">
                <span>
                  បញ្ជីអក្សរដែលខុស និងអក្សរដែលកែរួចទាំងអស់ក្នុងទំព័រនេះ ({toKhmerNumerals(corrections.length)} កន្លែង)៖
                </span>
                <span className="text-emerald-400 font-bold">
                  ✓ បានជួសជុលទៅជាភាសាខ្មែរសុទ្ធ ១០០%
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-96 overflow-y-auto pr-1">
                {corrections.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2 text-xs font-khmer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                        #{toKhmerNumerals(idx + 1)} • {item.category}
                      </span>
                      {item.count > 1 && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                          {toKhmerNumerals(item.count)} ដង
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex-1 min-w-[120px] p-2 rounded-lg bg-rose-950/40 border border-rose-500/30">
                        <div className="text-[10px] text-rose-400 mb-0.5">❌ អក្សរដែលខុស៖</div>
                        <div className="font-bold text-rose-200 break-all select-text">
                          {item.wrongText}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-[120px] p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
                        <div className="text-[10px] text-emerald-400 mb-0.5">✅ អក្សរដែលកែរួច៖</div>
                        <div className="font-bold text-emerald-200 break-all select-text">
                          {item.fixedText}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : viewTab === 'words' ? (
        <div className="p-4 sm:p-5 pt-0 space-y-4">
          {totalNonKhmerWordsCount === 0 ? (
            <div className="p-10 text-center text-slate-400 font-khmer bg-slate-900/40 rounded-xl border border-slate-800 space-y-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <h4 className="text-sm font-bold text-slate-200">
                អបអរសាទរ! មិនមានអក្សរ ឬពាក្យបរទេសនៅសល់ក្នុងអត្ថបទបកប្រែនេះឡើយ
              </h4>
              <p className="text-xs text-slate-500">
                អត្ថបទបកប្រែនេះជាអក្សរខ្មែរសុទ្ធ ១០០% ស្របតាមក្បួនភាសាខ្មែរ។
              </p>
              {onFixAllSpellingAndForeign && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onFixAllSpellingAndForeign}
                    disabled={isFixingSpellingAndForeign}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-khmer font-bold transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>ពិនិត្យ និងជួសជុលអក្ខរាវិរុទ្ធខ្មែរម្ដងទៀត</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Search bar & status */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="ស្វែងរកពាក្យមិនមែនខ្មែរ..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent text-slate-200 placeholder-slate-500 text-xs outline-none w-full font-khmer"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="text-slate-500 hover:text-slate-300 text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <span className="text-slate-400 font-khmer">
                  បង្ហាញ {toKhmerNumerals(filteredItems.length)} នៃ {toKhmerNumerals(totalNonKhmerWordsCount)} ពាក្យ
                </span>
              </div>

              {/* Grid: Left side Words list, Right side Contexts & Sentences */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Left: Words Chips List */}
                <div className="md:col-span-1 bg-slate-900/60 rounded-xl p-3 border border-slate-800 space-y-1.5 max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-amber-500/20 scrollbar-track-slate-950">
                  <div className="text-[11px] font-semibold text-amber-400 font-khmer px-2 pb-1 border-b border-slate-800">
                    បញ្ជីពាក្យមិនមែនខ្មែរ (ចុចដើម្បីមើល):
                  </div>
                  {filteredItems.map((item) => {
                    const isSelected = activeItem?.word === item.word;
                    return (
                      <button
                        key={item.word}
                        onClick={() => {
                          setSelectedWord(item.word);
                          if (onSelectWord) onSelectWord(item.word);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all ${
                          isSelected
                            ? 'bg-amber-500 text-slate-950 font-bold shadow'
                            : 'hover:bg-slate-800/80 text-slate-300'
                        }`}
                      >
                        <span className="font-mono text-xs truncate max-w-[150px]">
                          {item.word}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                            isSelected
                              ? 'bg-slate-950 text-amber-400'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {item.count}x
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Right: Detailed Context Preview */}
                <div className="md:col-span-2 bg-slate-900/60 rounded-xl p-4 border border-slate-800 flex flex-col justify-between space-y-3">
                  {activeItem ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/30">
                            {activeItem.word}
                          </span>
                          <span className="text-xs text-slate-400 font-khmer">
                            បានរកឃើញ {toKhmerNumerals(activeItem.count)} ដង
                          </span>
                        </div>

                        <button
                          onClick={() => handleCopyWord(activeItem.word)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-khmer transition-all"
                        >
                          {copiedWord === activeItem.word ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedWord === activeItem.word ? 'បានចម្លង' : 'ចម្លងពាក្យ'}</span>
                        </button>
                      </div>

                      <div>
                        <span className="text-[11px] text-slate-400 font-khmer block mb-2">
                          ទីកន្លែងដែលពាក្យនេះលេចឡើងក្នុងអត្ថបទបកប្រែ៖
                        </span>
                        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                          {activeItem.contexts.map((ctx, idx) => (
                            <div
                              key={idx}
                              className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 font-khmer leading-relaxed select-text"
                            >
                              <span className="text-slate-400 font-mono text-[10px] mr-2">
                                #{idx + 1}
                              </span>
                              {ctx}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-slate-500 font-khmer text-xs">
                      ជ្រើសរើសពាក្យមួយពីបញ្ជីខាងឆ្វេងដើម្បីពិនិត្យទីតាំង
                    </div>
                  )}

                  <div className="text-[11px] text-amber-400/90 font-khmer bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
                    💡 គន្លឹះ៖ ចុចប៊ូតុងពណ៌បៃតង «ជួសជុលអក្ខរាវិរុទ្ធ & ជម្រះ/បកប្រែពាក្យបរទេសទាំងអស់» ខាងលើ ដើម្បីឱ្យប្រព័ន្ធបកប្រែ ឬជម្រះពាក្យបរទេសទាំងអស់នេះទៅជាភាសាខ្មែរសុទ្ធ ១០០% ដោយស្វ័យប្រវត្តិ។
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* View Tab 2: Full Original Non-Khmer Source Text */
        <div className="p-4 sm:p-5 pt-0 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400 font-khmer">
            <span>អត្ថបទដើមភាសាបរទេស (Original Foreign Dialogue/Story):</span>
            <span className="font-mono">{originalText.length.toLocaleString()} តួអក្សរ</span>
          </div>

          <textarea
            readOnly
            value={originalText}
            rows={14}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 outline-none leading-relaxed select-text scrollbar-thin scrollbar-thumb-amber-500/20"
          />

          <div className="flex justify-end">
            <button
              onClick={() => {
                navigator.clipboard.writeText(originalText);
                setCopiedOriginal(true);
                setTimeout(() => setCopiedOriginal(false), 2000);
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-khmer transition-all"
            >
              {copiedOriginal ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedOriginal ? 'បានចម្លងអត្ថបទដើម!' : 'ចម្លងអត្ថបទដើមបរទេស'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
