import React from 'react';
import { X, Sparkles, BookOpen, Layers, Users, Zap, CheckCircle2 } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 font-khmer text-base">
                របៀបប្រើប្រាស់កម្មវិធី KhmerStory Translator
              </h3>
              <p className="text-xs text-slate-400 font-khmer">
                លក្ខណៈពិសេសចម្បងៗ និងការបកប្រែសាច់រឿងវែងរហូតដល់ ៣៥០,០០០+ តួអក្សរ
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feature List */}
        <div className="space-y-4 text-xs font-khmer text-slate-300">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-950 border border-indigo-500/30">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0 text-base">
              🗡️
            </div>
            <div>
              <h4 className="font-bold text-indigo-300 text-sm mb-1">
                ១. រចនាប័ទ្មបកប្រែទី ១៖ បែប Anime / កម្រិត Rank (F, E, D, C, B, A, S, SS...)
              </h4>
              <p className="text-slate-400 leading-relaxed">
                បកប្រែកម្រិត Rank ច្បាស់លាស់ (Rank A, B, C, S, SS, SSS), ជំនាញ Skills, វេទមន្ត Magic, Hunter, Dungeon, Boss, Status window, Guild ជាមួយការសន្ទនាក្លាហាន មុះមុត ស៊ីអារម្មណ៍បែប Anime ជក់ចិត្ត។
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-950 border border-amber-500/30">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0 text-base">
              ☯️
            </div>
            <div>
              <h4 className="font-bold text-amber-300 text-sm mb-1">
                ២. រចនាប័ទ្មបកប្រែទី ២៖ បែប ដុងហោ / Anime ចិន (Cultivation / Qi / បក្ស)
              </h4>
              <p className="text-slate-400 leading-relaxed">
                បកប្រែការដាំដុះធាតុ (Qi / Cultivation), ឋានៈដាំដុះ (ចម្រាញ់ធាតុ, កសាងគ្រឹះ, ស្នូលមាស, ព្រលឹងទិព្វ, ឆ្លងរន្ទះសួគ៌), និកាយ/បក្ស, ព្រឹទ្ធាចារ្យ, សិស្សច្បង, ដាវទិព្វ, ថ្នាំទិព្វ ពិរោះរណ្តំបែបទេវកថាបុរាណចិន។
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-950 border border-rose-500/30">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 shrink-0 text-base">
              🎬
            </div>
            <div>
              <h4 className="font-bold text-rose-300 text-sm mb-1">
                ៣. រចនាប័ទ្មបកប្រែទី ៣៖ បែប ភាពយន្ត (Movie / Cinema Dialogue / Dubbing)
              </h4>
              <p className="text-slate-400 leading-relaxed">
                ការសន្ទនារស់រវើក ធម្មជាតិ ជក់ចិត្ត ងាយស្រួលយល់ និងពិរោះស័ក្តិសមបំផុតសម្រាប់ការបញ្ចេញសំឡេង បញ្ចូលសំឡេង (Dubbing / Voiceover) មិនរឹងដូចសៀវភៅ។
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-bold text-amber-300 text-sm mb-1">
                ៤. ពិនិត្យមើលអត្ថបទទាំងមូលជាមុន & ចងចាំឈ្មោះតួអង្គ (Entity Bible)
              </h4>
              <p className="text-slate-400 leading-relaxed">
                មុននឹងបកប្រែ ប្រព័ន្ធនឹងស្កេនពិនិត្យមើលសាច់រឿងទាំងមូល ដើម្បីស្រង់ឈ្មោះតួអង្គ (Characters) ទីតាំង (Locations) និងវត្ថុ/អាវុធទេព (Artifacts) មកបង្កើតជាតារាងចងចាំ។ អ្នកអាចកែសម្រួលឈ្មោះខ្មែរតាមចិត្ត ហើយ Gemini នឹងរក្សាឈ្មោះទាំងនោះឱ្យដូចគ្នា ១០០% ពីទំព័រទី១ រហូតដល់ចប់។
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-bold text-emerald-300 text-sm mb-1">
                ៥. ភាសាខ្មែរសុទ្ធ ១០០% មិនសង្ខេបន័យ & ១ ទំព័រ &lt;= ៥០,០០០ តួអក្សរ
              </h4>
              <p className="text-slate-400 leading-relaxed">
                បកប្រែបែបអ្នកនិពន្ធនិទានរឿង ពិរោះ រលូន ក្បោះក្បាយ មិនសង្ខេបន័យដាច់ខាត។ គាំទ្រអត្ថបទវែងរហូតដល់ ៣៥០,០០០+ តួអក្សរ ដោយបំបែកទំព័រត្រឹមត្រូវ គ្មានការបាត់បង់ទិន្នន័យឡើយ។
              </p>
            </div>
          </div>
        </div>

        {/* Close Button */}
        <div className="pt-2 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-khmer text-xs transition-colors"
          >
            យល់ព្រម
          </button>
        </div>
      </div>
    </div>
  );
};
