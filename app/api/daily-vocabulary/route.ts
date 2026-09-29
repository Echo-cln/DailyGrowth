/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbRequest } from "@/lib/supabase-rest";

type Row = Record<string, any>;
type ImportWord = {
  word?: string;
  phonetic?: string;
  partOfSpeech?: string;
  coreMeaning?: string;
  collocations?: string[];
  example?: string;
  exampleTranslation?: string;
  exampleType?: string;
  source?: string;
  difficulty?: string;
};

async function rows(path: string) {
  const all: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 10_000; from += pageSize) {
    const page = await dbRequest<Row[]>(path, { range: `${from}-${from + pageSize - 1}` });
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}
async function insert(table: string, body: Row | Row[], onConflict?: string) {
  return dbRequest<Row[]>(`${table}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ""}`, {
    method: "POST",
    body,
    prefer: `${onConflict ? "resolution=merge-duplicates," : ""}return=representation`,
  });
}
async function nextNumericId(table: "vocabulary_words" | "vocabulary_senses" | "corpus_entries") {
  const latest = await rows(`${table}?select=id&order=id.desc&limit=1`);
  return Number(latest[0]?.id || 0) + 1;
}
async function digest(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function resolveTargetUser(requestedUserId: string) {
  const configured = String(process.env.DEFAULT_IMPORT_USER_ID || "").trim();
  if (requestedUserId || configured) return requestedUserId || configured;
  // A personal deployment should not force the scheduler to carry a UUID.
  // As soon as there are several accounts, however, the caller must select one.
  const profiles = await rows("profiles?select=id&limit=2");
  if (profiles.length === 1) return String(profiles[0].id);
  throw new Error("存在多个账户：请在请求中提供 targetUserId，或配置 DEFAULT_IMPORT_USER_ID");
}

async function importedCorpus() {
  const existing = await rows("corpora?select=id&code=eq.cet6-imported&limit=1");
  if (existing.length) return existing[0];
  const created = await insert("corpora", {
    code: "cet6-imported",
    name: "溯·辞 CET-6 外部导入词库",
    track: "cet6",
    source_label: "每日导入 API",
    description: "由受保护的每日导入接口写入；不改动用户原始 1800 词库。",
    is_active: true,
  }, "code");
  return created[0];
}

export async function POST(request: Request) {
  const configuredKey = process.env.DAILY_IMPORT_API_KEY;
  if (!configuredKey) return Response.json({ error: "服务器尚未配置 DAILY_IMPORT_API_KEY" }, { status: 503 });
  if ((request.headers.get("authorization") || "") !== `Bearer ${configuredKey}`)
    return Response.json({ error: "未授权：请使用 Authorization: Bearer <DAILY_IMPORT_API_KEY>" }, { status: 401 });

  let date = "", words: ImportWord[] = [], targetUserId = "", addToToday = true;
  try {
    const payload = (await request.json()) as { date?: string; words?: ImportWord[]; targetUserId?: string; addToToday?: boolean };
    date = String(payload.date || "");
    words = Array.isArray(payload.words) ? payload.words : [];
    targetUserId = String(payload.targetUserId || "").trim();
    addToToday = payload.addToToday !== false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date 必须为 YYYY-MM-DD");
    if (words.length < 1 || words.length > 200) throw new Error("words 数量必须为 1–200");
    for (const item of words) if (!item.word?.trim() || !item.coreMeaning?.trim()) throw new Error("每个词必须包含 word 和 coreMeaning");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "JSON 格式错误" }, { status: 400 });
  }

  try {
    targetUserId = await resolveTargetUser(targetUserId);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法确定导入账户" }, { status: 400 });
  }

  const profile = await rows(`profiles?select=id&id=eq.${targetUserId}&limit=1`);
  if (!profile.length) return Response.json({ error: "targetUserId 不存在：请先让该账户登录网站" }, { status: 404 });
  const idempotencyKey = await digest(`${date}:${targetUserId}:${words.map((item) => item.word?.trim().toLowerCase()).sort().join(",")}`);
  const previous = await rows(`import_logs?select=*&idempotency_key=eq.${idempotencyKey}&limit=1`);
  if (previous.length)
    return Response.json({ ok: true, duplicateRequest: true, date, targetUserId, received: words.length, inserted: 0, updated: 0, duplicates: words.length, failures: [] });

  let insertedCount = 0, updatedCount = 0, duplicateCount = 0;
  const failures: { word: string; error: string }[] = [];
  const processed: string[] = [];
  try {
    let task: Row | undefined;
    if (addToToday) {
      const existingTasks = await rows(`daily_tasks?select=*&user_id=eq.${targetUserId}&task_date=eq.${date}&track=eq.cet6&limit=1`);
      if (existingTasks.length) task = existingTasks[0];
      else {
        const taskRows = await insert("daily_tasks", {
          user_id: targetUserId, task_date: date, track: "cet6", new_target: words.length,
          weak_review_target: 20, yesterday_review_target: 0, origin: "api_import", label: "外部定时导入",
          generation_seed: `api-${idempotencyKey.slice(0, 16)}`, generation_snapshot: { idempotencyKey },
        });
        task = taskRows[0];
      }
    }
    const corpus = await importedCorpus();
    const corpusEntries = await rows(`corpus_entries?select=word_id,position&corpus_id=eq.${corpus.id}&order=position.desc&limit=1`);
    let nextCorpusPosition = Number(corpusEntries[0]?.position || 0) + 1;
    let nextTaskPosition = task
      ? (await rows(`daily_task_items?select=position&task_id=eq.${task.id}&item_kind=eq.new&order=position.desc&limit=1`))[0]?.position || 0
      : 0;
    for (const item of words) {
      const lemma = item.word!.trim().toLowerCase();
      try {
        let word = (await rows(`vocabulary_words?select=id&normalized_lemma=eq.${encodeURIComponent(lemma)}&limit=1`))[0];
        if (!word) {
          word = (await insert("vocabulary_words", {
            id: await nextNumericId("vocabulary_words"), lemma, normalized_lemma: lemma, phonetic_uk: item.phonetic || "",
          }))[0];
          insertedCount++;
        } else {
          updatedCount++;
          if (item.phonetic) await dbRequest(`vocabulary_words?id=eq.${word.id}`, { method: "PATCH", body: { phonetic_uk: item.phonetic }, prefer: "return=minimal" });
        }
        let sense = (await rows(`vocabulary_senses?select=id&word_id=eq.${word.id}&sense_no=eq.1&limit=1`))[0];
        if (!sense)
          sense = (await insert("vocabulary_senses", {
            id: await nextNumericId("vocabulary_senses"), word_id: word.id, sense_no: 1,
            part_of_speech: item.partOfSpeech || "", core_meaning: item.coreMeaning!.trim(), difficulty: item.difficulty || "core",
          }, "word_id,sense_no"))[0];
        else
          await dbRequest(`vocabulary_senses?id=eq.${sense.id}`, { method: "PATCH", body: { part_of_speech: item.partOfSpeech || sense.part_of_speech, core_meaning: item.coreMeaning!.trim(), difficulty: item.difficulty || "core" }, prefer: "return=minimal" });
        const entryExists = await rows(`corpus_entries?select=id&corpus_id=eq.${corpus.id}&word_id=eq.${word.id}&limit=1`);
        if (!entryExists.length) {
          await insert("corpus_entries", {
            id: await nextNumericId("corpus_entries"), corpus_id: corpus.id, word_id: word.id, primary_sense_id: sense.id,
            position: nextCorpusPosition++, selection_priority: 100,
            selection_source: item.source || "每日导入 API", theme: "", memory_hook: "", exam_marker: "",
            metadata: { importedAt: new Date().toISOString(), exampleType: item.exampleType || "" },
          });
        }
        if (item.collocations?.length)
          for (let index = 0; index < item.collocations.length; index++) {
            const content = item.collocations[index].trim();
            if (!content) continue;
            const exists = await rows(`word_collocations?select=id&sense_id=eq.${sense.id}&content=eq.${encodeURIComponent(content)}&limit=1`);
            if (!exists.length) await insert("word_collocations", { sense_id: sense.id, content, rank: index + 1, source_type: "mnemonic", source_label: item.source || "外部导入" });
          }
        if (item.example?.trim()) {
          const exists = await rows(`vocabulary_examples?select=id&sense_id=eq.${sense.id}&sentence=eq.${encodeURIComponent(item.example.trim())}&limit=1`);
          if (!exists.length)
            await insert("vocabulary_examples", { sense_id: sense.id, sentence: item.example.trim(), translation: item.exampleTranslation || "",
              source_type: item.exampleType?.includes("真题") ? "exam" : item.exampleType?.includes("词典") ? "dictionary" : "mnemonic",
              source_label: item.source || item.exampleType || "六级语境助记句", verified: Boolean(item.exampleType?.includes("真题") && item.source), rank: 1 });
        }
        if (task) {
          const exists = await rows(`daily_task_items?select=id&task_id=eq.${task.id}&word_id=eq.${word.id}&item_kind=eq.new&limit=1`);
          if (exists.length) duplicateCount++;
          else await insert("daily_task_items", { task_id: task.id, word_id: word.id, item_kind: "new", position: ++nextTaskPosition, completed: false, added_manually: false });
        }
        await insert("user_word_progress", {
          user_id: targetUserId, word_id: word.id, track: "cet6", status: "assigned",
          first_assigned_at: date, review_count: 0, lapse_count: 0,
        }, "user_id,word_id,track");
        processed.push(lemma);
      } catch (error) {
        failures.push({ word: lemma, error: error instanceof Error ? error.message : "写入失败" });
      }
    }
    const status = failures.length ? "partial" : "succeeded";
    await insert("import_logs", { user_id: targetUserId, idempotency_key: idempotencyKey, endpoint: "/api/daily-vocabulary",
      received_count: words.length, inserted_count: insertedCount, updated_count: updatedCount, duplicate_count: duplicateCount,
      failed_count: failures.length, status, message: failures.length ? `${failures.length} 个词写入失败` : `成功处理 ${processed.length} 个词`, details: { date, addToToday, processed, failures } });
    return Response.json({ ok: failures.length === 0, date, targetUserId, received: words.length, inserted: insertedCount, updated: updatedCount, duplicates: duplicateCount, failures, words: processed }, { status: failures.length ? 207 : 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "导入失败", inserted: insertedCount, updated: updatedCount, duplicates: duplicateCount, failures }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ endpoint: "/api/daily-vocabulary", method: "POST", authentication: "Authorization: Bearer <DAILY_IMPORT_API_KEY>",
    target: "单账户时自动识别；多账户使用 body.targetUserId 或服务端 DEFAULT_IMPORT_USER_ID", optional: { addToToday: "false 时只写入待背诵词库" },
    required: ["date", "words[].word", "words[].coreMeaning"], deduplication: "相同日期、账户与词表的重复请求不会再次导入" });
}
