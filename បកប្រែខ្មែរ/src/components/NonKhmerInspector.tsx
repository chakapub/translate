import React, { useState, useMemo } from 'react';
import {
  AlertCircle,
  Copy,
  Check,
  Search,
  Filter,
  FileText,
  Sparkles,
  ExternalLink,
  Languages,
  CheckCircle2,
} from 'lucide-react';
import { extractNonKhmerWords, NonKhmerItem } from '../utils/nonKhmerDetector';
import { toKhmerNumerals } from '../utils/khmerCleaner';

interface NonKhmerInspectorProps {
  translatedText: string;
  originalText?: string;
  onSelectWord?: (word: string) => void;
}

export const NonKhmerInspector: React.FC<NonKhmerInspectorProps> = ({
  translatedText,
  originalText = '',
  onSelectWord,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [copiedWord, setCopiedWord] = useState<string | null>(null);
  const [copiedAllWords, setCopiedAllWords] = useState<boolean>(false);
  const [viewTab, setViewTab] = useState<'words' | 'original'>('words');

  // Extract all non-Khmer words from the translated text
  const nonKhmerItems: NonKhmerItem[] = useMemo(() => {
    return extractNonKhmerWords(translatedText);
  }, [translatedText]);

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return nonKhmerItems;
    const q = searchQuery.toLowerCase().trim();
    return nonKhmerItems.filter(
      (item) => item.word.toLowerCase().includes(q) || item.contexts.some((c) => c.toLowerCase().includes(q))
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
            <h3 className="text-base font-bold text-amber-300 font-khmer flex items-center gap-2">
              <span>ផ្ទាំងបង្ហាញអក្សរដែលបកប្រែហើយ ដែលមិនមែនជាអក្សរខ្មែរ</span>
              <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                {toKhmerNumerals(totalNonKhmerWordsCount)} ពាក្យ ({toKhmerNumerals(totalOccurrences)} ដង)
              </span>
            </h3>
            <p className="text-xs text-slate-400 font-khmer mt-0.5">
              ស្រង់ពាក្យជាអក្សរបរទេស (អង់គ្លេស / ឡាតាំង / ចិន) ដែលនៅសល់ក្នុងអត្ថបទបកប្រែខ្មែរ
            </p>
          </div>
        </div>

        {/* Tab & Copy Action Buttons */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
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

      {viewTab === 'words' ? (
        <div className="p-4 sm:p-5 pt-0 space-y-4">
          {totalNonKhmerWordsCount === 0 ? (
            <div className="p-10 text-center text-slate-400 font-khmer bg-slate-900/40 rounded-xl border border-slate-800 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <h4 className="text-sm font-bold text-slate-200">
                អបអរសាទរ! មិនមានអក្សរ ឬពាក្យបរទេសនៅសល់ក្នុងអត្ថបទបកប្រែនេះឡើយ
              </h4>
              <p className="text-xs text-slate-500">
                អត្ថបទបកប្រែនេះជាអក្សរខ្មែរសុទ្ធ ១០០% ស្របតាមក្បួនភាសាខ្មែរ។
              </p>
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
                              {/* Highlight the non-khmer word inside context */}
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
                    💡 គន្លឹះ៖ លោកអ្នកអាចចម្លងពាក្យនេះទៅដាក់ក្នុង «តារាងតួអង្គ (Entity Bible)» ឬកែប្រែដោយផ្ទាល់ក្នុងផ្ទាំង Side-by-Side។
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
                alert('បានចម្លងអត្ថបទដើមភាសាបរទេសរួចរាល់!');
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-khmer transition-all"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>ចម្លងអត្ថបទដើមបរទេស</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
