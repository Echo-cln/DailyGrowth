import { authenticate, dbRequest } from "@/lib/supabase-rest";

type Row = Record<string, unknown>;
type DictionarySense = { examples?: unknown };
type DictionaryEntry = { senses?: DictionarySense[] };
type DictionaryPayload = {
  entries?: DictionaryEntry[];
  source?: { url?: unknown; license?: { name?: unknown } };
};
type DatamuseRow = { word?: unknown };

const FREE_DICTIONARY_LABEL = "Free Dictionary API · Wiktionary";
const DATAMUSE_LABEL = "Datamuse · Google Books Ngrams";

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function containsWholeWord(sentence: string, word: string) {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\\\]/g, "\\$&")}\\b`, "i").test(sentence);
}

function usableSentence(value: unknown, word: string) {
  const sentence = String(value || "").replace(/\s+/g, " ").trim();
  return sentence.length >= 12 && sentence.length <= 260 && containsWholeWord(sentence, word) ? sentence : "";
}

type TranslationPayload = { responseData?: { translatedText?: unknown } };

function decodeEntities(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function translateToChinese(sentence: string) {
  const response = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(sentence)}&langpair=en%7Czh-CN`,
    { headers: { Accept: "application/json" }, cache: "no-store" },
  );
  if (!response.ok) return "";
  const payload = (await response.json()) as TranslationPayload;
  const translation = decodeEntities(String(payload.responseData?.translatedText || "")).replace(/\s+/g, " ").trim();
  return /[\u3400-\u9FFF]/u.test(translation) ? translation : "";
}

async function datamusePhrases(word: string) {
  const base = "https://api.datamuse.com/words";
  const [followers, predecessors] = await Promise.all([
    fetch(`${base}?rel_bga=${encodeURIComponent(word)}&max=4`, { cache: "no-store" }),
    fetch(`${base}?rel_bgb=${encodeURIComponent(word)}&max=4`, { cache: "no-store" }),
  ]);
  const toWords = async (response: Response) => response.ok
    ? ((await response.json()) as DatamuseRow[]).map((row) => String(row.word || "").trim())
    : [];
  const [after, before] = await Promise.all([toWords(followers), toWords(predecessors)]);
  const permitted = (value: string) => /^[a-z][a-z' -]{0,80}$/i.test(value) && !value.toLowerCase().includes(word);
  return unique([
    ...after.filter(permitted).map((value) => `${word} ${value}`),
    ...before.filter(permitted).map((value) => `${value} ${word}`),
  ]).slice(0, 3);
}

export async function POST(request: Request) {
  try {
    await authenticate(request);
    const body = (await request.json().catch(() => ({}))) as { word?: unknown };
    const word = String(body.word || "").trim().toLowerCase();
    if (!/^[a-z][a-z'-]{0,80}$/.test(word)) return Response.json({ error: "单词格式不正确" }, { status: 400 });

    const words = await dbRequest<Row[]>(
      `vocabulary_words?select=id&normalized_lemma=eq.${encodeURIComponent(word)}&limit=1`,
    );
    if (!words[0]?.id) return Response.json({ error: "该词不在 CET-6 词库中" }, { status: 404 });
    const senses = await dbRequest<Row[]>(
      `vocabulary_senses?select=id&word_id=eq.${words[0].id}&order=sense_no&limit=1`,
    );
    if (!senses[0]?.id) return Response.json({ error: "该词缺少释义记录" }, { status: 404 });
    const senseId = Number(senses[0].id);

    const dictionaryResponse = await fetch(
      `https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(word)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    const dictionary = dictionaryResponse.ok ? (await dictionaryResponse.json()) as DictionaryPayload : {};
    const examples = unique(
      (dictionary.entries || [])
        .flatMap((entry) => entry.senses || [])
        .flatMap((sense) => Array.isArray(sense.examples) ? sense.examples : [])
        .map((example) => usableSentence(example, word))
        .filter(Boolean),
    );
    const collocations = await datamusePhrases(word);
    const translation = examples[0] ? await translateToChinese(examples[0]) : "";

    if (examples[0] && translation) {
      const exists = await dbRequest<Row[]>(
        `vocabulary_examples?select=id&sense_id=eq.${senseId}&source_label=eq.${encodeURIComponent(FREE_DICTIONARY_LABEL)}&limit=1`,
      );
      if (!exists.length) {
        await dbRequest("vocabulary_examples", {
          method: "POST",
          body: {
            sense_id: senseId,
            sentence: examples[0],
            translation,
            source_type: "dictionary",
            source_label: FREE_DICTIONARY_LABEL,
            source_url: String(dictionary.source?.url || "") || null,
            citation_note: `来源数据许可：${String(dictionary.source?.license?.name || "CC BY-SA 4.0")}`,
            verified: true,
            rank: 6,
          },
          prefer: "return=minimal",
        });
      }
    }

    if (collocations.length) {
      const existing = await dbRequest<Row[]>(
        `word_collocations?select=content&sense_id=eq.${senseId}&source_label=eq.${encodeURIComponent(DATAMUSE_LABEL)}`,
      );
      const known = new Set(existing.map((item) => String(item.content || "").toLowerCase()));
      const rows = collocations.filter((phrase) => !known.has(phrase.toLowerCase())).map((content, index) => ({
        sense_id: senseId, content, translation: "", rank: 30 + index,
        source_type: "dictionary", source_label: DATAMUSE_LABEL, verified: true,
      }));
      if (rows.length) await dbRequest("word_collocations", { method: "POST", body: rows, prefer: "return=minimal" });
    }

    return Response.json({
      ok: true, example: examples[0] || "", collocations,
      source: examples[0] ? FREE_DICTIONARY_LABEL : DATAMUSE_LABEL,
      note: examples[0] && translation
        ? "已补入公开词典例句及中文译文。"
        : examples[0]
          ? "公开词典例句已找到，但免费翻译服务未返回有效中文，本次不会写入例句。"
          : "该词暂无公开词典例句，已补入高频搭配。",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "公开词典查询失败" }, { status: 500 });
  }
}
