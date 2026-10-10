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
// Keep this short so a newly enriched entry appears on the next refresh.
const LEXICON_CACHE_TTL_MS = 5 * 1000;
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
    getRows("vocabulary_examples?select=id,sense_id,sentence,translation,source_type,source_label,source_url,verified,rank&order=rank"),
    getRows("corpus_entries?select=word_id,position,corpus_day,corpus_unit,selection_priority,selection_source,theme,memory_hook,exam_marker&order=selection_priority,position"),
    getRows("word_comparisons?select=word_id,similar_words,distinction,contrast_example").catch(() => []),
  ]);
  const corpusWordIds = new Set(entries.map((row) => Number(row.word_id)));
  const words = wordRows.filter((row) => corpusWordIds.has(Number(row.id)));
  const senses = senseRows.filter((row) => corpusWordIds.has(Number(row.word_id)));
  const senseIds = new Set(senses.map((row) => Number(row.id)));
  const collocations = collocationRows.filter((row) => senseIds.has(Number(row.sense_id)));
  // Human-verified sentences and openly licensed Wiktionary examples are eligible
  // for display; the UI labels open-dictionary material as not yet reviewed.
  const examples = exampleRows.filter((row) =>
    senseIds.has(Number(row.sense_id)) &&
    (Boolean(row.verified) || (row.source_type === "dictionary" && /Wiktionary/i.test(String(row.source_label || ""))),
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
  let score = 0;
  if (/真题|高危|高频/.test(source)) score += 400;
  if (/≥\s*[23]|多套|复现/.test(marker)) score += 260;
  else if (/选词填空|阅读|听力/.test(marker)) score += 160;
  if (/advanced|hard|difficult|high/.test(difficulty)) score += 140;
  else if (/core|medium/.test(difficulty)) score += 80;
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
    part_of_speech: String(sense.part_of_speech || ""), core_meaning: sense.core_meaning || "释义待补充", meaning_source: String(sense.note || ""),
    meanings: senses.map((row) => ({ part_of_speech: row.part_of_speech || "", meaning: row.core_meaning || "" })),
    collocations: senses.flatMap((row) => (lexicon.collocationsBySense.get(Number(row.id)) || [])
      .slice()
      .sort((a, b) => Number(Boolean(b.verified)) - Number(Boolean(a.verified)) || Number(a.rank || 0) - Number(b.rank || 0))
      .map((item) => ({ phrase: item.content || "", translation: item.translation || "", source: item.source_label || "", verified: item.verified }))).slice(0, 3),
    example: storedSentence,
    example_translation: storedSentence ? String(example.translation || "").trim() : "",
    example_type: !storedSentence ? "例句待补" : example.source_type === "exam" ? "真题原句" : example.source_type === "dictionary" ? (String(example.source_label || "").includes("Wiktionary") ? "开放词典例句 · 非真题" : "词典例句 · 非真题") : "学习例句",
    source: !storedSentence ? "例句待补充" : example.source_label || "溯·辞学习例句",
    example_source_url: String(example.source_url || ""),
    example_verified: Boolean(example.verified),
    comparison: comparison.distinction ? { similarWords: comparison.similar_words || [], distinction: comparison.distinction, contrastExample: comparison.contrast_example || "" } : null,
    example_is_fallback: !storedSentence,
    status: progress?.status || "unlearned", proficiency: progress?.proficiency || null,