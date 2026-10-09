import { authenticate, dbRequest } from "@/lib/supabase-rest";

type Row = Record<string, unknown>;
type ApiTranslation = { language?: { code?: unknown }; word?: unknown };
type ApiSense = { definition?: unknown; examples?: unknown; translations?: ApiTranslation[] };
type ApiPronunciation = { type?: unknown; text?: unknown; tags?: unknown };
type ApiEntry = { language?: { code?: unknown }; partOfSpeech?: unknown; pronunciations?: ApiPronunciation[]; senses?: ApiSense[] };
type DictionaryPayload = { entries?: ApiEntry[]; source?: { url?: unknown; license?: { name?: unknown; url?: unknown } } };

const DICTIONARY_LABEL = "Free Dictionary API · Wiktionary";
const LICENSE_FALLBACK = "CC BY-SA 4.0";
const TRANSLATION_LABEL = "MyMemory machine translation";

function clean(value: unknown, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
function unique(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}
function hasChinese(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}
function containsWholeWord(sentence: string, word: string) {
  const escaped = word.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + escaped + "\\b", "i").test(sentence);
}
function usableSentence(value: unknown, word: string) {
  const sentence = clean(value, 260);
  return sentence.length >= 12 && containsWholeWord(sentence, word) ? sentence : "";
}
function posCode(value: unknown) {
  const pos = clean(value, 50).toLowerCase();
  if (pos === "noun" || pos === "n") return "n.";
  if (pos === "verb" || pos === "v") return "v.";
  if (pos === "adjective" || pos === "adj") return "adj.";
  if (pos === "adverb" || pos === "adv") return "adv.";
  if (pos === "preposition" || pos === "prep") return "prep.";
  if (pos === "pronoun" || pos === "pron") return "pron.";
  if (pos === "conjunction" || pos === "conj") return "conj.";
  if (pos === "interjection" || pos === "int") return "int.";
  return pos;
}
function chineseTranslation(sense: ApiSense) {
  const translations = Array.isArray(sense.translations) ? sense.translations : [];
  const hit = translations.find((item) => {
    const code = clean(item.language?.code, 10).toLowerCase();
    return code === "zh" || code.startsWith("zh-");
  });
  const value = clean(hit?.word, 160);
  return hasChinese(value) ? value : "";
}
function decodeEntities(value: string) {
  return value.replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
async function translateToChinese(text: string) {
  if (!text) return "";
  try {
    const response = await fetch(
      "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=en%7Czh-CN",
      { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) return "";
    const payload = (await response.json()) as { responseData?: { translatedText?: unknown } };
    const translation = decodeEntities(String(payload.responseData?.translatedText || "")).replace(/\s+/g, " ").trim();
    return hasChinese(translation) ? translation : "";
  } catch {
    return "";
  }
}
function ipaFor(entries: ApiEntry[], dialect: "uk" | "us") {
  const values = entries.flatMap((entry) => Array.isArray(entry.pronunciations) ? entry.pronunciations : [])
    .filter((item) => clean(item.type, 10).toLowerCase() === "ipa")
    .map((item) => ({ text: clean(item.text, 80), tags: (Array.isArray(item.tags) ? item.tags : []).map((tag) => clean(tag, 50).toLowerCase()) }))
    .filter((item) => item.text);
  const matches = (tags: string[]) => dialect === "uk"
    ? tags.some((tag) => /\b(uk|gb|british|received pronunciation|rp)\b/.test(tag))
    : tags.some((tag) => /\b(us|american|general american|ga)\b/.test(tag));
  return values.find((item) => matches(item.tags))?.text || "";
}
async function rows(path: string) {
  return dbRequest<Row[]>(path);
}
async function insert(table: string, body: Row | Row[]) {
  return dbRequest<Row[]>(table, { method: "POST", body, prefer: "return=representation" });
}
async function patch(table: string, filter: string, body: Row) {
  return dbRequest<Row[]>(table + "?" + filter, { method: "PATCH", body, prefer: "return=minimal" });
}

export async function POST(request: Request) {
  try {
    await authenticate(request);
    const body = (await request.json().catch(() => ({}))) as { word?: unknown };
    const word = String(body.word || "").trim().toLowerCase();
    if (!/^[a-z][a-z'-]{0,80}$/.test(word)) return Response.json({ error: "单词格式不正确" }, { status: 400 });

    const words = await rows("vocabulary_words?select=id,phonetic_uk,phonetic_us&normalized_lemma=eq." + encodeURIComponent(word) + "&limit=1");
    if (!words[0]?.id) return Response.json({ error: "该词不在词库中，暂时无法自动补齐" }, { status: 404 });
    const wordRow = words[0];
    const senses = await rows("vocabulary_senses?select=id,part_of_speech,core_meaning,note&word_id=eq." + wordRow.id + "&order=sense_no");
    if (!senses.length) return Response.json({ error: "该词缺少释义记录，暂时无法自动补齐" }, { status: 404 });

    const senseIds = senses.map((item) => String(item.id)).filter(Boolean);
    const senseFilter = "sense_id=in.(" + senseIds.join(",") + ")";
    const [existingCollocations, existingExamples] = await Promise.all([
      rows("word_collocations?select=id,sense_id,content,translation,source_type,source_label&" + senseFilter),
      rows("vocabulary_examples?select=id,sense_id,sentence,translation,source_type,source_label,source_url,verified&" + senseFilter),
    ]);

    let dictionary: DictionaryPayload = {};
    let dictionaryAvailable = false;
    try {
      const response = await fetch("https://freedictionaryapi.com/api/v1/entries/en/" + encodeURIComponent(word) + "?translations=true",
        { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(9000) });
      if (response.ok) {
        dictionary = (await response.json()) as DictionaryPayload;
        dictionaryAvailable = true;
      }
    } catch {
      dictionary = {};
    }

    const englishEntries = (dictionary.entries || []).filter((entry) => clean(entry.language?.code, 10).toLowerCase() === "en");
    const updatedFields: string[] = [];
    const sources: string[] = [];
    const phoneticPatch: Row = {};
    if (!clean(wordRow.phonetic_uk, 80)) {
      const uk = ipaFor(englishEntries, "uk");
      if (uk) phoneticPatch.phonetic_uk = uk;
    }
    if (!clean(wordRow.phonetic_us, 80)) {
      const us = ipaFor(englishEntries, "us");
      if (us) phoneticPatch.phonetic_us = us;
    }
    if (Object.keys(phoneticPatch).length) {
      await patch("vocabulary_words", "id=eq." + wordRow.id, phoneticPatch);
      updatedFields.push("英美音标");
      sources.push(DICTIONARY_LABEL);
    }

    const missingSenseRows = senses.filter((sense) =>
      !clean(sense.core_meaning, 300) || /释义待补充|meaning pending/i.test(clean(sense.core_meaning, 300)),
    );
    const meaningCandidates = missingSenseRows.map((sense) => {
      const match = englishEntries.find((entry) => posCode(entry.partOfSpeech) === posCode(sense.part_of_speech)) || englishEntries[0];
      const apiSense = (match?.senses || []).find((item) => clean(item.definition, 500)) || null;
      return { sense, apiSense, definition: clean(apiSense?.definition, 500) };
    }).filter((item) => item.apiSense && item.definition);

    const translatedMeanings = await Promise.all(meaningCandidates.slice(0, 5).map(async (item) => ({
      ...item,
      meaning: chineseTranslation(item.apiSense!) || await translateToChinese(item.definition),
    })));
    let meaningsAdded = 0;
    for (const item of translatedMeanings) {
      const meaning = clean(item.meaning, 300);
      if (!meaning || !hasChinese(meaning)) continue;
      const matchedEntry = englishEntries.find((entry) => entry.senses?.includes(item.apiSense!));
      const sensePatch: Row = { core_meaning: meaning };
      if (!clean(item.sense.part_of_speech, 40)) sensePatch.part_of_speech = posCode(matchedEntry?.partOfSpeech);
      if (!clean(item.sense.note, 300)) sensePatch.note = "开放词典来源：Wiktionary（社区维护，非权威词典）；中文释义可能为机器翻译，建议核对。";
      await patch("vocabulary_senses", "id=eq." + item.sense.id, sensePatch);
      meaningsAdded++;
    }
    if (meaningsAdded) {
      updatedFields.push("中文释义");
      sources.push(DICTIONARY_LABEL + " / Chinese translations");
    }

    const phrasePool = unique(existingCollocations
      .filter((item) => !clean(item.translation, 160))
      .map((item) => clean(item.content, 120)))
      .filter((phrase) => /^[a-z][a-z' -]{0,119}$/i.test(phrase)).slice(0, 5);
    const phrasesWithTranslation = await Promise.all(phrasePool.map(async (phrase) => ({ phrase, translation: await translateToChinese(phrase) })));
    let collocationsTranslated = 0;
    for (const item of phrasesWithTranslation) {
      if (!item.translation) continue;
      const existing = existingCollocations.find((row) =>
        clean(row.content, 120).toLowerCase() === item.phrase.toLowerCase() && !clean(row.translation, 160),
      );
      if (existing?.id) {
        await patch("word_collocations", "id=eq." + existing.id, {
          translation: item.translation,
          source_label: [clean(existing.source_label, 120), TRANSLATION_LABEL + "（机器翻译，待核对）"].filter(Boolean).join("；"),
        });
        collocationsTranslated++;

      }
    }
    if (collocationsTranslated) {
      updatedFields.push("现有搭配的中文翻译");
      sources.push(TRANSLATION_LABEL + "（机器翻译，待核对）");
    }

    const verifiedExamples = existingExamples.filter((item) => item.verified === true);
    let exampleTranslationAdded = 0;
    let exampleAdded = 0;
    const existingWithoutTranslation = verifiedExamples.find((item) => clean(item.sentence, 260) && !clean(item.translation, 300));
    if (existingWithoutTranslation?.id) {
      const translation = await translateToChinese(clean(existingWithoutTranslation.sentence, 260));
      if (translation) {
        await patch("vocabulary_examples", "id=eq." + existingWithoutTranslation.id, { translation });
        exampleTranslationAdded++;
        updatedFields.push("例句翻译");
        sources.push(TRANSLATION_LABEL);
      }
    } else if (!verifiedExamples.length) {
      const candidate = englishEntries.flatMap((entry) =>
        (entry.senses || []).flatMap((sense) => Array.isArray(sense.examples) ? sense.examples : []),
      ).map((sentence) => usableSentence(sentence, word)).find(Boolean) || "";
      const translation = candidate ? await translateToChinese(candidate) : "";
      if (candidate && translation) {
        const license = clean(dictionary.source?.license?.name, 100) || LICENSE_FALLBACK;
        const sourcePage = clean(dictionary.source?.url, 1000);
        await insert("vocabulary_examples", {
          sense_id: senseIds[0], sentence: candidate, translation, source_type: "dictionary",
          source_label: "开放词典例句（Wiktionary，非六级真题）",
          source_url: /^https:\/\/en\.wiktionary\.org\//i.test(sourcePage) ? sourcePage : null,
          citation_note: "来源：Wiktionary 开放词典（非六级真题）；许可：" + license + "；中文为机器翻译，建议核对。",
          verified: true, rank: 6,
        });
        exampleAdded++;
        updatedFields.push("例句及翻译");
        sources.push("Wiktionary 开放词典（非六级真题） / " + TRANSLATION_LABEL + "（机器翻译，待核对）");
      }
    }

    const refreshedWord = (await rows("vocabulary_words?select=phonetic_uk,phonetic_us&id=eq." + wordRow.id + "&limit=1"))[0] || wordRow;
    const refreshedSenses = await rows("vocabulary_senses?select=id,core_meaning&word_id=eq." + wordRow.id + "&order=sense_no");
    const refreshedSenseIds = refreshedSenses.map((item) => String(item.id)).filter(Boolean);
    const refreshedFilter = "sense_id=in.(" + refreshedSenseIds.join(",") + ")";
    const refreshedCollocations = await rows("word_collocations?select=id,content,translation&" + refreshedFilter);
    const refreshedExamples = await rows("vocabulary_examples?select=id,sentence,translation,verified&" + refreshedFilter);
    const remainingFields: string[] = [];
    if (!clean(refreshedWord.phonetic_uk, 80)) remainingFields.push("英音音标");
    if (!clean(refreshedWord.phonetic_us, 80)) remainingFields.push("美音音标");
    if (refreshedSenses.some((item) => !clean(item.core_meaning, 300) || /释义待补充|meaning pending/i.test(clean(item.core_meaning, 300))))
      remainingFields.push("中文释义");
    if (!refreshedCollocations.length || refreshedCollocations.some((item) => !clean(item.translation, 160)))
      remainingFields.push("搭配或搭配翻译");
    if (!refreshedExamples.some((item) => item.verified === true && clean(item.sentence, 260)))
      remainingFields.push("例句");
    else if (!refreshedExamples.some((item) => item.verified === true && clean(item.translation, 300)))
      remainingFields.push("例句翻译");

    return Response.json({
      ok: true, word, updatedFields: unique(updatedFields), remainingFields, sources: unique(sources),
      dictionaryAvailable, exampleAdded, exampleTranslationAdded, collocationsTranslated,
      note: updatedFields.length
        ? "已更新缺失字段并写入云端。Wiktionary 是开放社区词典，新增例句不是六级真题；机器翻译和搭配翻译均需核对。"
        : "本次没有取得可安全写入的新内容；已有真题例句和用户数据均已保留。",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "公开词典查询或云端更新失败" }, { status: 500 });
  }
}
