import React from 'react';
import { BookOpen, Sparkles, Cpu, ShieldCheck, HelpCircle, RotateCcw } from 'lucide-react';

interface HeaderProps {
  onReset: () => void;
  onOpenHelp: () => void;
  hasSavedData?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onReset, onOpenHelp, hasSavedData }) => {
  return (
    <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Logo and App Title */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 via-rose-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/30">
            <BookOpen className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-amber-200 via-amber-400 to-rose-300 bg-clip-text text-transparent font-khmer">
                KhmerStory Translator
              </h1>
              <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                ខ្មែរសុទ្ធ ១០០%
              </span>
            </div>
            <p className="text-xs text-slate-400 font-khmer">
              កម្មវិធីបកប្រែរឿងប្រលោមលោកអង់គ្លេស-ហិនឌី គាំទ្ររហូតដល់ ៣៥០,០០០+ តួអក្សរ ដោយបែងចែកទំព័រត្រឹមត្រូវ មិនឱ្យលើស ៥០,០០០ តួ
            </p>
          </div>
        </div>

        {/* Feature Badges & Quick Actions */}
        <div className="flex flex-wrap items-center gap-2 justify-end w-full md:w-auto text-xs">
          {hasSavedData && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 font-khmer animate-pulse">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>រក្សាទុកស្វ័យប្រវត្តិ (Auto-Saved)</span>
            </div>
          )}

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-950/60 border border-sky-500/40 text-sky-300 font-khmer">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span>គាំទ្រ SRT Subtitles Sync</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/50 border border-amber-500/30 text-amber-300">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-khmer">១ ទំព័រ &lt;= ៥០,០០០ តួ</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/50 border border-rose-500/30 text-rose-300">
            <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
            <span className="font-khmer">មិនបាត់ទិន្នន័យ</span>
          </div>

          <button
            onClick={onOpenHelp}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="របៀបប្រើប្រាស់"
          >
            <HelpCircle className="w-4 h-4 text-slate-400" />
            <span className="font-khmer">ជំនួយ</span>
          </button>

          <button
            onClick={onReset}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 border border-slate-700/60 hover:border-rose-500/40 transition-colors"
            title="ចាប់ផ្ដើមរឿងថ្មី ឬលុបទិន្នន័យ"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="font-khmer">រឿងថ្មី</span>
          </button>
        </div>
      </div>
    </header>
  );
};
