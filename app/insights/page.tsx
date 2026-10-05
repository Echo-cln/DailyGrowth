"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, LineChart, Newspaper, ShieldAlert, Sparkles } from "lucide-react";

type InsightType = "growth_brief" | "fund_strategy" | "market_intraday";
type HubItem = { id: string; content_type: InsightType | "workout_plan"; title: string; summary: string; payload: Record<string, unknown>; content_date: string };
type ActionState = { item_id: string; action_key: string; completed: boolean };
type Line = { key: string; title: string; detail: string };

const TEXT = "#465a6b";
const SURFACE = "#cfe7f1";
const ACCENT = "#ffd8b8";
const taskLinks: Record<InsightType, string> = {
  growth_brief: "https://chatgpt.com/c/6abb0103-00dc-83ea-afbc-60a987f3eadf?automationId=6ab0f201e5a08191b50d6b5f25de2f5e&messageId=finalAgentTurnStart",
  fund_strategy: "https://chatgpt.com/c/6abc6367-7574-83ea-993d-fae69ade85b8?automationId=6abb36c335c88191b6b00164be58a233&messageId=finalAgentTurnStart",
  market_intraday: "https://chatgpt.com/c/6aba02e7-79c4-83e9-8935-8b09e57f8a38?automationId=6ab3894d946081918d9d383e8fee9ffd&messageId=finalAgentTurnStart",
};
const meta: Record<InsightType, { label: string; short: string; description: string; color: string; icon: typeof Newspaper }> = {
  growth_brief: { label: "成长洞察", short: "每日成长简报", description: "把重要趋势、机会和学习方向整理为今天可执行的判断。", color: "bg-[#abd7fb]", icon: Newspaper },
  fund_strategy: { label: "基金策略", short: "每日基金策略", description: "保留仓位、风险触发条件与需要执行的下一步。", color: "bg-[#fcceb4]", icon: LineChart },
  market_intraday: { label: "盘中风险", short: "盘中风控复盘", description: "下午复盘市场变化，确认是否需要调整风险动作。", color: "bg-[#f7d6ae]", icon: ShieldAlert },
};

function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function clean(value: string) { return value.replace(/\r\n?/g, "\n").replace(/genui.*?/g, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*([^*\n]+)\*/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1").trim(); }
function documentBody(item?: HubItem) { const raw = item?.payload.document; return raw && typeof raw === "object" && !Array.isArray(raw) ? String((raw as Record<string, unknown>).body || "") : ""; }
function actionLines(item?: HubItem): Line[] {
  if (!item) return [];
  const raw = Array.isArray(item.payload.items) ? item.payload.items : Array.isArray(item.payload.highlights) ? item.payload.highlights : [];
  const listed = raw.map((row, index) => typeof row === "string" ? { key: String(index), title: row, detail: "" } : { key: String((row as Record<string, unknown>).id ?? index), title: String((row as Record<string, unknown>).title ?? (row as Record<string, unknown>).text ?? "未命名事项"), detail: String((row as Record<string, unknown>).summary ?? (row as Record<string, unknown>).detail ?? "") });
  if (listed.length) return listed;
  return clean(documentBody(item)).split("\n").map((line) => line.trim()).filter((line) => /(?:继续持有|暂停加仓|减仓|不加仓|不新增|执行|分批|观察|保留)/.test(line)).slice(0, 8).map((title, index) => ({ key: `doc-${index}`, title: title.replace(/^(?:[-•●▪·]|\d+[.)、])\s*/, ""), detail: "" }));
}
function renderDocument(body: string) {
  const lines = clean(body).split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.map((line, index) => {
    if (/^(?:#{1,3}\s+|[一二三四五六七八九十]+[、.]\s*|\d+[、.]\s*)/.test(line)) return <h3 key={index} className="pt-3 text-lg font-black" style={{ color: TEXT }}>{line.replace(/^#{1,3}\s*/, "")}</h3>;
    if (/^(?:[-•●▪·*])\s+/.test(line)) return <div key={index} className="flex gap-2 text-sm leading-7 text-[#5e7180]"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: ACCENT }}/><p>{line.replace(/^(?:[-•●▪·*])\s+/, "")}</p></div>;
    return <p key={index} className="text-sm leading-7 text-[#5e7180]">{line}</p>;
  });
}

export default function InsightsPage() {
  const [date] = useState(today);
  const [items, setItems] = useState<HubItem[]>([]);
  const [actions, setActions] = useState<ActionState[]>([]);
  const [focus, setFocus] = useState<InsightType>("growth_brief");
  const [error, setError] = useState("");
  const request = useCallback(async (url: string, init?: RequestInit) => {
    const token = localStorage.getItem("suci_access_token") || "";
    if (!token) throw new Error("请先从「溯 · 辞」登录，再打开洞察。");
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "同步失败"); return body;
  }, []);
  const load = useCallback(async () => { try { const data = await request(`/api/daily-hub?date=${date}`); setItems(data.items || []); setActions(data.actions || []); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取洞察内容"); } }, [date, request]);
  useEffect(() => { const timer = window.setTimeout(() => { const value = new URLSearchParams(window.location.search).get("focus"); if (value === "growth_brief" || value === "fund_strategy" || value === "market_intraday") setFocus(value); void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const item = useMemo(() => items.find((entry) => entry.content_type === focus), [focus, items]);
  const rows = actionLines(item);
  async function toggle(line: Line, checked: boolean) {
    if (!item) return;
    setActions((old) => [...old.filter((state) => !(state.item_id === item.id && state.action_key === line.key)), { item_id: item.id, action_key: line.key, completed: checked }]);
    try { await request("/api/daily-hub", { method: "POST", body: JSON.stringify({ action: "set-action-state", itemId: item.id, actionKey: line.key, completed: checked }) }); } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); void load(); }
  }
  const selectedMeta = meta[focus]; const Icon = selectedMeta.icon;
  return <main className="min-h-screen bg-[#f9f2ef]" style={{ color: TEXT }}>
    <header className="border-b border-[#eadfd9] bg-[#fffdfb]"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><Link href="/daily" className="flex items-center gap-2 font-black"><span className="grid h-9 w-9 place-items-center rounded-2xl" style={{ backgroundColor: SURFACE }}>D</span>DailyGlow</Link><nav className="hidden items-center gap-5 text-sm font-semibold md:flex"><Link href="/daily">每日中心</Link><Link href="/">溯 · 辞</Link><Link className="rounded-full px-3 py-1" style={{ backgroundColor: ACCENT }} href="/insights">洞察</Link><Link href="/training">训练</Link></nav><Link href="/daily" className="text-sm font-bold">返回总览</Link></div></header>
    <section className="mx-auto max-w-6xl px-5 py-9"><Link href="/daily" className="inline-flex items-center gap-1 text-sm font-bold text-[#5e7180]"><ArrowLeft size={16}/>每日中心</Link><div className="mt-5"><p className="flex items-center gap-2 text-sm font-bold"><Sparkles size={16} style={{ color: TEXT }}/>今日洞察</p><h1 className="mt-2 text-3xl font-black md:text-5xl">把信息变成判断。</h1><p className="mt-3 max-w-2xl leading-7 text-[#5e7180]">三份定时内容在这里分开阅读、完成行动，并在对应的 ChatGPT 任务中继续追问。</p></div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">{(Object.keys(meta) as InsightType[]).map((type) => { const card = meta[type]; const CardIcon = card.icon; const active = focus === type; return <button key={type} onClick={() => { setFocus(type); window.history.replaceState(null, "", `/insights?focus=${type}`); }} className={`rounded-[1.7rem] border border-[#eadfd9] p-5 text-left transition ${active ? "ring-2 ring-[#cfe7f1]" : "hover:-translate-y-0.5"} ${card.color}`}><CardIcon size={21}/><p className="mt-6 text-xl font-black">{card.label}</p><p className="mt-2 text-sm leading-6 text-[#465a6b]">{card.description}</p><span className="mt-5 inline-flex items-center gap-1 text-sm font-bold">查看内容 <ChevronRight size={16}/></span></button>; })}</div>
      {error && <p className="mt-6 rounded-2xl border border-[#fcceb4] bg-[#fffaf7] px-4 py-3 text-sm">{error}</p>}
      <article className="mt-8 overflow-hidden rounded-[2rem] border border-[#eadfd9] bg-[#fffdfb]"><div className={`${selectedMeta.color} p-6 md:p-8`}><Icon size={24}/><p className="mt-5 text-sm font-bold">{selectedMeta.short} · {date}</p><h2 className="mt-1 text-2xl font-black md:text-3xl">{item?.title || `等待今日${selectedMeta.short}`}</h2><p className="mt-3 max-w-3xl leading-7 text-[#465a6b]">{item?.summary || "定时任务的内容抵达后，会在这里自动整理为正文与可执行行动。"}</p></div><div className="grid gap-8 p-6 md:grid-cols-[minmax(0,1.5fr)_minmax(18rem,.8fr)] md:p-8"><section><p className="mb-4 inline-flex rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: ACCENT }}>完整洞察</p>{item ? <div className="space-y-3">{renderDocument(documentBody(item))}</div> : <div className="rounded-2xl bg-[#fffaf7] p-5 text-sm leading-7 text-[#5e7180]">内容尚未同步。你可以稍后返回刷新，或在每日中心使用备用导入。</div>}</section><aside className="rounded-[1.5rem] bg-[#f7fbfd] p-5"><p className="text-sm font-bold">行动卡</p><p className="mt-1 text-sm leading-6 text-[#5e7180]">完成状态会同步回每日中心。</p><div className="mt-4 space-y-3">{rows.length ? rows.map((line) => { const checked = actions.some((state) => state.item_id === item?.id && state.action_key === line.key && state.completed); return <label key={line.key} className="flex cursor-pointer gap-3 rounded-2xl bg-white p-3 text-sm"><input checked={checked} disabled={!item} onChange={(event) => void toggle(line, event.target.checked)} type="checkbox" className="mt-1 h-4 w-4" style={{ accentColor: ACCENT }}/><span className={checked ? "line-through opacity-55" : ""}>{line.title}{line.detail && <small className="mt-1 block leading-5 text-[#697386]">{line.detail}</small>}</span></label>; }) : <p className="rounded-2xl bg-white p-4 text-sm leading-6 text-[#697386]">这份内容暂未识别出行动项。</p>}</div><a href={taskLinks[focus]} target="_blank" rel="noreferrer" onClick={() => { if (item) void navigator.clipboard?.writeText(`请继续问答《${item.title}》，结合今天的内容给出下一步建议。`); }} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-bold" style={{ backgroundColor: SURFACE }}>继续问 GPT <ChevronRight size={16}/></a><p className="mt-2 text-center text-xs text-[#697386]">打开对应任务，同时复制追问内容。</p></aside></div></article>
  </section></main>;
}
