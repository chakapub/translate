import { PageChunk } from './utils/chunker';

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

export type NarrativeStyle = TranslationStyle | 'storytelling_vivid' | 'classical_novel' | 'modern_smooth' | 'formal_epic';

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
