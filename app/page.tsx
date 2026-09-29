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
  collocations: Array<string | { phrase?: string; translation?: string; source?: string }> | string[];
  example: string;
  example_translation: string;
  example_type: string;
  example_is_fallback?: boolean;
  source: string;
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
      source: cleanDisplayText(source.source, 100),
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

  const load = useCallback(async (full = false) => {
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
  const enrichFromFreeSources = async (word: Word) => {
    const response = await authorizedFetch("/api/free-lexicon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word: word.word }),
    });
    const payload = (await response.json()) as { error?: string; note?: string };
    if (!response.ok) {
      toast.error(payload.error || "学习内容补全失败");
      return;
    }
    toast.success(payload.note || "已补全学习内容");
    await load(Boolean(data?.wordsLoaded));
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
