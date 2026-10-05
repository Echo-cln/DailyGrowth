"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, LineChart, Newspaper, ShieldAlert, Sparkles } from "lucide-react";

type InsightType = "growth_brief" | "fund_strategy" | "market_intraday";
type HubItem = { id: string; content_type: InsightType | "workout_plan"; title: string; summary: string; payload: Record<string, unknown>; content_date: string };
type ActionState = { item_id: string; action_key: string; completed: boolean };
type DocumentBlock = { kind: "title" | "heading" | "label" | "paragraph" | "bullet" | "numbered" | "quote" | "table"; text?: string; rows?: string[][] };
type DocumentTone = { title: string; tableHead: string; headingBorder: string; labelSurface: string; labelBorder: string; quoteSurface: string; quoteBorder: string; bullet: string };

const TEXT = "#3f5e77";
const SURFACE = "#cfe7f1";
const ACCENT = "#ffd8b8";
const taskLinks: Record<InsightType, string> = {
  growth_brief: "https://chatgpt.com/c/6abb0103-00dc-83ea-afbc-60a987f3eadf?automationId=6ab0f201e5a08191b50d6b5f25de2f5e&messageId=finalAgentTurnStart",
  fund_strategy: "https://chatgpt.com/c/6abc6367-7574-83ea-993d-fae69ade85b8?automationId=6abb36c335c88191b6b00164be58a233&messageId=finalAgentTurnStart",
  market_intraday: "https://chatgpt.com/c/6aba02e7-79c4-83e9-8935-8b09e57f8a38?automationId=6ab3894d946081918d9d383e8fee9ffd&messageId=finalAgentTurnStart",
};
const meta: Record<InsightType, { label: string; short: string; description: string; surface: string; border: string; ring: string; iconSurface: string; iconColor?: string; icon: typeof Newspaper; tone: DocumentTone }> = {
  growth_brief: { label: "成长洞察", short: "每日成长简报", description: "把重要趋势、机会和学习方向整理为今天可执行的判断。", surface: "bg-[#f1f9fe]", border: "border-[#b9dff5]", ring: "ring-[#b9dff5]", iconSurface: "bg-[#86c9f2]", icon: Newspaper, tone: { title: "bg-[#f1f9fe]", tableHead: "bg-[#eaf7ff]", headingBorder: "border-[#86c9f2]", labelSurface: "bg-[#f7fcff]", labelBorder: "border-[#d5ebf8]", quoteSurface: "bg-[#f6fbfe]", quoteBorder: "border-[#86c9f2]", bullet: "#86c9f2" } },
  fund_strategy: { label: "基金策略", short: "每日基金策略", description: "保留仓位、风险触发条件与需要执行的下一步。", surface: "bg-[#fff7f1]", border: "border-[#f5c7a8]", ring: "ring-[#f5c7a8]", iconSurface: "bg-[#f4b27a]", icon: LineChart, tone: { title: "bg-[#fff7f1]", tableHead: "bg-[#fff1e5]", headingBorder: "border-[#f4b27a]", labelSurface: "bg-[#fffaf6]", labelBorder: "border-[#f8dcc6]", quoteSurface: "bg-[#fff9f3]", quoteBorder: "border-[#f4b27a]", bullet: "#f4b27a" } },
  market_intraday: { label: "盘中风险", short: "盘中风控复盘", description: "下午复盘市场变化，确认是否需要调整风险动作。", surface: "bg-[#fafdf3]", border: "border-[#d4e6a2]", ring: "ring-[#d4e6a2]", iconSurface: "bg-[#b9d878]", iconColor: "#7f9f53", icon: ShieldAlert, tone: { title: "bg-[#fafdf3]", tableHead: "bg-[#f2f9e3]", headingBorder: "border-[#b9d878]", labelSurface: "bg-[#fcfef8]", labelBorder: "border-[#dfebbc]", quoteSurface: "bg-[#fbfdf5]", quoteBorder: "border-[#b9d878]", bullet: "#9bbd62" } },
};

function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function clean(value: string) { return value.replace(/\r\n?/g, "\n").replace(/genui.*?/g, "").replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1").trim(); }
function documentBody(item?: HubItem) { const raw = item?.payload.document; return raw && typeof raw === "object" && !Array.isArray(raw) ? String((raw as Record<string, unknown>).body || "") : ""; }
function splitTableRow(line: string) { return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()); }
function parseDocument(body: string): DocumentBlock[] {
  const lines = clean(body).split("\n"); const blocks: DocumentBlock[] = []; let sawTitle = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim(); if (!line) continue; const next = lines[index + 1]?.trim() || "";
    if (line.includes("|") && /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(next)) { const rows = [splitTableRow(line)]; index += 2; while (index < lines.length && lines[index].includes("|")) { rows.push(splitTableRow(lines[index])); index += 1; } blocks.push({ kind: "table", rows }); index -= 1; continue; }
    if (!sawTitle && /^(?:#\s*)?\d{4}-\d{2}-\d{2}/.test(line)) { blocks.push({ kind: "title", text: line.replace(/^#\s*/, "") }); sawTitle = true; continue; }
    if (/^(?:#{1,3}\s+|[一二三四五六七八九十]+[、.]\s*|\d+[、.]\s*)/.test(line)) { blocks.push({ kind: "heading", text: line.replace(/^#{1,3}\s*/, "") }); continue; }
    if (/^(?:结论|最终结论|触发条件|执行动作|动作|原因|执行含义|事实|不确定性|结构结论|补充市场体检|今日最终执行表)\s*[：:]/.test(line)) { blocks.push({ kind: "label", text: line }); continue; }
    const bullet = line.match(/^(?:[-•●▪·*])\s+(.+)$/); if (bullet) { blocks.push({ kind: "bullet", text: bullet[1] }); continue; }
    const numbered = line.match(/^\d+[.)]\s+(.+)$/); if (numbered) { blocks.push({ kind: "numbered", text: numbered[1] }); continue; }
    if (line.startsWith(">")) { blocks.push({ kind: "quote", text: line.replace(/^>\s*/, "") }); continue; }
    blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
}
function inline(text: string) { const parts = text.split(/(\*\*[^*]+\*\*)/g); return parts.map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index} className="font-extrabold" style={{ color: TEXT }}>{part.slice(2, -2)}</strong> : part); }
function renderDocument(body: string, tone: DocumentTone) { return parseDocument(body).map((block, index) => {
  if (block.kind === "table" && block.rows?.length) return <div key={index} className="my-6 overflow-x-auto rounded-2xl border border-[#dbe8ee] bg-white"><table className="w-full min-w-[34rem] text-left text-sm"><thead className={tone.tableHead}><tr>{block.rows[0].map((cell, cellIndex) => <th key={cellIndex} className="px-4 py-3 font-extrabold">{inline(cell)}</th>)}</tr></thead><tbody>{block.rows.slice(1).map((row, rowIndex) => <tr key={rowIndex} className="border-t border-[#e5eef2]">{row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-3 align-top leading-6 text-[#526979]">{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
  if (block.kind === "title") return <p key={index} className={`mb-6 rounded-xl px-4 py-3 text-sm font-bold text-[#526979] ${tone.title}`}>{inline(block.text || "")}</p>;
  if (block.kind === "heading") return <h3 key={index} className={`mt-9 border-l-4 pl-3 text-xl font-black tracking-tight ${tone.headingBorder}`} style={{ color: TEXT }}>{inline(block.text || "")}</h3>;
  if (block.kind === "label") return <p key={index} className={`rounded-xl border px-4 py-3 text-base leading-7 text-[#526979] ${tone.labelSurface} ${tone.labelBorder}`}>{inline(block.text || "")}</p>;
  if (block.kind === "quote") return <blockquote key={index} className={`border-l-4 px-5 py-4 text-base font-semibold leading-8 text-[#526979] ${tone.quoteSurface} ${tone.quoteBorder}`}>{inline(block.text || "")}</blockquote>;
  if (block.kind === "bullet" || block.kind === "numbered") return <div key={index} className="flex gap-3 text-base leading-8 text-[#526979]"><span className="mt-3 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.bullet }} /><p>{inline(block.text || "")}</p></div>;
  return <p key={index} className="text-base leading-8 text-[#526979]">{inline(block.text || "")}</p>;
}); }

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
  const moduleActionKey = "__module_complete__";
  const moduleComplete = actions.some((state) => state.item_id === item?.id && state.action_key === moduleActionKey && state.completed);
  async function toggle(checked: boolean) {
    if (!item) return;
    setActions((old) => [...old.filter((state) => !(state.item_id === item.id && state.action_key === moduleActionKey)), { item_id: item.id, action_key: moduleActionKey, completed: checked }]);
    try { await request("/api/daily-hub", { method: "POST", body: JSON.stringify({ action: "set-action-state", itemId: item.id, actionKey: moduleActionKey, completed: checked }) }); } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); void load(); }
  }
  const selectedMeta = meta[focus]; const Icon = selectedMeta.icon;
  return <main className="min-h-screen bg-[#f9f2ef]" style={{ color: TEXT }}>
    <header className="border-b border-[#eadfd9] bg-[#fffdfb]"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><Link href="/daily" className="flex items-center gap-2 font-black"><span className="grid h-9 w-9 place-items-center rounded-2xl" style={{ backgroundColor: SURFACE }}>D</span>DailyGlow</Link><nav className="hidden items-center gap-5 text-sm font-semibold md:flex"><Link href="/daily">每日中心</Link><Link href="/">溯 · 辞</Link><Link className="rounded-full px-3 py-1" style={{ backgroundColor: ACCENT }} href="/insights">洞察</Link><Link href="/training">训练</Link></nav><Link href="/daily" className="text-sm font-bold">返回总览</Link></div></header>
    <section className="mx-auto max-w-6xl px-5 py-9"><div className="relative overflow-hidden rounded-[2rem] border border-[#d6e7f0] bg-[linear-gradient(115deg,#ffffff_0%,#f6fbff_60%,#f9fbed_100%)] p-6 shadow-[0_16px_45px_rgba(63,94,119,0.07)] md:p-9"><div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border-[18px] border-[#dbeff8]/80"/><Link href="/daily" className="relative inline-flex items-center gap-1 text-sm font-bold text-[#5e7180]"><ArrowLeft size={16}/>每日中心</Link><div className="relative mt-5"><p className="flex items-center gap-2 text-sm font-bold"><Sparkles size={16} style={{ color: TEXT }}/>今日洞察</p><h1 className="mt-2 text-3xl font-black tracking-tight md:text-5xl">把信息变成判断。</h1><p className="mt-3 max-w-2xl leading-7 text-[#5e7180]">三份定时内容在这里分开阅读、完成行动，并在对应的 ChatGPT 任务中继续追问。</p></div></div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">{(Object.keys(meta) as InsightType[]).map((type) => { const card = meta[type]; const CardIcon = card.icon; const active = focus === type; return <button key={type} onClick={() => { setFocus(type); window.history.replaceState(null, "", `/insights?focus=${type}`); }} className={`rounded-[1.7rem] border p-5 text-left shadow-[0_10px_26px_rgba(63,94,119,0.035)] transition ${active ? `ring-2 ${card.ring}` : "hover:-translate-y-0.5 hover:shadow-[0_15px_30px_rgba(63,94,119,0.08)]"} ${card.surface} ${card.border}`}><span className={`grid h-11 w-11 place-items-center rounded-2xl ${card.iconSurface}`}><CardIcon size={21} style={{ color: card.iconColor }}/></span><p className="mt-6 text-xl font-black">{card.label}</p><p className="mt-2 text-sm leading-6 text-[#5e7180]">{card.description}</p><span className="mt-5 inline-flex items-center gap-1 text-sm font-bold">查看内容 <ChevronRight size={16}/></span></button>; })}</div>
      {error && <p className="mt-6 rounded-2xl border border-[#fcceb4] bg-[#fffaf7] px-4 py-3 text-sm">{error}</p>}
      <article className="mt-8 overflow-hidden rounded-[2rem] border border-[#d6e7f0] bg-[#fffdfb] shadow-[0_14px_36px_rgba(63,94,119,0.045)]"><div className={`flex flex-wrap items-start justify-between gap-6 border-b p-6 md:p-8 ${selectedMeta.surface} ${selectedMeta.border}`}><div className="max-w-3xl"><span className={`grid h-12 w-12 place-items-center rounded-2xl ${selectedMeta.iconSurface}`}><Icon size={24} style={{ color: selectedMeta.iconColor }}/></span><p className="mt-5 text-sm font-bold">{selectedMeta.short} · {date}</p><h2 className="mt-1 text-2xl font-black md:text-3xl">{item?.title || `等待今日${selectedMeta.short}`}</h2><p className="mt-3 leading-7 text-[#5e7180]">{item?.summary || "定时任务的内容抵达后，会在这里自动整理为适合网页阅读的报告。"}</p></div><label className={`flex min-w-[14rem] cursor-pointer items-center gap-3 rounded-2xl border bg-white/80 px-4 py-3 transition ${moduleComplete ? selectedMeta.border : "border-white"}`}><input checked={moduleComplete} disabled={!item} onChange={(event) => void toggle(event.target.checked)} type="checkbox" className="h-5 w-5" style={{ accentColor: ACCENT }}/><span><b className={moduleComplete ? "line-through opacity-55" : ""}>完成本篇</b><small className="mt-0.5 block text-xs text-[#697386]">同步回每日中心</small></span></label></div><div className="p-6 md:p-8"><section className="mx-auto max-w-4xl"><p className="mb-5 inline-flex rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: ACCENT }}>完整洞察</p>{item ? <div className="space-y-4">{renderDocument(documentBody(item), selectedMeta.tone)}</div> : <div className="rounded-2xl bg-[#fffaf7] p-5 text-sm leading-7 text-[#5e7180]">内容尚未同步。你可以稍后返回刷新，或在每日中心使用备用导入。</div>}<div className={`mt-10 border-t pt-6 ${selectedMeta.border}`}><a href={taskLinks[focus]} target="_blank" rel="noreferrer" onClick={() => { if (item) void navigator.clipboard?.writeText(`请继续问答《${item.title}》，结合今天的内容给出下一步建议。`); }} className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold" style={{ backgroundColor: SURFACE }}>继续问 GPT <ChevronRight size={16}/></a><p className="mt-2 text-xs text-[#697386]">打开对应的每日任务，并复制追问内容。</p></div></section></div></article>
  </section></main>;
}
