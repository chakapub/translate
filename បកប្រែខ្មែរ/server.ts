import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json({ limit: '100mb' }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Helper to call Gemini with retry and fallback model
async function generateContentWithFallback(params: any): Promise<any> {
  const models = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        ...params,
        model,
      });
      return response;
    } catch (err: any) {
      lastError = err;
      const msg = err.message || String(err);
      console.warn(`Model ${model} failed:`, msg);

      // If it's a 429 quota exhaustion, immediately skip to next fallback model
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota') || msg.includes('quota')) {
        continue;
      }

      // If it's a 503 high demand spike, retry once after a short delay
      if (msg.includes('503') || msg.includes('UNAVAILABLE')) {
        try {
          await new Promise((r) => setTimeout(r, 600));
          const retryRes = await ai.models.generateContent({
            ...params,
            model,
          });
          return retryRes;
        } catch (retryErr: any) {
          lastError = retryErr;
        }
      }
    }
  }
  throw lastError;
}

// Helper to call Gemini Streaming with fallback model
async function generateStreamWithFallback(params: any): Promise<any> {
  const models = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
  let lastError: any = null;

  for (const model of models) {
    try {
      const stream = await ai.models.generateContentStream({
        ...params,
        model,
      });
      return stream;
    } catch (err: any) {
      lastError = err;
      const msg = err.message || String(err);
      console.warn(`Streaming on ${model} failed:`, msg);
      // Immediately try next model in fallback list
    }
  }
  throw lastError;
}

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// API: Analyze the entire story up to 100,000+ characters
// Builds Entity Bible (characters, locations, objects, tone) and narrative outline before translating
app.post('/api/analyze-story', async (req, res) => {
  try {
    const { fullText, sourceLang = 'auto', translationStyle = 'anime_rank' } = req.body;

    if (!fullText || typeof fullText !== 'string' || fullText.trim().length === 0) {
      return res.status(400).json({ error: 'អត្ថបទមិនអាចទទេបានឡើយ (Text is empty)' });
    }

    const totalChars = fullText.length;
    // For fast and highly reliable analysis without timeout spikes, sample up to 30,000 characters
    let textSample = fullText;
    if (fullText.length > 30000) {
      const part1 = fullText.slice(0, 18000);
      const part2 = fullText.slice(Math.floor(fullText.length / 2) - 4000, Math.floor(fullText.length / 2) + 4000);
      const part3 = fullText.slice(-6000);
      textSample = `${part1}\n\n[...]\n\n${part2}\n\n[...]\n\n${part3}`;
    }

    let styleNote = '';
    if (translationStyle === 'anime_rank') {
      styleNote = 'The user selected Anime / Hunter / Magic Rank style (ថ្នាក់ F, E, D, C, B, A, S, SS...). Pay special attention to ranks, skill names, dungeons, spells, and dynamic titles.';
    } else if (translationStyle === 'donghua_cultivation') {
      styleNote = 'The user selected Donghua / Xianxia / Qi Cultivation style. Pay special attention to cultivation realms, sect names, martial arts, elixirs, and ancient Chinese mythological terminology.';
    } else {
      styleNote = 'The user selected Movie / Cinema / Screenplay style. Pay special attention to cinematic character personalities, natural dialogue registers, and vivid scene elements.';
    }

    const prompt = `You are a master literary editor and multilingual scholar specialized in English, Hindi, and pure classical/modern Khmer (ភាសាខ្មែរ).
The user is going to translate a long story/novel (${totalChars} characters) from ${sourceLang === 'hi' ? 'Hindi' : sourceLang === 'en' ? 'English' : 'English or Hindi'} into 100% Pure, Natural, Beautiful Khmer (ភាសាខ្មែរសុទ្ធ១០០%).
Translation Style Preference: ${styleNote}

To ensure consistent character names, locations, terms, and unbroken narrative continuity from page 1 to the end, carefully read and analyze this story text below.

EXTRACT AND ESTABLISH THE FOLLOWING ENTITY BIBLE & STORY BLUEPRINT:
1. Story Title: Suggested poetic, engaging Khmer title (and original title).
2. Story Overview: A 3-4 sentence narrative context in Khmer so translators know the emotional and plot arc.
3. Tone & Style: Specific narrative tone in Khmer (e.g. វីរកថាបុរាណ, ប្រលោមលោកមនោសញ្ចេតនា, ទេវកថាអាថ៌កំបាំង, រឿងនិទានប្រជាប្រិយ, ផ្សងព្រេង).
4. Characters (តួអង្គ): Every named character, with:
   - originalName (e.g. "Arjun" / "John Watson")
   - khmerName: Accurate, phonetically natural Khmer transliteration/translation (e.g. "អរជុន" / "ចន វ៉ាតសុន"). MUST be consistent throughout.
   - role: Role (e.g. តួឯកប្រុស, គ្រូ, មេទ័ព, ប្អូនស្រី)
   - description: Brief description and personality traits
5. Locations (ទីតាំង): All major places, cities, realms, or buildings with standard Khmer translation.
6. Key Objects/Artifacts (វត្ថុ ឬ ពាក្យគន្លឹះ): Weapons, magical items, royal titles, vehicles, or specialized terms with authentic Khmer terminology.
7. Pronoun Guidelines (ក្បួនប្រើសព្វនាម): Clear instructions on which Khmer pronouns should be used (e.g., ទ្រង់/ព្រះអង្គ for kings/gods, ឯង/ខ្ញុំ for peers, លោក/នាង for formal address) to ensure high naturalness.

STORY TEXT:
---
${textSample}
---`;

    try {
      const response = await generateContentWithFallback({
        contents: prompt,
        config: {
          systemInstruction: 'You analyze literary stories for 100% pure Khmer narrative translation and entity memory consistency. Always return clean structured JSON.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              originalTitle: { type: Type.STRING },
              khmerTitle: { type: Type.STRING },
              storyOverview: { type: Type.STRING },
              genre: { type: Type.STRING },
              narrativeTone: { type: Type.STRING },
              pronounGuidelines: { type: Type.STRING },
              characters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    originalName: { type: Type.STRING },
                    khmerName: { type: Type.STRING },
                    role: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['originalName', 'khmerName', 'role'],
                },
              },
              locations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    originalName: { type: Type.STRING },
                    khmerName: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['originalName', 'khmerName'],
                },
              },
              terms: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    originalName: { type: Type.STRING },
                    khmerName: { type: Type.STRING },
                    category: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['originalName', 'khmerName'],
                },
              },
            },
            required: ['khmerTitle', 'storyOverview', 'characters', 'locations', 'terms'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json({
        success: true,
        analysis: parsed,
        charCount: totalChars,
      });
    } catch (apiErr: any) {
      console.warn('AI analysis returned error, generating smart heuristic fallback:', apiErr.message);

      // Smart Heuristic Fallback so the user is NEVER blocked from translating
      const firstLine = fullText.trim().split('\n')[0].slice(0, 80).replace(/[#*]/g, '').trim();

      // Extract capitalized names as potential characters
      const words = fullText.match(/\b[A-Z][a-z]{2,15}\b/g) || [];
      const commonWords = new Set(['The', 'And', 'Then', 'When', 'With', 'From', 'After', 'Before', 'Into', 'This', 'That', 'They', 'There', 'What', 'Where']);
      const nameFreq: { [key: string]: number } = {};
      for (const w of words) {
        if (!commonWords.has(w)) {
          nameFreq[w] = (nameFreq[w] || 0) + 1;
        }
      }

      const topNames = Object.entries(nameFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name]) => ({
          originalName: name,
          khmerName: name, // User or translator can adjust
          role: 'តួអង្គសំខាន់',
          description: 'តួអង្គក្នុងសាច់រឿង',
        }));

      const fallbackAnalysis = {
        originalTitle: firstLine || 'Story',
        khmerTitle: 'រឿងប្រលោមលោកខ្មែរសុទ្ធ',
        storyOverview: 'សាច់រឿងពេញលេញត្រូវបានរៀបចំរួចរាល់សម្រាប់ការបកប្រែជាភាសាខ្មែរសុទ្ធ ១០០% តាមលំដាប់ទំព័រ មិនសង្ខេបន័យ។',
        genre: 'រឿងប្រលោមលោក',
        narrativeTone: 'បែបពន្យល់សាច់រឿងរលូន',
        pronounGuidelines: 'ប្រើពាក្យសព្វនាមខ្មែរគួរសម ពិរោះ និងសមស្របតាមឋានៈតួអង្គ។',
        characters: topNames.length > 0 ? topNames : [
          { originalName: 'Protagonist', khmerName: 'តួឯក', role: 'តួឯក', description: 'តួឯកនៃសាច់រឿង' }
        ],
        locations: [
          { originalName: 'Setting', khmerName: 'ទីតាំងរឿង', description: 'ទីកន្លែងកើតហេតុក្នុងរឿង' }
        ],
        terms: [
          { originalName: 'Key Term', khmerName: 'ពាក្យគន្លឹះ', category: 'ទូទៅ', description: 'ពាក្យពិសេសក្នុងរឿង' }
        ],
      };

      return res.json({
        success: true,
        analysis: fallbackAnalysis,
        charCount: totalChars,
        isFallback: true,
      });
    }
  } catch (err: any) {
    console.error('Fatal error in analyze-story:', err);
    res.status(500).json({ error: err.message || 'បរាជ័យក្នុងការវិភាគសាច់រឿង' });
  }
});

// API: Stream translation for a single page/chunk (8,000 - 9,000 characters)
// With Server-Sent Events (SSE) for live character jumping & streaming
app.post('/api/translate-stream', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const {
      chunkText,
      chunkIndex = 0,
      totalChunks = 1,
      sourceLang = 'auto',
      storyTitle = '',
      characters = [],
      locations = [],
      terms = [],
      pronounGuidelines = '',
      previousSummary = '',
      previousTail = '',
      translationStyle = 'anime_rank',
      isSrtMode = false,
      narrativeStyle,
    } = req.body;

    const activeStyle = translationStyle || narrativeStyle || 'anime_rank';
    const isSrt = Boolean(isSrtMode || (typeof chunkText === 'string' && chunkText.includes('[SRT_')));

    if (!chunkText || typeof chunkText !== 'string') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'គ្មានអត្ថបទត្រូវបកប្រែ' })}\n\n`);
      return res.end();
    }

    // Style-specific translation directive and vocabulary guidelines
    let styleInstructions = '';
    if (activeStyle === 'anime_rank') {
      styleInstructions = `=== រចនាប័ទ្មបកប្រែទី ១៖ បែប ANIME / NOVEL GAME / HUNTER (កម្រិតបែប អេ ប៊ី ស៊ី អេស...) ===
- កម្រិត Rank / Class / Level: ត្រូវបកប្រែ និងប្រើប្រាស់កម្រិតច្បាស់លាស់ ដូចជា "កម្រិត អេស (Rank S)", "កម្រិត អេ (Rank A)", "កម្រិត ប៊ី (Rank B)", "កម្រិត ស៊ី (Rank C)", "កម្រិត ឌី (Rank D)", "កម្រិត អ៊ី (Rank E)", "កម្រិត អេសអេស (Rank SS)", "កម្រិត អេសអេសអេស (Rank SSS)" ឬ "Hunter ថ្នាក់ S", "បិសាចកម្រិត A"។
- ពាក្យជំនាញនិងវេទមន្ត (Skills & Magic): ឈ្មោះជំនាញ (Skills) ក្បាច់ប្រយុទ្ធ វង់មន្តអាគម កម្រិត Tier 1-10 ត្រូវបកប្រែឱ្យមានអំណាច រស់រវើក ដូចជា "ជំនាញអណ្តាតភ្លើងពិឃាត", "ជំនាញបំបាំងកាយ", "ច្រកទ្វារវិមាត្រ (Dungeon/Gate)", "មេបិសាច (Boss)", "ផ្ទាំងព័ត៌មានឋានៈ (Status Window)", "ថាមពលវេទមន្ត (Mana)"។
- ទឹកដមសម្លេង និងការសន្ទនា (Dialogue & Tone): បែប Anime ជប៉ុន មុះមុត ក្លាហាន ឡូយឆាយ មានថាមពលមហិមា និងទាក់ទាញអារម្មណ៍យុវវ័យ។`;
    } else if (activeStyle === 'donghua_cultivation') {
      styleInstructions = `=== រចនាប័ទ្មបកប្រែទី ២៖ បែប ដុងហោ / ANIME ចិន / ការដាំដុះធាតុ (DONGHUA / XIANXIA / CULTIVATION) ===
- ការដាំដុះថាមពល (Cultivation / Qi): ប្រើប្រាស់ពាក្យបច្ចេកទេសដាំដុះធាតុបុរាណឱ្យត្រូវតាមប្រភេទរឿងចិនដូចជា "ការដាំដុះថាមពល", "ថាមពលឈី (Qi)", "ការចម្រាញ់ធាតុ (Qi Condensation)", "ការកសាងគ្រឹះ (Foundation Establishment)", "ការបង្កើតស្នូលមាស (Core Formation / Golden Core)", "ការបំបែកព្រលឹងទិព្វ (Nascent Soul)", "ដំណាក់កាលបរិសុទ្ធ (Soul Formation)", "ការឆ្លងកាត់ទុក្ខវេទនារន្ទះសួគ៌ (Heavenly Tribulation)", "ការទម្លុះព្រំដែនកម្រិត (Breakthrough)"។
- និកាយនិងពិភពគុន (Sects & Jianghu): ប្រើប្រាស់ពាក្យ "និកាយ", "បក្ស", "មេបក្ស", "ព្រឹទ្ធាចារ្យកំពូល", "សិស្សច្បង", "សិស្សប្អូន", "លោកគ្រូ/ម្ចាស់បង/ម្ចាស់ប្អូនស្រី", "ដាវទិព្វហោះ", "ថ្នាំគ្រាប់ទិព្វចម្រាញ់ (Elixir/Dan)", "ល្អាងហាត់ធាតុ", "ពិភពមនុស្ស/ពិភពទេវៈ/ពិភពបិសាច"។
- ទឹកដមសម្លេង (Tone): ពិរោះរណ្តំ បែបអក្សរសិល្ប៍ទេវកថាចិនបុរាណ មានភាពថ្លៃថ្នូរ ឧត្តុង្គឧត្តម និងអស្ចារ្យ។`;
    } else {
      styleInstructions = `=== រចនាប័ទ្មបកប្រែទី ៣៖ បែប ភាពយន្ត (MOVIE / CINEMA / DUBBING & SUBTITLE STYLE) ===
- ការសន្ទនាបែបភាពយន្ត (Cinematic & Natural Dialogue): ពាក្យពេចន៍សន្ទនាមានភាពរស់រវើក ធម្មជាតិ ដូចមនុស្សនិយាយគ្នាក្នុងជីវិតពិត ឬតួអង្គក្នុងកុនហូលីវូដ ងាយស្រួលយល់ ស្តាប់ទៅជក់ចិត្ត និងល្អឥតខ្ចោះសម្រាប់ការបញ្ចេញសំឡេង បញ្ចូលសំឡេង (Dubbing / Voiceover)។
- មិនរឹងស្តូក (Fluid & Expressive): ជៀសវាងពាក្យវេយ្យាករណ៍រឹងៗដូចសៀវភៅចាស់ បកប្រែរំលេចអារម្មណ៍ ទឹកដមសម្លេង ចង្វាក់ដង្ហើម កាយវិការ និងបរិយាកាសតានតឹងនៃឈុតឆាកនីមួយៗឱ្យដូចទស្សនិកជនកំពុងទស្សនាខ្សែភាពយន្តខ្នាតធំ។`;
    }

    // Format the Entity Bible for Gemini to guarantee consistency
    const characterGlossary = characters
      .map((c: any) => `• ${c.originalName} => "${c.khmerName}" (${c.role || ''}: ${c.description || ''})`)
      .join('\n');

    const locationGlossary = locations
      .map((l: any) => `• ${l.originalName} => "${l.khmerName}" (${l.description || ''})`)
      .join('\n');

    const termGlossary = terms
      .map((t: any) => `• ${t.originalName} => "${t.khmerName}" (${t.category || ''}: ${t.description || ''})`)
      .join('\n');

    const srtSpecialLaw = isSrt
      ? `=== លក្ខខណ្ឌច្បាប់ដែកដាច់ខាតសម្រាប់ចំណងជើងរឿង SRT (STRICT SRT SUBTITLE LAWS) ===
1. នេះគឺជាចំណងជើងរឿង (Subtitles/SRT) ដែលមានលេខរៀង និងម៉ោងជាក់លាក់តាមទម្រង់ [SRT_X | ម៉ោងចាប់ផ្តើម --> ម៉ោងបញ្ចប់]។
2. ត្រូវតែរក្សាស្លាក [SRT_X | ម៉ោងចាប់ផ្តើម --> ម៉ោងបញ្ចប់] ឱ្យនៅដដែល ១០០% គ្រប់ជួរទាំងអស់ ដោយមិនប្តូរលេខរៀង មិនប្តូរម៉ោង និងមិនលុបចោលឡើយ។
3. នៅក្រោមស្លាក [SRT_X | ...] នីមួយៗ ត្រូវបកប្រែអត្ថន័យនៃបន្ទាត់នោះជាភាសាខ្មែរឱ្យចំអត្ថន័យ ១០០% (Line-by-line meaning match) ស័ក្តិសមសម្រាប់ការអានចំណងជើងរឿង (Subtitles) ឬការបញ្ចូលសំឡេង (Dubbing)។
4. ហាមបូកបញ្ចូលបន្ទាត់ ឬរំលងបន្ទាត់ណាមួយដាច់ខាត។ ចំនួនស្លាក [SRT_X] នៃអត្ថបទបកប្រែត្រូវតែស្មើគ្នានឹងចំនួនដើមទាំងស្រុង។`
      : '';

    const systemInstruction = `អ្នកគឺជាមហាកវីនិពន្ធ និងជាអ្នកបកប្រែរឿងប្រលោមលោកជាន់ខ្ពស់ជំនាញភាសាខ្មែរសុទ្ធ ១០០% (Master Literary Khmer Translator & Storyteller).

ភារកិច្ចចម្បងរបស់អ្នក៖
បកប្រែអត្ថបទដើមពី ${sourceLang === 'hi' ? 'ភាសាហិនឌី' : sourceLang === 'en' ? 'ភាសាអង់គ្លេស' : 'ភាសាអង់គ្លេស/ហិនឌី'} ទៅជា "ភាសាខ្មែរសុទ្ធ ១០០%" ដោយអនុលោមតាមរចនាប័ទ្មបកប្រែដែលបានកំណត់យ៉ាងច្បាស់លាស់។

${styleInstructions}

${srtSpecialLaw}

លក្ខខណ្ឌច្បាប់ដែកដាច់ខាត (STRICT LAWS):
1. ភាសាខ្មែរសុទ្ធ ១០០% (PURE KHMER):
   - មិនត្រូវប្រើពាក្យអង់គ្លេស ឬហិនឌីលាយឡំដាច់ខាត។
   - ប្រើកន្សោមពាក្យខ្មែរពិរោះ ងាយយល់ ត្រូវតាមរចនាប័ទ្មដែលបានជ្រើសរើស។
2. ហាមសង្ខេបដាច់ខាត (STRICTLY NO SUMMARIZING):
   - ត្រូវបកប្រែឱ្យអស់គ្រប់ឃ្លា គ្រប់ប្រយោគ គ្រប់កាយវិការ គ្រប់កិច្ចសន្ទនា គ្រប់បរិយាកាស និងគ្រប់ទិដ្ឋភាពទាំងអស់នៃអត្ថបទដើម។
   - រក្សាខ្លឹមសារដើមឱ្យពេញលេញ ១០០% ដោយគ្មានការកាត់ចោល ឬបង្រួមអត្ថន័យឡើយ។
3. ក្បួនសញ្ញាវណ្ណយុត្តិដាច់ខាត (ONLY '។' AND '?'):
   - មិនបាច់ដាក់សញ្ញាច្រើន ឬសញ្ញាបរទេសឡើយ។ ដាក់តែសញ្ញាខណ្ឌ «។» និងសញ្ញាសួរ «?» បានហើយ។
   - ហាមប្រើសញ្ញាសម្រង់ " " « »
   - ហាមប្រើសញ្ញាឧទាន !
   - ហាមប្រើសញ្ញាពីរចុច : ឬចុចក្បៀស ;
   - ហាមប្រើសញ្ញាផ្កាយ * ឬ **
   - ហាមប្រើសញ្ញាវង់ក្រចក ( ) ឬ [ ]
   - ហាមប្រើសញ្ញាដក - ឬ —
   - ត្រូវសរសេរជាភាសាខ្មែររលូន ប្រើដកឃ្លាធម្មជាតិ និងបញ្ចប់ប្រយោគដោយសញ្ញា «។» ឬ «?» តែប៉ុណ្ណោះ។
4. ក្បួនប្រើប្រាស់លេខខ្មែរសុទ្ធ ១០០% (KHMER NUMERALS ONLY):
   - គ្រប់តួលេខទាំងអស់ (ចំនួន បរិមាណ ពេលវេលា ម៉ោង ថ្ងៃខែឆ្នាំ អាយុ លេខរាប់) ត្រូវតែសរសេរជាលេខខ្មែរសុទ្ធ ១០០% ជានិច្ច ដូចជា៖ ០, ១, ២, ៣, ៤, ៥, ៦, ៧, ៨, ៩។
   - ហាមដាច់ខាតកុំប្រើលេខអារ៉ាប់ (0, 1, 2, 3...) ឡើយ។
5. ការរក្សាឈ្មោះតួអង្គ ទីតាំង និងវត្ថុ (Memory & Entity Consistency):
   - ត្រូវតែប្រើឈ្មោះខ្មែរដូចដែលមានចែងក្នុងតារាង Entity Bible ខាងក្រោមជាដាច់ខាត ហាមបង្កើតឈ្មោះថ្មីខុសគ្នា។
6. សព្វនាមនិងការសន្ទនា (Pronouns & Dialogue Registers):
   - ប្រើពាក្យគួរសម និងសព្វនាមខ្មែរឱ្យត្រូវតាមបរិបទ និងកម្រិតឋានៈនៃតួអង្គ។`;

    let formattedInput = '';
    let instructionFooter = '';

    if (isSrt) {
      formattedInput = chunkText;
      instructionFooter = `ការណែនាំដាច់ខាតសម្រាប់ការបកប្រែចំណងជើងរឿង SRT៖
1. ត្រូវរក្សាស្លាក [SRT_X | ម៉ោង] គ្រប់បន្ទាត់ទាំងអស់ ដោយគ្មានការរំលង ឬកាត់ចោលឡើយ។
2. នៅក្រោមស្លាកនីមួយៗ ត្រូវបកប្រែអត្ថន័យនៃបន្ទាត់នោះជាភាសាខ្មែរសុទ្ធឱ្យចំអត្ថន័យ ១០០% (Line-by-line meaning match)។
3. មិនបាច់ដាក់សញ្ញាច្រើនទេ ដាក់តែសញ្ញាខណ្ឌ «។» និងសញ្ញាសួរ «?» បានហើយ។
4. គ្រប់តួលេខទាំងអស់ (ចំនួន បរិមាណ ឆ្នាំ) ត្រូវសរសេរជាលេខខ្មែរសុទ្ធ (០, ១, ២, ៣, ៤, ៥, ៦, ៧, ៨, ៩) ហាមប្រើលេខអារ៉ាប់ (0-9)។

សូមចាប់ផ្តើមបកប្រែចំណងជើងរឿង SRT ជាភាសាខ្មែរសុទ្ធភ្លាមៗ៖`;
    } else {
      // Split chunk into paragraphs for clear paragraph-by-paragraph mapping
      const rawParagraphs = chunkText
        .split(/\n{2,}/)
        .map((p: string) => p.trim())
        .filter(Boolean);

      formattedInput = rawParagraphs
        .map((p: string, i: number) => `[P${i + 1}]\n${p}`)
        .join('\n\n');

      instructionFooter = `ការណែនាំដាច់ខាតសម្រាប់ការបកប្រែ៖
1. ត្រូវបកប្រែឱ្យអស់គ្រប់កថាខណ្ឌទាំងអស់ពី [P1] ដល់ [P${rawParagraphs.length}] ដោយគ្មានការរំលង ឬសង្ខេបឡើយ។
2. នៅដើមកថាខណ្ឌនីមួយៗ ត្រូវដាក់ស្លាក [P1], [P2]... ដូចអត្ថបទដើម ដើម្បីឱ្យប្រព័ន្ធតាមដានកថាខណ្ឌកំពុងបកប្រែ។
3. មិនបាច់ដាក់សញ្ញាច្រើនទេ ដាក់តែសញ្ញាខណ្ឌ «។» និងសញ្ញាសួរ «?» បានហើយ (ហាមដាក់ ", !, :, -, *, ())។
4. គ្រប់តួលេខទាំងអស់ (ចំនួន បរិមាណ ពេលវេលា ឆ្នាំ) ត្រូវសរសេរជាលេខខ្មែរសុទ្ធ (០, ១, ២, ៣, ៤, ៥, ៦, ៧, ៨, ៩) ហាមដាច់ខាតកុំប្រើលេខអារ៉ាប់ (0-9)។

សូមចាប់ផ្តើមបកប្រែជាភាសាខ្មែរសុទ្ធភ្លាមៗ៖`;
    }

    const userPrompt = `[ទិន្នន័យចងចាំសម្រាប់សាច់រឿង៖ "${storyTitle}"]
[ទំព័រទី ${chunkIndex + 1} នៃទំព័រសរុប ${totalChunks}]

=== តារាងឈ្មោះតួអង្គដែលត្រូវចងចាំ (ENTITY BIBLE - CHARACTERS) ===
${characterGlossary || 'គ្មានតួអង្គពិសេស'}

=== តារាងទីតាំងដែលត្រូវចងចាំ (LOCATIONS) ===
${locationGlossary || 'គ្មានទីតាំងពិសេស'}

=== តារាងវត្ថុនិងពាក្យគន្លឹះ (OBJECTS & TERMS) ===
${termGlossary || 'គ្មានពាក្យពិសេស'}

${pronounGuidelines ? `=== ក្បួនប្រើប្រាស់សព្វនាម (PRONOUN RULES) ===\n${pronounGuidelines}\n` : ''}
${previousSummary ? `=== សេចក្តីសង្ខេបទំព័រមុនៗដើម្បីបន្តសាច់រឿង (CONTINUITY CONTEXT) ===\n${previousSummary}\n` : ''}
${previousTail ? `=== ចុងបញ្ចប់នៃទំព័រមុន (PREVIOUS PAGE ENDING) ===\n"...${previousTail}"\n(សូមបន្តសាច់រឿងឱ្យរលូនតភ្ជាប់ពីឃ្លានេះ)\n` : ''}

=== អត្ថបទដើមដែលត្រូវបកប្រែជាភាសាខ្មែរសុទ្ធ ១០០% (${chunkText.length} តួអក្សរ) ===
${formattedInput}

${instructionFooter}`;

    // Stream from Gemini with fallback models
    const streamModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
    let totalCharsReceived = 0;
    let streamSuccess = false;
    let lastStreamError: any = null;

    for (const model of streamModels) {
      try {
        console.log(`Starting translation stream for page ${chunkIndex + 1} with model: ${model}...`);
        const stream = await ai.models.generateContentStream({
          contents: userPrompt,
          model,
          config: {
            systemInstruction,
            temperature: narrativeStyle === 'storytelling_vivid' ? 0.45 : 0.35,
            topP: 0.95,
          },
        });

        for await (const chunk of stream) {
          const text = chunk.text || '';
          if (text.length > 0) {
            totalCharsReceived += text.length;
            res.write(
              `data: ${JSON.stringify({
                type: 'chunk',
                text,
                charsAdded: text.length,
                totalChars: totalCharsReceived,
              })}\n\n`
            );
          }
        }

        if (totalCharsReceived > 0) {
          streamSuccess = true;
          break;
        } else {
          console.warn(`Model ${model} completed but generated 0 characters. Trying next model...`);
        }
      } catch (err: any) {
        lastStreamError = err;
        const msg = err.message || String(err);
        console.warn(`Streaming failed on model ${model}:`, msg);

        // If characters were already written to client, we cannot seamlessly switch mid-stream
        if (totalCharsReceived > 0) {
          break;
        }
      }
    }

    if (!streamSuccess || totalCharsReceived === 0) {
      const errMsg = lastStreamError?.message || 'មិនទទួលបានអត្ថបទបកប្រែពីម៉ាស៊ីនបកប្រែឡើយ (សូមសាកល្បងម្ដងទៀត)';
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: errMsg,
        })}\n\n`
      );
      return res.end();
    }

    // Done event
    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        chunkIndex,
        totalChars: totalCharsReceived,
      })}\n\n`
    );
    res.end();
  } catch (err: any) {
    console.error('Error in translate stream:', err);
    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        message: err.message || 'មានបញ្ហាក្នុងដំណើរការបកប្រែ',
      })}\n\n`
    );
    res.end();
  }
});

// API: Generate brief continuity summary of a finished chunk to link next chunk
app.post('/api/summarize-chunk', async (req, res) => {
  try {
    const { khmerText, chunkIndex = 0 } = req.body;
    if (!khmerText) {
      return res.json({ summary: '' });
    }

    const response = await generateContentWithFallback({
      contents: `សង្ខេបខ្លឹមសារសំខាន់នៃទំព័រទី ${chunkIndex + 1} នេះត្រឹម ២-៣ ប្រយោគជាភាសាខ្មែរ ដើម្បីទុកធ្វើជាបរិបទតភ្ជាប់សម្រាប់បកប្រែទំព័របន្ទាប់៖\n\n${khmerText.slice(0, 5000)}`,
    });

    res.json({ summary: response.text || '' });
  } catch (err: any) {
    console.error('Error summarizing chunk:', err);
    res.json({ summary: '' });
  }
});

// Setup Vite dev server or static file serving
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, port },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
