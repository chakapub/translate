import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitIntoPages,
  countWords,
  getPageParagraphs,
  buildResilientSubBatches,
  formatCleanKhmerError,
  evaluatePageTranslationCompleteness,
  getUntranslatedBlocksInBatch,
  deduplicateTranslatedBlocks,
  ABSOLUTE_MAX_PAGE_CHARS,
} from './chunker';
import {
  cleanKhmerPunctuation,
  toKhmerNumerals,
  fixKhmerSpellingAndForeignText,
  fixExtraVowelsAndWeirdKhmerClusters,
  convertAllNumbersToKhmerWords,
  computeKhmerCorrectionDiffs,
} from './khmerCleaner';
import { extractNonKhmerWords, hasNonKhmerWords } from './nonKhmerDetector';

test('splitIntoPages splits 10,000,000+ (10 million) characters rapidly without exceeding 50,000 chars per page', () => {
  const paragraph =
    'High upon the ramparts of Highspire Citadel, Commander Valerius tightened his cloak against the driving snow. Below him stretched the vast Silverwood. "Stand firm, Lyra! The S-Rank gate approaches its zenith!"\n\n';
  const repeats = Math.ceil(10_000_000 / paragraph.length);
  const tenMillionText = paragraph.repeat(repeats);
  assert.ok(tenMillionText.length >= 10_000_000, `Expected >= 10M chars, got ${tenMillionText.length}`);

  const startMs = Date.now();
  const pages = splitIntoPages(tenMillionText, { targetChars: 12500, hardMaxLimit: 50000 });
  const elapsedMs = Date.now() - startMs;

  assert.ok(pages.length >= 750, `Expected at least 750 pages for 10M chars, got ${pages.length}`);
  assert.ok(elapsedMs < 3000, `Expected 10M char split to finish in <3000ms, took ${elapsedMs}ms`);

  for (let i = 0; i < pages.length; i++) {
    assert.ok(
      pages[i].charCount <= ABSOLUTE_MAX_PAGE_CHARS,
      `Page ${i + 1} exceeded max limit: ${pages[i].charCount}`
    );
    assert.ok(pages[i].charCount > 0, `Page ${i + 1} should not be empty`);
    assert.equal(pages[i].index, i);
  }
});

test('buildResilientSubBatches preserves exact [P1]..[Pn] paragraph tags across sub-batches', () => {
  const paras = Array.from(
    { length: 12 },
    (_, i) => `Paragraph number ${i + 1}. ` + 'The quick brown fox jumps over the lazy dog. '.repeat(12)
  ).join('\n\n');

  const batches = buildResilientSubBatches(paras, false, 1800);
  assert.ok(batches.length >= 3, `Expected multiple sub-batches, got ${batches.length}`);
  assert.equal(batches[0].startNum, 1);
  assert.equal(batches[batches.length - 1].endNum, 12);

  const combined = batches.map((b) => b.formattedBatch).join('\n\n');
  for (let i = 1; i <= 12; i++) {
    assert.ok(combined.includes(`[P${i}]`), `Missing paragraph tag [P${i}]`);
  }
});

test('formatCleanKhmerError cleanly formats nested 503 Service Unavailable JSON errors', () => {
  const userReported503 = `{"error":{"message":"{\\n \\"error\\": {\\n \\"code\\": 503,\\n \\"message\\": \\"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.\\",\\n \\"status\\": \\"UNAVAILABLE\\"\\n }\\n}\\n","code":503,"status":"Service Unavailable"}}`;
  const formatted = formatCleanKhmerError(userReported503);
  assert.ok(!formatted.includes('"code": 503'));
  assert.ok(formatted.includes('503 High Demand'));
});

test('countWords and Khmer numeral conversion work accurately', () => {
  assert.equal(countWords('Hello world   from\n\nKhmer translator!'), 5);
  assert.equal(toKhmerNumerals('Page 3 of 800 (10000000 chars)'), 'Page ៣ of ៨០០ (១០០០០០០០ chars)');
  const cleaned = cleanKhmerPunctuation('[P1] "សួស្តី!" គាត់និយាយ 123។');
  assert.ok(!cleaned.includes('[P1]'));
  assert.ok(!cleaned.includes('"'));
  assert.ok(!cleaned.includes('!'));
  assert.ok(cleaned.includes('១២៣'));
});

test('fixKhmerSpellingAndForeignText fixes Khmer orthography, extra vowels (លើសស្រៈ), and glued Thai/foreign text like គ្នាอย่างรุนแรง and ស្របពេលដែលអារ៉ុនพยายามพยายามជួ', () => {
  const sampleRaw = `[P1] ស្របពេលដែលអារ៉ុនพยายามพยายามជួ គាត់ក៏បានបុកទង្គិចគ្នាอย่างรุนแรง និងប្រយុទ្ធគ្នាាា សំរាប់ Hunter កំរិត Rank S ដែលមានកំលាំងខ្លាំង ដើម្បីសំលាប់ Monster នៅក្នុង Dungeon អោយអស់ 100 ក្បាល។\n\n[SRT_2 | 00:00:05,000 --> 00:00:09,000]\nValerius បានប្រើ Skill ពិសេសរបស់ System នៅក្នុង Eldoria 江湖។`;

  const result = fixKhmerSpellingAndForeignText(sampleRaw, {
    glossary: [
      { originalName: 'Valerius', khmerName: 'វ៉ាលេរីយ៉ុស' },
      { originalName: 'Eldoria', khmerName: 'អេលដូរ៉ា' },
    ],
    removeOrTransliterateAllForeign: true,
    preserveTags: true,
  });

  // 1. Structural tags preserved
  assert.ok(result.cleanedText.includes('[P1]'));
  assert.ok(result.cleanedText.includes('[SRT_2 | 00:00:05,000 --> 00:00:09,000]'));

  // 2. Language-confused Thai + truncated Khmer word "ស្របពេលដែលអារ៉ុនพยายามพยายามជួ" -> "ស្របពេលដែលអារ៉ុនព្យាយាមជួយ"
  assert.ok(
    result.cleanedText.includes('ស្របពេលដែលអារ៉ុនព្យាយាមជួយ'),
    `Expected ស្របពេលដែលអារ៉ុនព្យាយាមជួយ in: ${result.cleanedText}`
  );
  assert.ok(!result.cleanedText.includes('พยายาม'));

  // 3. Glued Thai text គ្នាอย่างรุนแรง fixed to គ្នាយ៉ាងខ្លាំងក្លា and extra vowels គ្នាាា fixed to គ្នា
  assert.ok(result.cleanedText.includes('គ្នាយ៉ាងខ្លាំងក្លា'), `Expected គ្នាយ៉ាងខ្លាំងក្លា in: ${result.cleanedText}`);
  assert.ok(!result.cleanedText.includes('อย่างรุนแรง'));
  assert.ok(!result.cleanedText.includes('គ្នាាា'));
  assert.ok(result.cleanedText.includes('ប្រយុទ្ធគ្នា'));

  // 4. Khmer Chuon Nath spelling fixed
  assert.ok(result.cleanedText.includes('សម្រាប់'));
  assert.ok(result.cleanedText.includes('កម្រិត'));
  assert.ok(result.cleanedText.includes('កម្លាំង'));
  assert.ok(result.cleanedText.includes('សម្លាប់'));
  assert.ok(result.cleanedText.includes('ឱ្យអស់'));

  // 5. Entity Bible & Foreign terms translated
  assert.ok(result.cleanedText.includes('វ៉ាលេរីយ៉ុស'));
  assert.ok(result.cleanedText.includes('អេលដូរ៉ា'));
  assert.ok(result.cleanedText.includes('អ្នកប្រមាញ់'));
  assert.ok(result.cleanedText.includes('កម្រិត អេស'));
  assert.ok(result.cleanedText.includes('គុកវិមាត្រ'));

  // 6. Zero leftover non-Khmer words or extra-vowel clusters remain
  const remainingForeign = extractNonKhmerWords(result.cleanedText);
  assert.equal(remainingForeign.length, 0, `Expected 0 foreign/corrupted words, found: ${JSON.stringify(remainingForeign)}`);
});

test('repairs mixed Greek/Bengali/Burmese glued syllables (διοាក់គំនិតនោះ, তরwសាង, ដ៏ကြမ်းដុះដំបូ) and extracts exact Before/After correction diffs', () => {
  const userCorruptedSnippet = `ក៏បាននឹកឃើញដល់មេរៀនរបស់ ម៉ឺលីន។ ចូរប្រើបំណងប្រាថ្នារបស់អ្នកដើម្បីបញ្ចុះបញ្ចូលពិភពលោក និងទាញថាមពលក្នុងស្រមើស្រមៃឱ្យក្លាយជាការពិត។ គេបាន διοាក់គំនិតនោះទៅក្នុងរន្ធដ៏អស់សង្ឃឹម ដោយព្យាយាមចងបាតគ្រូគុន তরwសាង\nដ៏ကြမ်းដុះដំបូ`;

  assert.equal(hasNonKhmerWords(userCorruptedSnippet), true);
  const detectedBefore = extractNonKhmerWords(userCorruptedSnippet);
  assert.ok(detectedBefore.length >= 3, `Expected at least 3 corrupted tokens detected, got ${JSON.stringify(detectedBefore)}`);

  const repaired = fixKhmerSpellingAndForeignText(userCorruptedSnippet, {
    removeOrTransliterateAllForeign: true,
    preserveTags: true,
  });

  assert.ok(
    repaired.cleanedText.includes('គេបាន ដាក់គំនិតនោះទៅក្នុងរន្ធដ៏អស់សង្ឃឹម'),
    `Expected គេបាន ដាក់គំនិតនោះទៅក្នុងរន្ធដ៏អស់សង្ឃឹម in: ${repaired.cleanedText}`
  );
  assert.ok(
    repaired.cleanedText.includes('កសាង'),
    `Expected កសាង in: ${repaired.cleanedText}`
  );
  assert.ok(
    repaired.cleanedText.includes('ដ៏គ្រោតគ្រាតដុះដំបូង'),
    `Expected ដ៏គ្រោតគ្រាតដុះដំបូង in: ${repaired.cleanedText}`
  );
  assert.equal(hasNonKhmerWords(repaired.cleanedText), false);
  assert.equal(extractNonKhmerWords(repaired.cleanedText).length, 0);

  const diffs = computeKhmerCorrectionDiffs(userCorruptedSnippet, repaired.cleanedText);
  assert.ok(diffs.length >= 3, `Expected >= 3 diff items, got: ${JSON.stringify(diffs)}`);
  assert.ok(
    diffs.some((d) => d.wrongText.includes('διοាក់') && d.fixedText.includes('ដាក់')),
    `Expected diff for διοាក់ -> ដាក់, got: ${JSON.stringify(diffs)}`
  );
  assert.ok(
    diffs.some((d) => d.wrongText === 'তরwសាង' && d.fixedText === 'កសាង'),
    `Expected diff for তরwសាង -> កសាង, got: ${JSON.stringify(diffs)}`
  );
  assert.ok(
    diffs.some((d) => d.wrongText === 'ដ៏ကြမ်းដុះដំបូ' && d.fixedText === 'ដ៏គ្រោតគ្រាតដុះដំបូង'),
    `Expected diff for ដ៏ကြမ်းដុះដំបូ -> ដ៏គ្រោតគ្រាតដុះដំបូង, got: ${JSON.stringify(diffs)}`
  );
});

test('convertAllNumbersToKhmerWords converts Arabic and Khmer numerals into spoken Khmer words while preserving tags', () => {
  const input = `[P1] គាត់មានអាយុ ២៥ ឆ្នាំ និងមានកងទ័ព 100 នាក់ ហើយមានមាស 1,500 ដុំ និងថាមពល 99.5%។`;
  const converted = convertAllNumbersToKhmerWords(input, { preserveTags: true });

  assert.ok(converted.convertedCount >= 4);
  assert.ok(converted.text.includes('[P1]'), 'Should preserve [P1] tag');
  assert.ok(converted.text.includes('ម្ភៃប្រាំ'), `Expected ម្ភៃប្រាំ in: ${converted.text}`);
  assert.ok(converted.text.includes('មួយរយ'), `Expected មួយរយ in: ${converted.text}`);
  assert.ok(converted.text.includes('មួយពាន់ប្រាំរយ'), `Expected មួយពាន់ប្រាំរយ in: ${converted.text}`);
  assert.ok(converted.text.includes('កៅសិបប្រាំបួនចុចប្រាំភាគរយ'), `Expected កៅសិបប្រាំបួនចុចប្រាំភាគរយ in: ${converted.text}`);
  // Outside of [P1], no digits should remain
  const withoutTags = converted.text.replace(/\[P\d+\]/g, '');
  assert.ok(!/[0-9០-៩]/.test(withoutTags), `Expected no digits remaining, got: ${withoutTags}`);
});

test('fixExtraVowelsAndWeirdKhmerClusters removes stacked vowels and orphan signs', () => {
  const corrupted = 'កាាារប្រយុទ្ធគ្នាាា ដើើើម្បីីី ា ្ ំ សម្រេចជោគជ័យ';
  const cleaned = fixExtraVowelsAndWeirdKhmerClusters(corrupted);
  assert.ok(cleaned.fixesCount > 0);
  assert.equal(cleaned.text.replace(/\s+/g, ' '), 'ការប្រយុទ្ធគ្នា ដើម្បី សម្រេចជោគជ័យ');
});

test('never produces (លុបចោល) or deletes valid Khmer clauses or foreign character names', () => {
  const paragraphWithNames = `आरन សួរថា តើនាងពិតជាមានអារម្មណ៍ស្រួលចិត្តមែនឬដែលត្រូវរស់នៅជាមួយមនុស្សដែលស្ទើរតែបញ្ជូននាង ទៅកាន់ពិភពលោកក្រោយនោះ។\nប្លូសសម ស្តីបន្ទោសគាត់ដែលនាំយកព្រះនៃសេចក្តីវិនាសមកផ្ទះដូចជាសត្វចិញ្ចឹមវង្វេង។\nនាងបានផ្តល់ការលួងលោមដល់គាត់ ដោយទទួលស្គាល់ថាទស្សនៈដ៏រឹងត្អឹងរបស់នាងផ្ទាល់អំពីល្អ និងអាក្រក់បានផ្លាស់ប្តូរទាំងស្រុង។`;

  const result = fixKhmerSpellingAndForeignText(paragraphWithNames, {
    removeOrTransliterateAllForeign: true,
    preserveTags: true,
  });

  // 1. All Khmer story clauses are preserved 100% intact with Chuon Nath dictionary spelling (ស្ដីបន្ទោស, ផ្លាស់ប្ដូរ)
  assert.ok(result.cleanedText.includes('តើនាងពិតជាមានអារម្មណ៍ស្រួលចិត្តមែនឬ'));
  assert.ok(result.cleanedText.includes('ប្លូសសម ស្ដីបន្ទោសគាត់'));
  assert.ok(result.cleanedText.includes('និងអាក្រក់បានផ្លាស់ប្ដូរទាំងស្រុង'));

  // 2. Hindi name आरन was transliterated to Khmer អារន (never deleted into blank space!)
  assert.ok(result.cleanedText.includes('អារន សួរថា'), `Expected អារន សួរថា in: ${result.cleanedText}`);

  // 3. Even if afterText has fewer newlines (merged lines), computeKhmerCorrectionDiffs NEVER produces '(លុបចោល)'
  const mergedSingleLine = result.cleanedText.replace(/\n+/g, ' ');
  const diffs = computeKhmerCorrectionDiffs(paragraphWithNames, mergedSingleLine);

  assert.ok(
    !diffs.some((d) => d.fixedText === '(លុបចោល)' || !d.fixedText.trim()),
    `Expected zero (លុបចោល) items, got: ${JSON.stringify(diffs)}`
  );
  assert.ok(
    diffs.some((d) => d.wrongText === 'आरन' && d.fixedText === 'អារន'),
    `Expected exact repair आरन -> អារន, got: ${JSON.stringify(diffs)}`
  );
});

test('getPageParagraphs splits unpunctuated run-on transcript into manageable <=950 char paragraphs and semantic English words are translated meaningfully', () => {
  const unpunctuatedTranscript =
    'Our village has no precedent of women asking for a divorce that wont do at all if you get a divorce people in the village will just divorce whenever things get rough that simply wont do we cant set this kind of example '.repeat(
      18
    );
  assert.ok(unpunctuatedTranscript.length > 3500);

  const paragraphs = getPageParagraphs(unpunctuatedTranscript);
  assert.ok(paragraphs.length >= 4, `Expected >= 4 paragraphs, got ${paragraphs.length}`);
  for (const p of paragraphs) {
    assert.ok(p.length <= 950, `Expected paragraph <= 950 chars, got ${p.length}`);
  }

  const sampleClean = fixKhmerSpellingAndForeignText('នៅក្នុង village នោះ women សុំ divorce', {
    removeOrTransliterateAllForeign: true,
    preserveTags: true,
  });
  assert.ok(sampleClean.cleanedText.includes('ភូមិ'), `Expected ភូមិ in ${sampleClean.cleanedText}`);
  assert.ok(sampleClean.cleanedText.includes('មនុស្សស្រី'), `Expected មនុស្សស្រី in ${sampleClean.cleanedText}`);
  assert.ok(sampleClean.cleanedText.includes('លែងលះ'), `Expected លែងលះ in ${sampleClean.cleanedText}`);
});

test('normalizeSourceTextBeforeTranslation fixes missing English apostrophes/possessives and prevents shifter+vowel ៊អី corruption', async () => {
  const { normalizeSourceTextBeforeTranslation } = await import('./khmerCleaner');
  const rawTranscript =
    'That wont do at all if youd agree to my divorce I reckon that Little Zhuangzhuang is my husbands child anyway Ill warn my nephew to treat you better They say its Xiaoxius fourth younger brother';
  const normalized = normalizeSourceTextBeforeTranslation(rawTranscript);
  assert.ok(normalized.includes("won't"), `Expected won't in ${normalized}`);
  assert.ok(normalized.includes("you'd"), `Expected you'd in ${normalized}`);
  assert.ok(normalized.includes("husband's child"), `Expected husband's child in ${normalized}`);
  assert.ok(normalized.includes("I'll"), `Expected I'll in ${normalized}`);
  assert.ok(normalized.includes("it's"), `Expected it's in ${normalized}`);
  assert.ok(normalized.includes("Xiaoxiu's fourth"), `Expected Xiaoxiu's fourth in ${normalized}`);

  // Verify shifter+vowel ៊អី is repaired to ៊ី and Chuon Nath dictionary words are enforced
  const sampleWithCorruptedCluster =
    'សៀវស៊អីវស និង រ៊អីលលី បានទៅកំសាន្ត និងជំរាបសួរសំបូរបែប ផ្តល់កំដៅ';
  const cleaned = fixKhmerSpellingAndForeignText(sampleWithCorruptedCluster, {
    removeOrTransliterateAllForeign: true,
    preserveTags: true,
  });
  assert.ok(!cleaned.cleanedText.includes('៊អី'), `Expected no ៊អី in: ${cleaned.cleanedText}`);
  assert.ok(!cleaned.cleanedText.includes('៉អី'), `Expected no ៉អី in: ${cleaned.cleanedText}`);
  assert.ok(cleaned.cleanedText.includes('កម្សាន្ត'), `Expected Chuon Nath កម្សាន្ត in: ${cleaned.cleanedText}`);
  assert.ok(cleaned.cleanedText.includes('ជម្រាបសួរ'), `Expected Chuon Nath ជម្រាបសួរ in: ${cleaned.cleanedText}`);
  assert.ok(cleaned.cleanedText.includes('សម្បូរបែប'), `Expected Chuon Nath សម្បូរបែប in: ${cleaned.cleanedText}`);
  assert.ok(cleaned.cleanedText.includes('ផ្ដល់'), `Expected Chuon Nath ផ្ដល់ in: ${cleaned.cleanedText}`);
  assert.ok(cleaned.cleanedText.includes('កម្ដៅ'), `Expected Chuon Nath កម្ដៅ in: ${cleaned.cleanedText}`);
});

test('strips scraped Cambodian news hallucinations (លី យ៉ុង ផាត់ / Cambodia News) and joins word-spaced Khmer sentences naturally', () => {
  const userReportedCorrupted = `អ្នក នឹង បាត់ បង់ ក្បាល របស់ អ្នក ទេ ប៉ុន្តែកំណត់ត្រារដ្ឋាភិបាលដោយសន្តិវិធីរបស់អ្នកក្នុងរយៈពេលប៉ុន្មានឆ្នាំចុងក្រោយនេះ ខ្ញុំ នឹង រាយការណ៍ ពាក្យ មួយ ទៅ ព្រះ មហាក្សត្រ របស់ ព្រះអង្គ។ ខ្ញុំ នឹង រាយការណ៍ ពាក្យ មួយ ទៅ ព្រះ មហាក្សត្រ របស់ ព្រះអង្គ។ អី អ្នកក្រោមបង្គាប់របស់អ្នកយល់។ បងប្រុសតូចរបស់ខ្ញុំ ហ៊ឺ? បងប្រុសដ៏ល្អណាស់។ បងប្រុសទីពីរនេះត្រូវតែជាមិត្តរួមថ្នាក់របស់អ្នក ជៀង អីន? អ៊ីហ, នេះគឺជាបងប្រុស ជៀង។ ភោជនីយដ្ឋាន ថ្មី មួយ ឈ្មោះ ថា ហួនសី ផ្ទះ ទើប តែ បើក នៅ ក្នុង ទីក្រុង។ ខ្ញុំ នឹង នាំ អ្នក រាល់ គ្នា ទៅ សាកល្បង ត្រី របស់ អ្នក រាល់ គ្នា។ វា ជា រឿងរ៉ាវ មួយ។ អ្នកទទួលភ្ញៀវ សូមឱ្យយើងមានបន្ទប់ឯកជនដ៏ស្រស់ស្អាតមួយ។ ដូច្នេះសូមអភ័យទោសលោកគ្រូ សុ វ័យក្មេង។ យើង មាន សិស្ស ជា ច្រើន នៅ ក្នុង ទីក្រុង សម្រាប់ ការ ប្រឡង បន្ទប់ ឯកជន ទាំង អស់ ពេញ។ តើ អ្នក នៅ ក្នុង បន្ទប់ ស្នាក់ នៅ ខាង មុខ នេះ ដែរ ឬ ទេ? ធំ បងប្អូនប្រុស សុ, ដោយ សារ តែ យើង បាន មក ដល់ ទី នេះ តុ នៅ ខាង មុខ ហាង នេះ មើល ទៅ ស្រស់ ស្អាត ណាស់។ ឯងនិយាយអីនិយាយទៅ។ តើ អ្នក ស្តាប់ ទេ? នាយក វិទ្យាល័យ លី យ៉ុង ផាត់ រៀបចំ ការប្រកួត ដណ្តើម ខ្សែក្រវាត់ ស្រា បៀរ អាន់ ឆ័ រ |កាមបូដីអា នេវស | ខមឺ នេវស ពត៌មានខ្មែរ នាយក វិទ្យាល័យ លី យ៉ុង ផាត់ រៀបចំ ការប្រកួត ដណ្តើម ខ្សែក្រវាត់ ស្រា បៀរ អាន់ ឆ័ រ |កាមបូដីអា នេវស | ខមឺ នេវស ពត៌មានខ្មែរ នាយក វិទ្យាល័យ`;

  const cleaned = fixKhmerSpellingAndForeignText(userReportedCorrupted, {
    removeOrTransliterateAllForeign: true,
    preserveTags: true,
  });

  // 1. News hallucination completely removed
  assert.ok(!cleaned.cleanedText.includes('លី យ៉ុង ផាត់'), `Expected no លី យ៉ុង ផាត់ in: ${cleaned.cleanedText}`);
  assert.ok(!cleaned.cleanedText.includes('កាមបូដីអា'), `Expected no កាមបូដីអា in: ${cleaned.cleanedText}`);
  assert.ok(!cleaned.cleanedText.includes('ស្រាបៀរ'), `Expected no ស្រាបៀរ in: ${cleaned.cleanedText}`);
  assert.ok(!cleaned.cleanedText.includes('នាយក វិទ្យាល័យ'), `Expected no នាយក វិទ្យាល័យ in: ${cleaned.cleanedText}`);

  // 2. Word-spaced Khmer sentences joined naturally
  assert.ok(
    cleaned.cleanedText.includes('អ្នកនឹងមិនបាត់បង់ក្បាលរបស់អ្នកទេ'),
    `Expected joined អ្នកនឹងមិនបាត់បង់ក្បាលរបស់អ្នកទេ in: ${cleaned.cleanedText}`
  );
  assert.ok(
    cleaned.cleanedText.includes('ខ្ញុំនឹងរាយការណ៍ពាក្យមួយទៅព្រះមហាក្សត្ររបស់ព្រះអង្គ។'),
    `Expected joined ខ្ញុំនឹងរាយការណ៍ពាក្យមួយទៅព្រះមហាក្សត្ររបស់ព្រះអង្គ។ in: ${cleaned.cleanedText}`
  );

  // 3. Idioms & Honorifics fixed
  assert.ok(cleaned.cleanedText.includes('ប្អូនប្រុសតូចរបស់ខ្ញុំ'), `Expected ប្អូនប្រុសតូចរបស់ខ្ញុំ in: ${cleaned.cleanedText}`);
  assert.ok(cleaned.cleanedText.includes('អ្នកប្រុសតូច ស៊ូ'), `Expected អ្នកប្រុសតូច ស៊ូ in: ${cleaned.cleanedText}`);
  assert.ok(cleaned.cleanedText.includes('បងប្រុសធំ ស៊ូ'), `Expected បងប្រុសធំ ស៊ូ in: ${cleaned.cleanedText}`);
  assert.ok(cleaned.cleanedText.includes('ហាងហួនស៊ី'), `Expected ហាងហួនស៊ី in: ${cleaned.cleanedText}`);
  assert.ok(cleaned.cleanedText.includes('តើអ្នកស្ដាប់ទេ?'), `Expected Chuon Nath តើអ្នកស្ដាប់ទេ? in: ${cleaned.cleanedText}`);
});

test('repairs កលាសស / កលាបសស and translates leftover English class / clubs / talents semantically into pure Chuon Nath Khmer', () => {
  const corruptedPhonetic = 'ដែលជាទេពកោសល្យកំពូលក្នុង កលាសស មួយ? កលាបសស';
  const repaired = fixKhmerSpellingAndForeignText(corruptedPhonetic, {
    removeOrTransliterateAllForeign: true,
    preserveTags: true,
  });
  assert.ok(!repaired.cleanedText.includes('កលាសស'), `Expected no កលាសស in: ${repaired.cleanedText}`);
  assert.ok(!repaired.cleanedText.includes('កលាបសស'), `Expected no កលាបសស in: ${repaired.cleanedText}`);
  assert.ok(
    repaired.cleanedText.includes('ដែលជាទេពកោសល្យកំពូលក្នុងថ្នាក់រៀនមួយ?'),
    `Expected ដែលជាទេពកោសល្យកំពូលក្នុងថ្នាក់រៀនមួយ? in: ${repaired.cleanedText}`
  );
  assert.ok(repaired.cleanedText.includes('ក្លឹប'), `Expected ក្លឹប in: ${repaired.cleanedText}`);

  const rawEnglishMix = 'ដែលជា top talent ក្នុង class មួយ? clubs និង schools';
  const translatedMix = fixKhmerSpellingAndForeignText(rawEnglishMix, {
    removeOrTransliterateAllForeign: true,
    preserveTags: true,
  });
  assert.ok(!translatedMix.cleanedText.includes('កលាសស'), `Expected no កលាសស in: ${translatedMix.cleanedText}`);
  assert.ok(!translatedMix.cleanedText.includes('កលាបសស'), `Expected no កលាបសស in: ${translatedMix.cleanedText}`);
  assert.ok(translatedMix.cleanedText.includes('ទេពកោសល្យកំពូល'), `Expected ទេពកោសល្យកំពូល in: ${translatedMix.cleanedText}`);
  assert.ok(translatedMix.cleanedText.includes('ថ្នាក់រៀន'), `Expected ថ្នាក់រៀន in: ${translatedMix.cleanedText}`);
  assert.ok(translatedMix.cleanedText.includes('ក្លឹប'), `Expected ក្លឹប in: ${translatedMix.cleanedText}`);
  assert.ok(translatedMix.cleanedText.includes('សាលារៀន'), `Expected សាលារៀន in: ${translatedMix.cleanedText}`);
});

test('evaluatePageTranslationCompleteness and getUntranslatedBlocksInBatch prevent partial page skipping and identify exact missing blocks', () => {
  const srtSource = [
    '[SRT_1 | 00:00:01,000 --> 00:00:03,000]\nFirst subtitle line here.',
    '[SRT_2 | 00:00:03,500 --> 00:00:05,000]\nSecond subtitle line here.',
    '[SRT_3 | 00:00:05,500 --> 00:00:07,000]\nThird subtitle line here.',
    '[SRT_4 | 00:00:07,500 --> 00:00:09,000]\nFourth subtitle line here.',
    '[SRT_5 | 00:00:09,500 --> 00:00:11,000]\nFifth subtitle line here.',
  ].join('\n\n');

  const partialSrtTranslated = [
    '[SRT_1 | 00:00:01,000 --> 00:00:03,000]\nបន្ទាត់ចំណងជើងទីមួយនៅទីនេះ។',
    '[SRT_2 | 00:00:03,500 --> 00:00:05,000]\nបន្ទាត់ចំណងជើងទីពីរនៅទីនេះ។',
  ].join('\n\n');

  // Partial SRT (only 2 out of 5 cues translated) MUST NOT be marked complete!
  const partialCheck = evaluatePageTranslationCompleteness(
    { originalText: srtSource, charCount: srtSource.length, isSrtChunk: true },
    partialSrtTranslated
  );
  assert.equal(partialCheck.isComplete, false, 'Partial SRT page must not be marked complete');
  assert.equal(partialCheck.translatedBlocks, 2);
  assert.equal(partialCheck.totalBlocks, 5);

  const missingSrt = getUntranslatedBlocksInBatch(srtSource, partialSrtTranslated, true, false);
  assert.equal(missingSrt.length, 3);
  assert.deepEqual(
    missingSrt.map((b) => b.key),
    ['SRT_3', 'SRT_4', 'SRT_5']
  );

  const fullSrtTranslated = [
    partialSrtTranslated,
    '[SRT_3 | 00:00:05,500 --> 00:00:07,000]\nបន្ទាត់ចំណងជើងទីបីនៅទីនេះ។',
    '[SRT_4 | 00:00:07,500 --> 00:00:09,000]\nបន្ទាត់ចំណងជើងទីបួននៅទីនេះ។',
    '[SRT_5 | 00:00:09,500 --> 00:00:11,000]\nបន្ទាត់ចំណងជើងទីប្រាំនៅទីនេះ។',
  ].join('\n\n');

  const fullCheck = evaluatePageTranslationCompleteness(
    { originalText: srtSource, charCount: srtSource.length, isSrtChunk: true },
    fullSrtTranslated
  );
  assert.equal(fullCheck.isComplete, true, 'Full SRT page with all 5 cues must be marked complete');
  assert.equal(getUntranslatedBlocksInBatch(srtSource, fullSrtTranslated, true, false).length, 0);

  // Deduplication replaces cut-off block with complete block
  const duplicatedStory =
    '[P1]\nកថាខណ្ឌទីមួយពេញលេញ។\n\n[P2]\nកថាខណ្ឌកាត់\n\n[P2]\nកថាខណ្ឌទីពីរពេញលេញទាំងអស់នៅទីនេះ។\n\n[P3]\nកថាខណ្ឌទីបីពេញលេញ។';
  const deduped = deduplicateTranslatedBlocks(duplicatedStory, false);
  assert.ok(deduped.includes('កថាខណ្ឌទីពីរពេញលេញទាំងអស់នៅទីនេះ។'));
  assert.ok(!deduped.includes('កថាខណ្ឌកាត់\n'));
  assert.equal((deduped.match(/\[P2\]/g) || []).length, 1);
});

test('parseSrt renumbers skipped sequence numbers, splitSrtIntoPages chunks 12,000-13,000 chars per page, formatPagesAsBracketedSingleParagraph outputs pure continuous Khmer with zero [1]..[500] line numbers, and scanned names + Chuon Nath orthography are strictly enforced', async () => {
  const { parseSrt, formatCuesAsBracketedSingleParagraph } = await import('./srtParser');
  const { splitSrtIntoPages, formatPagesAsBracketedSingleParagraph } = await import('./chunker');

  // 1. Test skipped SRT sequence numbers (e.g. 1, 5, 9, 15) -> must become 1, 2, 3, 4 internally
  const rawGappedSrt = [
    '1\n00:00:01,000 --> 00:00:03,000\nFirst line with Origin Energy',
    '5\n00:00:04,000 --> 00:00:06,000\nSecond line with Aura',
    '9\n00:00:07,000 --> 00:00:09,000\nThird line with Star Knight',
    '15\n00:00:10,000 --> 00:00:12,000\nFourth line with Magic Swordsman',
  ].join('\n\n');

  const parsedCues = parseSrt(rawGappedSrt);
  assert.equal(parsedCues.length, 4);
  assert.deepEqual(
    parsedCues.map((c) => c.id),
    [1, 2, 3, 4]
  );

  // 2. Test 12,000-13,000 character per page chunking for SRT cues
  const longCues = Array.from({ length: 300 }, (_, idx) => ({
    id: idx + 1,
    startTime: '00:00:01,000',
    endTime: '00:00:02,000',
    timecode: '00:00:01,000 --> 00:00:02,000',
    originalText: `Subtitle cue number ${idx + 1} with approximately one hundred characters of detailed dramatic dialogue text for testing page splitting.`,
    translatedText: `[${idx + 1}] អត្ថបទបកប្រែជួរទី${toKhmerNumerals(idx + 1)}។`,
  }));

  const srtPages = splitSrtIntoPages(longCues, { targetChars: 12500 });
  assert.ok(srtPages.length >= 2, '300 cues (~36,000 chars) must split into multiple 12,000-13,000 char pages');
  assert.ok(
    srtPages[0].charCount >= 12000 && srtPages[0].charCount <= 13200,
    `Page 1 charCount should be between 12,000 and 13,000 chars, got ${srtPages[0].charCount}`
  );

  // 3. Test scanned Entity Bible names (including partial proper-noun tokens), Chuon Nath spelling, Thai script removal, and zero parentheses
  const scannedGlossary = [
    { originalName: 'Commander Valerius', khmerName: 'មេបញ្ជាការវ៉ាលេរៀស' },
    { originalName: 'Shadow Sect', khmerName: 'និកាយស្រមោល' },
    { originalName: 'Origin Energy', khmerName: 'ថាមពលដើមកំណើត' },
  ];
  const rawDirtyKhmer =
    'Valerius នៃ Shadow Sect បានប្រើ Origin Energy និង ថាមពលដើមกำเนิด ព្រមទាំង អอร៉ា (Aura) របស់ អביר (Knight) ដើម្បីទទួល อำนาจ និង สำเร็จ ការ ดำเนิน បាតុភូតដ៏អស្ចារ្យ [cite: 12] [source]';
  const cleanedDirty = fixKhmerSpellingAndForeignText(rawDirtyKhmer, {
    glossary: scannedGlossary,
    removeOrTransliterateAllForeign: true,
    preserveTags: false,
  }).cleanedText;

  assert.ok(cleanedDirty.includes('វ៉ាលេរៀស'), `Expected scanned character name វ៉ាលេរៀស in ${cleanedDirty}`);
  assert.ok(cleanedDirty.includes('និកាយស្រមោល'), `Expected scanned location name និកាយស្រមោល in ${cleanedDirty}`);
  assert.ok(cleanedDirty.includes('ថាមពលដើមកំណើត'), `Expected scanned term ថាមពលដើមកំណើត in ${cleanedDirty}`);
  assert.ok(cleanedDirty.includes('អូរ៉ា'), `Expected អូរ៉ា in ${cleanedDirty}`);
  assert.ok(cleanedDirty.includes('អស្សឫទ្ធិ'), `Expected អស្សឫទ្ធិ in ${cleanedDirty}`);
  assert.ok(cleanedDirty.includes('អំណាច'), `Expected អំណាច in ${cleanedDirty}`);
  assert.ok(cleanedDirty.includes('សម្រេច'), `Expected សម្រេច in ${cleanedDirty}`);
  assert.ok(cleanedDirty.includes('ដំណើរ'), `Expected ដំណើរ in ${cleanedDirty}`);
  assert.ok(!/[\u0E00-\u0E7F]/.test(cleanedDirty), `Expected zero Thai chars in ${cleanedDirty}`);
  assert.ok(!/[()（）]/.test(cleanedDirty), `Expected zero parentheses in ${cleanedDirty}`);

  // 4. Test that formatPagesAsBracketedSingleParagraph and formatCuesAsBracketedSingleParagraph strip [1], [2], [500] line numbers completely
  const formattedSingleParagraph = formatPagesAsBracketedSingleParagraph(srtPages);
  assert.ok(
    formattedSingleParagraph.startsWith('អត្ថបទបកប្រែជួរទី១។ អត្ថបទបកប្រែជួរទី២។'),
    `Expected output to start with pure Khmer text and ZERO [1] [2] line numbers, got: ${formattedSingleParagraph.slice(0, 120)}`
  );
  assert.ok(
    !/\[\d+\]/.test(formattedSingleParagraph),
    'Output must contain ZERO [1], [2], [500] bracketed line numbers'
  );
  assert.ok(!formattedSingleParagraph.includes('\n'), 'Single paragraph output must not contain line breaks');
  assert.ok(!formattedSingleParagraph.includes('-->'), 'Single paragraph output must not contain timestamps');
  assert.equal(/\[\d+\]/.test(formatCuesAsBracketedSingleParagraph(srtPages[0].srtCues!)), false);
});

test('fixes missing vowels and missing subscripts (ដ៏ឈ្ងុយឆងាញ់របស់ខ្ញុំ -> ដ៏ឈ្ងុយឆ្ងាញ់របស់ខ្ញុំ, ឆងាញ់ -> ឆ្ងាញ់, ឆងល់, សងប់សងាត់, ផអែម, សលាប់, ភលេច) strictly per Chuon Nath dictionary', () => {
  const missingVowelSubscriptSample =
    'ម្ហូបដ៏ឈ្ងុយឆងាញ់របស់ខ្ញុំ មានរសជាតិផអែម និងឈ្ងុយឆងាញ់ពិសាណាស់។ គាត់ឆងល់ថាមិចក៏សងប់សងាត់ម្ល៉េះ មិនដឹងជាសលាប់ ឬភលេចដរទៅណាទេ។';

  const fixed = fixKhmerSpellingAndForeignText(missingVowelSubscriptSample, {
    removeOrTransliterateAllForeign: true,
    preserveTags: true,
  });

  assert.ok(
    fixed.cleanedText.includes('ដ៏ឈ្ងុយឆ្ងាញ់របស់ខ្ញុំ'),
    `Expected ដ៏ឈ្ងុយឆ្ងាញ់របស់ខ្ញុំ, got: ${fixed.cleanedText}`
  );
  assert.ok(
    fixed.cleanedText.includes('ឈ្ងុយឆ្ងាញ់ពិសាណាស់'),
    `Expected ឈ្ងុយឆ្ងាញ់ពិសាណាស់, got: ${fixed.cleanedText}`
  );
  assert.ok(
    fixed.cleanedText.includes('ផ្អែម'),
    `Expected ផ្អែម, got: ${fixed.cleanedText}`
  );
  assert.ok(
    fixed.cleanedText.includes('ឆ្ងល់'),
    `Expected ឆ្ងល់, got: ${fixed.cleanedText}`
  );
  assert.ok(
    fixed.cleanedText.includes('ស្ងប់ស្ងាត់'),
    `Expected ស្ងប់ស្ងាត់, got: ${fixed.cleanedText}`
  );
  assert.ok(
    fixed.cleanedText.includes('ស្លាប់'),
    `Expected ស្លាប់, got: ${fixed.cleanedText}`
  );
  assert.ok(
    fixed.cleanedText.includes('ភ្លេច'),
    `Expected ភ្លេច, got: ${fixed.cleanedText}`
  );
  assert.ok(
    fixed.cleanedText.includes('ដើរទៅ'),
    `Expected ដើរទៅ, got: ${fixed.cleanedText}`
  );
  assert.ok(!fixed.cleanedText.includes('ឆងាញ់'), 'Should have zero ឆងាញ់ remaining');
  assert.ok(!fixed.cleanedText.includes('ផអែម'), 'Should have zero ផអែម remaining');
  assert.ok(!fixed.cleanedText.includes('សងប់សងាត់'), 'Should have zero សងប់សងាត់ remaining');
  assert.ok(!fixed.cleanedText.includes('សលាប់'), 'Should have zero សលាប់ remaining');
  assert.ok(!fixed.cleanedText.includes('ភលេច'), 'Should have zero ភលេច remaining');

  // Verify composite vowel normalization e.g. េើ -> ើ
  const compositeVowelTest = fixExtraVowelsAndWeirdKhmerClusters('ចម្រើន រស់រវើក');
  assert.ok(compositeVowelTest.text.includes('រស់រវើក'));
});




