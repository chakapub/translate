import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  Upload,
  Sparkles,
  ArrowRight,
  Layers,
  Clock,
  Sliders,
  Trash2,
  Film,
  CheckCircle,
  PlayCircle,
  FileCode,
  ListFilter,
  Check,
} from 'lucide-react';
import { TranslationStyle } from '../types';
import {
  isSrtContent,
  parseSrt,
  SrtCue,
  parseSrtAndExtractCleanText,
  syncCuesWithTextLines,
  buildSrt,
} from '../utils/srtParser';
import { toKhmerNumerals } from '../utils/khmerCleaner';

interface StoryInputProps {
  inputText: string;
  setInputText: (text: string) => void;
  sourceLang: 'auto' | 'en' | 'hi';
  setSourceLang: (lang: 'auto' | 'en' | 'hi') => void;
  translationStyle: TranslationStyle;
  setTranslationStyle: (style: TranslationStyle) => void;
  targetCharsPerPage: number;
  setTargetCharsPerPage: (size: number) => void;
  onStartAnalysis: () => void;
  onDirectTranslate?: () => void;
  isAnalyzing: boolean;
  isSrtMode?: boolean;
  setIsSrtMode?: (val: boolean) => void;
  allSrtCues?: SrtCue[];
  setAllSrtCues?: React.Dispatch<React.SetStateAction<SrtCue[]>>;
}

const SAMPLE_SRT_TEXT = `1
00:00:01,200 --> 00:00:04,500
Commander Valerius, the frost drakes have breached the northern gate!

2
00:00:04,800 --> 00:00:08,200
Stand your ground! Do not let them reach the Grand Sanctuary!

3
00:00:08,500 --> 00:00:12,100
Lyra, activate the ancient kinetic barrier now! We need five minutes to protect the villagers.

4
00:00:12,400 --> 00:00:15,800
I am channeling the celestial runes, but my spiritual mana is draining rapidly!

5
00:00:16,100 --> 00:00:19,600
Then it falls upon the Radiant Blade! Awaken, primordial flame of the dawn!

6
00:00:20,000 --> 00:00:24,300
Behold! The S-Rank dragon core has shattered into crystal mist!`;

const SAMPLE_NOVEL_TEXT = `The northern winds of Eldoria had always carried the whisper of impending ruin, but this winter, the frost bit with an unusual hunger. High upon the ramparts of Highspire Citadel, Commander Valerius tightened his fur-lined cloak against the driving snow. Below him, the vast expanse of the Silverwood stretched toward the jagged horizon, its ancient pines bowed under the weight of an unseasonable blizzard. Beside him stood Lyra, an archivist of the Grand Sanctuary, her fingers calloused from turning pages of centuries-old grimoires rather than holding steel.

"The omens are no longer veiled in riddles, Valerius," Lyra said softly, her breath forming small clouds in the biting dusk. "The Astral Alignment approaches its zenith. If Malakor breaks the seal upon the Obsidian Abyss before the winter solstice, the light of Eldoria will be extinguished forever."

Valerius turned his gaze to the scabbard at his side. Within rested the Radiant Blade, an ancient sword forged from celestial meteorites during the First Dawning. Its crystalline pommel faintly hummed, responding to the growing dissonance that pulsed through the veins of the earth. For three generations, the Blade had remained dormant, an heirloom of bygone champions. Yet now, the runes etched along its crossguard pulsed with an intermittent amber flame.`;

export const StoryInput: React.FC<StoryInputProps> = ({
  inputText,
  setInputText,
  sourceLang,
  setSourceLang,
  translationStyle,
  setTranslationStyle,
  targetCharsPerPage,
  setTargetCharsPerPage,
  onStartAnalysis,
  onDirectTranslate,
  isAnalyzing,
  isSrtMode = false,
  setIsSrtMode,
  allSrtCues = [],
  setAllSrtCues,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [srtViewMode, setSrtViewMode] = useState<'pure_text' | 'cues' | 'raw'>('pure_text');
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  const charCount = inputText.length;
  const wordCount = inputText.trim() ? inputText.trim().split(/\s+/).length : 0;
  const estimatedPages = Math.max(1, Math.ceil(charCount / targetCharsPerPage));
  const estimatedReadMins = Math.ceil(wordCount / 200);

  // Effective cues: prioritize allSrtCues prop, fallback to parsing if inputText contains raw SRT
  const activeCues: SrtCue[] =
    allSrtCues.length > 0
      ? allSrtCues
      : isSrtContent(inputText)
      ? parseSrt(inputText)
      : [];

  const showNotification = (msg: string) => {
    setNotificationMsg(msg);
    setTimeout(() => setNotificationMsg(null), 3500);
  };

  // Handle file uploads: for SRT files, extract ONLY pure text into input box & store cues!
  const handleFileUpload = (file: File, forceSrt: boolean = false) => {
    if (!file) return;
    const isSrtFile = forceSrt || file.name.toLowerCase().endsWith('.srt');

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      if (isSrtFile || isSrtContent(content)) {
        const { cues, cleanText } = parseSrtAndExtractCleanText(content);
        if (cues.length > 0) {
          setInputText(cleanText);
          if (setAllSrtCues) setAllSrtCues(cues);
          if (setIsSrtMode) setIsSrtMode(true);
          setSrtViewMode('pure_text');
          showNotification(
            `✓ បានស្រង់អត្ថបទសុទ្ធ ${toKhmerNumerals(cues.length)} ជួរពីឯកសារ SRT ចូលក្នុងប្រអប់រួចរាល់!`
          );
          return;
        }
      }

      setInputText(content);
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const isSrt = file.name.toLowerCase().endsWith('.srt');
      handleFileUpload(file, isSrt);
    }
  };

  const handleClearText = () => {
    if (!inputText) return;
    setInputText('');
    if (setAllSrtCues) setAllSrtCues([]);
  };

  // Load sample SRT: Extract clean text into input box & set cues!
  const handleLoadSampleSrt = () => {
    const { cues, cleanText } = parseSrtAndExtractCleanText(SAMPLE_SRT_TEXT);
    setInputText(cleanText);
    if (setAllSrtCues) setAllSrtCues(cues);
    if (setIsSrtMode) setIsSrtMode(true);
    setSrtViewMode('pure_text');
    showNotification(`⚡ បានស្រង់អត្ថបទសុទ្ធ ${toKhmerNumerals(cues.length)} ជួរពីគំរូ SRT ចូលក្នុងប្រអប់!`);
  };

  const handleLoadSampleNovel = () => {
    setInputText(SAMPLE_NOVEL_TEXT);
    if (setIsSrtMode) setIsSrtMode(false);
    if (setAllSrtCues) setAllSrtCues([]);
  };

  // Textarea change handler: auto-detects pasted raw SRT and extracts pure text
  const handleTextareaChange = (newVal: string) => {
    if (isSrtContent(newVal)) {
      const { cues, cleanText } = parseSrtAndExtractCleanText(newVal);
      if (cues.length > 0) {
        setInputText(cleanText);
        if (setAllSrtCues) setAllSrtCues(cues);
        if (setIsSrtMode) setIsSrtMode(true);
        setSrtViewMode('pure_text');
        showNotification(
          `✓ បានស្រង់អត្ថបទសុទ្ធ ${toKhmerNumerals(cues.length)} ជួរពីកូដ SRT ដែលបានបិទភ្ជាប់!`
        );
        return;
      }
    }

    setInputText(newVal);
    // If in SRT mode and cues exist, keep cue text synchronized
    if (isSrtMode && allSrtCues && allSrtCues.length > 0 && setAllSrtCues) {
      const synced = syncCuesWithTextLines(allSrtCues, newVal);
      setAllSrtCues(synced);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl space-y-6">
      {/* Step 1 Title & Language Picker */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 rounded-full bg-amber-400 animate-pulse"></span>
            <h2 className="text-lg font-bold text-slate-100 font-khmer">
              ជំហានទី ១៖ ជ្រើសរើសទម្រង់បញ្ចូល (អត្ថបទ ឬ SRT) និងលក្ខណៈបកប្រែ
            </h2>
          </div>
          <p className="text-xs text-slate-400 font-khmer mt-0.5">
            ជ្រើសរើសរបៀបបកប្រែអត្ថបទប្រលោមលោក ឬផ្ទុកឯកសារចំណងជើងរឿង SRT ដើម្បីបកប្រែដោយរក្សាពេលវេលា (Timecode) ដូចដើម ១០០%។
          </p>
        </div>

        {/* Source Language Picker */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 font-khmer font-semibold">ភាសាដើម៖</span>
          <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
            <button
              onClick={() => setSourceLang('auto')}
              className={`px-3 py-1.5 text-xs rounded-lg font-khmer transition-all ${
                sourceLang === 'auto'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ស្វ័យប្រវត្ត (Auto)
            </button>
            <button
              onClick={() => setSourceLang('en')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                sourceLang === 'en'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              English (អង់គ្លេស)
            </button>
            <button
              onClick={() => setSourceLang('hi')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                sourceLang === 'hi'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              हिन्दी (ហិនឌី)
            </button>
          </div>
        </div>
      </div>

      {/* Prominent High-Visibility Mode Tabs: Novel Text vs SRT Subtitles */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-slate-300 font-khmer flex items-center gap-1.5">
          <span>ជ្រើសរើសទម្រង់ឯកសារដែលត្រូវបកប្រែ៖</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Tab 1: Novel / Story Text Mode */}
          <button
            type="button"
            onClick={() => {
              if (setIsSrtMode) setIsSrtMode(false);
            }}
            className={`p-4 rounded-xl border text-left transition-all relative flex items-start gap-3.5 ${
              !isSrtMode
                ? 'bg-gradient-to-br from-amber-950/60 via-slate-900 to-amber-900/30 border-amber-500/80 ring-2 ring-amber-500/30 shadow-lg shadow-amber-950/40'
                : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60 opacity-80'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                !isSrtMode ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
              }`}
            >
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-100 font-khmer">
                  ១. បកប្រែអត្ថបទប្រលោមលោក (Story / Novel)
                </span>
                {!isSrtMode && (
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                )}
              </div>
              <p className="text-xs text-slate-400 font-khmer mt-1 leading-relaxed">
                បិទភ្ជាប់អត្ថបទវែងរហូតដល់ ៣៥០,០០០+ តួអក្សរ។ ប្រព័ន្ធបែងចែកទំព័រស្វ័យប្រវត្ត (&lt;= ៥០,០០០ តួ/ទំព័រ) និងចងចាំឈ្មោះតួអង្គ។
              </p>
            </div>
          </button>

          {/* Tab 2: SRT Subtitle Mode (Highlighted!) */}
          <button
            type="button"
            onClick={() => {
              if (setIsSrtMode) setIsSrtMode(true);
            }}
            className={`p-4 rounded-xl border text-left transition-all relative flex items-start gap-3.5 ${
              isSrtMode
                ? 'bg-gradient-to-br from-sky-950/80 via-slate-900 to-indigo-950/60 border-sky-400 ring-2 ring-sky-400/40 shadow-xl shadow-sky-950/50'
                : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isSrtMode
                  ? 'bg-sky-400 text-slate-950 shadow-md shadow-sky-400/30'
                  : 'bg-sky-950/60 text-sky-400 border border-sky-800'
              }`}
            >
              <Film className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-sky-300 font-khmer">
                    ២. បកប្រែឯកសារចំណងជើងរឿង SRT (Subtitle .SRT)
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40 animate-pulse">
                    ថ្មី NEW
                  </span>
                </div>
                {isSrtMode && (
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
                )}
              </div>
              <p className="text-xs text-slate-300 font-khmer mt-1 leading-relaxed">
                ផ្ទុកឯកសារ <strong className="text-sky-300">.srt</strong>។ ប្រព័ន្ធនឹងបកប្រែ និងតម្រៀបពេលវេលា <strong className="text-sky-300">Timecodes</strong> ដូច SRT ដើម ១០០% និងទាញយកជា .srt វិញបាន!
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* 3 Translation Styles Selector */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200 font-khmer flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>ជ្រើសរើសលក្ខណៈបកប្រែ (Translation Style - ៣ ជម្រើស)៖</span>
          </span>
          <span className="text-[11px] text-amber-400 font-khmer">បកប្រែចំជំនាញ ពិរោះ និងត្រឹមត្រូវ</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Style 1: Anime Rank */}
          <button
            type="button"
            onClick={() => setTranslationStyle('anime_rank')}
            className={`p-4 rounded-xl border text-left transition-all relative overflow-hidden flex flex-col justify-between ${
              translationStyle === 'anime_rank'
                ? 'bg-gradient-to-br from-indigo-950/90 via-slate-900 to-indigo-900/60 border-indigo-500 ring-2 ring-indigo-500/40 shadow-lg shadow-indigo-950/50'
                : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900/50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🗡️</span>
                  <span className="font-bold text-sm text-indigo-300 font-khmer">
                    ១. បែប Anime / កម្រិត Rank
                  </span>
                </div>
                {translationStyle === 'anime_rank' && (
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse"></span>
                )}
              </div>
              <p className="text-[11.5px] text-slate-300 font-khmer leading-relaxed">
                កម្រិត Rank ច្បាស់លាស់បែប <strong className="text-amber-300 font-mono">Rank F, E, D, C, B, A, S, SS, SSS</strong>, ជំនាញ Skill, វេទមន្ត Magic, Hunter, Dungeon, Boss, Status window, Guild, Level-up.
              </p>
            </div>
            <div className="mt-3">
              <span className="text-[10.5px] text-indigo-300 font-mono bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-500/30 inline-block">
                ⚡ Rank S / Skills / Magic Spells
              </span>
            </div>
          </button>

          {/* Style 2: Donghua Cultivation */}
          <button
            type="button"
            onClick={() => setTranslationStyle('donghua_cultivation')}
            className={`p-4 rounded-xl border text-left transition-all relative overflow-hidden flex flex-col justify-between ${
              translationStyle === 'donghua_cultivation'
                ? 'bg-gradient-to-br from-amber-950/90 via-slate-900 to-amber-900/60 border-amber-500 ring-2 ring-amber-500/40 shadow-lg shadow-amber-950/50'
                : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900/50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl">☯️</span>
                  <span className="font-bold text-sm text-amber-300 font-khmer">
                    ២. បែប ដុងហោ / Anime ចិន
                  </span>
                </div>
                {translationStyle === 'donghua_cultivation' && (
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                )}
              </div>
              <p className="text-[11.5px] text-slate-300 font-khmer leading-relaxed">
                ការដាំដុះទៅតាមប្រភេទរឿង <strong className="text-amber-300">Qi / Cultivation</strong>, ឋានៈដាំដុះ (ចម្រាញ់ធាតុ, កសាងគ្រឹះ, ស្នូលមាស, ព្រលឹងទិព្វ), និកាយ/បក្ស, ព្រឹទ្ធាចារ្យ, សិស្សច្បង, ដាវទិព្វ, ថ្នាំទិព្វ.
              </p>
            </div>
            <div className="mt-3">
              <span className="text-[10.5px] text-amber-300 font-mono bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/30 inline-block">
                📜 Cultivation / Qi / Sect / Realms
              </span>
            </div>
          </button>

          {/* Style 3: Movie Cinema */}
          <button
            type="button"
            onClick={() => setTranslationStyle('movie_cinema')}
            className={`p-4 rounded-xl border text-left transition-all relative overflow-hidden flex flex-col justify-between ${
              translationStyle === 'movie_cinema'
                ? 'bg-gradient-to-br from-rose-950/90 via-slate-900 to-rose-900/60 border-rose-500 ring-2 ring-rose-500/40 shadow-lg shadow-rose-950/50'
                : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900/50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎬</span>
                  <span className="font-bold text-sm text-rose-300 font-khmer">
                    ៣. បែប ភាពយន្ត (Cinema)
                  </span>
                </div>
                {translationStyle === 'movie_cinema' && (
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse"></span>
                )}
              </div>
              <p className="text-[11.5px] text-slate-300 font-khmer leading-relaxed">
                សន្ទនាបែបភាពយន្តរស់រវើក ធម្មជាតិ ជក់ចិត្ត ល្អឥតខ្ចោះសម្រាប់ការ <strong className="text-rose-300">បញ្ចេញសំឡេង / បញ្ចូលសំឡេង (Dubbing / Voiceover)</strong> មិនរឹងដូចសៀវភៅ.
              </p>
            </div>
            <div className="mt-3">
              <span className="text-[10.5px] text-rose-300 font-mono bg-rose-950/80 px-2 py-0.5 rounded border border-rose-500/30 inline-block">
                🎙️ Dubbing / Cinematic Dialogue
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Notification Toast Banner */}
      {notificationMsg && (
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-950 via-slate-900 to-sky-950 border border-emerald-500/50 shadow-lg flex items-center justify-between gap-3 animate-fade-in text-xs font-khmer">
          <div className="flex items-center gap-2.5 text-emerald-300 font-semibold">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{notificationMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotificationMsg(null)}
            className="text-slate-400 hover:text-slate-200 text-xs px-1.5 py-0.5 rounded hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
      )}

      {/* ======================= SRT WORKSTATION AREA ======================= */}
      {isSrtMode && (
        <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-b from-sky-950/60 via-slate-950 to-slate-950 border-2 border-sky-500/50 shadow-2xl space-y-4">
          {/* SRT Section Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-sky-500/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/40 flex items-center justify-center shrink-0">
                <Film className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-sky-200 font-khmer flex items-center gap-2">
                  <span>ប្រអប់ផ្ទុក និងបកប្រែឯកសារ SRT (SRT Subtitle Station)</span>
                  {activeCues.length > 0 && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-400 text-slate-950 font-bold font-mono">
                      {toKhmerNumerals(activeCues.length)} ជួរ
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400 font-khmer mt-0.5">
                  ស្រង់យកតែអត្ថបទសុទ្ធមកតម្រៀបក្នុងប្រអប់ដើម្បីបកប្រែ និងតម្រៀបជា SRT តាមពេលវេលាដើមវិញ ១០០%
                </p>
              </div>
            </div>

            {/* Quick Actions for SRT */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLoadSampleSrt}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-khmer text-xs font-semibold transition-all active:scale-95 shadow"
                title="សាកល្បងមើលគំរូ SRT ភ្លាមៗដោយមិនចាំបាច់មានឯកសារ"
              >
                <PlayCircle className="w-3.5 h-3.5 text-sky-400" />
                <span>⚡ ដាក់គំរូ SRT សាកល្បង</span>
              </button>

              <input
                type="file"
                ref={srtInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, true);
                  e.target.value = '';
                }}
                accept=".srt"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => srtInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-khmer text-xs transition-all"
              >
                <Upload className="w-3.5 h-3.5 text-sky-400" />
                <span>ផ្ទុកឯកសារ .srt ថ្មី</span>
              </button>

              {inputText && (
                <button
                  type="button"
                  onClick={handleClearText}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-950/60 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-800 text-xs font-khmer transition-all"
                  title="លុបទិន្នន័យ SRT"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>លុបទាំងអស់</span>
                </button>
              )}
            </div>
          </div>

          {/* If NO cues loaded yet, show the drag & drop zone */}
          {activeCues.length === 0 && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => srtInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-sky-400 bg-sky-500/20 scale-[1.01]'
                  : 'border-sky-500/60 bg-sky-950/20 hover:border-sky-400 hover:bg-sky-950/40'
              }`}
            >
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-sky-500/20 border border-sky-400/50 text-sky-400 flex items-center justify-center shadow-lg shadow-sky-500/20">
                  <Upload className="w-7 h-7" />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-sky-200 font-khmer">
                    ចុចទីនេះដើម្បីជ្រើសរើសឯកសារ SRT (.srt) ឬអូសទម្លាក់ឯកសារមកទីនេះ
                  </h4>
                  <p className="text-xs text-slate-400 font-khmer mt-1">
                    ប្រព័ន្ធនឹងស្រង់យកតែអត្ថបទសុទ្ធមកតម្រៀបក្នុងប្រអប់ដើម្បីត្រៀមបកប្រែ និងរក្សាពេលវេលាដើម ១០០%
                  </p>
                </div>
                <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
                  <span className="px-3.5 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-bold font-khmer text-xs shadow-md shadow-sky-500/30 flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5" />
                    <span>ជ្រើសរើសឯកសារ .srt ពីឧបករណ៍</span>
                  </span>
                  <span className="text-xs text-slate-400 font-khmer">
                    ឬចុច «⚡ ដាក់គំរូ SRT សាកល្បង» ខាងលើ
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* When Cues are loaded: Tab selector & Workstation views */}
          {activeCues.length > 0 && (
            <div className="space-y-3">
              {/* Cue Stats Bar & View Mode Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-950/80 p-3 rounded-xl border border-sky-500/30">
                <div className="flex items-center gap-3">
                  <span className="text-sky-300 font-khmer font-bold flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span>
                      បានស្រង់អត្ថបទសុទ្ធ៖ <strong>{toKhmerNumerals(activeCues.length)} ជួរ</strong>
                    </span>
                  </span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-400 font-mono text-[11px]">
                    ⏱️ {activeCues[0].startTime} ➜ {activeCues[activeCues.length - 1].endTime}
                  </span>
                </div>

                {/* 3 View Mode Tabs */}
                <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-[11.5px]">
                  <button
                    type="button"
                    onClick={() => setSrtViewMode('pure_text')}
                    className={`px-3 py-1.5 rounded-md font-khmer transition-all flex items-center gap-1.5 ${
                      srtViewMode === 'pure_text'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>📝 អត្ថបទសុទ្ធក្នុងប្រអប់ (Pure Text)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSrtViewMode('cues')}
                    className={`px-3 py-1.5 rounded-md font-khmer transition-all flex items-center gap-1.5 ${
                      srtViewMode === 'cues'
                        ? 'bg-sky-500 text-slate-950 font-bold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ListFilter className="w-3.5 h-3.5" />
                    <span>⏱️ តារាងកូដម៉ោង SRT ({toKhmerNumerals(activeCues.length)})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSrtViewMode('raw')}
                    className={`px-3 py-1.5 rounded-md font-khmer transition-all flex items-center gap-1.5 ${
                      srtViewMode === 'raw'
                        ? 'bg-sky-500 text-slate-950 font-bold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>📄 កូដ SRT ដើម</span>
                  </button>
                </div>
              </div>

              {/* View 1: PURE TEXT IN INPUT BOX (User's primary request) */}
              {srtViewMode === 'pure_text' && (
                <div className="space-y-2">
                  <div className="p-2.5 rounded-xl bg-sky-950/40 border border-sky-500/30 text-xs text-sky-200 font-khmer flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      <strong>អត្ថបទសុទ្ធត្រូវបានស្រង់ចូលប្រអប់រួចរាល់៖</strong> អត្ថបទនេះត្រូវបានតម្រៀបតាមជួរ字幕។ ពេលបកប្រែ ប្រព័ន្ធនឹងបញ្ជូនអត្ថបទសុទ្ធនេះទៅបកប្រែ ហើយតម្រៀបចូលក្នុង SRT វិញដោយស្វ័យប្រវត្ត ១០០% តាមពេលវេលាដើម!
                    </span>
                  </div>

                  <div className="relative">
                    <textarea
                      value={inputText}
                      onChange={(e) => handleTextareaChange(e.target.value)}
                      placeholder="អត្ថបទសុទ្ធដែលស្រង់ចេញពី SRT នឹងបង្ហាញនៅទីនេះ..."
                      className="w-full h-80 bg-slate-950 border border-sky-500/50 rounded-xl p-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400/50 font-sans leading-relaxed resize-y scrollbar-thin scrollbar-thumb-sky-500/30"
                    />
                    <div className="absolute bottom-3 right-3 text-[11px] font-mono text-sky-400 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-sky-500/30 pointer-events-none">
                      {inputText.split('\n').filter(Boolean).length} ជួរអត្ថបទ
                    </div>
                  </div>
                </div>
              )}

              {/* View 2: Cues Table List */}
              {srtViewMode === 'cues' && (
                <div className="max-h-80 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-sky-500/30 scrollbar-track-slate-900 bg-slate-950/90 p-3 rounded-xl border border-sky-500/30">
                  {activeCues.map((cue) => (
                    <div
                      key={cue.id}
                      className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:border-sky-500/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-bold text-sky-400 bg-sky-950 px-2 py-0.5 rounded text-[11px] border border-sky-800/60">
                          #{cue.id}
                        </span>
                        <span className="font-mono text-slate-400 text-[11px]">
                          {cue.timecode}
                        </span>
                      </div>
                      <div className="text-slate-200 font-sans text-xs flex-1 sm:text-right">
                        {cue.originalText}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* View 3: Raw SRT Textarea */}
              {srtViewMode === 'raw' && (
                <textarea
                  readOnly
                  value={buildSrt(activeCues, false)}
                  className="w-full h-80 bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-500 scrollbar-thin scrollbar-thumb-sky-500/30 leading-relaxed"
                />
              )}
            </div>
          )}

          {/* Quick Translate Buttons for SRT Mode */}
          {activeCues.length > 0 && onDirectTranslate && (
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={onDirectTranslate}
                className="w-full sm:flex-1 py-3.5 px-6 rounded-xl font-khmer font-bold text-sm bg-gradient-to-r from-sky-400 to-indigo-500 hover:from-sky-300 hover:to-indigo-400 text-slate-950 shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
              >
                <Sparkles className="w-4 h-4 text-slate-950" />
                <span>🚀 ចាប់ផ្តើមបកប្រែ SRT នេះភ្លាមៗ (Start SRT Translation)</span>
                <ArrowRight className="w-4 h-4 text-slate-950" />
              </button>

              <button
                type="button"
                onClick={onStartAnalysis}
                disabled={isAnalyzing}
                className="w-full sm:w-auto py-3.5 px-5 rounded-xl font-khmer text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center justify-center gap-1.5"
              >
                <span>🔍 វិភាគសាច់រឿង & ស្រង់តួអង្គជាមុន</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ======================= NOVEL / STORY TEXT AREA ======================= */}
      {!isSrtMode && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs text-slate-300 font-khmer font-semibold flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>ប្រអប់បញ្ចូលអត្ថបទប្រលោមលោក (Input Story / Novel Text):</span>
            </label>

            {/* Quick Demo & Clear Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleLoadSampleNovel}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all font-khmer text-xs"
                title="សាកល្បងដាក់អត្ថបទគំរូ"
              >
                <PlayCircle className="w-3.5 h-3.5 text-amber-400" />
                <span>⚡ ដាក់គំរូសាកល្បង</span>
              </button>

              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, false);
                  e.target.value = '';
                }}
                accept=".txt,.md,.text,.srt"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all font-khmer text-xs"
              >
                <Upload className="w-3.5 h-3.5 text-amber-400" />
                <span>ផ្ទុកឯកសារ (.txt / .srt)</span>
              </button>

              {inputText && (
                <button
                  type="button"
                  onClick={handleClearText}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-800 transition-all font-khmer text-xs"
                  title="លុបអត្ថបទទាំងអស់ក្នុងប្រអប់"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>លុបទាំងអស់</span>
                </button>
              )}
            </div>
          </div>

          <div className="relative">
            <textarea
              value={inputText}
              onChange={(e) => handleTextareaChange(e.target.value)}
              placeholder="ចម្លង ឬបិទភ្ជាប់សាច់រឿងនៅទីនេះ... ឬចុច «⚡ ដាក់គំរូសាកល្បង» ឬចុច «ផ្ទុកឯកសារ»..."
              className="w-full h-80 bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/60 font-sans leading-relaxed resize-y scrollbar-thin scrollbar-thumb-amber-500/30"
            />
          </div>

          {/* Action buttons for Novel Mode */}
          {inputText.trim().length > 0 && (
            <div className="pt-1 flex flex-col sm:flex-row items-center gap-3">
              {onDirectTranslate && (
                <button
                  type="button"
                  onClick={onDirectTranslate}
                  className="w-full sm:flex-1 py-3.5 px-6 rounded-xl font-khmer font-bold text-sm bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
                >
                  <Sparkles className="w-4 h-4 text-slate-950" />
                  <span>🚀 ចាប់ផ្តើមបកប្រែភ្លាមៗ (Start Direct Translation)</span>
                  <ArrowRight className="w-4 h-4 text-slate-950" />
                </button>
              )}

              <button
                type="button"
                onClick={onStartAnalysis}
                disabled={isAnalyzing}
                className="w-full sm:w-auto py-3.5 px-5 rounded-xl font-khmer text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center justify-center gap-1.5"
              >
                <span>🔍 វិភាគសាច់រឿង & ស្រង់តួអង្គជាមុន</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Live Text Statistics & Chunking Indicator */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold text-xs">
            字
          </div>
          <div>
            <div className="text-[11px] text-slate-400 font-khmer">ចំនួនតួអក្សរសរុប</div>
            <div className="text-base font-bold font-mono text-slate-100">
              {charCount.toLocaleString()}{' '}
              <span className="text-[10px] text-slate-500 font-normal">/ ៣៥០,០០០+</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-slate-400 font-khmer">បែងចែកជាទំព័រ</div>
            <div className="text-base font-bold font-mono text-slate-100">
              {charCount > 0 ? estimatedPages : 0}{' '}
              <span className="text-[10px] text-slate-500 font-khmer font-normal">ទំព័រ (&lt;= 50k/ទំព័រ)</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-slate-400 font-khmer">ចំនួនពាក្យ (Words)</div>
            <div className="text-base font-bold font-mono text-slate-100">
              {wordCount.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] text-slate-400 font-khmer">រយៈពេលអានប៉ាន់ស្មាន</div>
            <div className="text-base font-bold font-mono text-slate-100">
              ~{estimatedReadMins}{' '}
              <span className="text-[10px] text-slate-500 font-khmer font-normal">នាទី</span>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Settings Toggle */}
      <div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 font-khmer transition-colors"
        >
          <Sliders className="w-3.5 h-3.5 text-amber-400" />
          <span>ការកំណត់ទំហំទំព័រ (បច្ចុប្បន្ន៖ {targetCharsPerPage.toLocaleString()} តួអក្សរក្នុង ១ ទំព័រ • អតិបរមាមិនលើសពី ៥០,០០០ តួ)</span>
        </button>

        {showSettings && (
          <div className="mt-3 p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between text-xs text-slate-300 font-khmer gap-2">
              <span className="font-semibold text-amber-300">ទំហំទំព័រគោលដៅ (Target Page Size):</span>
              <span className="font-mono text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {targetCharsPerPage.toLocaleString()} តួអក្សរ / ១ ទំព័រ
              </span>
            </div>

            {/* Quick preset buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { label: '១២,៥០០ តួ (១២,០០០ - ១៣,០០០ តួ • ស្តង់ដារ)', val: 12500 },
                { label: '៨,៥០០ តួ (លឿន)', val: 8500 },
                { label: '១៨,០០០ តួ (មធ្យម)', val: 18000 },
                { label: '២៥,០០០ តួ (វែង)', val: 25000 },
                { label: '៤៥,០០០ តួ (អតិបរមា)', val: 45000 },
              ].map((preset) => (
                <button
                  key={preset.val}
                  type="button"
                  onClick={() => setTargetCharsPerPage(preset.val)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-khmer transition-all border ${
                    targetCharsPerPage === preset.val
                      ? 'bg-amber-500 text-slate-950 font-bold border-amber-400 shadow'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <input
              type="range"
              min="5000"
              max="45000"
              step="1000"
              value={targetCharsPerPage}
              onChange={(e) => setTargetCharsPerPage(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>5,000 តួ</span>
              <span>15,000 តួ</span>
              <span>25,000 តួ</span>
              <span>35,000 តួ</span>
              <span>45,000 តួ (ពិដាន 50,000)</span>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 font-khmer space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <span>✓ ក្បួនបែងចែកទំព័រត្រឹមត្រូវតាមលក្ខខណ្ឌ៖</span>
              </p>
              <ul className="list-disc list-inside text-slate-300 space-y-0.5 text-[10.5px]">
                <li>១ ទំព័រត្រូវបានកំណត់ដាច់ខាត <strong>មិនឱ្យលើសពី ៥០,០០០ តួអក្សរឡើយ</strong> (Hard Limit &lt;= 50,000)។</li>
                <li>ប្រព័ន្ធកាត់ទំព័រត្រឹមសញ្ញាបញ្ចប់ប្រយោគ (. / ? / ! / ។) ឬកថាខណ្ឌ (\n\n) យ៉ាងត្រឹមត្រូវ គ្មានការដាច់ពាក្យឡើយ។</li>
                <li>អត្ថបទវែង <strong>៣៤៨,៧៣៧ តួអក្សរ</strong> នឹងត្រូវបែងចែកជាទំព័រតូចៗស្អាតសមរម្យ មិនឱ្យគរចូលតែ ១ ទំព័រឡើយ។</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Primary Action Button: Pre-Analyze Whole Story or Direct Translate */}
      {!isSrtMode && (
        <div className="pt-2 space-y-3">
          <button
            onClick={onStartAnalysis}
            disabled={charCount < 10 || isAnalyzing}
            className={`w-full py-4 px-6 rounded-xl font-khmer font-bold text-base flex items-center justify-center gap-3 transition-all shadow-xl ${
              charCount < 10 || isAnalyzing
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-gradient-to-r from-amber-500 via-amber-600 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 shadow-amber-500/25 active:scale-[0.99]'
            }`}
          >
            {isAnalyzing ? (
              <>
                <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                <span>កំពុងពិនិត្យ និងស្រង់ឈ្មោះតួអង្គ... (Examining whole story & building Entity Bible)</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 text-slate-950" />
                <span>ពិនិត្យមើលអត្ថបទទាំងមូលជាមុន & ចងចាំឈ្មោះតួអង្គ (Pre-Analyze Story)</span>
                <ArrowRight className="w-5 h-5 text-slate-950" />
              </>
            )}
          </button>

          {onDirectTranslate && (
            <div className="flex items-center justify-center pt-1">
              <button
                onClick={onDirectTranslate}
                disabled={charCount < 10 || isAnalyzing}
                className="text-xs text-slate-400 hover:text-amber-300 font-khmer underline underline-offset-4 decoration-slate-700 hover:decoration-amber-400 transition-colors"
              >
                ឬបន្តទៅបកប្រែផ្ទាល់ភ្លាមៗ ដោយមិនបាច់វិភាគ (Skip Analysis & Start Translating Directly) →
              </button>
            </div>
          )}

          <p className="text-center text-xs text-slate-400 font-khmer mt-2.5">
            * តាមការណែនាំ៖ ប្រព័ន្ធត្រូវពិនិត្យមើលអត្ថបទទាំងមូលជាមុន ដើម្បីស្រង់ឈ្មោះតួអង្គ ទីតាំង និងវត្ថុ រៀបចំជាបញ្ជីចងចាំ ធានាឱ្យសាច់រឿងរលូន មិនសង្ខេបន័យពីដើមដល់ចប់។
          </p>
        </div>
      )}
    </div>
  );
};
