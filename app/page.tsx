/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  Flame,
  Highlighter,
  LibraryBig,
  LineChart,
  Loader2,
  Newspaper,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Pencil,
  TrendingUp,
  Volume2,
  Dumbbell,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Proficiency = "unfamiliar" | "familiar" | "mastered";
type View = "growth" | "today" | "words" | "wordbook" | "drafts" | "review" | "writing" | "stats" | "settings";
type Word = {
  id: number;
  word: string;
  phonetic: string;
  phonetic_uk?: string;
  phonetic_us?: string;
  part_of_speech: string;
  core_meaning: string;
  meaning_source?: string;
  collocations: Array<string | { phrase?: string; translation?: string; source?: string; verified?: boolean }> | string[];
  example: string;
  example_translation: string;
  example_type: string;
  example_is_fallback?: boolean;
  source: string;
  example_source_url?: string;
  example_translation_note?: string;
  example_verified?: boolean;
  status: string;
  proficiency: Proficiency | null;
  first_learned_at: string | null;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  review_count: number;
  exam_marker?: string;
  exam_priority?: number;
  task_item_id?: string;
  item_type?: "new" | "review";
  completed?: boolean;
  meanings?: Array<{ part_of_speech?: string; pos?: string; meaning?: string; definition?: string }>;
  comparison?: { similarWords?: string[] | string; distinction?: string; contrastExample?: string } | null;
};
type Collection = {
  id: string;
  word_id?: number;
  content: string;
  translation: string;
  expression_type: string;
  topic: string;
  replaceable_parts: string;
  source: string;
  note: string;
  proficiency: Proficiency;
  created_at: string;
};
type Highlight = {
  id: string;
  word_id?: number;
  content: string;
  color: string;
  note: string;
};
type WordbookItem = Word & { note: string; source_context: string; added_at: string };
type Draft = { id: string; title: string; text: string; drawing: string; updated_at: string };
type State = {
  date: string;
  task: { new_target: number; review_target: number };
  taskItems: Word[];
  words: Word[];
  wordsLoaded: boolean;
  summary: {
    total: number;
    learned: number;
    unfamiliar: number;
    familiar: number;
    mastered: number;
    reviewCount: number;
  };
  collections: Collection[];
  wordbook: WordbookItem[];
  drafts: Draft[];
  highlights: Highlight[];
  settings: {
    new_target: number;
    review_target: number;
    reminder_time: string;
    reminder_enabled?: boolean;
    track: "cet4" | "cet6" | "mixed" | "custom";
  };
  logs: Record<string, unknown>[];
  history: Record<string, unknown>[];
  user: {
    id: string;
    email: string;
    displayName: string;
    authProvider: "chatgpt" | "password";
    role?: "admin" | "learner";
  };
  corpus: {
    source: string;
    count: number;
    days: number;
    importedHistoryDays: number;
  };
};


function cleanDisplayText(value: unknown, limit = 240) {
  const text = String(value || "")
    .replace(/^\s*(?:[A-Z]|\d+)\)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const compact = text.replace(/[\s,，.。;；、:：]/g, "");
  const repeated = /([\u4E00-\u9FFF]{1,8})(?:\1){3,}/u.test(compact);
  const looksLikeAnswerKey = /(题干|原文|答案为|该段|关键词|对应原文|选项)/.test(text);
  return repeated || text.length > limit || (looksLikeAnswerKey && text.length > 120) ? "" : text;
}

function cleanExample(value: unknown) {
  return cleanDisplayText(value, 300);
}

function formatCollocations(collocations: unknown) {
  if (!Array.isArray(collocations)) return [];
  return collocations.map((item: any) => {
    const source = typeof item === "string" ? { phrase: item, translation: "" } : {
      phrase: item?.phrase || item?.content || "",
      translation: item?.translation || "",
      source: item?.source || "",
    };
    return {
      phrase: cleanDisplayText(source.phrase, 100),
      translation: cleanDisplayText(source.translation, 100),
      source: cleanDisplayText(source.source, 160),
      verified: typeof item === "object" && item ? item.verified : undefined,
    };
  }).filter((x) => x.phrase);
}

function formatMeanings(word: Word) {
  const raw = (word as any).meanings;
  if (Array.isArray(raw) && raw.length) {
    return raw
      .map((m:any) => cleanDisplayText(`${m.part_of_speech || m.pos || ""} ${m.definition || m.meaning || ""}`.trim(), 180))
      .filter(Boolean);
  }
  return [cleanDisplayText(`${word.part_of_speech || ""} ${word.core_meaning || ""}`.trim(), 180)].filter(Boolean);
}

function comparisonLines(word: Word) {
  const raw = cleanDisplayText(word.comparison?.distinction, 420)
    .replace(/使用时先核对词性、搭配和上下文，避免仅凭词形猜义。?/g, "")
    .trim();
  if (!raw) return { targetTail: "", similar: [] as string[] };
  const pieces = raw.split(/[；;]+/).map((item) => item.trim()).filter(Boolean);
  const escaped = word.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const target = new RegExp(`^${escaped}\\b\\s*`, "i");
  const first = pieces.shift() || "";
  return {
    targetTail: first.replace(target, "").trim(),
    similar: pieces.map((item) => item.replace(target, "").trim()).filter(Boolean),
  };
}

function calculateStudyStreak(history: Record<string, unknown>[]) {
  const dates = new Set(
    history
      .filter((item) => Number(item.total || 0) > 0)
      .map((item) => String(item.task_date || ""))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
  );
  const now = new Date();
  let cursor = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    const day = new Date(`${cursor}T12:00:00`);
    day.setDate(day.getDate() - 1);
    cursor = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  }
  return streak;
}

function speak(word: string, lang: "en-GB" | "en-US") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    toast.error("当前浏览器不支持本地朗读");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = lang;
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
}

type CachedState = { savedAt: number; value: State };
const STATE_CACHE_PREFIX = "suci_state_cache_v1";

function cacheKey(token: string, date: string | null, full = false) {
  // The JWT subject keeps cached learning data isolated when more than one
  // account has signed in on the same browser.
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string };
    return `${STATE_CACHE_PREFIX}:${payload.sub || "anonymous"}:${date || "today"}:${full ? "full" : "lite"}`;
  } catch {
    return `${STATE_CACHE_PREFIX}:anonymous:${date || "today"}:${full ? "full" : "lite"}`;
  }
}

function readCachedState(token: string, date: string | null, full = false) {
  try {
    const raw = localStorage.getItem(cacheKey(token, date, full));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedState;
    return cached?.value?.taskItems && Array.isArray(cached?.value?.words) ? cached.value : null;
  } catch {
    return null;
  }
}

function saveCachedState(token: string, date: string | null, value: State, full = false) {
  try {
    localStorage.setItem(cacheKey(token, date, full), JSON.stringify({ savedAt: Date.now(), value } satisfies CachedState));
  } catch {
    // Storage can be unavailable in private browsing; the live request still works.
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const nav: { id: View; label: string; icon: typeof BookOpen }[] = [
  { id: "growth", label: "每日总览", icon: Sparkles },
  { id: "today", label: "溯 · 辞", icon: BookOpen },
  { id: "words", label: "词汇总表", icon: LibraryBig },
  { id: "wordbook", label: "生词本", icon: Bookmark },
  { id: "review", label: "复习中心", icon: RotateCcw },
  { id: "writing", label: "写作金句库", icon: Bookmark },
  { id: "drafts", label: "草稿本", icon: Pencil },
  { id: "stats", label: "学习统计", icon: TrendingUp },
  { id: "settings", label: "设置", icon: Settings },
];
const labels: Record<Proficiency, string> = {
  unfamiliar: "不熟练",
  familiar: "微熟练",
  mastered: "很熟练",
};
const proficiencyStyles: Record<Proficiency, string> = {
  unfamiliar: "border-[#F98C53] bg-[#FFF4ED] text-[#A64B1C]",
  familiar: "border-[#ABD7FB] bg-[#EFF8FF] text-[#28628F]",
  mastered: "border-[#D2E0AA] bg-[#F4F8E9] text-[#556B2F]",
};

export default function Home() {
  const [data, setData] = useState<State | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [enrichingWordId, setEnrichingWordId] = useState<number | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [view, setView] = useState<View>("growth");
  const [loading, setLoading] = useState(true);
  const [hiddenParts, setHiddenParts] = useState({ meaning: false, collocation: false, example: false });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [wordOrder, setWordOrder] = useState<"corpus" | "exam">("corpus");
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [collectionWordId, setCollectionWordId] = useState<
    number | undefined
  >();
  const [collectionForm, setCollectionForm] = useState({
    content: "",
    translation: "",
    expressionType: "句型",
    topic: "通用",
    replaceableParts: "",
    source: "用户收藏",
    note: "",
  });
  const [selection, setSelection] = useState<{
    content: string;
    wordId?: number;
    top: number;
    left: number;
  } | null>(null);
  const [inlineCollection, setInlineCollection] = useState<{
    wordId?: number;
    content: string;
    translation: string;
    expressionType: string;
    topic: string;
    replaceableParts: string;
    source: string;
    note: string;
    top: number;
    left: number;
  } | null>(null);
  const [practice, setPractice] = useState<{
    id: string;
    content: string;
    text: string;
  } | null>(null);
  const [moreCount, setMoreCount] = useState(20);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [stickyOpen, setStickyOpen] = useState(false);
  const [stickyPosition, setStickyPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const token = localStorage.getItem("suci_access_token");
    if (token) {
      const cached = readCachedState(token, null);
      if (cached) {
        setData(cached);
        setLoading(false);
      }
    }
    setAccessToken(token);
    setAuthReady(true);
  }, []);

  const authorizedFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const run = (token: string) =>
        fetch(url, {
          ...init,
          headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${token}` },
        });
      if (!accessToken) return new Response(JSON.stringify({ error: "请先登录" }), { status: 401 });
      let response = await run(accessToken);
      // Supabase can briefly reject a freshly-issued session as "issued at
      // future" while its Auth and Data API clocks converge. Retrying the
      // same request avoids showing users an unnecessary red error message.
      for (let attempt = 0; attempt < 2 && response.status === 401; attempt++) {
        const text = await response.clone().text();
        if (!/issued at future|jwt.*future|PGRST303/i.test(text)) break;
        await wait(700 * (attempt + 1));
        response = await run(accessToken);
      }
      if (response.status !== 401) return response;
      const refreshToken = localStorage.getItem("suci_refresh_token");
      if (!refreshToken) return response;
      const refreshed = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh", refreshToken }),
      });
      if (!refreshed.ok) return response;
      const session = (await refreshed.json()) as { access_token: string; refresh_token: string };
      localStorage.setItem("suci_access_token", session.access_token);
      localStorage.setItem("suci_refresh_token", session.refresh_token);
      setAccessToken(session.access_token);
      return run(session.access_token);
    },
    [accessToken],
  );

  const load = useCallback(async (full = false, refreshLexicon = false) => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    const cached = readCachedState(accessToken, selectedDate, full);
    if (cached) {
      setData(cached);
      setLoading(false);
    }
    try {
      const params = new URLSearchParams();
      if (selectedDate) params.set("date", selectedDate);
      if (full) params.set("full", "1");
      if (refreshLexicon) params.set("refreshLexicon", "1");
      const endpoint = `/api/state${params.size ? `?${params}` : ""}`;
      const response = await authorizedFetch(endpoint, { cache: "no-store" });
      const payload = (await response.json()) as State & { error?: string };
      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem("suci_access_token");
          localStorage.removeItem("suci_refresh_token");
          setAccessToken(null);
        }
        throw new Error(payload.error || "加载失败");
      }
      setData(payload);
      saveCachedState(accessToken, selectedDate, payload, full);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [accessToken, authorizedFetch, selectedDate]);
  useEffect(() => {
    if (authReady) void load();
  }, [authReady, load]);
  useEffect(() => {
    if (["words", "review", "stats"].includes(view) && data && !data.wordsLoaded) void load(true);
  }, [data, load, view]);
  const mutate = async (body: Record<string, unknown>, success?: string) => {
    const endpoint = selectedDate ? `/api/state?date=${encodeURIComponent(selectedDate)}` : "/api/state";
    const response = await authorizedFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { error?: string; [key: string]: unknown };
    if (!response.ok) {
      toast.error(payload.error || "保存失败");
      return false;
    }
    if (success) toast.success(success);
    await load(Boolean(data?.wordsLoaded));
    return payload;
  };
  const enrichWordFromLicensedSources = async (word: Word) => {
    if (enrichingWordId === word.id) return;
    setEnrichingWordId(word.id);
    try {
      const response = await authorizedFetch("/api/free-lexicon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word: word.word }),
      });
      const payload = (await response.json()) as { error?: string; note?: string; updated?: string[] };
      if (!response.ok) throw new Error(payload.error || "自动补全暂不可用");
      await load(Boolean(data?.wordsLoaded), true);
      toast.success(payload.updated?.length ? `已补充：${payload.updated.join("、")}；来源已在词卡中标明` : payload.note || "本次未找到可补充资料");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "自动补全暂不可用");
    } finally {
      setEnrichingWordId(null);
    }
  };
  const rateWord = async (word: Word, proficiency: Proficiency) => {
    if (!data || !accessToken) return;
    const previous = data;
    // Update this screen immediately. The same payload is then persisted in
    // the background; an error restores the exact pre-click state.
    const updateWord = (item: Word) => item.id === word.id
      ? { ...item, proficiency, status: "learned", completed: item.task_item_id === word.task_item_id ? true : item.completed, last_reviewed_at: new Date().toISOString() }
      : item;
    const wasLearned = ["learned", "learned_unrated"].includes(word.status);
    const updated = {
      ...data,
      taskItems: data.taskItems.map(updateWord),
      words: data.words.map(updateWord),
      summary: {
        ...data.summary,
        learned: data.summary.learned + (wasLearned ? 0 : 1),
        unfamiliar: data.summary.unfamiliar + (word.proficiency === "unfamiliar" ? -1 : 0) + (proficiency === "unfamiliar" ? 1 : 0),
        familiar: data.summary.familiar + (word.proficiency === "familiar" ? -1 : 0) + (proficiency === "familiar" ? 1 : 0),
        mastered: data.summary.mastered + (word.proficiency === "mastered" ? -1 : 0) + (proficiency === "mastered" ? 1 : 0),
      },
    };
    setData(updated);
    saveCachedState(accessToken, selectedDate, updated, Boolean(data.wordsLoaded));
    try {
      const endpoint = selectedDate ? `/api/state?date=${encodeURIComponent(selectedDate)}` : "/api/state";
      const response = await authorizedFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rate-word", wordId: word.id, itemId: word.task_item_id, proficiency }) });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "保存失败");
      toast.success(`已标记为${labels[proficiency]}`);
    } catch (error) {
      setData(previous);
      saveCachedState(accessToken, selectedDate, previous, Boolean(previous.wordsLoaded));
      toast.error(error instanceof Error ? error.message : "保存失败，已恢复原状态");
    }
  };
  const signOut = async () => {
    try {
      await authorizedFetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    } finally {
      localStorage.removeItem("suci_access_token");
      localStorage.removeItem("suci_refresh_token");
      setData(null);
      setAccessToken(null);
      setLoading(false);
    }
  };
  const openCollection = (
    content = "",
    wordId?: number,
    translation = "",
    source = "用户收藏",
  ) => {
    setEditingCollectionId(null);
    setCollectionWordId(wordId);
    setCollectionForm({
      content,
      translation,
      expressionType: content.split(" ").length < 7 ? "词组" : "句型",
      topic: "通用",
      replaceableParts: "",
      source,
      note: "",
    });
    setCollectionOpen(true);
    setSelection(null);
  };
  const editCollection = (collection: Collection) => {
    setEditingCollectionId(collection.id);
    setCollectionWordId(collection.word_id);
    setCollectionForm({
      content: collection.content,
      translation: collection.translation,
      expressionType: collection.expression_type,
      topic: collection.topic || "通用",
      replaceableParts: collection.replaceable_parts || "",
      source: collection.source || "用户收藏",
      note: collection.note || "",
    });
    setCollectionOpen(true);
  };
  const saveCollection = async () => {
    const editing = Boolean(editingCollectionId);
    if (
      await mutate(
        {
          action: editing ? "update-collection" : "collect",
          id: editingCollectionId,
          wordId: collectionWordId,
          ...collectionForm,
        },
        editing ? "写作金句已更新" : "已加入写作金句库",
      )
    ) {
      setCollectionOpen(false);
      setEditingCollectionId(null);
    }
  };
  const openInlineCollection = (
    content: string,
    wordId?: number,
    translation = "",
    source = "用户收藏",
    anchor?: { top: number; left: number },
  ) => {
    const left = Math.max(12, Math.min(window.innerWidth - 470, anchor?.left ?? window.innerWidth / 2 - 220));
    const top = Math.max(12, Math.min(window.innerHeight - 500, anchor?.top ?? 96));
    setInlineCollection({
      wordId, content, translation,
      expressionType: content.trim().split(/\s+/).length < 7 ? "词组" : "句型",
      topic: "通用", replaceableParts: "", source, note: "", top, left,
    });
    setSelection(null);
  };
  const saveInlineCollection = async () => {
    if (!inlineCollection) return;
    if (
      await mutate(
        { action: "collect", ...inlineCollection },
        "已加入写作金句库",
      )
    ) {
      setInlineCollection(null);
    }
  };
  const captureSelection = (wordId?: number) => {
    const browserSelection = window.getSelection();
    const text = browserSelection?.toString().trim();
    if (!text || text.length < 2 || !browserSelection?.rangeCount) return;
    const rect = browserSelection.getRangeAt(0).getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - 170,
      Math.max(170, rect.left + rect.width / 2),
    );
    setSelection({
      content: text,
      wordId,
      top: Math.max(8, rect.top - 58),
      left,
    });
  };
  const saveHighlight = async () => {
    if (!selection) return;
    await mutate(
      {
        action: "highlight",
        wordId: selection.wordId,
        content: selection.content,
        color: "#FCCEB4",
      },
      "高亮已保存",
    );
    setSelection(null);
  };
  const addSelectionToWordbook = async () => {
    if (!selection?.wordId) return;
    const exists = (appData.wordbook || []).some((item) => item.id === selection.wordId);
    if (exists) {
      toast.success("这个词已经在生词本");
      setSelection(null);
      return;
    }
    const saved = await mutate(
      { action: "add-to-wordbook", wordId: selection.wordId, sourceContext: "溯·辞选词" },
      "已加入生词本",
    );
    if (saved) setSelection(null);
  };

  const reviewItems =
    data?.taskItems.filter((item) => item.item_type === "review") ?? [];
  const newItems =
    data?.taskItems.filter((item) => item.item_type === "new") ?? [];
  const reviewDone = reviewItems.filter((item) => item.completed).length;
  const newDone = newItems.filter((item) => item.completed).length;
  const learned = data?.wordsLoaded
    ? data.words.filter((word) => ["learned", "learned_unrated"].includes(word.status)).length
    : data?.summary.learned ?? 0;
  const mastered = data?.wordsLoaded ? data.words.filter((word) => word.proficiency === "mastered").length : data?.summary.mastered ?? 0;
  const unfamiliar = data?.wordsLoaded ? data.words.filter((word) => word.proficiency === "unfamiliar").length : data?.summary.unfamiliar ?? 0;
  const familiar = data?.wordsLoaded ? data.words.filter((word) => word.proficiency === "familiar").length : data?.summary.familiar ?? 0;
  const totalWords = data?.wordsLoaded ? data.words.length : data?.summary.total ?? 0;
  const filteredWords = useMemo(
    () =>
      (data?.words ?? []).filter((word) => {
        const matches =
          `${word.word} ${word.core_meaning} ${word.collocations.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase());
        return (
          matches &&
          (statusFilter === "all" ||
            word.status === statusFilter ||
            word.proficiency === statusFilter)
        );
      }).sort((a, b) => wordOrder === "exam" ? Number(b.exam_priority || 0) - Number(a.exam_priority || 0) || a.word.localeCompare(b.word) : 0),
    [data, query, statusFilter, wordOrder],
  );

  if (!authReady || (loading && !data))
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-base text-[#697386]">
          <Loader2 className="size-5 animate-spin" />
          正在打开你的 DailyGlow…
        </div>
      </main>
    );
  if (!accessToken)
    return (
      <LoginScreen
        onSession={(session) => {
          localStorage.setItem("suci_access_token", session.access_token);
          localStorage.setItem("suci_refresh_token", session.refresh_token);
          setLoading(true);
          setAccessToken(session.access_token);
        }}
      />
    );
  if (!data)
    return (
      <main className="grid min-h-screen place-items-center">
        <Button
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          重新加载
        </Button>
      </main>
    );

  const appData = data;
  const activeDate = selectedDate || appData.date;

  function GrowthView() {
    return (
      <div className="space-y-7">
        <section className="relative overflow-hidden rounded-[2rem] border border-[#D7E7F2] bg-[linear-gradient(120deg,#F6FBFF_0%,#FFF9F5_58%,#F3F8E9_100%)] p-6 shadow-[0_16px_45px_rgba(36,50,71,0.07)] sm:p-8">
          <div className="pointer-events-none absolute -right-12 -top-16 size-64 rounded-full border-[20px] border-[#ABD7FB]/35" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl"><p className="flex items-center gap-2 text-sm font-bold text-[#28628F]"><Sparkles className="size-4" />DAILYGLOW · PERSONAL DAILY SYSTEM</p><h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">今天，向前一点就很好。</h1><p className="mt-4 max-w-xl text-sm leading-7 text-[#697386]">把六级学习、每日简报、市场观察与训练放进同一份节奏里；每个模块独立保存，但都属于你的今天。</p></div>
            <div className="rounded-2xl border border-white/80 bg-white/70 px-5 py-4 backdrop-blur"><p className="text-xs font-bold text-[#697386]">今日日期</p><p className="mt-1 text-lg font-black">{activeDate}</p><p className="mt-1 text-sm text-[#28628F]">连续学习 {calculateStudyStreak(appData.history)} 天</p></div>
          </div>
        </section>

        <section><div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-sm font-bold text-[#28628F]">DAILY INPUTS</p><h2 className="mt-1 text-2xl font-black">今天还需要什么</h2></div><Link href="/daily" className="text-sm font-bold text-[#28628F]">打开完整每日中心</Link></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><button onClick={() => setView("words")} className="group rounded-[1.5rem] border border-[#F1DDCF] bg-[#FFF8F3] p-5 text-left transition hover:-translate-y-1 hover:shadow-md"><span className="grid size-10 place-items-center rounded-2xl bg-[#FCCEB4]"><BookOpen className="size-5 text-[#8A4826]" /></span><h3 className="mt-5 font-black">溯 · 辞</h3><p className="mt-2 text-sm leading-6 text-[#697386]">今日词汇 {reviewDone + newDone}/{reviewItems.length + newItems.length}，先完成一轮复习或新词。</p><span className="mt-4 inline-flex items-center text-sm font-bold text-[#8A4826]">开始学习 <ChevronRight className="size-4" /></span></button><Link href="/insights?focus=growth_brief" className="group rounded-[1.5rem] border border-[#D7E7F2] bg-[#F4FAFF] p-5 transition hover:-translate-y-1 hover:shadow-md"><span className="grid size-10 place-items-center rounded-2xl bg-[#ABD7FB]"><Newspaper className="size-5 text-[#1F4161]" /></span><h3 className="mt-5 font-black">每日成长简报</h3><p className="mt-2 text-sm leading-6 text-[#697386]">早间信息、科研机会与今日行动，独立阅读与完成。</p><span className="mt-4 inline-flex items-center text-sm font-bold text-[#28628F]">查看简报 <ChevronRight className="size-4" /></span></Link><Link href="/insights?focus=fund_strategy" className="group rounded-[1.5rem] border border-[#F3D8C7] bg-[#FFF8F3] p-5 transition hover:-translate-y-1 hover:shadow-md"><span className="grid size-10 place-items-center rounded-2xl bg-[#FFC9AB]"><LineChart className="size-5 text-[#C6633D]" /></span><h3 className="mt-5 font-black">基金市场观察</h3><p className="mt-2 text-sm leading-6 text-[#697386]">基金策略与盘中风险，分开阅读和继续追问。</p><span className="mt-4 inline-flex items-center text-sm font-bold text-[#C6633D]">查看市场 <ChevronRight className="size-4" /></span></Link><Link href="/training" className="group rounded-[1.5rem] border border-[#DDE9C3] bg-[#F8FBEF] p-5 transition hover:-translate-y-1 hover:shadow-md"><span className="grid size-10 place-items-center rounded-2xl bg-[#D2E0AA]"><Dumbbell className="size-5 text-[#556B2F]" /></span><h3 className="mt-5 font-black">运动塑形</h3><p className="mt-2 text-sm leading-6 text-[#697386]">按当天计划完成动作；也可先查看历史训练的完整内容。</p><span className="mt-4 inline-flex items-center text-sm font-bold text-[#556B2F]">开始训练 <ChevronRight className="size-4" /></span></Link></div></section>
      </div>
    );
  }

  function TodayView() {
    return (
      <div className="space-y-7">
        <section className="overflow-hidden rounded-[1.75rem] border border-[#D7E7F2] bg-[#F6FBFF] shadow-[0_12px_35px_rgba(31,65,97,0.06)]">
          <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-sm font-bold text-[#28628F]"><Sparkles className="size-4" />DailyGlow · 每日成长</div>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-[#243247] sm:text-3xl">先学词，也别忘了照顾今天的自己。</h1>
              <p className="mt-2 leading-6 text-sm text-[#697386]">溯 · 辞是你的学习模块；每日简报、基金观察和训练计划都在同一个私有云端账户里。</p>
            </div>
            <Link href="/daily" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#CFE7F1] px-5 py-3 text-sm font-bold text-[#465A6B] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#B9DAE7]">
              打开今日成长中心 <ChevronRight className="size-4" />
            </Link>
          </div>
          <div className="grid border-t border-[#D7E7F2] sm:grid-cols-4">
            <button onClick={() => setView("words")} className="flex items-center gap-3 border-b border-[#D7E7F2] px-5 py-4 text-left transition hover:bg-white/50 sm:border-b-0 sm:border-r"><span className="grid size-9 place-items-center rounded-xl bg-[#FCCEB4]"><BookOpen className="size-4" /></span><span><b className="block text-sm">溯 · 辞</b><small className="text-[#697386]">今日词汇 {reviewDone + newDone}/{reviewItems.length + newItems.length}</small></span></button>
            <Link href="/insights?focus=growth_brief" className="flex items-center gap-3 border-b border-[#D7E7F2] px-5 py-4 transition hover:bg-white/50 sm:border-b-0 sm:border-r"><span className="grid size-9 place-items-center rounded-xl bg-[#ABD7FB]"><Newspaper className="size-4 text-[#1F4161]" /></span><span><b className="block text-sm">每日简报</b><small className="text-[#697386]">独立阅读与完成</small></span></Link>
            <Link href="/insights?focus=fund_strategy" className="flex items-center gap-3 border-b border-[#D7E7F2] px-5 py-4 transition hover:bg-white/50 sm:border-b-0 sm:border-r"><span className="grid size-9 place-items-center rounded-xl bg-[#D2E0AA]"><LineChart className="size-4 text-[#556B2F]" /></span><span><b className="block text-sm">基金市场</b><small className="text-[#697386]">策略与风控分开记录</small></span></Link>
            <Link href="/training" className="flex items-center gap-3 px-5 py-4 transition hover:bg-white/50"><span className="grid size-9 place-items-center rounded-xl bg-[#FCE0D7]"><Dumbbell className="size-4 text-[#8B4B42]" /></span><span><b className="block text-sm">今日训练</b><small className="text-[#697386]">DailyGlow 运动计划</small></span></Link>
          </div>
        </section>
        <section className="grid gap-4 md:grid-cols-4">
          <Metric
            label="今日复习"
            value={`${reviewDone}/${reviewItems.length}`}
            note={reviewItems.length ? "优先回收薄弱词" : "完成新词后开始积累"}
            color="#ABD7FB"
            icon={RotateCcw}
          />
          <Metric
            label="今日新词"
            value={`${newDone}/${newItems.length}`}
            note={`今日目标 ${appData.task.new_target} 个`}
            color="#FCCEB4"
            icon={BookOpen}
          />
          <Metric
            label="已背诵"
            value={String(learned)}
            note={`总词库 ${totalWords} 个`}
            color="#D2E0AA"
            icon={Check}
          />
          <Metric
            label="写作收藏"
            value={String(appData.collections.length)}
            note="从认识到主动表达"
            color="#F98C53"
            icon={Bookmark}
          />
        </section>
        <TaskSection
          title="今日先复习"
          subtitle="来自多个学习日，不熟练词优先"
          items={reviewItems}
          accent="#ABD7FB"
          empty="现在还没有到期词。先完成今天的新词，系统会按第 1、3、7、15 天为你安排回收。"
        />
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-[#F2D7C7] bg-[#FFF9F5] p-3">
          <span className="mr-auto text-sm text-[#697386]">今天还想多背？可按任意数量继续加入。</span>
          <Input
            className="w-24"
            type="number"
            min={1}
            max={200}
            value={moreCount}
            onChange={(event) => setMoreCount(Number(event.target.value))}
          />
          <Button onClick={() => mutate({ action: "add-more-new", count: moreCount }, `已继续加入 ${moreCount} 个新词`)}>
            <Plus className="size-4" />
            继续添加
          </Button>
        </div>
        <TaskSection
          title="今日新词"
          subtitle="先抓词性、一个核心义和一个高频搭配"
          items={newItems}
          accent="#FCCEB4"
        />
        <TaskInsights items={[...reviewItems, ...newItems]} />
        <WritingReview />
      </div>
    );
  }

  function TaskSection({
    title,
    subtitle,
    items,
    accent,
    empty,
  }: {
    title: string;
    subtitle: string;
    items: Word[];
    accent: string;
    empty?: string;
  }) {
    const done = items.filter((item) => item.completed).length;
    return (
      <section className="overflow-hidden rounded-3xl border bg-[#FFFDFB] shadow-sm">
        <div className="flex flex-wrap items-center gap-4 border-b p-5">
          <span
            className="h-11 w-1.5 rounded-full"
            style={{ background: accent }}
          />
          <div className="mr-auto">
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-[#697386]">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {([
              ["meaning", "单词释义"],
              ["example", "例句中文"],
            ] as const).map(([key, label]) => (
              <Button key={key} size="sm" variant="outline" onClick={() => setHiddenParts((previous) => ({ ...previous, [key]: !previous[key] }))}>
                {hiddenParts[key] ? `显示${label}` : `遮住${label}`}
              </Button>
            ))}
          </div>
          <div className="w-32">
            <Progress value={items.length ? (done / items.length) * 100 : 0} />
            <p className="mt-1 text-right text-xs text-[#697386]">
              {done}/{items.length}
            </p>
          </div>
        </div>
        {items.length ? (
          <VocabularyTable words={items} />
        ) : (
          <div className="p-8 text-center text-sm leading-7 text-[#697386]">
            {empty || "今日暂无任务"}
          </div>
        )}
      </section>
    );
  }

  function InlineCollectionPanel() {
    if (!inlineCollection) return null;
    const update = (key: keyof typeof inlineCollection, value: string) =>
      setInlineCollection({ ...inlineCollection, [key]: value });
    const dragRef = useRef<{ dx: number; dy: number } | null>(null);
    const stopDrag = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", moveDrag);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
    const moveDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setInlineCollection((current) =>
        current
          ? {
              ...current,
              left: Math.max(8, Math.min(window.innerWidth - 300, event.clientX - drag.dx)),
              top: Math.max(8, Math.min(window.innerHeight - 180, event.clientY - drag.dy)),
            }
          : current,
      );
    };
    const startDrag = (event: any) => {
      event.preventDefault();
      dragRef.current = {
        dx: event.clientX - inlineCollection.left,
        dy: event.clientY - inlineCollection.top,
      };
      window.addEventListener("pointermove", moveDrag);
      window.addEventListener("pointerup", stopDrag);
      window.addEventListener("pointercancel", stopDrag);
    };
    return (
      <div
        className="fixed z-[70] w-[min(92vw,460px)] resize overflow-auto rounded-2xl border border-[#E5D5CC] bg-[#FFFDFB] p-4 shadow-2xl"
        style={{ top: inlineCollection.top, left: inlineCollection.left, maxHeight: "min(32rem, calc(100vh - 1.5rem))", minHeight: 300 }}
      >
        <div
          className="mb-3 flex cursor-move touch-none items-center justify-between gap-3 border-b border-[#F0E4DE] pb-2"
          onPointerDown={startDrag}
        >
          <div>
            <h3 className="text-sm font-semibold">收藏到写作金句</h3>
            <p className="mt-0.5 text-xs text-[#697386]">
              按住这里可拖动；右下角可拉伸。
            </p>
          </div>
          <button
            className="cursor-pointer text-lg text-[#697386]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setInlineCollection(null)}
          >
            ×
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium">收藏内容</span>
            <textarea
              className="min-h-16 w-full rounded-xl border bg-white p-2 text-sm"
              value={inlineCollection.content}
              onChange={(e) => update("content", e.target.value)}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium">中文含义</span>
            <Input
              value={inlineCollection.translation}
              onChange={(e) => update("translation", e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">表达类型</span>
            <select
              className="h-10 w-full rounded-xl border bg-white px-3 text-sm"
              value={inlineCollection.expressionType}
              onChange={(e) => update("expressionType", e.target.value)}
            >
              {[
                "词组",
                "句型",
                "论证句",
                "举例句",
                "建议句",
                "让步句",
                "结论句",
                "连接表达",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">主题</span>
            <select
              className="h-10 w-full rounded-xl border bg-white px-3 text-sm"
              value={inlineCollection.topic}
              onChange={(e) => update("topic", e.target.value)}
            >
              {[
                "通用",
                "科技",
                "教育",
                "环境",
                "社会",
                "文化",
                "青年成长",
                "健康",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium">可替换成分</span>
            <Input
              placeholder="如 reconcile [A] with [B]"
              value={inlineCollection.replaceableParts}
              onChange={(e) => update("replaceableParts", e.target.value)}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium">个人笔记</span>
            <Input
              placeholder="适用话题、易错点或改写思路"
              value={inlineCollection.note}
              onChange={(e) => update("note", e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setInlineCollection(null)}
          >
            取消
          </Button>
          <Button size="sm" onClick={saveInlineCollection}>
            <Bookmark className="size-4" />
            收藏并关闭
          </Button>
        </div>
      </div>
    );
  }


  function HandwritingSticky() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawingRef = useRef(false);
    const dragRef = useRef<{ dx: number; dy: number } | null>(null);
    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const erasingRef = useRef(false);
    const [color, setColor] = useState("#8D4A28");
    const [brush, setBrush] = useState(3);
    const [longPressErasing, setLongPressErasing] = useState(false);

    const getPoint = (event: any) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * canvas.width / rect.width,
        y: (event.clientY - rect.top) * canvas.height / rect.height,
      };
    };
    const pressureWidth = (event: any, erasing: boolean) => {
      const pressure = typeof event.pressure === "number" && event.pressure > 0 ? event.pressure : 0.5;
      return erasing ? 10 + pressure * 36 : Math.max(1, brush * (0.55 + pressure * 0.9));
    };
    const strokeTo = (event: any, erasing: boolean, begin = false) => {
      const canvas = canvasRef.current;
      const point = getPoint(event);
      const context = canvas?.getContext("2d");
      if (!point || !context) return;
      context.globalCompositeOperation = erasing ? "destination-out" : "source-over";
      context.strokeStyle = color;
      context.lineWidth = pressureWidth(event, erasing);
      context.lineCap = "round";
      context.lineJoin = "round";
      if (begin) {
        context.beginPath();
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
        context.stroke();
      }
    };
    const cancelHold = () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    };
    const begin = (event: any) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      erasingRef.current = false;
      setLongPressErasing(false);
      holdTimerRef.current = setTimeout(() => {
        if (!drawingRef.current) return;
        erasingRef.current = true;
        setLongPressErasing(true);
        strokeTo(event, true, true);
      }, 450);
    };
    const draw = (event: any) => {
      if (!drawingRef.current) return;
      if (!erasingRef.current) {
        if (holdTimerRef.current) {
          cancelHold();
          strokeTo(event, false, true);
          return;
        }
        strokeTo(event, false);
        return;
      }
      strokeTo(event, true);
    };
    const end = () => {
      cancelHold();
      drawingRef.current = false;
      erasingRef.current = false;
      setLongPressErasing(false);
    };
    const clear = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    };
    const save = async () => {
      const drawing = canvasRef.current?.toDataURL("image/png") || "";
      if (!drawing) return;
      await mutate({ action: "save-draft", title: "手写便签", text: "", drawing }, "手写便签已保存到草稿本");
    };
    const stopDrag = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", moveDrag);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
    const moveDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setStickyPosition({
        left: Math.max(8, Math.min(window.innerWidth - 350, event.clientX - drag.dx)),
        top: Math.max(8, Math.min(window.innerHeight - 330, event.clientY - drag.dy)),
      });
    };
    const startDrag = (event: any) => {
      event.preventDefault();
      dragRef.current = { dx: event.clientX - stickyPosition.left, dy: event.clientY - stickyPosition.top };
      window.addEventListener("pointermove", moveDrag);
      window.addEventListener("pointerup", stopDrag);
      window.addEventListener("pointercancel", stopDrag);
    };
    if (!stickyOpen) return null;
    return (
      <section className="fixed z-[65] w-[min(92vw,340px)] overflow-hidden rounded-2xl border border-[#E7D5B3] bg-[#FFFCEB] shadow-2xl" style={{ left: stickyPosition.left, top: stickyPosition.top }}>
        <div className="flex cursor-grab touch-none select-none items-center justify-between border-b border-[#E7D5B3] bg-[#FFF5C8] px-3 py-2 active:cursor-grabbing" onPointerDown={startDrag}>
          <span className="text-sm font-semibold text-[#7B5426]">手写便签 · 按住这里拖动</span>
          <button className="cursor-pointer text-lg text-[#8A704D]" onPointerDown={(event) => event.stopPropagation()} onClick={() => setStickyOpen(false)}>×</button>
        </div>
        <div className="p-3">
          <canvas ref={canvasRef} width={620} height={400} className="h-52 w-full touch-none rounded-xl border border-dashed border-[#D8C58B] bg-[#FFFDF5]" onPointerDown={begin} onPointerMove={draw} onPointerUp={end} onPointerCancel={end} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <input aria-label="笔触颜色" type="color" value={color} onChange={(event) => setColor(event.target.value)} className="size-7 cursor-pointer rounded border-0 bg-transparent p-0" />
            <input aria-label="笔触粗细" type="range" min="1" max="10" value={brush} onChange={(event) => setBrush(Number(event.target.value))} className="w-20 accent-[#A66A32]" />
            <button className="text-xs text-[#80633B] hover:text-[#A64B1C]" onClick={clear}>清空</button>
            <button className="rounded-lg bg-[#A66A32] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#8D5727]" onClick={save}>保存</button>
          </div>
          <p className="mt-1 text-[11px] text-[#9A825F]">{longPressErasing ? "正在橡皮擦：保持按住并移动即可擦除。" : "画布内原地长按约 0.45 秒进入压力橡皮；松开后自动恢复画笔。"}</p>
        </div>
      </section>
    );
  }

  function VocabularyTable({ words }: { words: Word[] }) {
    return (
      <div className="space-y-3">
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow className="bg-[#FAF6F3]">
            <TableHead className="pl-5">单词</TableHead>
            <TableHead className="w-[22%]">核心含义</TableHead>
            <TableHead className="w-[18%]">必记搭配</TableHead>
            <TableHead className="w-[35%]">例句</TableHead>
            <TableHead className="pr-5">熟练度</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {words.map((word) => (
            <TableRow
              key={`${word.task_item_id}-${word.id}`}
              onMouseUp={() => captureSelection(word.id)}
              className={word.completed ? "bg-[#F7FAEF]" : ""}
            >
              <TableCell className="pl-5 align-top">
                <strong
                  className="text-base text-[#1F4161]"
                  onMouseUp={() => captureSelection(word.id)}
                >
                  {renderMarkedText(
                    word.word,
                    word.word,
                    appData.highlights.filter((h) => h.word_id === word.id),
                  )}
                </strong>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#697386]">
                  <button type="button" onClick={() => speak(word.word, "en-GB")} title="播放英音" className="inline-flex items-center gap-1 hover:text-[#A64B1C]"><Volume2 className="size-3" />英 {word.phonetic_uk || word.phonetic || "—"}</button>
                  <button type="button" onClick={() => speak(word.word, "en-US")} title="播放美音" className="inline-flex items-center gap-1 hover:text-[#A64B1C]"><Volume2 className="size-3" />美 {word.phonetic_us || word.phonetic || "—"}</button>
                </div>
              </TableCell>
              <TableCell className="max-w-56 whitespace-normal align-top">
                <span className={hiddenParts.meaning ? "select-none rounded bg-[#E9E4E1] text-transparent" : ""}>
                  {formatMeanings(word).map((m) => (
                    <div key={m} className="leading-8 [&+div]:mt-2">{m}</div>
                  ))}
                </span>
                {word.meaning_source && <p className="mt-1 text-[10px] leading-4 text-[#8A94A4]">来源说明：{word.meaning_source}</p>}
              </TableCell>
              <TableCell className="max-w-60 whitespace-normal align-top">
                <div className="space-y-2.5">
                  {formatCollocations(word.collocations).map((x) => (
                    <div key={x.phrase} className="space-y-0.5">
                      <code className="block w-fit rounded-lg bg-[#EFF8FF] px-3 py-1 text-sm leading-5 text-[#28628F]">
                        {x.phrase}
                      </code>
                      {x.translation && (
                        <span className="block text-sm leading-5 text-[#697386]">{x.translation}</span>
                      )}
                      {x.source && <span className="block text-[10px] leading-4 text-[#8A94A4]">来源：{x.source}{x.verified === false ? " · 待核验" : ""}</span>}
                    </div>
                  ))}
                  {!formatCollocations(word.collocations).length && (
                    <span className="text-xs text-[#8A94A4]">搭配待补充</span>
                  )}
                  {(!formatCollocations(word.collocations).length || formatCollocations(word.collocations).some((item) => !item.translation)) && (
                    <button type="button" onClick={() => void enrichWordFromLicensedSources(word)} disabled={enrichingWordId === word.id}
                      className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-[#ABD7FB] px-2.5 py-1.5 text-xs text-[#28628F] hover:bg-[#EFF8FF] disabled:cursor-wait disabled:opacity-60">
                      {enrichingWordId === word.id ? <><Loader2 className="size-3 animate-spin" />正在补齐</> : "补充搭配"}
                    </button>
                  )}
                </div>
              </TableCell>
              <TableCell className="whitespace-normal align-top">
                <p className="leading-6">
                  {cleanExample(word.example)
                    ? renderMarkedText(cleanExample(word.example), word.word, appData.highlights.filter((h) => h.word_id === word.id))
                    : <span className="text-[#8A94A4]">例句待补充</span>}
                </p>
                {(!word.phonetic_uk || !word.phonetic_us || !word.core_meaning || /释义待补充|meaning pending/i.test(word.core_meaning) ||
                  !cleanExample(word.example) || !word.example_translation) && (
                  <div className="mt-2 space-y-1">
                    <button type="button" onClick={() => void enrichWordFromLicensedSources(word)} disabled={enrichingWordId === word.id}
                      className="inline-flex items-center gap-1 rounded-md border border-dashed border-[#ABD7FB] px-2.5 py-1.5 text-xs text-[#28628F] hover:bg-[#EFF8FF] disabled:cursor-wait disabled:opacity-60">
                      {enrichingWordId === word.id ? <><Loader2 className="size-3 animate-spin" />正在补齐</> : "补全例句与释义"}
                    </button>
                    <span className="block max-w-sm text-[10px] leading-4 text-[#8A94A4]">从 Wiktionary 开放词典补充例句、释义和音标；搭配候选来自语料并标注待核验。不是六级真题。机器翻译待核对。</span>
                  </div>
                )}
                <p
                  className={`mt-2 text-sm leading-6 text-[#697386] ${hiddenParts.example ? "select-none rounded bg-[#E9E4E1] text-transparent" : ""}`}
                >
                  {cleanDisplayText(word.example_translation, 300) || "该例句翻译待补充"}
                </p>
                {word.example_translation_note?.includes("机器翻译") && (
                  <span className="text-[10px] text-[#8A94A4]">机器翻译，待核对</span>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[11px]">
                    {word.example_type}
                  </Badge>
                  <button
                    type="button"
                    className="rounded-md border border-[#E5DAD4] px-2 py-0.5 text-[11px] text-[#A64B1C] hover:border-[#F98C53]"
                    onClick={() => mutate({ action: "add-to-wordbook", wordId: word.id, sourceContext: "例句关联词" }, "已记入生词本")}
                  >
                    {(appData.wordbook || []).some((item) => item.id === word.id) ? "已在生词本" : "加入生词本"}
                  </button>
                  {word.source && (
                    <span className="text-[11px] text-[#697386]">
                      来源：{word.example_source_url ? <a href={word.example_source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{word.source}</a> : word.source}
                      {!word.example_verified && word.example_type.includes("开放词典") ? " · 待核验" : ""}
                      {word.example_type.includes("开放词典") ? <> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="underline underline-offset-2">CC BY-SA 4.0</a></> : ""}
                    </span>
                  )}

                </div>
                {appData.highlights.some((h) => h.word_id === word.id) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {appData.highlights
                      .filter((h) => h.word_id === word.id)
                      .slice(0, 4)
                      .map((h) => (
                        <span
                          key={h.id}
                          className="rounded-md px-1.5 py-0.5 text-[11px] text-[#7F3C1D]"
                          style={{ background: h.color }}
                        >
                          {h.content}
                        </span>
                      ))}
                  </div>
                )}
              </TableCell>
              <TableCell className="pr-5 align-top">
                <div className="flex w-32 flex-col items-stretch gap-2">
                  <button
                    className="shrink-0 rounded-lg border border-[#E5DAD4] bg-white p-1.5 text-[#A64B1C] hover:border-[#F98C53]"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      openInlineCollection(cleanExample(word.example), word.id, cleanDisplayText(word.example_translation, 300), word.source || word.example_type, { top: rect.bottom + 10, left: rect.right - 450 });
                    }}
                    title="收藏到写作金句"
                    disabled={!cleanExample(word.example)}
                  >
                    <Bookmark className="size-4" />
                  </button>
                  <button
                    className="rounded-lg border border-[#ABD7FB] bg-[#EFF8FF] px-2 py-1.5 text-xs text-[#28628F] hover:border-[#28628F]"
                    onClick={() => mutate({ action: "add-to-today", wordId: word.id, itemType: "review" }, "已加入今日复习，并置顶显示")}
                  >
                    加入今日复习
                  </button>
                  {(
                    ["unfamiliar", "familiar", "mastered"] as Proficiency[]
                  ).map((p) => (
                    <button
                      key={p}
                      onClick={() => rateWord(word, p)}
                      className={`flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-xs transition ${word.proficiency === p ? proficiencyStyles[p] : "border-[#E5DAD4] bg-white text-[#697386] hover:border-[#F98C53]"}`}
                    >
                      {word.proficiency === p && (
                        <Check className="mr-1 size-3" />
                      )}
                      {labels[p]}
                    </button>
                  ))}
                </div>

              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    );
  }

  function TaskInsights({ items }: { items: Word[] }) {
    const focus = items.filter((word, index, list) => list.findIndex((item) => item.id === word.id) === index);
    const comparisons = focus.filter((word) => word.comparison?.distinction);
    const sentences = focus.filter((word) => cleanExample(word.example));
    return (
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border bg-[#FFFDFB] p-6 shadow-sm">
          <TitleIcon color="#D2E0AA" icon={Sparkles} title="相近词辨析" note="放在任务最后，按今天的词义边界集中记忆" />
          {comparisons.length ? (
            <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
              {comparisons.map((word) => {
                const comparison = comparisonLines(word);
                return (
                  <div key={word.id} className="rounded-2xl border border-[#E7DFD8] bg-[#FCFAF7] p-4 text-sm leading-7 text-[#586274]">
                    <p><b className="mr-1 text-[#7F3C1D]">{word.word}</b>{comparison.targetTail}</p>
                    {comparison.similar.map((line) => <p key={line} className="mt-2 text-[#697386]">{line}</p>)}
                    {cleanDisplayText(word.comparison?.contrastExample, 180) && <p className="mt-2 text-xs leading-6 text-[#697386]">{cleanDisplayText(word.comparison?.contrastExample, 180)}</p>}
                  </div>
                );
              })}
            </div>
          ) : <p className="text-sm text-[#697386]">今日任务暂无相近词辨析，后续词条会在这里集中显示。</p>}
        </div>
        <div className="rounded-3xl border bg-[#FFFDFB] p-6 shadow-sm">
          <TitleIcon color="#ABD7FB" icon={FileText} title="一句话总结" note="一个句子覆盖一个重点词；词多时自动分成多句" />
          <div className="max-h-[32rem] space-y-4 overflow-y-auto pr-1">
            {sentences.map((word) => (
              <div key={word.id} className="border-b border-[#F0EAE6] pb-4 last:border-0 last:pb-0">
                <p className="text-sm leading-7">{cleanExample(word.example) ? renderMarkedText(cleanExample(word.example), word.word, appData.highlights.filter((h) => h.word_id === word.id)) : "例句数据待整理"}</p>
                <p className="mt-1 text-xs leading-6 text-[#697386]">{cleanDisplayText(word.example_translation, 300) || "中文含义待补充"}</p>
              </div>
            ))}
            {!sentences.length && <p className="text-sm text-[#697386]">今日词条的例句正在整理中。</p>}
          </div>

        </div>
      </section>
    );
  }

  function WordbookView() {
    const items = appData.wordbook || [];
    return (
      <div className="space-y-5">
        <PageTitle
          title="生词本"
          note="把例句中想单独回收的词收进这里；加入今日任务后会置顶显示。"
          action={<Badge className="bg-[#D2E0AA] text-[#46582B]">当前词本：CET-6 1800</Badge>}
        />
        {items.length ? (
          <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <VocabularyTable words={items} />
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed bg-white p-14 text-center">
            <Bookmark className="mx-auto mb-3 size-8 text-[#A64B1C]" />
            <h2 className="font-semibold">你的生词本还是空的</h2>
            <p className="mt-2 text-sm text-[#697386]">在例句或词汇总表中点击“记为生词”，需要时再加入今日复习。</p>
          </section>
        )}
      </div>
    );
  }

  function DraftsView() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawingRef = useRef(false);
    const [draftId, setDraftId] = useState<string | null>(null);
    const [title, setTitle] = useState("未命名便签");
    const [mode, setMode] = useState<"text" | "draw">("text");
    const [text, setText] = useState("");
    const [drawing, setDrawing] = useState("");
    const [color, setColor] = useState("#243247");
    const [brush, setBrush] = useState(4);

    const restoreCanvas = useCallback((data = "") => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#FFFDFB";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (!data) return;
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = data;
    }, []);

    useEffect(() => { restoreCanvas(drawing); }, [drawing, restoreCanvas]);

    const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
    };
    const beginDraw = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const p = point(event);
      drawingRef.current = true;
      canvas.setPointerCapture(event.pointerId);
      context.strokeStyle = color;
      context.lineWidth = brush;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(p.x, p.y);
    };
    const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const context = canvasRef.current?.getContext("2d");
      if (!context) return;
      const p = point(event);
      context.lineTo(p.x, p.y);
      context.stroke();
    };
    const endDraw = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const canvas = canvasRef.current;
      if (canvas) setDrawing(canvas.toDataURL("image/png"));
    };
    const openDraft = (draft: Draft) => {
      setDraftId(draft.id);
      setTitle(draft.title);
      setText(draft.text);
      setDrawing(draft.drawing);
    };
    const newDraft = () => {
      setDraftId(null);
      setTitle("未命名便签");
      setText("");
      setDrawing("");
      setMode("text");
    };
    const saveDraft = async () => {
      const result = await mutate({ action: "save-draft", id: draftId, title, text, drawing }, "草稿已保存");
      if (result && typeof result === "object" && typeof result.id === "string") setDraftId(result.id);
    };

    return (
      <div className="space-y-5">
        <PageTitle
          title="草稿本"
          note="文字或手写都能保存到当前账户；便签会在这里留下历史记录。"
          action={<Button onClick={newDraft}><Plus className="size-4" />新建便签</Button>}
        />
        <section className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-3xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">历史便签</h2>
              <span className="text-xs text-[#697386]">{(appData.drafts || []).length} 条</span>
            </div>
            <div className="max-h-[52rem] space-y-2 overflow-y-auto pr-1">
              {(appData.drafts || []).map((draft) => (
                <div key={draft.id} className={`group rounded-2xl border p-3 transition ${draft.id === draftId ? "border-[#ABD7FB] bg-[#EFF8FF]" : "hover:border-[#D8CDC6]"}`}>
                  <button className="block w-full text-left" onClick={() => openDraft(draft)}>
                    <b className="block truncate text-sm">{draft.title}</b>
                    <span className="mt-1 block truncate text-xs text-[#697386]">{draft.text || (draft.drawing ? "手写便签" : "空白便签")}</span>
                  </button>
                  <button className="mt-2 text-xs text-[#A64B1C] hover:underline" onClick={() => mutate({ action: "delete-draft", id: draft.id }, "草稿已删除")}>删除</button>
                </div>
              ))}
              {!(appData.drafts || []).length && <p className="p-3 text-sm leading-6 text-[#697386]">新建一张便签，之后会在这里保留历史。</p>}
            </div>
          </aside>
          <div className="rounded-3xl border bg-[#FFFDFB] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input className="max-w-sm bg-white font-medium" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="便签标题" />
              <div className="grid grid-cols-2 rounded-xl border bg-[#F8F3F0] p-1">
                <button className={`rounded-lg px-4 py-2 text-sm ${mode === "text" ? "bg-white font-semibold shadow-sm" : "text-[#697386]"}`} onClick={() => setMode("text")}>文本框</button>
                <button className={`rounded-lg px-4 py-2 text-sm ${mode === "draw" ? "bg-white font-semibold shadow-sm" : "text-[#697386]"}`} onClick={() => setMode("draw")}>手写</button>
              </div>
            </div>
            {mode === "text" ? (
              <textarea className="mt-5 min-h-[30rem] w-full resize-y rounded-2xl border bg-white p-5 text-base leading-8 outline-none focus:border-[#ABD7FB]" placeholder="在这里写下联想、易错点或练习句……" value={text} onChange={(event) => setText(event.target.value)} />
            ) : (
              <div className="mt-5">
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-[#F8F3F0] p-3">
                  <span className="text-xs text-[#697386]">笔触</span>
                  {["#243247", "#A64B1C", "#28628F", "#5B7F45", "#8F5DA8"].map((value) => <button key={value} aria-label={value} onClick={() => setColor(value)} className={`size-6 rounded-full border-2 ${color === value ? "border-[#243247] ring-2 ring-[#ABD7FB]" : "border-white"}`} style={{ background: value }} />)}
                  <input aria-label="笔触粗细" type="range" min="2" max="16" value={brush} onChange={(event) => setBrush(Number(event.target.value))} />
                  <Button size="sm" variant="outline" onClick={() => { setDrawing(""); restoreCanvas(""); }}>清空画布</Button>
                </div>
                <canvas ref={canvasRef} width={960} height={560} className="aspect-[12/7] w-full touch-none rounded-2xl border bg-white" onPointerDown={beginDraw} onPointerMove={draw} onPointerUp={endDraw} onPointerCancel={endDraw} />
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button onClick={saveDraft}><Bookmark className="size-4" />保存便签</Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function WordsView() {
    if (!appData.wordsLoaded)
      return <PageLoading title="正在加载完整词汇表…" />;
    return (
      <div className="space-y-5">
        <PageTitle
          title="词汇总表"
          note="查看已背诵和待背诵部分，也可以手动加入今日任务。"
          action={
            <Button onClick={exportCsv} variant="outline">
              导出 CSV
            </Button>
          }
        />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SmallStat label="总词数" value={totalWords} />
          <SmallStat label="已背诵" value={learned} />
          <SmallStat label="待背诵" value={totalWords - learned} />
          <SmallStat label="不熟练" value={unfamiliar} />
          <SmallStat label="很熟练" value={mastered} />
          <SmallStat label="今日完成" value={newDone + reviewDone} />
        </div>
        <div className="flex flex-wrap gap-3 rounded-2xl border bg-white p-3">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-3 size-4 text-[#8A94A4]" />
            <Input
              className="pl-9"
              placeholder="搜索单词、中文或搭配"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-xl border bg-white px-3 text-sm"
          >
            <option value="all">全部状态</option>
            <option value="unlearned">待背诵</option>
            <option value="learned">已背诵</option>
            <option value="unfamiliar">不熟练</option>
            <option value="familiar">微熟练</option>
            <option value="mastered">很熟练</option>
          </select>
          <select value={wordOrder} onChange={(e) => setWordOrder(e.target.value as "corpus" | "exam")} className="h-10 rounded-xl border bg-white px-3 text-sm">
            <option value="corpus">按词库顺序</option>
            <option value="exam">真题优先排序</option>
          </select>
        </div>
        <section className="overflow-hidden rounded-3xl border bg-white">
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow className="bg-[#FAF6F3]">
                <TableHead className="pl-5">单词</TableHead>
                <TableHead>完整含义与必记搭配</TableHead>
                <TableHead>学习状态</TableHead>
                <TableHead>真题标签</TableHead>
                <TableHead className="w-[14%]">下次复习</TableHead>
                <TableHead>次数</TableHead>
                <TableHead className="pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredWords.map((word) => (
                <TableRow key={word.id}>
                  <TableCell className="pl-5">
                    <b className="text-[#1F4161]">{word.word}</b>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-[#697386]">
                      <button type="button" onClick={() => speak(word.word, "en-GB")} className="inline-flex items-center gap-1 hover:text-[#A64B1C]"><Volume2 className="size-3" />英 {word.phonetic_uk || word.phonetic || "—"}</button>
                      <button type="button" onClick={() => speak(word.word, "en-US")} className="inline-flex items-center gap-1 hover:text-[#A64B1C]"><Volume2 className="size-3" />美 {word.phonetic_us || word.phonetic || "—"}</button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-lg whitespace-normal break-words">
                    <div className="space-y-1">{formatMeanings(word).map((meaning) => <div key={meaning}>{meaning}</div>)}</div>
                    {formatCollocations(word.collocations).slice(0, 2).map((item) => <div key={item.phrase} className="mt-1 text-xs"><code className="text-[#28628F] break-words">{item.phrase}</code>{item.translation && <span className="ml-1 text-[#697386]">{item.translation}</span>}</div>)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        ["learned", "learned_unrated"].includes(word.status)
                          ? "bg-[#D2E0AA] text-[#46582B]"
                          : "bg-[#FCCEB4] text-[#7F3C1D]"
                      }
                    >
                      {word.status === "learned"
                        ? labels[word.proficiency || "familiar"]
                        : word.status === "learned_unrated" ? "已背诵·待评" : "待背诵"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {word.exam_priority === 2 ? <Badge className="bg-[#FCCEB4] text-[#7F3C1D]">真题复现 ≥2 套</Badge> : word.exam_priority === 1 ? <Badge className="bg-[#EFF8FF] text-[#28628F]">真题核心词</Badge> : <span className="text-xs text-[#8A94A4]">—</span>}
                  </TableCell>
                  <TableCell className="align-top">
                    {["learned", "learned_unrated"].includes(word.status) ? (
                      <div className="flex w-full flex-col items-start gap-2">
                        <Input
                          aria-label={`${word.word} 的下次复习日期`}
                          type="date"
                          value={word.next_review_at || ""}
                          onChange={(event) => void mutate({ action: "set-next-review", wordId: word.id, nextReviewAt: event.target.value }, "复习日期已调整")}
                        />
                        {word.next_review_at && word.next_review_at < appData.date && <span className="text-xs leading-5 text-[#A64B1C]">已到期<br />今日复习优先</span>}
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell>{word.review_count}</TableCell>
                  <TableCell className="pr-5">
                    <div className="flex flex-col items-stretch gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => mutate(
                          { action: "add-to-wordbook", wordId: word.id, sourceContext: "词汇总表" },
                          "已记入生词本",
                        )}
                      >
                        <Bookmark className="size-4" />
                        {(appData.wordbook || []).some((item) => item.id === word.id) ? "已在生词本" : "记为生词"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => mutate(
                          {
                            action: "add-to-today",
                            wordId: word.id,
                            itemType: "review",
                          },
                          "已加入今日任务，并置顶显示",
                        )}
                      >
                        <Plus className="size-4" />
                        加入今日
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
    );
  }

  function ReviewView() {
    if (!appData.wordsLoaded)
      return <PageLoading title="正在加载复习队列…" />;
    const due = appData.words
      .filter((w) => w.status === "learned")
      .sort((a, b) =>
        (a.next_review_at || "").localeCompare(b.next_review_at || ""),
      );
    return (
      <div className="space-y-5">
        <PageTitle
          title="复习中心"
          note="不熟练词优先；第 1、3、7、15 天会自动回到你的任务里。"
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Metric
            label="不熟练"
            value={String(unfamiliar)}
            note="次日优先回收"
            color="#F98C53"
            icon={RotateCcw}
          />
          <Metric
            label="微熟练"
            value={String(
              familiar,
            )}
            note="保持正常间隔"
            color="#ABD7FB"
            icon={Clock3}
          />
          <Metric
            label="很熟练"
            value={String(mastered)}
            note="拉长间隔，随机回收"
            color="#D2E0AA"
            icon={Check}
          />
        </div>
        <section className="overflow-hidden rounded-3xl border bg-white">
          <div className="border-b p-5">
            <h2 className="font-semibold">待复习队列</h2>
            <p className="mt-1 text-sm text-[#697386]">按下次复习日期排序</p>
          </div>
          {due.length ? (
            <VocabularyTable words={due.slice(0, 30)} />
          ) : (
            <div className="p-10 text-center text-[#697386]">
              完成今天的新词后，这里会形成你的长期复习队列。
            </div>
          )}
        </section>
      </div>
    );
  }

  function WritingView() {
    const [writingQuery, setWritingQuery] = useState("");
    const visible = appData.collections.filter((c) =>
      `${c.content} ${c.translation} ${c.topic}`
        .toLowerCase()
        .includes(writingQuery.toLowerCase()),
    );
    return (
      <div className="space-y-5">
        <PageTitle
          title="写作金句库"
          note="把认识的词变成六级作文里能主动调用的表达。"
          action={
            <Button onClick={() => openCollection()}>
              <Plus className="size-4" />
              手动添加
            </Button>
          }
        />
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-[#8A94A4]" />
          <Input
            className="bg-white pl-9"
            placeholder="搜索英文、中文、主题"
            value={writingQuery}
            onChange={(e) => setWritingQuery(e.target.value)}
          />
        </div>
        {visible.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {visible.map((c) => (
              <article
                key={c.id}
                className="rounded-3xl border bg-white p-5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap gap-2">
                      <Badge className="bg-[#ABD7FB] text-[#1F4161]">
                        {c.expression_type}
                      </Badge>
                      <Badge variant="outline">{c.topic}</Badge>
                      <Badge variant="outline">{labels[c.proficiency]}</Badge>
                    </div>
                    <p className="text-lg font-semibold leading-8">
                      {c.content}
                    </p>
                    <p className="mt-2 text-sm text-[#697386]">
                      {c.translation}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(c.content);
                      toast.success("已复制英文");
                    }}
                  >
                    <Copy className="size-4 text-[#697386]" />
                  </button>
                </div>
                {c.replaceable_parts && (
                  <div className="mt-4 rounded-xl bg-[#EFF8FF] p-3 text-sm">
                    <span className="text-xs text-[#697386]">可替换骨架</span>
                    <code className="mt-1 block whitespace-normal text-[#28628F]">
                      {c.replaceable_parts}
                    </code>
                  </div>
                )}
                {c.note && <p className="mt-3 text-sm">笔记：{c.note}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPractice({
                        id: c.id,
                        content: c.replaceable_parts || c.content,
                        text: "",
                      })
                    }
                  >
                    我要仿写
                  </Button>
                  {(
                    ["unfamiliar", "familiar", "mastered"] as Proficiency[]
                  ).map((p) => (
                    <button
                      key={p}
                      onClick={() =>
                        mutate({
                          action: "rate-collection",
                          id: c.id,
                          proficiency: p,
                        })
                      }
                      className={`rounded-lg border px-2 py-1 text-xs ${c.proficiency === p ? proficiencyStyles[p] : "text-[#697386]"}`}
                    >
                      {labels[p]}
                    </button>
                  ))}
                  <button
                    className="ml-auto inline-flex items-center gap-1 text-xs text-[#28628F]"
                    onClick={() => editCollection(c)}
                  >
                    <Pencil className="size-3.5" />
                    编辑
                  </button>
                  <button
                    className="text-[#A64B1C]"
                    onClick={() =>
                      mutate(
                        { action: "delete-collection", id: c.id },
                        "收藏已删除",
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed bg-white p-14 text-center">
            <Bookmark className="mx-auto mb-3 size-8 text-[#F98C53]" />
            <h2 className="font-semibold">你的第一条金句，从今天的例句开始</h2>
            <p className="mt-2 text-sm text-[#697386]">
              选中句子中的短语，或点击例句旁的收藏按钮。
            </p>
            <Button className="mt-5" onClick={() => openCollection()}>
              <Plus className="size-4" />
              手动添加
            </Button>
          </div>
        )}
      </div>
    );
  }

  function WritingReview() {
    const seen = new Set<string>();
    const items = appData.collections
      .filter((c) => c.proficiency !== "mastered")
      .filter((c) => {
        const key = `${c.content.trim().toLowerCase()}|${c.translation.trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
    return (
      <section className="rounded-3xl border bg-[#FFFDFB] p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">今日写作表达回顾</h2>
            <p className="mt-1 text-sm text-[#697386]">
              每日回收 3–5 条薄弱表达
            </p>
          </div>
          <Button variant="ghost" onClick={() => setView("writing")}>
            打开金句库
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {items.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((c) => (
              <div key={c.id} className="rounded-2xl bg-[#F9F2EF] p-4">
                <span className="text-xs text-[#697386]">
                  {c.translation || c.expression_type}
                </span>
                <p className="mt-2 font-medium">{c.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl bg-[#F9F2EF] p-5 text-sm text-[#697386]">
            收藏短语或例句后，它们会在这里进入主动回忆。
          </p>
        )}
      </section>
    );
  }

  function StatsView() {
    if (!appData.wordsLoaded)
      return <PageLoading title="正在加载学习统计…" />;
    const total = Math.max(totalWords, 1);
    const values = [
      { label: "待背诵", value: totalWords - learned, color: "#FCCEB4" },
      { label: "不熟练", value: unfamiliar, color: "#F98C53" },
      {
        label: "微熟练",
        value: familiar,
        color: "#ABD7FB",
      },
      { label: "很熟练", value: mastered, color: "#D2E0AA" },
    ];
    return (
      <div className="space-y-5">
        <PageTitle
          title="学习统计"
          note="关注薄弱词是否减少，而不只是累计背了多少。"
        />
        <div className="grid gap-4 md:grid-cols-4">
          <Metric
            label="词库完成度"
            value={`${Math.round((learned / total) * 100)}%`}
            note={`${learned}/${totalWords} 个`}
            color="#D2E0AA"
            icon={TrendingUp}
          />
          <Metric
            label="今日完成"
            value={String(newDone + reviewDone)}
            note="新词与复习合计"
            color="#F98C53"
            icon={Check}
          />
          <Metric
            label="复习总次数"
            value={String(
              appData.summary.reviewCount,
            )}
            note="每次熟练度判断都会记录"
            color="#ABD7FB"
            icon={RotateCcw}
          />
          <Metric
            label="写作表达"
            value={String(appData.collections.length)}
            note="独立计算写作熟练度"
            color="#FCCEB4"
            icon={Bookmark}
          />
        </div>
        <section className="grid gap-5 rounded-3xl border bg-white p-6 lg:grid-cols-[1.2fr_.8fr]">
          <div>
            <h2 className="font-semibold">熟练度分布</h2>
            <div className="mt-6 space-y-5">
              {values.map((item) => (
                <div key={item.label}>
                  <div className="mb-2 flex justify-between text-sm">
                    <span>{item.label}</span>
                    <b>{item.value}</b>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-[#F1ECE9]">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(item.value / total) * 100}%`,
                        background: item.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-[#EFF8FF] p-5">
            <CalendarDays className="size-5 text-[#28628F]" />
            <h3 className="mt-3 font-semibold">间隔复习节奏</h3>
            <p className="mt-2 text-sm leading-7 text-[#506174]">
              新学后的第 1、3、7、15
              天优先回收；不熟练词次日出现，很熟练词延长间隔。
            </p>
            <div className="mt-5 flex items-center gap-2">
              {[1, 3, 7, 15].map((d, i) => (
                <span
                  key={d}
                  className="grid size-10 place-items-center rounded-full text-sm font-semibold"
                  style={{
                    background: ["#FCCEB4", "#ABD7FB", "#D2E0AA", "#F98C53"][i],
                    color: i === 3 ? "white" : "#243247",
                  }}
                >
                  D{d}
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className="rounded-3xl border bg-white p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">历史每日计划恢复</h2>
              <p className="mt-1 text-sm text-[#697386]">
                已恢复从开始背词至今的任务安排；未确认完成的内容仍保持待学习。
              </p>
            </div>
            <Badge className="bg-[#D2E0AA] text-[#46582B]">
              {appData.corpus.importedHistoryDays} 个历史学习日
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {appData.history
              .filter((item) => item.origin === "conversation_history")
              .map((item, index) => (
                <div
                  key={`${String(item.task_date)}-${index}`}
                  className="rounded-2xl bg-[#FAF6F3] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <b>{String(item.task_date)}</b>
                    <span className="text-xs text-[#697386]">
                      {String(item.completed || 0)} / {String(item.total || 0)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">
                    {String(item.label || "历史学习计划")}
                  </p>
                  <p className="mt-1 text-xs text-[#697386]">
                    新词 {String(item.new_count || 0)} · 复习{" "}
                    {String(item.review_count || 0)}
                  </p>
                </div>
              ))}
          </div>
        </section>
      </div>
    );
  }

  function SettingsView() {
    const [form, setForm] = useState({
      newTarget: appData.settings.new_target,
      reviewTarget: appData.settings.review_target,
      reminderTime: appData.settings.reminder_time,
      reminderEnabled: appData.settings.reminder_enabled !== false,
      track: appData.settings.track,
    });
    const [passwordForm, setPasswordForm] = useState({ currentPassword: "", password: "", confirmPassword: "" });
    const [nameForm, setNameForm] = useState(appData.user.displayName);
    const [accountForm, setAccountForm] = useState({ displayName: "", email: "", password: "", confirmPassword: "" });
    const submitAuth = async (body: Record<string, unknown>, success: string) => {
      const response = await authorizedFetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) { toast.error(payload.error || "操作失败"); return false; }
      toast.success(payload.message || success); return true;
    };
    return (
      <div className="space-y-5">
        <PageTitle
          title="设置与自动导入"
          note="调整每日节奏，并查看定时任务接口状态。"
        />
        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border bg-white p-6">
            <h2 className="font-semibold">每日学习目标</h2>
            <div className="mt-5 grid gap-4">
              <Field label="每日新词">
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={form.newTarget}
                  onChange={(e) =>
                    setForm({ ...form, newTarget: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="每日随机薄弱词复习">
                <Input
                  type="number"
                  min={0}
                  max={200}
                  value={form.reviewTarget}
                  onChange={(e) =>
                    setForm({ ...form, reviewTarget: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="提醒时间">
                <Input
                  type="time"
                  value={form.reminderTime}
                  onChange={(e) =>
                    setForm({ ...form, reminderTime: e.target.value })
                  }
                />
              </Field>
              <label className="flex items-center justify-between rounded-xl border border-[#EADFD9] bg-[#FFF9F5] px-3 py-2.5">
                <span><b className="block text-sm">每日邮件提醒</b><span className="text-xs text-[#697386]">按提醒时间发送；需要在 Vercel 配置 SMTP 凭据。</span></span>
                <input type="checkbox" className="size-4 accent-[#F98C53]" checked={form.reminderEnabled} onChange={(event) => setForm({ ...form, reminderEnabled: event.target.checked })} />
              </label>
              <Field label="默认词库方向">
                <select className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value as typeof form.track })}>
                  <option value="cet6">六级词库</option><option value="cet4">四级词库</option><option value="mixed">四、六级混合</option><option value="custom">自定义词库</option>
                </select>
              </Field>
              <Button
                className="mt-2 w-fit"
                onClick={() =>
                  mutate({ action: "settings", ...form }, "设置已保存")
                }
              >
                保存设置
              </Button>
              <Button variant="outline" className="w-fit" onClick={() => setForm({ newTarget: 20, reviewTarget: 20, reminderTime: "20:30", reminderEnabled: true, track: "cet6" })}>恢复推荐默认值</Button>
            </div>
          </div>
          <div className="rounded-3xl border bg-[#243247] p-6 text-white">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-[#F98C53]">
                <Sparkles className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold">每日导入 API</h2>
                <p className="text-sm text-white/65">
                  供外部定时任务安全写入新词
                </p>
              </div>
            </div>
            <code className="mt-6 block rounded-xl bg-black/20 p-4 text-sm text-[#ABD7FB]">
              POST /api/daily-vocabulary
            </code>
            <div className="mt-4 space-y-2 text-sm text-white/75">
              <p>请求头：Authorization: Bearer &lt;API Key&gt;</p>
              <p>去重规则：日期 + 单词；重复调用不会重复插入</p>
              <p>密钥位置：服务器环境变量 DAILY_IMPORT_API_KEY</p>
              <p>目标账户：请求体 targetUserId 或 DEFAULT_IMPORT_USER_ID</p>
            </div>
          </div>
        </section>
        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border bg-white p-6">
            <h2 className="font-semibold">账户名称与切换</h2>
            <p className="mt-1 text-sm text-[#697386]">显示名称只属于当前账户；退出后可直接登录另一个账户，学习数据不会混在一起。</p>
            <div className="mt-5 grid gap-3">
              <Field label="账户显示名称"><Input maxLength={50} value={nameForm} onChange={(e) => setNameForm(e.target.value)} /></Field>
              <div className="flex flex-wrap gap-3"><Button className="w-fit" onClick={async () => { if (await submitAuth({ action: "update-display-name", displayName: nameForm }, "账户名称已修改")) await load(); }}>保存名称</Button><Button variant="outline" className="w-fit" onClick={() => void signOut()}>退出并切换账户</Button></div>
            </div>
          </div>
          <div className="rounded-3xl border bg-white p-6">
            <h2 className="font-semibold">修改密码</h2><p className="mt-1 text-sm text-[#697386]">输入当前密码，再两次输入相同的新密码后保存。</p>
            <div className="mt-5 grid gap-3">
              <Field label="当前密码"><Input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} /></Field>
              <Field label="新密码（至少 8 位）"><Input type="password" value={passwordForm.password} onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })} /></Field>
              <Field label="再次输入新密码"><Input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} /></Field>
              <Button className="mt-1 w-fit" onClick={async () => { if (await submitAuth({ action: "change-password", ...passwordForm }, "密码已修改")) setPasswordForm({ currentPassword: "", password: "", confirmPassword: "" }); }}>保存新密码</Button>
            </div>
          </div>
          <div className="rounded-3xl border bg-[#EFF8FF] p-6"><h2 className="font-semibold">忘记密码</h2><p className="mt-2 text-sm leading-6 text-[#486176]">请在登录页选择“忘记密码”。系统会向该账户邮箱发送 6 位验证码，验证后才能设置新密码。</p><p className="mt-3 text-xs leading-5 text-[#697386]">验证码和密码均由 Supabase Auth 处理，网站不会保存明文密码。</p></div>
        </section>
        {appData.user.role === "admin" && <section className="rounded-3xl border border-[#F2D7C7] bg-[#FFF9F5] p-6">
          <h2 className="font-semibold">管理员：开通学习账户</h2><p className="mt-1 text-sm text-[#697386]">公开注册保持关闭；在此分配的新账户彼此完全隔离。</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="显示名称"><Input value={accountForm.displayName} onChange={(e) => setAccountForm({ ...accountForm, displayName: e.target.value })} /></Field>
            <Field label="邮箱"><Input type="email" value={accountForm.email} onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })} /></Field>
            <Field label="初始密码（至少 8 位）"><Input type="password" value={accountForm.password} onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })} /></Field>
            <Field label="再次输入初始密码"><Input type="password" value={accountForm.confirmPassword} onChange={(e) => setAccountForm({ ...accountForm, confirmPassword: e.target.value })} /></Field>
          </div>
          <Button className="mt-5" onClick={async () => { if (await submitAuth({ action: "admin-create-user", ...accountForm }, "账户已开通")) setAccountForm({ displayName: "", email: "", password: "", confirmPassword: "" }); }}><Plus className="size-4" />开通账户</Button>
        </section>}
        <section className="rounded-3xl border bg-white p-6">
          <h2 className="font-semibold">登录方式与数据隔离</h2>
          <p className="mt-1 text-sm text-[#697386]">
            每个账户拥有独立的进度、复习记录、高光与写作收藏。
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border-2 border-[#ABD7FB] bg-[#EFF8FF] p-5">
              <div className="flex items-center justify-between">
                <b>Supabase 账户</b>
                <Badge className="bg-[#D2E0AA] text-[#46582B]">已登录</Badge>
              </div>
              <p className="mt-3 text-sm font-medium">
                {appData.user.displayName}
              </p>
              <p className="mt-1 text-xs text-[#697386]">{appData.user.email}</p>
            </div>
            <div className="rounded-2xl border border-dashed bg-[#FAF6F3] p-5">
              <div className="flex items-center justify-between">
                <b>账户密码登录</b>
                <Badge variant="outline">已启用</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#697386]">
                密码哈希与会话由 Supabase Auth 管理；新账户只能由管理员在后台创建。
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-[#FFF4ED] p-4">
            <p className="text-xs font-medium text-[#A64B1C]">
              自动导入目标用户 ID
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs">
                {appData.user.id}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(appData.user.id);
                  toast.success("用户 ID 已复制");
                }}
              >
                <Copy className="size-4" />
                复制
              </Button>
            </div>
          </div>
        </section>
        <section className="rounded-3xl border bg-white p-6">
          <h2 className="font-semibold">最近导入记录</h2>
          {appData.logs.length ? (
            <div className="mt-4 space-y-2">
              {appData.logs.map((log, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-4 rounded-xl bg-[#FAF6F3] p-3 text-sm"
                >
                  <b>{String(log.import_date)}</b>
                  <span>接收 {String(log.received_count)}</span>
                  <span>写入 {String(log.inserted_count)}</span>
                  <span>重复 {String(log.duplicate_count)}</span>
                  <Badge>{String(log.status)}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#697386]">
              尚无外部导入记录。配置 API Key 后即可接入定时任务。
            </p>
          )}
        </section>
      </div>
    );
  }

  function exportCsv() {
    const rows = [
      [
        "单词",
        "音标",
        "词性",
        "核心义",
        "必记搭配",
        "状态",
        "熟练度",
        "下次复习",
      ],
      ...appData.words.map((w) => [
        w.word,
        w.phonetic,
        w.part_of_speech,
        w.core_meaning,
        w.collocations.join("; "),
        w.status,
        w.proficiency || "",
        w.next_review_at || "",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `词汇总表-${appData.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#F9F2EF] text-[#243247]">
      <header className="sticky top-0 z-40 border-b border-[#EADFD9] bg-[#FFFDFB]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center gap-5 px-4 py-3 lg:px-8">
          <button
            className="flex shrink-0 items-center gap-3"
            onClick={() => setView("growth")}
          >
            <span className="grid size-10 place-items-center rounded-2xl bg-[#CFE7F1] text-[#465A6B] shadow-sm">
              <Sparkles className="size-5" />
            </span>
            <span className="hidden text-left sm:block">
              <strong className="block text-[15px]">DailyGlow</strong>
              <span className="text-xs text-[#697386]">学习 · 洞察 · 训练</span>
            </span>
          </button>
          <nav className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {(view === "growth" ? nav.filter((item) => item.id === "growth" || item.id === "today") : nav).map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${view === item.id ? "bg-[#FFD8B8] text-[#465A6B]" : "text-[#697386] hover:bg-[#F4ECE8] hover:text-[#465A6B]"}`}
              >
                <item.icon className="size-4" />
                {item.label}
              </button>
            ))}
          </nav>
          <Link href="/daily" className="hidden shrink-0 items-center gap-1.5 rounded-xl bg-[#EFF8FF] px-3 py-2 text-sm font-bold text-[#1F4161] transition hover:bg-[#ABD7FB] lg:flex">
            <Sparkles className="size-4" />每日成长
          </Link>
          <div className="hidden items-center gap-4 text-xs xl:flex">
            {view !== "growth" && <span className="flex items-center gap-1.5">
              <Flame className="size-4 text-[#F98C53]" />
              连续 {calculateStudyStreak(appData.history)} 天
            </span>}
            {view !== "growth" && <span>
              复习 {reviewDone}/{reviewItems.length}
            </span>}
            {view !== "growth" && <span>
              新词 {newDone}/{newItems.length}
            </span>}
            <label className="flex items-center gap-1 rounded-lg bg-[#FAF6F3] px-2 py-1 text-[#697386]" title="选择要查看或调整的学习日期">
              <CalendarDays className="size-3.5" />
              <input className="w-[106px] bg-transparent text-xs outline-none" type="date" value={activeDate} onChange={(event) => { setLoading(true); setSelectedDate(event.target.value || null); }} />
            </label>
            {selectedDate && <button className="text-xs text-[#9E4F24] underline" onClick={() => setSelectedDate(null)}>回到今天</button>}
            <button
              onClick={() => setView("settings")}
              className="rounded-xl bg-[#EFF8FF] px-3 py-2 text-left"
            >
              <b className="block max-w-36 truncate text-[#1F4161]">
                {appData.user.displayName}
              </b>
              <span className="text-[10px] text-[#697386]">账户数据已隔离</span>
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1500px] px-4 py-7 lg:px-8">
        {view === "growth" && <GrowthView />}
        {view === "today" && <TodayView />}
        {view === "words" && WordsView()}
        {view === "wordbook" && <WordbookView />}
        {view === "review" && <ReviewView />}
        {view === "writing" && <WritingView />}
        {view === "drafts" && <DraftsView />}
        {view === "stats" && <StatsView />}
        {view === "settings" && <SettingsView />}
      </div>
      <button
        type="button"
        onClick={() => {
          setStickyPosition({ left: Math.max(12, window.innerWidth - 360), top: Math.max(12, window.innerHeight - 330) });
          setStickyOpen(true);
        }}
        className="fixed bottom-6 right-6 z-30 grid size-12 place-items-center rounded-full border border-[#E5D5CC] bg-[#FFFDFB] text-[#A64B1C] shadow-lg transition hover:-translate-y-0.5 hover:bg-[#FFF4ED]"
        title="打开手写便签"
      >
        <Pencil className="size-5" />
      </button>
      <InlineCollectionPanel />
      <HandwritingSticky />
      {selection && (
        <div
          className="fixed z-50 flex max-w-[min(92vw,560px)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-[#E5D5CC] bg-white p-2 shadow-2xl"
          style={{ top: selection.top, left: selection.left }}
        >
          <span className="min-w-0 flex-1 truncate px-2 text-sm">
            “{selection.content}”
          </span>
          <Button size="sm" variant="outline" onClick={saveHighlight}>
            <Highlighter className="size-4" />
            高光
          </Button>
          <Button
            size="sm"
            onClick={() =>
              openInlineCollection(selection.content, selection.wordId)
            }
          >
            <Bookmark className="size-4" />
            收藏
          </Button>
          {selection.wordId && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={(appData.wordbook || []).some((item) => item.id === selection.wordId)}
              onClick={() => void addSelectionToWordbook()}
              title="将当前词条加入生词本"
            >
              <Bookmark className="size-4" />
              {(appData.wordbook || []).some((item) => item.id === selection.wordId) ? "已在生词本" : "记为生词"}
            </Button>
          )}
          <button
            className="px-2 text-[#697386]"
            onClick={() => setSelection(null)}
          >
            ×
          </button>
        </div>
      )}
      <Dialog open={collectionOpen} onOpenChange={setCollectionOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingCollectionId ? "编辑写作金句" : "收藏至写作金句"}</DialogTitle>
            <DialogDescription>
              补充用途与可替换成分，之后可以按主题复习和仿写。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="英文内容" wide>
              <textarea
                className="min-h-24 w-full rounded-xl border bg-white p-3 text-sm"
                value={collectionForm.content}
                onChange={(e) =>
                  setCollectionForm({
                    ...collectionForm,
                    content: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="中文含义" wide>
              <Input
                value={collectionForm.translation}
                onChange={(e) =>
                  setCollectionForm({
                    ...collectionForm,
                    translation: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="表达类型">
              <select
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm"
                value={collectionForm.expressionType}
                onChange={(e) =>
                  setCollectionForm({
                    ...collectionForm,
                    expressionType: e.target.value,
                  })
                }
              >
                {[
                  "词组",
                  "句型",
                  "论证句",
                  "举例句",
                  "建议句",
                  "让步句",
                  "结论句",
                  "连接表达",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="主题">
              <select
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm"
                value={collectionForm.topic}
                onChange={(e) =>
                  setCollectionForm({
                    ...collectionForm,
                    topic: e.target.value,
                  })
                }
              >
                {[
                  "通用",
                  "科技",
                  "教育",
                  "环境",
                  "社会",
                  "文化",
                  "青年成长",
                  "健康",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="可替换成分">
              <Input
                placeholder="如 reconcile [A] with [B]"
                value={collectionForm.replaceableParts}
                onChange={(e) =>
                  setCollectionForm({
                    ...collectionForm,
                    replaceableParts: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="来源">
              <Input
                value={collectionForm.source}
                onChange={(e) =>
                  setCollectionForm({
                    ...collectionForm,
                    source: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="个人笔记" wide>
              <Input
                placeholder="适用话题、易错点或改写思路"
                value={collectionForm.note}
                onChange={(e) =>
                  setCollectionForm({ ...collectionForm, note: e.target.value })
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectionOpen(false)}>
              取消
            </Button>
            <Button onClick={saveCollection}>
              <Bookmark className="size-4" />
              {editingCollectionId ? "保存修改" : "保存收藏"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(practice)}
        onOpenChange={(open) => !open && setPractice(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>我要仿写</DialogTitle>
            <DialogDescription>{practice?.content}</DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-32 rounded-xl border bg-white p-3"
            placeholder="在这里写下你的迁移句…"
            value={practice?.text ?? ""}
            onChange={(e) =>
              practice && setPractice({ ...practice, text: e.target.value })
            }
          />
          <DialogFooter>
            <Button
              onClick={async () => {
                if (
                  practice &&
                  (await mutate(
                    {
                      action: "save-practice",
                      id: practice.id,
                      practiceText: practice.text,
                    },
                    "仿写已保存",
                  ))
                )
                  setPractice(null);
              }}
            >
              保存练习
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function LoginScreen({
  onSession,
}: {
  onSession: (session: { access_token: string; refresh_token: string }) => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("1801135991@qq.com");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [registerSent, setRegisterSent] = useState(false);
  const [displayName, setDisplayName] = useState("Echo");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const isRegister = mode === "register";
  const isResetting = mode === "forgot";
  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setRegisterSent(false);
    setResetSent(false);
    setFieldErrors({});
  };
  const submit = async () => {
    const errors: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "请输入正确的邮箱地址";
    if (isRegister && !registerSent && !displayName.trim()) errors.displayName = "请填写显示名称";
    if ((!isResetting || resetSent) && password.length < 8 && (isRegister || isResetting)) errors.password = "密码至少需要 8 位";
    if ((isRegister || (isResetting && resetSent)) && password !== confirmPassword) errors.confirmPassword = "两次输入的密码不一致";
    if ((registerSent || (isResetting && resetSent)) && code.length !== 6) errors.code = "请输入邮件中的 6 位验证码";
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const action = isRegister
        ? (registerSent ? "complete-registration" : "request-registration-code")
        : isResetting
          ? (resetSent ? "reset-password" : "request-password-reset")
          : "login";
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, contactMethod: "email", email, password, confirmPassword, displayName, code }),
      });
      const payload = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "操作失败");
      if (isRegister && !registerSent) {
        setRegisterSent(true);
        toast.success("邮箱验证码已发送");
        return;
      }
      if (isResetting) {
        if (!resetSent) {
          setResetSent(true);
          toast.success("如该邮箱已开通账户，验证码已发送");
        } else {
          switchMode("login");
          toast.success("密码已重置，请使用新密码登录");
        }
        return;
      }
      if (!payload.access_token || !payload.refresh_token) throw new Error("登录会话创建失败");
      onSession({ access_token: payload.access_token, refresh_token: payload.refresh_token });
      toast.success(isRegister ? "注册成功，欢迎开始学习" : "登录成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作失败";
      setFieldErrors({ form: message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="relative grid min-h-screen overflow-hidden bg-[#FCF7F4] px-4 py-6 text-[#243247] sm:place-items-center sm:p-8">
      <div className="pointer-events-none absolute -left-24 top-8 size-80 rounded-full bg-[#D9EAF8]/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 right-8 size-96 rounded-full bg-[#F9D8C7]/55 blur-3xl" />
      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-[#EADFD9] bg-[#FFFDFB]/95 shadow-2xl shadow-[#DCC8BF]/30 lg:grid-cols-[1.05fr_.95fr]">
        <aside className="relative overflow-hidden bg-[linear-gradient(145deg,#EEF8FF_0%,#F9F4E9_52%,#FBE8DE_100%)] p-8 sm:p-10">
          <div className="absolute -right-16 top-6 size-56 rounded-full border border-[#ABD7FB]/70" />
          <div className="absolute bottom-0 left-0 h-28 w-full bg-[radial-gradient(ellipse_at_bottom,#D7E7B0_0%,transparent_65%)] opacity-60" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-[#CFE7F1] text-[#465A6B] shadow-lg shadow-[#CFE7F1]/50">
                <Sparkles className="size-6" />
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-wide text-[#243247]">DailyGlow</h1>
                <p className="text-sm text-[#637489]">学习 · 洞察 · 训练</p>
              </div>
            </div>
            <div className="my-10 max-w-sm sm:my-14">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C8DFF0] bg-white/70 px-3 py-1 text-xs font-medium text-[#40617C]">
                <Sparkles className="size-3.5 text-[#E98954]" /> 每日稳步积累
              </span>
              <h2 className="mt-5 text-3xl font-semibold leading-tight text-[#243247] sm:text-4xl">
                把每一天的积累，
                <br />
                变成真正能用的表达。
              </h2>
              <p className="mt-5 text-sm leading-7 text-[#617286]">
                溯 · 辞、每日简报、市场观察与运动计划，收进同一个持续生长的个人系统。
              </p>
            </div>
            <div className="mt-auto grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                ["学习", "溯 · 辞", "#28628F"],
                ["洞察", "简报与市场", "#A64B1C"],
                ["训练", "每日计划", "#556B2F"],
              ].map(([value, label, color]) => (
                <div key={label} className="rounded-2xl border border-white/75 bg-white/60 px-4 py-3 backdrop-blur-sm">
                  <strong className="block text-lg text-[#243247]" style={{ color }}>{value}</strong>
                  <span className="text-xs text-[#697386]">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
        <div className="p-7 sm:p-10">
          <div className="max-w-sm">
            <p className="text-sm font-medium text-[#9E4F24]">
              {isRegister ? "创建账户" : isResetting ? "找回密码" : "欢迎回来"}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              {isRegister ? (registerSent ? "验证你的联系方式" : "开始你的每日系统") : isResetting ? (resetSent ? "设置新密码" : "重获访问权限") : "继续今天的成长"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#697386]">
              {isRegister ? (registerSent ? "请输入发送至邮箱的 6 位验证码，完成注册。" : "使用邮箱注册，验证后即可保存独立的每日记录。") : isResetting ? (resetSent ? "请填写邮箱收到的 6 位验证码，并设置新密码。" : "输入账户邮箱，我们会发送一封验证码邮件。") : "登录后查看学习、简报、市场与训练的今日进度。"}
            </p>
          </div>
          {!isResetting && (
            <div className="mt-7 grid grid-cols-2 rounded-2xl border border-[#EADFD9] bg-[#F8F3F0] p-1.5">
              <button className={`rounded-xl px-3 py-2.5 text-sm transition ${mode === "login" ? "bg-white font-semibold text-[#243247] shadow-sm" : "text-[#697386] hover:text-[#243247]"}`} onClick={() => switchMode("login")}>账户登录</button>
              <button className={`rounded-xl px-3 py-2.5 text-sm transition ${mode === "register" ? "bg-white font-semibold text-[#243247] shadow-sm" : "text-[#697386] hover:text-[#243247]"}`} onClick={() => switchMode("register")}>注册账户</button>
            </div>
          )}
          <div className="mt-6 space-y-5">
            {isRegister && !registerSent && <AuthField label="显示名称" error={fieldErrors.displayName}><Input placeholder="例如 Echo" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setFieldErrors((current) => ({ ...current, displayName: "" })); }} /></AuthField>}
            <AuthField label="邮箱地址" error={fieldErrors.email}><Input type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: "" })); }} /></AuthField>
            {isRegister && registerSent && <AuthField label="邮箱验证码（6 位）" error={fieldErrors.code}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); setFieldErrors((current) => ({ ...current, code: "" })); }} /></AuthField>}
            {isResetting && resetSent && <AuthField label="邮件验证码（6 位）" error={fieldErrors.code}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); setFieldErrors((current) => ({ ...current, code: "" })); }} /></AuthField>}
            {(!isResetting || resetSent) && <AuthField label={isRegister || resetSent ? "设置密码（至少 8 位）" : "密码"} error={fieldErrors.password}><Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: "" })); }} onKeyDown={(event) => event.key === "Enter" && void submit()} /></AuthField>}
            {(isRegister || (isResetting && resetSent)) && <AuthField label="确认密码" error={fieldErrors.confirmPassword}><Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setFieldErrors((current) => ({ ...current, confirmPassword: "" })); }} onKeyDown={(event) => event.key === "Enter" && void submit()} /></AuthField>}
            {fieldErrors.form && <p className="rounded-xl border border-[#F2B8B5] bg-[#FFF4F3] px-3 py-2 text-sm text-[#B63833]">{fieldErrors.form}</p>}
            <Button className="mt-2 h-11 w-full rounded-xl bg-[#F98C53] text-[15px] font-semibold text-white shadow-lg shadow-[#F98C53]/20 hover:bg-[#E77A42]" disabled={busy} onClick={submit}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {isRegister ? registerSent ? "验证并完成注册" : "发送验证码" : isResetting ? resetSent ? "验证并重置密码" : "发送邮箱验证码" : "登录并打开 DailyGlow"}
              {!busy && !isResetting && <ChevronRight className="size-4" />}
            </Button>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 text-sm">
            {isResetting ? <button className="font-medium text-[#9E4F24] hover:underline" onClick={() => { setMode("login"); setResetSent(false); }}>返回登录</button> : <button className="font-medium text-[#9E4F24] hover:underline" onClick={() => { setMode("forgot"); setResetSent(false); setPassword(""); setConfirmPassword(""); }}>忘记密码？</button>}
            <span className="text-xs text-[#8A94A4]">你的每日记录私密保存</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error && <span className="block text-xs font-medium text-[#B63833]">{error}</span>}
    </label>
  );
}

function Metric({
  label,
  value,
  note,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  color: string;
  icon: typeof BookOpen;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border bg-[#FFFDFB] p-5 shadow-sm">
      <div
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: color }}
      />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[#697386]">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          <p className="mt-2 text-xs text-[#8A94A4]">{note}</p>
        </div>
        <span
          className="grid size-10 place-items-center rounded-2xl"
          style={{ background: `${color}66` }}
        >
          <Icon className="size-5" />
        </span>
      </div>
    </div>
  );
}
function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <span className="text-xs text-[#697386]">{label}</span>
      <strong className="mt-1 block text-2xl">{value}</strong>
    </div>
  );
}
function PageLoading({ title }: { title: string }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-3xl border bg-white text-sm text-[#697386]">
      <span className="flex items-center gap-3"><Loader2 className="size-4 animate-spin" />{title}</span>
    </div>
  );
}
function PageTitle({
  title,
  note,
  action,
}: {
  title: string;
  note: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-[#697386]">{note}</p>
      </div>
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`space-y-2 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
function TitleIcon({
  color,
  icon: Icon,
  title,
  note,
}: {
  color: string;
  icon: typeof BookOpen;
  title: string;
  note: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span
        className="grid size-9 place-items-center rounded-xl"
        style={{ background: color }}
      >
        <Icon className="size-4" />
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-[#697386]">{note}</p>
      </div>
    </div>
  );
}
function renderMarkedText(
  sentence: string,
  word: string,
  highlights: Highlight[],
) {
  if (!sentence) return (
    <span className="text-[#8A94A4]">
      暂无可展示例句
    </span>
  );
  const lower = sentence.toLowerCase();
  const ranges: {
    start: number;
    end: number;
    color: string;
    personal: boolean;
  }[] = [];
  for (const item of highlights) {
    const start = lower.indexOf(item.content.toLowerCase());
    if (start >= 0)
      ranges.push({
        start,
        end: start + item.content.length,
        color: item.color,
        personal: true,
      });
  }
  const wordStart = lower.indexOf(word.toLowerCase());
  if (wordStart >= 0)
    ranges.push({
      start: wordStart,
      end: wordStart + word.length,
      color: "#FCCEB4",
      personal: false,
    });
  ranges.sort(
    (a, b) =>
      a.start - b.start ||
      Number(b.personal) - Number(a.personal) ||
      b.end - a.end,
  );
  const accepted: typeof ranges = [];
  for (const range of ranges) {
    if (
      !accepted.some((item) => range.start < item.end && range.end > item.start)
    )
      accepted.push(range);
  }
  if (!accepted.length) return sentence;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of accepted) {
    if (range.start > cursor) nodes.push(sentence.slice(cursor, range.start));
    nodes.push(
      <mark
        key={`${range.start}-${range.end}`}
        className="rounded px-0.5 font-semibold text-[#7F3C1D]"
        style={{ background: range.color }}
      >
        {sentence.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < sentence.length) nodes.push(sentence.slice(cursor));
  return <>{nodes}</>;
}
