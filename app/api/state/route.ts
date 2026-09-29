/* eslint-disable @typescript-eslint/no-explicit-any */
import historyData from "@/data/study-history.json";
import {
  authenticate,
  dbRequest,
  jsonDate,
  shiftDate,
  type AuthUser,
} from "@/lib/supabase-rest";

type Row = Record<string, any>;
type HistoryDay = { date: string; label: string; words: string[]; reviews?: string[] };
const history = historyData as HistoryDay[];
const unauthorized = () => Response.json({ error: "请先登录", code: "UNAUTHORIZED" }, { status: 401 });
// Lexicon is cached briefly to avoid repeated full-corpus reads.
const LEXICON_CACHE_TTL_MS = 10 * 60 * 1000;
type Lexicon = {
  words: Row[];
  sensesByWord: Map<number, Row[]>;
  collocationsBySense: Map<number, Row[]>;
  examplesBySense: Map<number, Row[]>;
  comparisonsByWord: Map<number, Row>;
  entries: Row[];
  entryByWord: Map<number, Row>;
  wordByLemma: Map<string, number>;
};
let lexiconCache: { expiresAt: number; value: Lexicon } | null = null;

async function getRows(path: string) {
  // Supabase/PostgREST caps one response at 1,000 rows by default. Keep
  // fetching pages so the 1,800-word corpus is never displayed as 1,000.
  const all: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 10_000; from += pageSize) {
    const page = await dbRequest<Row[]>(path, { range: `${from}-${from + pageSize - 1}` });
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}
async function insertRows(table: string, rows: Row | Row[], onConflict?: string) {
  const suffix = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  // PostgREST accepts a bulk insert only when every object has the same set of
  // keys. Task items are intentionally assembled from several sources (new,
  // yesterday review and weak review), so group them by shape before posting.
  const batches = Array.isArray(rows)
    ? [...rows.reduce((groups, row) => {
        const shape = Object.keys(row).sort().join("|");
        const group = groups.get(shape) || [];
        group.push(row);
        groups.set(shape, group);
        return groups;
      }, new Map<string, Row[]>()).values()]
    : [rows];
  const result: Row[] = [];
  for (const batch of batches) {
    const inserted = await dbRequest<Row[]>(`${table}${suffix}`, {
      method: "POST",
      body: batch,
      prefer: `${onConflict ? "resolution=merge-duplicates," : ""}return=representation`,
    });
    result.push(...inserted);
  }
  return result;
}
async function patchRows(table: string, filter: string, body: Row) {
  return dbRequest<Row[]>(`${table}?${filter}`, { method: "PATCH", body, prefer: "return=representation" });
}

async function loadLexicon() {
  if (lexiconCache && lexiconCache.expiresAt > Date.now()) return lexiconCache.value;
  const [wordRows, senseRows, collocationRows, exampleRows, entries, comparisonRows] = await Promise.all([
    getRows("vocabulary_words?select=id,lemma,phonetic_uk,phonetic_us,pronunciation_audio_url&order=id"),
    getRows("vocabulary_senses?select=id,word_id,part_of_speech,core_meaning,difficulty,note&order=word_id,sense_no"),
    getRows("word_collocations?select=id,sense_id,content,translation,rank,source_type,source_label,verified&order=rank"),
    getRows("vocabulary_examples?select=id,sense_id,sentence,translation,source_type,source_label,verified,rank&order=rank"),
    getRows("corpus_entries?select=word_id,position,corpus_day,corpus_unit,selection_priority,selection_source,theme,memory_hook,exam_marker&order=selection_priority,position"),
    getRows("word_comparisons?select=word_id,similar_words,distinction,contrast_example").catch(() => []),
  ]);
  // The vocabulary table also stores a small number of expansion candidates.
  // The current CET-6 plan must show the user's original 1,800-word corpus.
  const corpusWordIds = new Set(entries.map((row) => Number(row.word_id)));
  const words = wordRows.filter((row) => corpusWordIds.has(Number(row.id)));
  const senses = senseRows.filter((row) => corpusWordIds.has(Number(row.word_id)));
  const senseIds = new Set(senses.map((row) => Number(row.id)));
  const collocations = collocationRows.filter((row) => senseIds.has(Number(row.sense_id)));
  // Only verified sentences are eligible for study. The source label is preserved
  // for transparency; valid internally curated learning sentences must not disappear
  // merely because they are not tagged as an external dictionary.
  const examples = exampleRows.filter((row) =>
    senseIds.has(Number(row.sense_id)) && Boolean(row.verified),
  );
  const sensesByWord = new Map<number, Row[]>();
  const collocationsBySense = new Map<number, Row[]>();
  const examplesBySense = new Map<number, Row[]>();
  const comparisonsByWord = new Map<number, Row>(comparisonRows.map((row) => [Number(row.word_id), row]));
  for (const row of senses) {
    const list = sensesByWord.get(Number(row.word_id)) || [];
    list.push(row);
    sensesByWord.set(Number(row.word_id), list);
  }
  for (const row of collocations) {
    const list = collocationsBySense.get(Number(row.sense_id)) || [];
    list.push(row);
    collocationsBySense.set(Number(row.sense_id), list);
  }
  for (const row of examples) {
    const list = examplesBySense.get(Number(row.sense_id)) || [];
    list.push(row);
    examplesBySense.set(Number(row.sense_id), list);
  }
  const entryByWord = new Map(entries.map((row) => [Number(row.word_id), row]));
  const wordByLemma = new Map(words.map((row) => [String(row.lemma).trim().toLowerCase(), Number(row.id)]));
  const value = { words, sensesByWord, collocationsBySense, examplesBySense, comparisonsByWord, entries, entryByWord, wordByLemma };
  lexiconCache = { value, expiresAt: Date.now() + LEXICON_CACHE_TTL_MS };
  return value;
}

function usernameFor(user: AuthUser) {
  const base = (user.email || `user_${user.id.slice(0, 8)}`).split("@")[0].replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 32);
  return base.length >= 3 ? base : `user_${user.id.slice(0, 8)}`;
}

async function ensureUser(user: AuthUser, wordByLemma: Map<string, number>) {
  const profile = await getRows(`profiles?select=*&id=eq.${user.id}&limit=1`);
  if (!profile.length) {
    const existing = await getRows("profiles?select=id&limit=1");
    if (existing.length) throw new Error("ACCOUNT_NOT_PROVISIONED");
    const displayName = String(user.user_metadata?.display_name || "Echo").trim() || "Echo";
    await insertRows("profiles", {
      id: user.id,
      username: usernameFor(user),
      display_name: displayName,
      email: user.email || null,
      role: "admin",
      status: "active",
    });
  } else if (profile[0].status !== "active") throw new Error("ACCOUNT_DISABLED");

  const settings = await getRows(`user_settings?select=user_id&user_id=eq.${user.id}&limit=1`);
  if (!settings.length)
    await insertRows("user_settings", {
      user_id: user.id,
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
      default_track: "cet6",
      daily_new_target: 20,
      weak_review_target: 20,
      reminder_time: "20:30:00",
    });
  await importHistory(user.id, wordByLemma);
  return (await getRows(`profiles?select=*&id=eq.${user.id}&limit=1`))[0];
}

async function importHistory(userId: string, wordByLemma: Map<string, number>) {
  const existing = await getRows(`daily_tasks?select=id&user_id=eq.${userId}&origin=eq.conversation_history&limit=1`);
  if (existing.length) return;
  const progress = new Map<string, Row>();
  for (const day of history) {
    const taskRows = await insertRows("daily_tasks", {
      user_id: userId,
      task_date: day.date,
      track: "cet6",
      new_target: day.words.length,
      weak_review_target: day.reviews?.length || 0,
      yesterday_review_target: 0,
      origin: "conversation_history",
      label: day.label,
      generation_seed: `history-${day.date}`,
      generation_snapshot: { restored: true },
    }, "user_id,task_date,track");
    const taskId = taskRows[0]?.id;
    if (!taskId) continue;
    const items: Row[] = [];
    day.words.forEach((lemma, index) => {
      const wordId = wordByLemma.get(lemma.toLowerCase());
      if (!wordId) return;
      items.push({ task_id: taskId, word_id: wordId, item_kind: "new", position: index + 1, completed: false, source_history_date: day.date });
      const previous = progress.get(String(wordId));
      progress.set(String(wordId), {
        user_id: userId,
        word_id: wordId,
        track: "cet6",
        status: "learned_unrated",
        proficiency: lemma.toLowerCase() === "ascertain" ? "familiar" : null,
        first_assigned_at: previous?.first_assigned_at || day.date,
        first_learned_at: previous?.first_learned_at || day.date,
        next_review_at: shiftDate(day.date, 1),
        review_count: previous?.review_count || 0,
        lapse_count: 0,
      });
    });
    (day.reviews || []).forEach((lemma, index) => {
      const wordId = wordByLemma.get(lemma.toLowerCase());
      if (!wordId) return;
      items.push({ task_id: taskId, word_id: wordId, item_kind: "review_weak", position: index + 1, completed: false, source_history_date: day.date });
    });
    if (items.length) await insertRows("daily_task_items", items, "task_id,item_kind,word_id");
  }
  if (progress.size) await insertRows("user_word_progress", [...progress.values()], "user_id,word_id,track");
}

function stableScore(id: number, seed: string) {
  let value = id;
  for (let i = 0; i < seed.length; i++) value = (value * 33 + seed.charCodeAt(i)) >>> 0;
  return value;
}

function newWordPriority(entry: Row, lexicon: Lexicon, date: string) {
  const sense = lexicon.sensesByWord.get(Number(entry.word_id))?.[0] || {};
  const source = String(entry.selection_source || "");
  const marker = String(entry.exam_marker || "");
  const difficulty = String(sense.difficulty || "").toLowerCase();
  // Higher is more urgent. Corpus position is deliberately not used here:
  // it must never turn the daily plan into an A-to-Z queue.
  let score = 0;
  if (/真题|高危|高频/.test(source)) score += 400;
  if (/≥\s*[23]|多套|复现/.test(marker)) score += 260;
  else if (/选词填空|阅读|听力/.test(marker)) score += 160;
  if (/advanced|hard|difficult|high/.test(difficulty)) score += 140;
  else if (/core|medium/.test(difficulty)) score += 80;
  // Stable daily shuffling spreads words of the same level across days while
  // keeping the task reproducible for a given date.
  return score * 10_000 + (10_000 - (stableScore(Number(entry.word_id), `new-${date}`) % 10_000));
}

async function ensureTodayTask(userId: string, settings: Row, lexicon: Lexicon, progressRows: Row[], requestedDate?: string | null) {
  const liveDate = jsonDate(String(settings.timezone || "Asia/Shanghai"));
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : liveDate;
  const track = String(settings.default_track || "cet6");
  let taskRows = await getRows(`daily_tasks?select=*&user_id=eq.${userId}&task_date=eq.${date}&track=eq.${track}&limit=1`);
  if (!taskRows.length)
    taskRows = await insertRows("daily_tasks", {
      user_id: userId,
      task_date: date,
      track,
      new_target: settings.daily_new_target || 20,
      weak_review_target: settings.weak_review_target ?? 20,
      yesterday_review_target: 0,
      origin: "generated",
      label: "今日自动任务",
      generation_seed: `daily-${userId}-${date}`,
      generation_snapshot: { rule: "yesterday_all_plus_weak" },
    }, "user_id,task_date,track");
  const task: Row = taskRows[0];
  let items = await getRows(`daily_task_items?select=*&task_id=eq.${task.id}&order=position`);
  const occupied = new Set(items.map((row) => Number(row.word_id)));
  const inserts: Row[] = [];

  const yesterday = shiftDate(date, -1);
  const yesterdayTask = await getRows(`daily_tasks?select=id&user_id=eq.${userId}&task_date=eq.${yesterday}&track=eq.${track}&limit=1`);
  if (yesterdayTask.length) {
    const yesterdayWords = await getRows(`daily_task_items?select=word_id&task_id=eq.${yesterdayTask[0].id}&item_kind=eq.new&order=position`);
    yesterdayWords.forEach((row, index) => {
      const wordId = Number(row.word_id);
      if (occupied.has(wordId)) return;
      occupied.add(wordId);
      inserts.push({ task_id: task.id, word_id: wordId, item_kind: "review_yesterday", position: index + 1, completed: false, source_history_date: yesterday });
    });
    if (Number(task.yesterday_review_target) !== yesterdayWords.length)
      await patchRows("daily_tasks", `id=eq.${task.id}`, { yesterday_review_target: yesterdayWords.length });
  }

  const weakExisting = items.filter((row) => row.item_kind === "review_weak").length;
  const weakNeed = Math.max(0, Number(task.weak_review_target || 0) - weakExisting);
  progressRows
    .filter((row) => ["learned", "learned_unrated"].includes(String(row.status)) && row.first_assigned_at !== yesterday && row.proficiency !== "mastered" && !occupied.has(Number(row.word_id)))
    .sort((a, b) => {
      const dueA = !a.next_review_at || a.next_review_at <= date ? 0 : 1;
      const dueB = !b.next_review_at || b.next_review_at <= date ? 0 : 1;
      if (dueA !== dueB) return dueA - dueB;
      const rank = (value: unknown) => value === "unfamiliar" ? 0 : value == null ? 1 : 2;
      return rank(a.proficiency) - rank(b.proficiency) || stableScore(Number(a.word_id), date) - stableScore(Number(b.word_id), date);
    })
    .slice(0, weakNeed)
    .forEach((row, index) => {
      const wordId = Number(row.word_id);
      occupied.add(wordId);
      inserts.push({ task_id: task.id, word_id: wordId, item_kind: "review_weak", position: weakExisting + index + 1, completed: false });
    });

  const progressByWord = new Map(progressRows.map((row) => [Number(row.word_id), row]));
  const newExisting = items.filter((row) => row.item_kind === "new").length;
  const newNeed = Math.max(0, Number(task.new_target || 20) - newExisting);
  const newCandidates = lexicon.entries.filter((entry) => {
    const p = progressByWord.get(Number(entry.word_id));
    return (!p || p.status === "unlearned") && !occupied.has(Number(entry.word_id));
  }).sort((a, b) => newWordPriority(b, lexicon, date) - newWordPriority(a, lexicon, date))
    .slice(0, newNeed);
  newCandidates.forEach((entry, index) => {
    const wordId = Number(entry.word_id);
    occupied.add(wordId);
    inserts.push({ task_id: task.id, word_id: wordId, item_kind: "new", position: newExisting + index + 1, completed: false });
  });
  if (inserts.length) {
    await insertRows("daily_task_items", inserts, "task_id,item_kind,word_id");
    if (newCandidates.length)
      await insertRows("user_word_progress", newCandidates.map((entry) => ({
        user_id: userId,
        word_id: Number(entry.word_id),
        track,
        status: "assigned",
        first_assigned_at: date,
        review_count: 0,
        lapse_count: 0,
      })), "user_id,word_id,track");
    items = await getRows(`daily_task_items?select=*&task_id=eq.${task.id}&order=position`);
  }
  items.sort((a, b) => Number(Boolean(b.added_manually)) - Number(Boolean(a.added_manually)) || Number(a.position) - Number(b.position));
  return { ...task, yesterday_review_target: yesterdayTask.length ? inserts.filter((row) => row.item_kind === "review_yesterday").length + Number(task.yesterday_review_target || 0) : 0, task_date: date, items } as Row & { items: Row[] };
}

function shapeWord(word: Row, lexicon: Lexicon, progress?: Row, item?: Row) {
  const senses = lexicon.sensesByWord.get(Number(word.id)) || [];
  const sense = senses[0] || {};
  const example = lexicon.examplesBySense.get(Number(sense.id))?.[0] || {};
  const entry = lexicon.entryByWord.get(Number(word.id)) || {};
  const comparison = lexicon.comparisonsByWord.get(Number(word.id)) || {};
  const storedSentence = String(example.sentence || "").trim();
  return {
    id: Number(word.id), word: word.lemma, phonetic: word.phonetic_uk || word.phonetic_us || "",
    phonetic_uk: word.phonetic_uk || "", phonetic_us: word.phonetic_us || "",
    part_of_speech: String(sense.part_of_speech || ""), core_meaning: sense.core_meaning || "释义待补充",
    meanings: senses.map((row) => ({ part_of_speech: row.part_of_speech || "", meaning: row.core_meaning || "" })),
    collocations: senses.flatMap((row) => (lexicon.collocationsBySense.get(Number(row.id)) || [])
      .slice()
      .sort((a, b) => Number(Boolean(b.verified)) - Number(Boolean(a.verified)) || Number(a.rank || 0) - Number(b.rank || 0))
      .map((item) => ({ phrase: item.content || "", translation: item.translation || "", source: item.source_label || "" }))).slice(0, 3),
    example: storedSentence,
    example_translation: storedSentence ? String(example.translation || "").trim() : "",
    example_type: !storedSentence ? "例句待补" : example.source_type === "exam" ? "真题原句" : "学习例句",
    source: !storedSentence ? "例句待补充" : example.source_label || "溯·辞学习例句",
    comparison: comparison.distinction ? { similarWords: comparison.similar_words || [], distinction: comparison.distinction, contrastExample: comparison.contrast_example || "" } : null,
    example_is_fallback: !storedSentence,
    status: progress?.status || "unlearned", proficiency: progress?.proficiency || null,
    first_learned_at: progress?.first_learned_at || null, last_reviewed_at: progress?.last_reviewed_at || null,
    next_review_at: progress?.next_review_at || null, review_count: Number(progress?.review_count || 0),
    corpus_day: entry.corpus_day || null, corpus_index: entry.position || null, corpus_unit: entry.corpus_unit || "",
    theme: entry.theme || "", memory_hook: entry.memory_hook || "", exam_marker: entry.exam_marker || "",
    exam_priority: String(entry.selection_source || "").includes("真题") ? (String(entry.exam_marker || "").includes("≥2") ? 2 : 1) : 0,
    task_item_id: item?.id, item_type: item ? (item.item_kind === "new" ? "new" : "review") : undefined,
    completed: Boolean(item?.completed),
  };
}

async function context(request: Request) {
  const user = await authenticate(request);
  const lexicon = await loadLexicon();
  const profile = await ensureUser(user, lexicon.wordByLemma);
  const [settingsRows, progressRows] = await Promise.all([
    getRows(`user_settings?select=*&user_id=eq.${user.id}&limit=1`),
    getRows(`user_word_progress?select=*&user_id=eq.${user.id}`),
  ]);
  const settings = settingsRows[0];
  const requestedDate = new URL(request.url).searchParams.get("date");
  const task = await ensureTodayTask(user.id, settings, lexicon, progressRows, requestedDate);
  return { user, profile, settings, progressRows, task, lexicon };
}

export async function GET(request: Request) {
  try {
    const full = new URL(request.url).searchParams.get("full") === "1";
    const { user, profile, settings, progressRows, task, lexicon } = await context(request);
    const [collections, tags, highlights, logs, tasks, wordbookRows, drafts] = await Promise.all([
      getRows(`writing_collections?select=*&user_id=eq.${user.id}&order=created_at.desc`),
      getRows("writing_collection_tags?select=collection_id,tag"),
      getRows(`highlights?select=*&user_id=eq.${user.id}&order=created_at.desc`),
      getRows(`import_logs?select=*&user_id=eq.${user.id}&order=created_at.desc&limit=20`),
      getRows(`daily_tasks?select=*&user_id=eq.${user.id}&order=task_date.desc&limit=90`),
      getRows(`user_wordbook_entries?select=*&user_id=eq.${user.id}&order=created_at.desc`),
      getRows(`user_drafts?select=*&user_id=eq.${user.id}&order=updated_at.desc`),
    ]);
    const progressByWord = new Map(progressRows.map((row) => [Number(row.word_id), row]));
    const wordById = new Map(lexicon.words.map((row) => [Number(row.id), row]));
    const taskItems = task.items.map((item: Row) => shapeWord(wordById.get(Number(item.word_id)) || {}, lexicon, progressByWord.get(Number(item.word_id)), item));
    const words = full ? lexicon.words.map((word) => shapeWord(word, lexicon, progressByWord.get(Number(word.id)))).sort((a, b) => {
      const ea = lexicon.entryByWord.get(a.id), eb = lexicon.entryByWord.get(b.id);
      if (ea && !eb) return -1; if (!ea && eb) return 1;
      return Number(ea?.position || 99999) - Number(eb?.position || 99999);
    }) : [];
    const summary = {
      total: lexicon.entries.length,
      learned: progressRows.filter((row) => ["learned", "learned_unrated"].includes(String(row.status))).length,
      unfamiliar: progressRows.filter((row) => row.proficiency === "unfamiliar").length,
      familiar: progressRows.filter((row) => row.proficiency === "familiar").length,
      mastered: progressRows.filter((row) => row.proficiency === "mastered").length,
      reviewCount: progressRows.reduce((sum, row) => sum + Number(row.review_count || 0), 0),
    };
    const taskIds = tasks.map((row) => row.id);
    const allItems = taskIds.length ? await getRows(`daily_task_items?select=task_id,item_kind,completed&task_id=in.(${taskIds.join(",")})`) : [];
    const historyRows = tasks.map((row) => {
      const items = allItems.filter((item) => item.task_id === row.id);
      return { task_date: row.task_date, origin: row.origin, label: row.label, new_target: row.new_target,
        review_target: Number(row.weak_review_target || 0) + Number(row.yesterday_review_target || 0), total: items.length,
        completed: items.filter((item) => item.completed).length, new_count: items.filter((item) => item.item_kind === "new").length,
        review_count: items.filter((item) => item.item_kind !== "new").length };
    });
    const topicsByCollection = new Map<string, string[]>();
    tags.forEach((row) => topicsByCollection.set(String(row.collection_id), [...(topicsByCollection.get(String(row.collection_id)) || []), row.tag]));
    return Response.json({
      date: task.task_date,
      task: { ...task, review_target: Number(task.weak_review_target || 0) + Number(task.yesterday_review_target || 0) },
      taskItems, words, wordsLoaded: full, summary,
      collections: collections.map((row) => ({ ...row, topic: topicsByCollection.get(String(row.id))?.[0] || "通用", source: row.source_label })),
      wordbook: wordbookRows.map((row) => ({ ...shapeWord(wordById.get(Number(row.word_id)) || {}, lexicon, progressByWord.get(Number(row.word_id))), note: row.note || "", source_context: row.source_context || "", added_at: row.created_at })),
      drafts: drafts.map((row) => ({ id: String(row.id), title: String(row.title || "未命名便签"), text: String(row.text_content || ""), drawing: String(row.drawing_data || ""), updated_at: String(row.updated_at || row.created_at || "") })),
      highlights: highlights.map((row) => ({ ...row, content: row.selected_text })),
      settings: { new_target: settings.daily_new_target, review_target: settings.weak_review_target, reminder_time: String(settings.reminder_time).slice(0, 5), reminder_enabled: settings.reminder_enabled !== false, track: settings.default_track || "cet6" },
      logs: logs.map((row) => ({ ...row, import_date: String(row.created_at).slice(0, 10) })), history: historyRows,
      user: { id: user.id, email: user.email || "", displayName: profile.display_name, authProvider: "password", role: profile.role },
      corpus: { source: "1800 核心词 Excel", count: lexicon.entries.length, days: Math.ceil(lexicon.entries.length / Number(settings.daily_new_target || 20)), importedHistoryDays: history.length },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载失败";
    if (message === "UNAUTHORIZED") return unauthorized();
    if (message === "ACCOUNT_NOT_PROVISIONED") return Response.json({ error: "该账户尚未由管理员开通", code: message }, { status: 403 });
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, task, lexicon } = await context(request);
    const body = (await request.json()) as Row;
    const action = String(body.action || ""), date = String(task.task_date);
    if (action === "rate-word") {
      const wordId = Number(body.wordId), proficiency = String(body.proficiency);
      if (!wordId || !["unfamiliar", "familiar", "mastered"].includes(proficiency)) return Response.json({ error: "参数无效" }, { status: 400 });
      const current = (await getRows(`user_word_progress?select=*&user_id=eq.${user.id}&word_id=eq.${wordId}&track=eq.cet6&limit=1`))[0] || {};
      const count = Number(current.review_count || 0) + 1;
      const interval = proficiency === "unfamiliar" ? 1 : proficiency === "mastered" ? (count < 3 ? 7 : 30) : [1, 3, 7, 15, 30][Math.min(count - 1, 4)];
      await insertRows("user_word_progress", { user_id: user.id, word_id: wordId, track: "cet6", status: "learned", proficiency,
        first_assigned_at: current.first_assigned_at || date, first_learned_at: current.first_learned_at || date,
        last_reviewed_at: new Date().toISOString(), next_review_at: shiftDate(date, interval), review_count: count,
        lapse_count: Number(current.lapse_count || 0) + (proficiency === "unfamiliar" ? 1 : 0) }, "user_id,word_id,track");
      const itemId = String(body.itemId || "");
      if (itemId && task.items.some((item: Row) => item.id === itemId)) await patchRows("daily_task_items", `id=eq.${itemId}`, { completed: true, proficiency, completed_at: new Date().toISOString() });
      await insertRows("review_records", { user_id: user.id, word_id: wordId, task_item_id: itemId || null, task_date: date, proficiency,
        previous_proficiency: current.proficiency || null, interval_days: interval, next_review_at: shiftDate(date, interval) });
      return Response.json({ ok: true, nextReviewAt: shiftDate(date, interval) });
    }
    if (action === "add-to-wordbook") {
      const wordId = Number(body.wordId);
      if (!wordId || !lexicon.words.some((row) => Number(row.id) === wordId))
        return Response.json({ error: "单词不存在" }, { status: 400 });
      await insertRows("user_wordbook_entries", {
        user_id: user.id, word_id: wordId,
        source_context: String(body.sourceContext || "例句生词"),
        note: String(body.note || ""),
      }, "user_id,word_id");
      return Response.json({ ok: true });
    }
    if (action === "remove-from-wordbook") {
      const wordId = Number(body.wordId);
      await dbRequest(`user_wordbook_entries?user_id=eq.${user.id}&word_id=eq.${wordId}`, { method: "DELETE", prefer: "return=minimal" });
      return Response.json({ ok: true });
    }
    if (action === "save-draft") {
      const title = String(body.title || "未命名便签").trim().slice(0, 80) || "未命名便签";
      const text = String(body.text || "").slice(0, 20_000);
      const drawing = String(body.drawing || "").slice(0, 2_000_000);
      const id = String(body.id || "");
      if (id) {
        const existing = await getRows(`user_drafts?select=id&id=eq.${id}&user_id=eq.${user.id}&limit=1`);
        if (!existing.length) return Response.json({ error: "草稿不存在或无权修改" }, { status: 404 });
        await patchRows("user_drafts", `id=eq.${id}&user_id=eq.${user.id}`, { title, text_content: text, drawing_data: drawing, updated_at: new Date().toISOString() });
      } else {
        const created = await insertRows("user_drafts", { user_id: user.id, title, text_content: text, drawing_data: drawing });
        return Response.json({ ok: true, id: String(created[0]?.id || "") });
      }
      return Response.json({ ok: true, id });
    }
    if (action === "delete-draft") {
      const id = String(body.id || "");
      if (!id) return Response.json({ error: "草稿 ID 缺失" }, { status: 400 });
      await dbRequest(`user_drafts?id=eq.${id}&user_id=eq.${user.id}`, { method: "DELETE", prefer: "return=minimal" });
      return Response.json({ ok: true });
    }
    if (action === "add-to-today") {
      const itemKind = body.itemType === "review" ? "review_weak" : "new";
      await insertRows("daily_task_items", { task_id: task.id, word_id: Number(body.wordId), item_kind: itemKind,
        position: task.items.filter((row: Row) => row.item_kind === itemKind).length + 1, completed: false, added_manually: true }, "task_id,item_kind,word_id");
      return Response.json({ ok: true });
    }
    if (action === "add-more-new") {
      const count = Math.max(1, Math.min(200, Number(body.count) || 20));
      const progress = await getRows(`user_word_progress?select=word_id,status&user_id=eq.${user.id}`);
      const unavailable = new Set(progress.filter((row) => row.status !== "unlearned").map((row) => Number(row.word_id)));
      task.items.forEach((row: Row) => unavailable.add(Number(row.word_id)));
      const picked = lexicon.entries.filter((row) => !unavailable.has(Number(row.word_id))).slice(0, count);
      const start = task.items.filter((row: Row) => row.item_kind === "new").length;
      if (picked.length) {
        await insertRows("daily_task_items", picked.map((row, index) => ({ task_id: task.id, word_id: Number(row.word_id), item_kind: "new", position: start + index + 1, completed: false, added_manually: true })), "task_id,item_kind,word_id");
        await insertRows("user_word_progress", picked.map((row) => ({ user_id: user.id, word_id: Number(row.word_id), track: "cet6", status: "assigned", first_assigned_at: date, review_count: 0, lapse_count: 0 })), "user_id,word_id,track");
        await patchRows("daily_tasks", `id=eq.${task.id}`, { new_target: Number(task.new_target || 0) + picked.length });
      }
      return Response.json({ ok: true, added: picked.length });
    }
    if (action === "collect") {
      const content = String(body.content || "").trim();
      if (!content) return Response.json({ error: "收藏内容不能为空" }, { status: 400 });
      const rows = await insertRows("writing_collections", { user_id: user.id, word_id: body.wordId ? Number(body.wordId) : null, content,
        translation: String(body.translation || ""), expression_type: String(body.expressionType || "句型"), replaceable_parts: String(body.replaceableParts || ""),
        source_type: String(body.source || "").includes("真题") ? "exam" : "user", source_label: String(body.source || "用户收藏"), note: String(body.note || ""), proficiency: "unfamiliar" });
      if (rows[0]?.id) await insertRows("writing_collection_tags", { collection_id: rows[0].id, tag: String(body.topic || "通用") }, "collection_id,tag");
      return Response.json({ ok: true });
    }
    if (action === "update-collection") {
      const id = String(body.id || "");
      const content = String(body.content || "").trim();
      if (!id || !content) return Response.json({ error: "收藏内容不能为空" }, { status: 400 });
      const existing = await getRows(`writing_collections?select=id&id=eq.${id}&user_id=eq.${user.id}&limit=1`);
      if (!existing.length) return Response.json({ error: "收藏不存在或无权修改" }, { status: 404 });
      await patchRows("writing_collections", `id=eq.${id}&user_id=eq.${user.id}`, {
        word_id: body.wordId ? Number(body.wordId) : null,
        content,
        translation: String(body.translation || ""),
        expression_type: String(body.expressionType || "句型"),
        replaceable_parts: String(body.replaceableParts || ""),
        source_type: String(body.source || "").includes("真题") ? "exam" : "user",
        source_label: String(body.source || "用户收藏"),
        note: String(body.note || ""),
      });
      await dbRequest(`writing_collection_tags?collection_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
      await insertRows("writing_collection_tags", { collection_id: id, tag: String(body.topic || "通用") }, "collection_id,tag");
      return Response.json({ ok: true });
    }
    if (action === "rate-collection") { await patchRows("writing_collections", `id=eq.${body.id}&user_id=eq.${user.id}`, { proficiency: body.proficiency }); return Response.json({ ok: true }); }
    if (action === "delete-collection") { await dbRequest(`writing_collections?id=eq.${body.id}&user_id=eq.${user.id}`, { method: "DELETE", prefer: "return=minimal" }); return Response.json({ ok: true }); }
    if (action === "highlight") {
      const selectedText = String(body.content || "").trim();
      if (!selectedText) return Response.json({ error: "高亮内容不能为空" }, { status: 400 });
      await insertRows("highlights", { user_id: user.id, word_id: body.wordId ? Number(body.wordId) : null, source_kind: body.wordId ? "word_context" : "manual", selected_text: selectedText, color: String(body.color || "#FCCEB4"), note: String(body.note || "") });
      return Response.json({ ok: true });
    }
    if (action === "save-practice") {
      const collection = await getRows(`writing_collections?select=id&id=eq.${body.id}&user_id=eq.${user.id}&limit=1`);
      if (!collection.length) return Response.json({ error: "收藏不存在" }, { status: 404 });
      await insertRows("writing_practice_records", { collection_id: body.id, user_id: user.id, practice_text: String(body.practiceText || ""), proficiency: body.proficiency || null });
      return Response.json({ ok: true });
    }
    if (action === "set-next-review") {
      const wordId = Number(body.wordId);
      const nextReviewAt = String(body.nextReviewAt || "");
      if (!wordId) return Response.json({ error: "请选择单词" }, { status: 400 });
      if (nextReviewAt && !/^\d{4}-\d{2}-\d{2}$/.test(nextReviewAt)) return Response.json({ error: "复习日期格式不正确" }, { status: 400 });
      const progress = await getRows(`user_word_progress?select=status&user_id=eq.${user.id}&word_id=eq.${wordId}&track=eq.cet6&limit=1`);
      if (!progress.length || !["learned", "learned_unrated"].includes(String(progress[0].status))) return Response.json({ error: "请先在今日任务中完成该词，再安排复习日期" }, { status: 400 });
      await patchRows("user_word_progress", `user_id=eq.${user.id}&word_id=eq.${wordId}&track=eq.cet6`, { next_review_at: nextReviewAt || null });
      return Response.json({ ok: true });
    }
    if (action === "settings") {
      const track = ["cet4", "cet6", "mixed", "custom"].includes(String(body.track)) ? String(body.track) : "cet6";
      await patchRows("user_settings", `user_id=eq.${user.id}`, { daily_new_target: Math.max(1, Math.min(200, Number(body.newTarget) || 20)), weak_review_target: Math.max(0, Math.min(200, Number(body.reviewTarget) || 20)), reminder_time: String(body.reminderTime || "20:30"), reminder_enabled: body.reminderEnabled !== false, default_track: track });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "未知操作" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    if (message === "UNAUTHORIZED") return unauthorized();
    return Response.json({ error: message }, { status: 500 });
  }
}
