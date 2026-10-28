import { StoryAnalysis, TranslationStyle } from '../types';
import { PageChunk } from './chunker';
import { SrtCue } from './srtParser';

export interface SavedStoryProject {
  inputText: string;
  sourceLang: 'auto' | 'en' | 'hi';
  translationStyle?: TranslationStyle;
  isSrtMode?: boolean;
  rawSrtContent?: string;
  allSrtCues?: SrtCue[];
  targetCharsPerPage: number;
  currentStep: 'input' | 'entity_review' | 'reader';
  analysis: StoryAnalysis | null;
  pages: PageChunk[];
  activePageIndex: number;
  updatedAt: number;
}

const DB_NAME = 'KhmerStoryTranslatorDB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const PROJECT_KEY = 'active_story_project';
const BACKUP_LS_KEY = 'khmer_story_backup_meta';

// Helper to open IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (e: any) => {
      resolve(e.target.result);
    };

    request.onerror = (e: any) => {
      reject(e.target.error);
    };
  });
}

/**
 * Save project to IndexedDB (supports 100MB+ of long novel text without quota limit)
 */
export async function saveProjectToStorage(project: SavedStoryProject): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(project, PROJECT_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // Also write a lightweight metadata backup in localStorage
    try {
      localStorage.setItem(
        BACKUP_LS_KEY,
        JSON.stringify({
          updatedAt: project.updatedAt,
          pageCount: project.pages.length,
          completedPages: project.pages.filter((p) => p.status === 'completed').length,
          title: project.analysis?.khmerTitle || '',
        })
      );
    } catch (e) {
      // Ignore localStorage quota
    }
  } catch (err) {
    console.warn('Failed to save to IndexedDB, attempting localStorage fallback:', err);
    try {
      localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    } catch (lsErr) {
      console.error('All storage attempts failed:', lsErr);
    }
  }
}

/**
 * Load saved project from IndexedDB or localStorage fallback
 */
export async function loadProjectFromStorage(): Promise<SavedStoryProject | null> {
  try {
    const db = await openDB();
    const data = await new Promise<SavedStoryProject | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(PROJECT_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (data) return data;
  } catch (err) {
    console.warn('Could not read from IndexedDB, trying localStorage:', err);
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

/**
 * Clear all project data from storage (only when user explicitly confirms deletion)
 */
export async function clearProjectFromStorage(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(PROJECT_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    // Ignore
  }

  try {
    localStorage.removeItem(PROJECT_KEY);
    localStorage.removeItem(BACKUP_LS_KEY);
  } catch (e) {
    // Ignore
  }
}
