import { authenticate, dbRequest } from "@/lib/supabase-rest";

type Row = Record<string, any>;
type Pronunciation = { text?: unknown; tags?: unknown };
type Translation = { language?: { code?: unknown }; word?: unknown };
type Sense = {
  definition?: unknown;
  examples?: unknown;
  translations?: unknown;
  subsenses?: unknown;
};
type Entry = {
  partOfSpeech?: unknown;
  pronunciations?: Pronunciation[];
  senses?: Sense[];
};
type DictionaryPayload = {
  entries?: Entry[];
  source?: { url?: unknown; license?: { name?: unknown; url?: unknown } };
};

const API_LABEL = "Wiktionary（FreeDictionaryAPI.com）";
const LICENSE = "Wiktionary CC BY-SA 4.0；FreeDictionaryAPI.com 提供结构化数据。中文释义/译文由机器翻译生成，待核对。";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

function clean(value: unknown, max = 1000) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function isMissing(value: unknown) {
  const text = clean(value, 500);
  return !text || /待补充|待整理|pending/i.test(text);
}
function flattenSenses(senses: Sense[] = []): Sense[] {
  return senses.flatMap((sense) => [sense, ...flattenSenses(Array.isArray(sense.subsenses) ? sense.subsenses as Sense[] : [])]);
}
function hasWord(sentence: string, word: string) {
  const tokens = sentence.toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) || [];
  return tokens.includes(word.toLowerCase());
}
function collectExamples(entries: Entry[], word: string) {
  return [...new Set(entries.flatMap((entry) => flattenSenses(entry.senses))
    .flatMap((sense) => Array.isArray(sense.examples) ? sense.examples : [])
    .map((value) => clean(value, 260))
    .filter((value) => value.length >= 12 && hasWord(value, word)))].slice(0, 5);
}
function chineseTranslation(sense: Sense) {
  const items = Array.isArray(sense.translations) ? sense.translations as Translation[] : [];
  return items.find((item) => /^zh(?:-|$)/i.test(String(item.language?.code || "")))?.word;
}
async function translateToChinese(value: string) {
  const response = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(value)}&langpair=en%7Czh-CN`,
    { headers: { Accept: "application/json" }, cache: "no-store" },
  );
  if (!response.ok) return "";
  const payload = await response.json() as { responseData?: { translatedText?: unknown } };
  const translated = clean(payload.responseData?.translatedText, 1000)
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return /[\u3400-\u9FFF]/u.test(translated) ? translated : "";
}
function safeIpa(value: unknown) {
  const text = clean(value, 100);
  return text.length <= 80 && /[\/\[\]]/.test(text) ? text : "";
}
function chooseIpa(entries: Entry[], region: "uk" | "us") {
  const tags = region === "uk" ? /uk|british|received pronunciation/i : /us|american/i;
  const candidates = entries.flatMap((entry) => entry.pronunciations || [])
    .filter((item) => Array.isArray(item.tags) && (item.tags as unknown[]).some((tag) => tags.test(String(tag))))
    .map((item) => safeIpa(item.text)).filter(Boolean);
  return candidates[0] || "";
}
function chooseSense(entries: Entry[], preferredPos: string) {
  const all = entries.flatMap((entry) => {
    const pos = clean(entry.partOfSpeech, 40);
    return flattenSenses(entry.senses).map((sense) => ({ sense, pos }));
  });
  return all.find((item) => preferredPos && item.pos.toLowerCase() === preferredPos.toLowerCase())
    || all.find((item) => clean(item.sense.definition, 500))
    || null;
}

export async function POST(request: Request) {
  try {
    await authenticate(request);
  } catch {
    return Response.json({ error: "请先登录" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({})) as { word?: unknown };
    const word = clean(body.word, 81).toLowerCase();
    if (!/^[a-z][a-z'-]{0,80}$/.test(word))
      return Response.json({ error: "单词格式不正确" }, { status: 400 });

    // Oxford's standard API/Sandbox credentials do not by themselves allow us
    // to persist dictionary text. Persist only Wiktionary data, with attribution.
    const response = await fetch(
      `https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(word)}?translations=true`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    if (!response.ok) {
      const status = response.status;
      return Response.json({
        error: status === 404 ? "开放词典暂未收录该词" : status === 429
          ? "开放词典请求达到频率限制，请稍后重试"
          : "开放词典暂时不可用，请稍后重试",
      }, { status: status === 404 ? 404 : status === 429 ? 429 : 502 });
    }
    const dictionary = await response.json() as DictionaryPayload;
    const entries = Array.isArray(dictionary.entries) ? dictionary.entries : [];
    if (!entries.length) return Response.json({ error: "开放词典暂未收录该词" }, { status: 404 });

    const words = await dbRequest<Row[]>(
      `vocabulary_words?select=id,lemma,phonetic_uk,phonetic_us&normalized_lemma=eq.${encodeURIComponent(word)}&limit=1`,
    );
    const wordRow = words[0];
    if (!wordRow?.id) return Response.json({ error: "该词不在 CET-6 词库中" }, { status: 404 });
    const senses = await dbRequest<Row[]>(
      `vocabulary_senses?select=id,part_of_speech,core_meaning,note&word_id=eq.${wordRow.id}&order=sense_no`,
    );
    if (!senses.length) return Response.json({ error: "该词缺少释义记录" }, { status: 404 });

    const updates: string[] = [];
    const sourceNotes: string[] = [];
    const ukIpa = isMissing(wordRow.phonetic_uk) ? chooseIpa(entries, "uk") : "";
    const usIpa = isMissing(wordRow.phonetic_us) ? chooseIpa(entries, "us") : "";
    const ipaFallback = isMissing(wordRow.phonetic_uk) && isMissing(wordRow.phonetic_us)
      ? entries.flatMap((entry) => entry.pronunciations || []).map((item) => safeIpa(item.text)).find(Boolean) || ""
      : "";
    const finalUk = ukIpa || ipaFallback;
    const finalUs = usIpa || ipaFallback;
    if (finalUk || finalUs) {
      const patch: Row = {};
      if (isMissing(wordRow.phonetic_uk) && finalUk) patch.phonetic_uk = finalUk;
      if (isMissing(wordRow.phonetic_us) && finalUs) patch.phonetic_us = finalUs;
      await dbRequest(`vocabulary_words?id=eq.${wordRow.id}`, { method: "PATCH", body: patch, prefer: "return=minimal" });
      updates.push("音标");
      sourceNotes.push(`${API_LABEL} 音标；CC BY-SA 4.0。`);
    }

    const exampleRows = await dbRequest<Row[]>(
      `vocabulary_examples?select=id&sense_id=in.(${senses.map((sense) => sense.id).join(",")})&limit=1`,
    );
    let addedExample = false;
    if (!exampleRows.length) {
      const selected = chooseSense(entries, clean(senses[0].part_of_speech, 40));
      const examples = collectExamples(entries, word);
      const sentence = examples[0] || "";
      if (selected && sentence) {
        const translation = await translateToChinese(sentence);
        const sourceUrl = clean(dictionary.source?.url, 500) || `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
        await dbRequest("vocabulary_examples", {
          method: "POST",
          body: {
            sense_id: senses[0].id,
            sentence,
            translation,
            source_type: "dictionary",
            source_label: API_LABEL,
            source_url: sourceUrl,
            citation_note: LICENSE,
            verified: false,
            rank: 6,
          },
          prefer: "return=minimal",
        });
        addedExample = true;
        updates.push("开放词典例句");
        if (translation) updates.push("例句机器翻译");
      }
    }

    const selected = chooseSense(entries, clean(senses[0].part_of_speech, 40));
    if (selected && isMissing(senses[0].core_meaning)) {
      const definition = clean(selected.sense.definition, 500);
      if (definition) {
        const wiktionaryTranslation = clean(chineseTranslation(selected.sense), 300);
        const meaning = wiktionaryTranslation || await translateToChinese(definition);
        if (meaning) {
          await dbRequest(`vocabulary_senses?id=eq.${senses[0].id}`, {
            method: "PATCH",
            body: { core_meaning: meaning },
            prefer: "return=minimal",
          });
          sourceNotes.push(wiktionaryTranslation
            ? `${API_LABEL} 中文释义；CC BY-SA 4.0，待核对。`
            : `${API_LABEL} 英文释义的机器翻译；待核对。CC BY-SA 4.0。`);
          updates.push("中文释义");
        }
      }
    }

    if (sourceNotes.length) {
      const priorNote = clean(senses[0].note, 1000);
      const attribution = [...new Set(sourceNotes)].join("；");
      if (!priorNote.includes("Wiktionary")) {
        const note = [priorNote, attribution].filter(Boolean).join("；");
        await dbRequest(`vocabulary_senses?id=eq.${senses[0].id}`, {
          method: "PATCH",
          body: { note },
          prefer: "return=minimal",
        });
      }
    }

    // This endpoint deliberately does not fabricate collocations. The source API
    // provides definitions/examples, not a vetted collocation list.
    if (!updates.length) {
      return Response.json({
        ok: true,
        updated: [],
        remaining: ["音标", "中文释义", "搭配", "例句或译文"],
        source: API_LABEL,
        license: "CC BY-SA 4.0",
        note: "本次没有找到可安全补入的缺失字段；搭配不会由语料猜测生成。",
      });
    }
    return Response.json({
      ok: true,
      updated: updates,
      remaining: ["未提供或无法可靠翻译的字段仍待补充", "必记搭配不会由语料猜测生成"],
      source: API_LABEL,
      sourceUrl: clean(dictionary.source?.url, 500) || `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
      license: "CC BY-SA 4.0",
      licenseUrl: LICENSE_URL,
      exampleAdded: addedExample,
      note: "资料来自 Wiktionary，经 FreeDictionaryAPI.com 提供；机器翻译内容待核对。已保留原有词条内容。未找到的字段继续显示待补充。",
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "开放词典自动补全失败",
    }, { status: 500 });
  }
}
