/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbRequest } from "@/lib/supabase-rest";

type Row = Record<string, any>;
type CollocationInput = { phrase?: unknown; translation?: unknown; sourceLabel?: unknown; verified?: unknown };
type EnrichmentWord = {
  word?: unknown;
  phoneticUk?: unknown;
  phoneticUs?: unknown;
  phoneticSourceLabel?: unknown;
  example?: {
    sentence?: unknown;
    translation?: unknown;
    sourceLabel?: unknown;
    sourceUrl?: unknown;
    sourceType?: unknown;
  };
  collocations?: CollocationInput[];
};

const trustedSourceHosts = new Set([
  "dictionary.cambridge.org",
  "oxfordlearnersdictionaries.com",
  "www.oxfordlearnersdictionaries.com",
  "ldoceonline.com",
  "www.ldoceonline.com",
  "merriam-webster.com",
  "www.merriam-webster.com",
  "freedictionaryapi.com",
  "en.wiktionary.org",
]);

function clean(value: unknown, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function hasChinese(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function hasWord(sentence: string, word: string) {
  const escaped = word.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + escaped + "\\b", "i").test(sentence);
}

function sourceUrl(value: unknown) {
  const raw = clean(value, 1000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || !trustedSourceHosts.has(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function rows(path: string) {
  return dbRequest<Row[]>(path);
}

async function insert(table: string, body: Row | Row[]) {
  return dbRequest<Row[]>(table, { method: "POST", body, prefer: "return=representation" });
}

export async function POST(request: Request) {
  const configuredKey = process.env.DAILYGLOW_IMPORT_KEY || "";
  if (!configuredKey) return Response.json({ error: "服务器尚未配置 DAILYGLOW_IMPORT_KEY" }, { status: 503 });
  if (request.headers.get("x-dailyglow-import-key") !== configuredKey)
    return Response.json({ error: "导入密钥无效" }, { status: 401 });

  let payload: { date?: string; words?: EnrichmentWord[] };
  try {
    const raw = await request.text();
    if (raw.length > 250_000) return Response.json({ error: "邮件数据超过 250 KB" }, { status: 413 });
    payload = JSON.parse(raw) as { date?: string; words?: EnrichmentWord[] };
  } catch {
    return Response.json({ error: "请求内容必须是有效 JSON" }, { status: 400 });
  }

  const date = clean(payload.date, 10);
  const words = Array.isArray(payload.words) ? payload.words : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "date 必须为 YYYY-MM-DD" }, { status: 400 });
  if (words.length < 1 || words.length > 80) return Response.json({ error: "words 数量必须为 1–80" }, { status: 400 });

  try {
    const coreCorpora = await rows("corpora?select=id&track=eq.cet6&code=neq.cet6-imported");
    const coreCorpusIds = coreCorpora.map((item) => String(item.id || "")).filter(Boolean);
    if (!coreCorpusIds.length)
      return Response.json({ error: "没有找到原始 CET-6 核心词库，未写入数据" }, { status: 503 });

    let phoneticsAdded = 0;
    let examplesAdded = 0;
    let collocationsAdded = 0;
    let skipped = 0;
    const results: Row[] = [];

    for (const item of words) {
      const lemma = clean(item.word, 81).toLowerCase();
      if (!/^[a-z][a-z'-]{0,80}$/.test(lemma)) {
        skipped++;
        results.push({ word: lemma, status: "invalid_word" });
        continue;
      }

      const match = (await rows("vocabulary_words?select=id,lemma,phonetic_uk,phonetic_us&normalized_lemma=eq." + encodeURIComponent(lemma) + "&limit=1"))[0];
      if (!match?.id) {
        skipped++;
        results.push({ word: lemma, status: "not_in_cet6" });
        continue;
      }

      const membership = await rows("corpus_entries?select=word_id&word_id=eq." + match.id + "&corpus_id=in.(" + coreCorpusIds.join(",") + ")");
      if (!membership.length) {
        skipped++;
        results.push({ word: lemma, status: "not_in_original_1800" });
        continue;
      }

      const senses = await rows("vocabulary_senses?select=id&word_id=eq." + match.id + "&order=sense_no");
      const senseIds = senses.map((sense) => String(sense.id || "")).filter(Boolean);
      if (!senseIds.length) {
        skipped++;
        results.push({ word: lemma, status: "missing_sense" });
        continue;
      }

      const phoneticSource = clean(item.phoneticSourceLabel, 120);
      const phoneticPatch: Row = {};
      const uk = clean(item.phoneticUk, 80);
      const us = clean(item.phoneticUs, 80);
      if (!clean(match.phonetic_uk, 80) && uk && phoneticSource) phoneticPatch.phonetic_uk = uk;
      if (!clean(match.phonetic_us, 80) && us && phoneticSource) phoneticPatch.phonetic_us = us;
      if (Object.keys(phoneticPatch).length) {
        await dbRequest("vocabulary_words?id=eq." + match.id, { method: "PATCH", body: phoneticPatch, prefer: "return=minimal" });
        phoneticsAdded += Object.keys(phoneticPatch).length;
      }

      const senseFilter = "sense_id=in.(" + senseIds.join(",") + ")";
      const existingCollocations = await rows("word_collocations?select=id,content,translation,source_label,verified&" + senseFilter);
      let collocationStatus = existingCollocations.length ? "already_present" : "not_provided";
      if (Array.isArray(item.collocations) && item.collocations.length) {
        const candidates = item.collocations.slice(0, 3).flatMap((entry, index) => {
          const phrase = clean(entry.phrase, 120);
          const translation = clean(entry.translation, 160);
          const sourceLabel = clean(entry.sourceLabel, 120);
          if (!phrase || !translation || !hasChinese(translation) || !sourceLabel || !/^[a-z][a-z' -]{0,119}$/i.test(phrase)) return [];
          return [{
            phrase,
            translation,
            sourceLabel,
            verified: entry.verified !== false,
            rank: index + 1,
          }];
        });
        const toInsert = existingCollocations.length ? [] : candidates.map((entry) => ({
          sense_id: senseIds[0],
          content: entry.phrase,
          translation: entry.translation,
          rank: entry.rank,
          source_type: "dictionary",
          source_label: entry.sourceLabel,
          verified: entry.verified,
        }));
        if (toInsert.length) {
          await insert("word_collocations", toInsert);
          collocationsAdded += toInsert.length;
          collocationStatus = "added";
        } else if (existingCollocations.length) {
          for (const entry of candidates) {
            const existing = existingCollocations.find((row) => clean(row.content, 120).toLowerCase() === entry.phrase.toLowerCase());
            if (!existing || clean(existing.translation, 160)) continue;
            await dbRequest("word_collocations?id=eq." + existing.id, {
              method: "PATCH",
              body: { translation: entry.translation },
              prefer: "return=minimal",
            });
            collocationsAdded++;
            collocationStatus = "translation_filled";
          }
        } else {
          collocationStatus = "no_valid_source_data";
        }
      }

      const existingExamples = await rows("vocabulary_examples?select=id,source_type,verified&sense_id=in.(" + senseIds.join(",") + ")");
      const hasExamExample = existingExamples.some((entry) => entry.verified === true && entry.source_type === "exam");
      const hasAnyVerifiedExample = existingExamples.some((entry) => entry.verified === true);
      let exampleStatus = hasExamExample ? "preserved_exam_example" : hasAnyVerifiedExample ? "already_present" : "not_provided";
      const example = item.example || {};
      const sentence = clean(example.sentence, 260);
      const translation = clean(example.translation, 300);
      const exampleSource = clean(example.sourceLabel, 120);
      const exampleType = clean(example.sourceType, 30).toLowerCase();
      const exampleLink = sourceUrl(example.sourceUrl);
      if (!hasAnyVerifiedExample && sentence && translation && hasChinese(translation) && exampleSource &&
          hasWord(sentence, lemma) && ["original", "dictionary"].includes(exampleType) &&
          (!clean(example.sourceUrl, 1000) || Boolean(exampleLink))) {
        await insert("vocabulary_examples", {
          sense_id: senseIds[0],
          sentence,
          translation,
          source_type: exampleType === "dictionary" ? "dictionary" : "mnemonic",
          source_label: exampleSource,
          source_url: exampleLink,
          citation_note: exampleLink ? "邮件补全数据；来源链接：" + exampleLink : "DailyGlow 原创六级语境例句",
          verified: true,
          rank: exampleType === "dictionary" ? 6 : 10,
        });
        examplesAdded++;
        exampleStatus = "added";
      }

      const changed = Object.keys(phoneticPatch).length > 0 || ["added", "translation_filled"].includes(collocationStatus) || exampleStatus === "added";
      if (!changed) skipped++;
      results.push({
        word: lemma,
        status: changed ? "enriched" : "unchanged",
        phonetics: Object.keys(phoneticPatch),
        example: exampleStatus,
        collocations: collocationStatus,
      });
    }

    return Response.json({
      ok: true,
      date,
      received: words.length,
      phoneticsAdded,
      examplesAdded,
      collocationsAdded,
      skipped,
      results,
      note: "只写入原始 CET-6 核心词库的空字段；今日学习与复习读取同一词库，无需重复造任务。",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "词汇补全导入失败" }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    endpoint: "/api/vocabulary-enrichment",
    method: "POST",
    authentication: "x-dailyglow-import-key",
    emailMarker: "DAILYGLOW_CET6_ENRICHMENT_V1",
    body: {
      date: "YYYY-MM-DD",
      words: [{
        word: "example",
        phoneticUk: "/ɪɡˈzɑːmpəl/",
        phoneticUs: "/ɪɡˈzæmpəl/",
        phoneticSourceLabel: "Oxford Learner's Dictionaries",
        example: {
          sentence: "She gave a clear example to explain the rule.",
          translation: "她举了一个清晰的例子来解释这条规则。",
          sourceType: "original",
          sourceLabel: "DailyGlow 原创六级语境例句",
        },
        collocations: [{
          phrase: "a typical example",
          translation: "一个典型的例子",
          sourceLabel: "Oxford Learner's Dictionaries",
          verified: true,
        }],
      }],
    },
    rules: [
      "only missing fields are filled",
      "a verified CET-6 exam example is never replaced",
      "only words in the original CET-6 corpus are accepted",
      "examples and collocations require English text, Chinese meaning, and source labels",
    ],
  });
}
