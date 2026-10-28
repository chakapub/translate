import React, { useState } from 'react';
import {
  Users,
  MapPin,
  Shield,
  Plus,
  Trash2,
  Edit2,
  Check,
  Sparkles,
  ArrowRight,
  BookOpen,
  HelpCircle,
  FileText,
} from 'lucide-react';
import { StoryAnalysis, CharacterEntity, LocationEntity, TermEntity } from '../types';

interface EntityBibleViewProps {
  analysis: StoryAnalysis;
  setAnalysis: React.Dispatch<React.SetStateAction<StoryAnalysis | null>>;
  onProceedToTranslate: () => void;
  onBackToInput: () => void;
  totalPages: number;
  totalChars: number;
}

export const EntityBibleView: React.FC<EntityBibleViewProps> = ({
  analysis,
  setAnalysis,
  onProceedToTranslate,
  onBackToInput,
  totalPages,
  totalChars,
}) => {
  const [activeTab, setActiveTab] = useState<'characters' | 'locations' | 'terms'>('characters');

  // New character state
  const [newCharOriginal, setNewCharOriginal] = useState('');
  const [newCharKhmer, setNewCharKhmer] = useState('');
  const [newCharRole, setNewCharRole] = useState('');
  const [isAddingChar, setIsAddingChar] = useState(false);

  // New location state
  const [newLocOriginal, setNewLocOriginal] = useState('');
  const [newLocKhmer, setNewLocKhmer] = useState('');
  const [newLocDesc, setNewLocDesc] = useState('');
  const [isAddingLoc, setIsAddingLoc] = useState(false);

  // New term state
  const [newTermOriginal, setNewTermOriginal] = useState('');
  const [newTermKhmer, setNewTermKhmer] = useState('');
  const [newTermCategory, setNewTermCategory] = useState('');
  const [isAddingTerm, setIsAddingTerm] = useState(false);

  const handleAddCharacter = () => {
    if (!newCharOriginal.trim() || !newCharKhmer.trim()) return;
    const newChar: CharacterEntity = {
      originalName: newCharOriginal.trim(),
      khmerName: newCharKhmer.trim(),
      role: newCharRole.trim() || 'តួអង្គ',
    };
    setAnalysis((prev) => (prev ? { ...prev, characters: [...prev.characters, newChar] } : null));
    setNewCharOriginal('');
    setNewCharKhmer('');
    setNewCharRole('');
    setIsAddingChar(false);
  };

  const handleDeleteCharacter = (index: number) => {
    setAnalysis((prev) =>
      prev ? { ...prev, characters: prev.characters.filter((_, i) => i !== index) } : null
    );
  };

  const handleUpdateCharacter = (index: number, field: keyof CharacterEntity, value: string) => {
    setAnalysis((prev) => {
      if (!prev) return null;
      const updated = [...prev.characters];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, characters: updated };
    });
  };

  const handleAddLocation = () => {
    if (!newLocOriginal.trim() || !newLocKhmer.trim()) return;
    const newLoc: LocationEntity = {
      originalName: newLocOriginal.trim(),
      khmerName: newLocKhmer.trim(),
      description: newLocDesc.trim(),
    };
    setAnalysis((prev) => (prev ? { ...prev, locations: [...prev.locations, newLoc] } : null));
    setNewLocOriginal('');
    setNewLocKhmer('');
    setNewLocDesc('');
    setIsAddingLoc(false);
  };

  const handleDeleteLocation = (index: number) => {
    setAnalysis((prev) =>
      prev ? { ...prev, locations: prev.locations.filter((_, i) => i !== index) } : null
    );
  };

  const handleAddTerm = () => {
    if (!newTermOriginal.trim() || !newTermKhmer.trim()) return;
    const newTerm: TermEntity = {
      originalName: newTermOriginal.trim(),
      khmerName: newTermKhmer.trim(),
      category: newTermCategory.trim() || 'វត្ថុ/ពាក្យគន្លឹះ',
    };
    setAnalysis((prev) => (prev ? { ...prev, terms: [...prev.terms, newTerm] } : null));
    setNewTermOriginal('');
    setNewTermKhmer('');
    setNewTermCategory('');
    setIsAddingTerm(false);
  };

  const handleDeleteTerm = (index: number) => {
    setAnalysis((prev) =>
      prev ? { ...prev, terms: prev.terms.filter((_, i) => i !== index) } : null
    );
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-xl space-y-6">
      {/* Title & Overview Banner */}
      <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-indigo-950/40 rounded-xl p-5 border border-amber-500/30">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-3 border-b border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[11px] font-semibold font-khmer">
                លទ្ធផលវិភាគសាច់រឿង
              </span>
              {analysis.translationGenre && (
                <span className="px-2 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold font-khmer">
                  {analysis.translationGenre === 'anime'
                    ? '⚡ លក្ខណៈ៖ អេននីមេ (កម្រិត អេស, អេ, ប៊ី, ស៊ី)'
                    : analysis.translationGenre === 'donghua'
                    ? '🔥 លក្ខណៈ៖ ដុងហួរ (ការដាំដុះ & ក្បាច់គុន)'
                    : '🎬 លក្ខណៈ៖ ភាពយន្ត (សំឡេងសន្ទនារស់រវើក)'}
                </span>
              )}
              <span className="text-xs text-slate-400 font-mono">
                {totalChars.toLocaleString()} តួអក្សរ ({totalPages} ទំព័រ)
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-amber-300 font-khmer mt-1">
              {analysis.khmerTitle || 'ចំណងជើងសាច់រឿង'}
            </h2>
            {analysis.originalTitle && (
              <p className="text-xs text-slate-400 font-sans italic">{analysis.originalTitle}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onBackToInput}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-khmer transition-colors"
            >
              ត្រឡប់កែអត្ថបទដើម
            </button>
            <button
              onClick={onProceedToTranslate}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs font-khmer flex items-center gap-1.5 shadow-md shadow-amber-500/20 active:scale-95 transition-all"
            >
              <span>ចាប់ផ្តើមបកប្រែពីទំព័រទី ១ (សរុប {totalPages} ទំព័រ)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Narrative Arc & Pronoun Rules */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-xs">
          <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800/80">
            <span className="font-semibold text-slate-300 font-khmer block mb-1">
              📖 បរិបទសាច់រឿងសង្ខេប (Context Blueprint):
            </span>
            <p className="text-slate-300 font-khmer leading-relaxed">
              {analysis.storyOverview || 'គ្មានការពិពណ៌នា'}
            </p>
          </div>
          <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800/80">
            <span className="font-semibold text-amber-400 font-khmer block mb-1">
              ✨ ក្បួនសព្វនាម & រចនាបថ (Pronoun & Register Guidelines):
            </span>
            <p className="text-slate-300 font-khmer leading-relaxed">
              {analysis.pronounGuidelines ||
                'ប្រើពាក្យសព្វនាមខ្មែរគួរសម ពិរោះ រលូន សមស្របតាមវ័យ និងឋានន្តរសក្តិរបស់តួអង្គ។'}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs: Characters, Locations, Objects */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('characters')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-khmer transition-all ${
              activeTab === 'characters'
                ? 'bg-amber-500 text-slate-950 font-bold shadow'
                : 'text-slate-400 hover:text-slate-200 bg-slate-950'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>ឈ្មោះតួអង្គ ({analysis.characters.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('locations')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-khmer transition-all ${
              activeTab === 'locations'
                ? 'bg-amber-500 text-slate-950 font-bold shadow'
                : 'text-slate-400 hover:text-slate-200 bg-slate-950'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>ទីតាំង ({analysis.locations.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('terms')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-khmer transition-all ${
              activeTab === 'terms'
                ? 'bg-amber-500 text-slate-950 font-bold shadow'
                : 'text-slate-400 hover:text-slate-200 bg-slate-950'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>វត្ថុ & ពាក្យគន្លឹះ ({analysis.terms.length})</span>
          </button>
        </div>

        <p className="text-[11px] text-slate-400 font-khmer">
          💡 អ្នកអាចចុចកែសម្រួលឈ្មោះខ្មែរដោយផ្ទាល់ ឬបន្ថែមឈ្មោះថ្មី មុននឹងបកប្រែ។
        </p>
      </div>

      {/* Characters Tab Content */}
      {activeTab === 'characters' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 font-khmer">
              បញ្ជីតួអង្គដែលត្រូវចងចាំ និងរក្សាឈ្មោះឱ្យដូចគ្នា ១០០%៖
            </span>
            <button
              onClick={() => setIsAddingChar(!isAddingChar)}
              className="text-xs font-khmer text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>បន្ថែមតួអង្គថ្មី</span>
            </button>
          </div>

          {/* Add Character Form */}
          {isAddingChar && (
            <div className="p-3 bg-slate-950 rounded-xl border border-amber-500/40 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <input
                type="text"
                placeholder="ឈ្មោះដើម (e.g. Harry Potter)"
                value={newCharOriginal}
                onChange={(e) => setNewCharOriginal(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-200"
              />
              <input
                type="text"
                placeholder="ឈ្មោះជាភាសាខ្មែរ (e.g. ហារី ផោតធ័រ)"
                value={newCharKhmer}
                onChange={(e) => setNewCharKhmer(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 font-khmer"
              />
              <input
                type="text"
                placeholder="តួនាទី (e.g. តួឯកប្រុស)"
                value={newCharRole}
                onChange={(e) => setNewCharRole(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 font-khmer"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddCharacter}
                  className="flex-1 bg-amber-500 text-slate-950 font-bold rounded py-1.5 font-khmer hover:bg-amber-400"
                >
                  បញ្ចូល
                </button>
                <button
                  onClick={() => setIsAddingChar(false)}
                  className="px-3 bg-slate-800 text-slate-400 rounded py-1.5 font-khmer hover:bg-slate-700"
                >
                  បោះបង់
                </button>
              </div>
            </div>
          )}

          {/* Character Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {analysis.characters.map((char, index) => (
              <div
                key={index}
                className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 hover:border-slate-700 transition-all space-y-2 group"
              >
                <div className="flex items-start justify-between">
                  <div className="font-mono text-xs font-semibold text-slate-400">
                    {char.originalName}
                  </div>
                  <button
                    onClick={() => handleDeleteCharacter(index)}
                    className="text-slate-600 hover:text-rose-400 p-1 transition-colors"
                    title="លុប"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 font-khmer">ឈ្មោះខ្មែរ៖</span>
                  <input
                    type="text"
                    value={char.khmerName}
                    onChange={(e) => handleUpdateCharacter(index, 'khmerName', e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-amber-300 font-bold font-khmer focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 font-khmer">តួនាទី៖</span>
                  <input
                    type="text"
                    value={char.role}
                    onChange={(e) => handleUpdateCharacter(index, 'role', e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-[11px] text-slate-300 font-khmer focus:outline-none"
                  />
                </div>
                {char.description && (
                  <p className="text-[10px] text-slate-500 font-khmer line-clamp-1 italic">
                    {char.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Locations Tab Content */}
      {activeTab === 'locations' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 font-khmer">
              បញ្ជីទីតាំង និងទីកន្លែងដែលត្រូវរក្សាឈ្មោះឱ្យដូចគ្នា៖
            </span>
            <button
              onClick={() => setIsAddingLoc(!isAddingLoc)}
              className="text-xs font-khmer text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>បន្ថែមទីតាំងថ្មី</span>
            </button>
          </div>

          {isAddingLoc && (
            <div className="p-3 bg-slate-950 rounded-xl border border-amber-500/40 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <input
                type="text"
                placeholder="ឈ្មោះដើម (e.g. Eldoria)"
                value={newLocOriginal}
                onChange={(e) => setNewLocOriginal(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-200"
              />
              <input
                type="text"
                placeholder="ឈ្មោះខ្មែរ (e.g. អេលដូរ៉ា)"
                value={newLocKhmer}
                onChange={(e) => setNewLocKhmer(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 font-khmer"
              />
              <input
                type="text"
                placeholder="ការពិពណ៌នា"
                value={newLocDesc}
                onChange={(e) => setNewLocDesc(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 font-khmer"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddLocation}
                  className="flex-1 bg-amber-500 text-slate-950 font-bold rounded py-1.5 font-khmer hover:bg-amber-400"
                >
                  បញ្ចូល
                </button>
                <button
                  onClick={() => setIsAddingLoc(false)}
                  className="px-3 bg-slate-800 text-slate-400 rounded py-1.5 font-khmer hover:bg-slate-700"
                >
                  បោះបង់
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {analysis.locations.map((loc, index) => (
              <div
                key={index}
                className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div className="font-mono text-xs font-semibold text-slate-400">
                    {loc.originalName}
                  </div>
                  <button
                    onClick={() => handleDeleteLocation(index)}
                    className="text-slate-600 hover:text-rose-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 font-khmer">ឈ្មោះខ្មែរ៖</span>
                  <input
                    type="text"
                    value={loc.khmerName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAnalysis((prev) => {
                        if (!prev) return null;
                        const updated = [...prev.locations];
                        updated[index] = { ...updated[index], khmerName: val };
                        return { ...prev, locations: updated };
                      });
                    }}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-amber-300 font-bold font-khmer"
                  />
                </div>
                {loc.description && (
                  <p className="text-[10px] text-slate-400 font-khmer line-clamp-1 italic">
                    {loc.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Terms & Artifacts Tab Content */}
      {activeTab === 'terms' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 font-khmer">
              បញ្ជីវត្ថុ អាវុធទេព និងពាក្យគន្លឹះពិសេស៖
            </span>
            <button
              onClick={() => setIsAddingTerm(!isAddingTerm)}
              className="text-xs font-khmer text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>បន្ថែមវត្ថុ/ពាក្យថ្មី</span>
            </button>
          </div>

          {isAddingTerm && (
            <div className="p-3 bg-slate-950 rounded-xl border border-amber-500/40 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <input
                type="text"
                placeholder="ពាក្យដើម (e.g. Radiant Blade)"
                value={newTermOriginal}
                onChange={(e) => setNewTermOriginal(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-200"
              />
              <input
                type="text"
                placeholder="ពាក្យខ្មែរ (e.g. ដាវទេពរស្មី)"
                value={newTermKhmer}
                onChange={(e) => setNewTermKhmer(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 font-khmer"
              />
              <input
                type="text"
                placeholder="ប្រភេទ (e.g. អាវុធទេព)"
                value={newTermCategory}
                onChange={(e) => setNewTermCategory(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-200 font-khmer"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddTerm}
                  className="flex-1 bg-amber-500 text-slate-950 font-bold rounded py-1.5 font-khmer hover:bg-amber-400"
                >
                  បញ្ចូល
                </button>
                <button
                  onClick={() => setIsAddingTerm(false)}
                  className="px-3 bg-slate-800 text-slate-400 rounded py-1.5 font-khmer hover:bg-slate-700"
                >
                  បោះបង់
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {analysis.terms.map((term, index) => (
              <div
                key={index}
                className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div className="font-mono text-xs font-semibold text-slate-400">
                    {term.originalName}
                  </div>
                  <button
                    onClick={() => handleDeleteTerm(index)}
                    className="text-slate-600 hover:text-rose-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 font-khmer">ពាក្យខ្មែរ៖</span>
                  <input
                    type="text"
                    value={term.khmerName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAnalysis((prev) => {
                        if (!prev) return null;
                        const updated = [...prev.terms];
                        updated[index] = { ...updated[index], khmerName: val };
                        return { ...prev, terms: updated };
                      });
                    }}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-amber-300 font-bold font-khmer"
                  />
                </div>
                {term.category && (
                  <p className="text-[10px] text-indigo-400 font-khmer">{term.category}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Bottom Bar */}
      <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-emerald-400 font-khmer">
          <Check className="w-4 h-4" />
          <span>
            បញ្ជីចងចាំឈ្មោះតួអង្គរួចរាល់ ({analysis.characters.length} តួអង្គ, {analysis.locations.length} ទីតាំង, {analysis.terms.length} វត្ថុ)
          </span>
        </div>

        <button
          onClick={onProceedToTranslate}
          className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 font-bold text-sm font-khmer flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 transition-all"
        >
          <span>បញ្ជាក់ និងចាប់ផ្តើមបកប្រែពីទំព័រទី ១ ជាភាសាខ្មែរសុទ្ធ ១០០%</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
