import { PageChunk } from './utils/chunker';

export type SourceLanguage = 'auto' | 'en' | 'hi';

export interface CharacterEntity {
  id?: string;
  originalName: string;
  khmerName: string;
  role: string;
  description?: string;
}

export interface LocationEntity {
  id?: string;
  originalName: string;
  khmerName: string;
  description?: string;
}

export interface TermEntity {
  id?: string;
  originalName: string;
  khmerName: string;
  category?: string;
  description?: string;
}

export interface StoryAnalysis {
  originalTitle?: string;
  khmerTitle: string;
  storyOverview: string;
  genre?: string;
  translationGenre?: string;
  narrativeTone?: string;
  pronounGuidelines?: string;
  characters: CharacterEntity[];
  locations: LocationEntity[];
  terms: TermEntity[];
}

export type TranslationStyle = 'anime_rank' | 'donghua_cultivation' | 'movie_cinema';

export type AiModelCategory = 'gemini_8_flash_high';

export type AiModelId = 'gemini-8-flash';

export interface AiModelOption {
  id: AiModelId;
  name: string;
  provider: string;
  modelCode: string;
  badge: string;
  category: AiModelCategory;
  zeroApiQuota: boolean;
  description: string;
}

export interface AiConnectionStatus {
  requestedId: AiModelId;
  requestedName: string;
  requestedProvider: string;
  requestedModelCode: string;
  connected: boolean;
  connectedAiSystem: string;
  connectedModelId: string;
  activeSdkModel?: string;
  thinkingLevel?: string;
  zeroApiQuota?: boolean;
  primaryWasBusy?: boolean;
  latencyMs: number;
  statusMessage: string;
  sampleTestKhmer?: string;
  checkedAt: number;
}

export const AI_MODEL_OPTIONS: AiModelOption[] = [
  {
    id: 'gemini-8-flash',
    name: '⚡ Google Gemini 8 Flash • កម្រិតគិតខ្ពស់ • គ្មានប្រព័ន្ធបម្រុង • ប្ដូរ Chat ថ្មីរាល់ទំព័រ',
    provider: 'Google Gemini 8 Flash • High Thinking Level • គ្មានប្រព័ន្ធបម្រុង',
    modelCode: 'gemini-8-flash',
    badge: '⚡ Gemini 8 Flash • កម្រិតគិតខ្ពស់',
    category: 'gemini_8_flash_high',
    zeroApiQuota: false,
    description:
      'ប្រើប្រាស់ផ្តាច់មុខម៉ូដែល Google Gemini 8 Flash កម្រិតគិតខ្ពស់ High Thinking Level តែមួយគត់ ដោយលុបប្រព័ន្ធបម្រុងចេញទាំងអស់ និងប្ដូរ Chat ថ្មីទាំងស្រុងរាល់ទំព័រនីមួយៗ។',
  },
];

export type NarrativeStyle =
  | TranslationStyle
  | 'storytelling_vivid'
  | 'classical_novel'
  | 'modern_smooth'
  | 'formal_epic';

export type ReaderTheme = 'dark' | 'sepia' | 'light';

export type ReaderFont = 'kantumruy' | 'hanuman' | 'battambang';

export type ViewMode = 'split' | 'khmer_only' | 'original_only' | 'srt_rows' | 'srt_code' | 'non_khmer';

export interface TranslationState {
  isAnalyzing: boolean;
  isTranslating: boolean;
  activeChunkIndex: number;
  autoTranslateAll: boolean;
  liveCharsReceived: number;
  liveKhmerChars: number;
  startTime?: number;
  error?: string | null;
}

