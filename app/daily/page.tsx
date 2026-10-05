"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check, ChevronLeft, ChevronRight,
  Dumbbell, LineChart, Newspaper, Plus, RefreshCw, Sparkles, X,
} from "lucide-react";

type HubType = "growth_brief" | "fund_strategy" | "market_intraday" | "workout_plan";
type HubItem = {
  id: string; content_type: HubType; title: string; summary: string;
  payload: Record<string, unknown>; content_date: string;
};
type ActionState = { item_id: string; action_key: string; completed: boolean };
type HubLine = { key: string; title: string; detail: string; url?: string };
type HubDocument = { body?: string; subject?: string; receivedAt?: string };
type DocumentBlock = { kind: "title" | "heading" | "label" | "paragraph" | "bullet" | "numbered" | "table"; text?: string; rows?: string[][] };

// 只替换页面中突兀的橙色与近黑深蓝；卡片底色、背景和整体主题保持不变。
// 两个替代色严格取自用户的参考图：蜜桃 #FFD8B8、雾蓝 #CFE7F1。
const DAILY_ACCENT = "#ffd8b8";
const DAILY_SURFACE = "#cfe7f1";
const DAILY_TEXT = "#465a6b";
const DAILY_ACCENT_PALE = "#fff1e4";
const GPT_TASK_URLS: Record<HubType, string> = {
  growth_brief: "https://chatgpt.com/c/6abb0103-00dc-83ea-afbc-60a987f3eadf?automationId=6ab0f201e5a08191b50d6b5f25de2f5e&messageId=finalAgentTurnStart",
  fund_strategy: "https://chatgpt.com/c/6abc6367-7574-83ea-993d-fae69ade85b8?automationId=6abb36c335c88191b6b00164be58a233&messageId=finalAgentTurnStart",
  market_intraday: "https://chatgpt.com/c/6aba02e7-79c4-83e9-8935-8b09e57f8a38?automationId=6ab3894d946081918d9d383e8fee9ffd&messageId=finalAgentTurnStart",
  workout_plan: "https://chatgpt.com/c/6ab3cca9-0b58-83e9-823e-2bf1aa4b4b09?automationId=6ab3d0b894508191aaa80aa90c093a60&messageId=finalAgentTurnStart",
};

const modules: Record<HubType, { label: string; hint: string; color: string; icon: typeof Newspaper }> = {
  growth_brief: { label: "每日简报", hint: "信息、机会与值得留意的事", color: "bg-[#abd7fb]", icon: Newspaper },
  fund_strategy: { label: "基金策略", hint: "09:00 的完整策略、仓位与触发条件", color: "bg-[#fcceb4]", icon: LineChart },
  market_intraday: { label: "盘中风控", hint: "14:00 的盘中复盘与风险动作", color: "bg-[#f7d6ae]", icon: LineChart },
  workout_plan: { label: "今日训练", hint: "DailyGlow 运动塑形计划", color: "bg-[#d2e0aa]", icon: Dumbbell },
};

function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function shiftDate(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function friendlyDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Shanghai" }).format(new Date(`${value}T12:00:00Z`)); }
function linesFrom(item: HubItem) {
  const list = Array.isArray(item.payload.items) ? item.payload.items : Array.isArray(item.payload.highlights) ? item.payload.highlights : [];
  return list.map((entry, index) => {
    if (typeof entry === "string") return { key: String(index), title: entry, detail: "" } satisfies HubLine;
    const value = entry as Record<string, unknown>;
    const candidateUrl = String(value.url ?? value.link ?? "").trim();
    return { key: String(value.id ?? index), title: String(value.title ?? value.text ?? "未命名事项"), detail: String(value.summary ?? value.detail ?? ""), url: /^https?:\/\//i.test(candidateUrl) ? candidateUrl : undefined } satisfies HubLine;
  });
}
function documentFrom(item: HubItem): HubDocument | null {
  const document = item.payload.document;
  return document && typeof document === "object" && !Array.isArray(document) ? document as HubDocument : null;
}

function cleanDocumentText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/genui.*?/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .trim();
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function parseDocumentBody(body: string): DocumentBlock[] {
  const lines = cleanDocumentText(body).split("\n");
  const blocks: DocumentBlock[] = [];
  let sawTitle = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    const next = lines[index + 1]?.trim() || "";
    if (raw.includes("|") && /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(next)) {
      const rows = [splitTableRow(raw)]; index += 2;
      while (index < lines.length && lines[index].includes("|")) { rows.push(splitTableRow(lines[index])); index += 1; }
      blocks.push({ kind: "table", rows }); index -= 1; continue;
    }
    if (!sawTitle && /^(?:\d{4}-\d{2}-\d{2}|#\s*\d{4}-\d{2}-\d{2})/.test(raw)) { blocks.push({ kind: "title", text: raw.replace(/^#\s*/, "") }); sawTitle = true; continue; }
    if (/^(?:#{1,3}\s+|[一二三四五六七八九十]+[、.]\s*|\d+[、.]\s*)/.test(raw)) { blocks.push({ kind: "heading", text: raw.replace(/^#{1,3}\s*/, "") }); continue; }
    if (/^(?:触发条件|执行动作|动作|原因|执行含义|事实|不确定性|结论|结构结论|补充市场体检|最终结论|今日最终执行表|完成情况|训练难度|膝盖状况|腹部酸痛|预计睡眠)\s*[：:]/.test(raw)) { blocks.push({ kind: "label", text: raw }); continue; }
    const bullet = raw.match(/^(?:[-•●▪·*])\s+(.+)$/);
    if (bullet) { blocks.push({ kind: "bullet", text: bullet[1] }); continue; }
    const numbered = raw.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) { blocks.push({ kind: "numbered", text: numbered[1] }); continue; }
    blocks.push({ kind: "paragraph", text: raw });
  }
  return blocks;
}

const IMPORTANT_RE = /(¥[\d,.]+|\d+(?:\.\d+)?%|风险等级|暂停加仓|继续持有|减仓|禁止加仓|不允许|保留现金|触发条件|执行动作|完成打卡)/g;
function emphasizeText(text: string) {
  return text.split(IMPORTANT_RE).map((part, index) => index % 2 === 1 ? <strong key={`${part}-${index}`} className="font-extrabold" style={{ color: DAILY_TEXT }}>{part}</strong> : part);
}

function DocumentRenderer({ body, compact = false, maxBlocks }: { body: string; compact?: boolean; maxBlocks?: number }) {
  const blocks = parseDocumentBody(body).slice(0, maxBlocks);
  return <div className={compact ? "space-y-2" : "space-y-4"}>{blocks.map((block, index) => {
    if (block.kind === "table" && block.rows?.length) return <div key={`table-${index}`} className="overflow-x-auto rounded-2xl border border-[#eadfd9]"><table className="w-full min-w-[28rem] text-left text-sm"><thead className="bg-[#f4ece8]"><tr>{block.rows[0].map((cell, cellIndex) => <th key={cellIndex} className="px-3 py-2 font-bold">{emphasizeText(cell)}</th>)}</tr></thead><tbody>{block.rows.slice(1).map((row, rowIndex) => <tr key={rowIndex} className="border-t border-[#eadfd9]">{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top leading-6">{emphasizeText(cell)}</td>)}</tr>)}</tbody></table></div>;
    if (block.kind === "title") return <h3 key={index} className={`${compact ? "text-base" : "text-xl"} font-black tracking-tight`}>{emphasizeText(block.text || "")}</h3>;
    if (block.kind === "heading") return <h4 key={index} className={`${compact ? "text-sm" : "text-lg"} pt-2 font-black`} style={{ color: DAILY_TEXT }}>{emphasizeText(block.text || "")}</h4>;
    if (block.kind === "label") return <p key={index} className="text-sm font-bold" style={{ color: DAILY_TEXT }}>{emphasizeText(block.text || "")}</p>;
    if (block.kind === "bullet" || block.kind === "numbered") return <div key={index} className="flex gap-2 text-sm leading-6"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: DAILY_ACCENT }} /> <p>{emphasizeText(block.text || "")}</p></div>;
    return <p key={index} className={`${compact ? "text-sm leading-6" : "text-sm leading-7"} text-[#697386]`}>{emphasizeText(block.text || "")}</p>;
  })}</div>;
}

function actionLinesFrom(item: HubItem): HubLine[] {
  const existing = linesFrom(item);
  if (existing.length) return existing;
  const body = documentFrom(item)?.body || "";
  const candidates = cleanDocumentText(body).split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => {
    if (/^(?:#|\d{4}-\d{2}-\d{2})/.test(line)) return false;
    return /(?:继续持有|暂停加仓|减仓|不加仓|不新增|不允许|保留|分批|执行|完成打卡|热身|主训练|拉伸|训练)/.test(line) || /^(?:[-•●▪·]|\d+[.)、])\s*/.test(line);
  });
  const unique = Array.from(new Set(candidates)).slice(0, 8);
  return unique.map((line, index) => ({ key: `document-${index}`, title: line.replace(/^(?:[-•●▪·]|\d+[.)、])\s*/, ""), detail: "" }));
}

function AskGPTButton({ prompt, href }: { prompt: string; href: string }) {
  const [copied, setCopied] = useState(false);
  async function ask() {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); window.setTimeout(() => setCopied(false), 2200); } catch { /* clipboard permission is optional */ }
  }
  return <a href={href} target="_blank" rel="noreferrer" onClick={() => { void ask(); }} className="inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold transition hover:opacity-80" style={{ borderColor: DAILY_SURFACE, backgroundColor: "#cfe7f1aa", color: DAILY_TEXT }}>{copied ? "已复制问题" : "继续问 GPT"}</a>;
}

export default function DailyPage() {
  const [date, setDate] = useState(today);
  const [items, setItems] = useState<HubItem[]>([]);
  const [actions, setActions] = useState<ActionState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState<HubType | null>(null);
  const [opened, setOpened] = useState<HubItem | null>(null);
  const [saving, setSaving] = useState(false);

  const token = useCallback(() => typeof window === "undefined" ? "" : localStorage.getItem("suci_access_token") || "", []);
  const request = useCallback(async (url: string, init?: RequestInit) => {
    const accessToken = token();
    if (!accessToken) throw new Error("请先从「溯 · 辞」登录，再打开每日主页。");
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "同步失败");
    return body;
  }, [token]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await request(`/api/daily-hub?date=${date}`); setItems(data.items || []); setActions(data.actions || []); }
    catch (cause) { setItems([]); setActions([]); setError(cause instanceof Error ? cause.message : "无法读取今日内容"); }
    finally { setLoading(false); }
  }, [date, request]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const completed = useMemo(() => actions.filter((state) => state.completed).length, [actions]);
  const actionTotal = useMemo(() => items.reduce((total, item) => total + actionLinesFrom(item).length, 0), [items]);
  async function toggle(itemId: string, actionKey: string, checked: boolean) {
    setActions((old) => [...old.filter((state) => !(state.item_id === itemId && state.action_key === actionKey)), { item_id: itemId, action_key: actionKey, completed: checked }]);
    try { await request("/api/daily-hub", { method: "POST", body: JSON.stringify({ action: "set-action-state", itemId, actionKey, completed: checked }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); void load(); }
  }
  async function saveImport(type: HubType, title: string, summary: string, rawPayload: string) {
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(rawPayload); } catch { setError("内容不是有效的 JSON，请检查逗号和引号。"); return; }
    setSaving(true);
    try {
      await request("/api/daily-hub", { method: "POST", body: JSON.stringify({ action: "upsert-content", contentType: type, contentDate: date, title, summary, payload, importSource: "chatgpt_or_manual" }) });
      setImporting(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败"); }
    finally { setSaving(false); }
  }
  async function copyToToday(item: HubItem) {
    if (date === today()) return;
    if (!window.confirm(`将「${item.title}」复制到今天吗？若今天已有同类内容，将由这份历史内容替换。`)) return;
    setSaving(true);
    try {
      await request("/api/daily-hub", { method: "POST", body: JSON.stringify({ action: "upsert-content", contentType: item.content_type, contentDate: today(), title: item.title, summary: item.summary, payload: item.payload, importSource: `history_copy:${item.content_date}` }) });
      setOpened(null);
      setError("已复制到今天。切回今天即可继续完成。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "复制失败"); }
    finally { setSaving(false); }
  }

  return <main className="min-h-screen bg-[#f9f2ef]" style={{ color: DAILY_TEXT }}>
    <header className="sticky top-0 z-20 border-b border-[#eadfd9] bg-[#fffdfb]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/daily" className="flex items-center gap-2 font-black tracking-tight"><span className="grid h-9 w-9 place-items-center rounded-2xl" style={{ backgroundColor: DAILY_SURFACE, color: DAILY_TEXT }}>D</span><span>DailyGlow</span></Link>
        <nav className="hidden items-center gap-5 text-sm font-semibold md:flex"><Link className="rounded-full px-2 py-1" style={{ backgroundColor: DAILY_ACCENT, color: DAILY_TEXT }} href="/daily">每日中心</Link><Link href="/">溯 · 辞</Link><Link className="text-[#697386] hover:text-[#465a6b]" href="/daily#insights">洞察</Link><Link className="text-[#697386] hover:text-[#465a6b]" href="/daily#training">训练</Link></nav>
        <Link href="/" className="rounded-full px-4 py-2 text-sm font-semibold" style={{ backgroundColor: DAILY_SURFACE, color: DAILY_TEXT }}>学习中心</Link>
      </div>
    </header>
    <section className="mx-auto max-w-6xl px-5 pb-16 pt-8">
      <div className="rounded-[2rem] border border-[#eadfd9] bg-[#fffdfb] p-6 shadow-[0_16px_45px_rgba(36,50,71,0.07)] md:p-9">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div><p className="mb-3 flex items-center gap-2 text-sm font-bold" style={{ color: DAILY_TEXT }}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: DAILY_ACCENT }}/><Sparkles size={16}/>你的每日成长桌面</p><h1 className="text-3xl font-black tracking-tight md:text-5xl">今天，慢慢变好。</h1><p className="mt-3 text-[#697386]">{friendlyDate(date)} · 已完成 {completed} / {actionTotal} 项行动</p></div>
          <div className="flex items-center gap-2 rounded-full bg-[#f4ece8] p-1"><button aria-label="前一天" onClick={() => setDate(shiftDate(date, -1))} className="rounded-full p-2 hover:bg-white"><ChevronLeft size={18}/></button><span className="min-w-28 text-center text-sm font-bold">{date}</span><button aria-label="后一天" onClick={() => setDate(shiftDate(date, 1))} className="rounded-full p-2 hover:bg-white"><ChevronRight size={18}/></button></div>
        </div>
      </div>
      {error && <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border bg-[#fff7f2] px-5 py-4 text-sm" style={{ borderColor: `${DAILY_ACCENT}cc` }}><span>{error}</span><Link className="shrink-0 font-bold" style={{ color: DAILY_TEXT }} href="/">去登录</Link></div>}
      <div id="insights" className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(modules) as HubType[]).map((type) => <div key={type} id={type === "workout_plan" ? "training" : undefined} className="scroll-mt-24"><HubCard type={type} item={items.find((item) => item.content_type === type)} actions={actions} loading={loading} onImport={() => setImporting(type)} onToggle={toggle} onOpen={setOpened}/></div>) }
      </div>
      <section className="mt-8 rounded-[2rem] border border-[#eadfd9] bg-[#fffdfb] p-6 md:p-8"><div className="flex items-center justify-between gap-4"><div><p className="inline-flex rounded-full px-3 py-1 text-sm font-bold" style={{ backgroundColor: DAILY_ACCENT, color: DAILY_TEXT }}>云端每日更新</p><h2 className="mt-2 text-xl font-black">三条内容，自动分开抵达</h2></div><RefreshCw size={20} className="text-[#697386]"/></div><p className="mt-3 max-w-3xl leading-7 text-[#697386]">早上自动生成每日简报与训练计划，下午自动补充基金市场观察；它们会直接保存到你的私有云端账户，换设备登录也能看到。下方的手动导入只在自动任务临时不可用时作为备用。</p><button onClick={() => setImporting("growth_brief")} className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#eadfd9] px-4 py-2 text-sm font-bold hover:border-[#ffd8b8]"><Plus size={16}/>备用：手动导入</button></section>
    </section>
    {importing && <ImportDialog type={importing} date={date} saving={saving} onClose={() => setImporting(null)} onSave={saveImport}/>} 
    {opened && <DetailDialog item={opened} actions={actions} date={date} saving={saving} onClose={() => setOpened(null)} onToggle={toggle} onCopyToToday={copyToToday}/>} 
  </main>;
}

function ActionCard({ item, row, actions, onToggle, index, compact = false }: { item: HubItem; row: HubLine; actions: ActionState[]; onToggle: (itemId: string, actionKey: string, checked: boolean) => void; index?: number; compact?: boolean }) {
  const checked = actions.some((state) => state.item_id === item.id && state.action_key === row.key && state.completed);
  const prompt = `请继续问答《${item.title}》中的行动：${row.title}。结合今天的数据，给出下一步建议。`;
  return <div className={`rounded-2xl border border-[#eadfd9] ${compact ? "bg-[#f9f2ef] p-3" : "bg-white p-4"}`}><div className="flex items-start gap-3"><input aria-label={`完成：${row.title}`} checked={checked} onChange={(event) => onToggle(item.id, row.key, event.target.checked)} type="checkbox" className="mt-1 h-4 w-4" style={{ accentColor: DAILY_ACCENT }}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div>{index !== undefined && <small className="font-bold" style={{ color: DAILY_TEXT }}>{String(index + 1).padStart(2, "0")}</small>}<b className={`block ${index !== undefined ? "ml-2" : ""} ${checked ? "line-through opacity-50" : ""}`}>{row.title}</b>{row.detail && <p className="mt-1 text-sm leading-6 text-[#697386]">{row.detail}</p>}</div><AskGPTButton prompt={prompt} href={GPT_TASK_URLS[item.content_type]}/></div>{row.url && <a href={row.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#28628F]">打开相关内容 <ChevronRight size={15}/></a>}</div></div></div>;
}

function HubCard({ type, item, actions, loading, onImport, onToggle, onOpen }: { type: HubType; item?: HubItem; actions: ActionState[]; loading: boolean; onImport: () => void; onToggle: (itemId: string, actionKey: string, checked: boolean) => void; onOpen: (item: HubItem) => void }) {
  const hubModule = modules[type]; const Icon = hubModule.icon; const rows = item ? actionLinesFrom(item) : []; const document = item ? documentFrom(item) : null;
  return <article className="overflow-hidden rounded-[2rem] border border-[#eadfd9] bg-[#fffdfb] shadow-sm"><div className={`${hubModule.color} p-6`}><div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/65"><Icon size={21}/></span><span className="rounded-full bg-white/60 px-3 py-1 text-xs font-bold">{document ? "邮件同步" : "自动更新"}</span></div><h2 className="mt-7 text-2xl font-black">{hubModule.label}</h2><p className="mt-1 min-h-10 text-sm leading-5" style={{ color: DAILY_TEXT }}>{item?.summary || hubModule.hint}</p></div><div className="min-h-55 p-6">{loading ? <p className="text-sm text-[#697386]">正在读取你的云端内容…</p> : !item ? <div className="flex h-38 flex-col justify-between"><p className="text-sm leading-6 text-[#697386]">自动邮件尚未到达。稍后刷新即可；也可临时手动导入。</p><button onClick={onImport} className="inline-flex w-fit items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold" style={{ backgroundColor: DAILY_SURFACE, color: DAILY_TEXT }}><Plus size={16}/>备用手动导入</button></div> : <><p className="mb-4 text-lg font-black">{item.title}</p>{document?.body ? <><DocumentRenderer body={document.body} compact maxBlocks={4}/><div className="mt-4 space-y-2">{rows.slice(0, 2).map((row) => <ActionCard key={row.key} item={item} row={row} actions={actions} onToggle={onToggle} compact/>)}</div></> : <div className="space-y-3">{rows.slice(0, 3).map((row, index) => <ActionCard key={row.key} item={item} row={row} actions={actions} onToggle={onToggle} index={index} compact/>)}</div>}<button onClick={() => onOpen(item)} className="mt-4 inline-flex items-center gap-1 text-sm font-bold" style={{ color: DAILY_TEXT, textDecoration: "underline", textDecorationColor: DAILY_ACCENT }}>查看完整原文 <ChevronRight size={16}/></button></>}</div></article>;
}

function DetailDialog({ item, actions, date, saving, onClose, onToggle, onCopyToToday }: { item: HubItem; actions: ActionState[]; date: string; saving: boolean; onClose: () => void; onToggle: (itemId: string, actionKey: string, checked: boolean) => void; onCopyToToday: (item: HubItem) => void }) {
  const meta = modules[item.content_type]; const Icon = meta.icon; const rows = actionLinesFrom(item); const document = documentFrom(item);
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-[#697386]/45 p-4"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-[#fffdfb] shadow-2xl"><div className={`${meta.color} sticky top-0 z-10 flex items-start justify-between p-6`}><div><span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/65"><Icon size={20}/></span><p className="mt-4 text-sm font-bold" style={{ color: DAILY_TEXT }}>{friendlyDate(item.content_date)} · {meta.label}</p><h2 className="mt-1 text-2xl font-black">{item.title}</h2>{item.summary && <p className="mt-2 max-w-xl text-sm leading-6" style={{ color: DAILY_TEXT }}>{item.summary}</p>}</div><button aria-label="关闭" onClick={onClose} className="rounded-full bg-white/55 p-2 hover:bg-white"><X size={20}/></button></div><div className="space-y-5 p-6">{document?.body && <article className="rounded-2xl border border-[#eadfd9] bg-[#fffaf7] p-5"><p className="mb-4 inline-flex rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: DAILY_ACCENT, color: DAILY_TEXT }}>正文 · 已整理为标题、段落、重点、列表与表格</p><DocumentRenderer body={document.body}/></article>}{rows.length ? <section><div className="mb-3 flex items-center justify-between gap-3"><div><p className="inline-flex rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: DAILY_ACCENT, color: DAILY_TEXT }}>行动卡</p><h3 className="mt-2 text-lg font-black">今天完成后逐项打勾</h3></div><span className="rounded-full px-3 py-1 text-xs font-bold" style={{ backgroundColor: DAILY_ACCENT_PALE, color: DAILY_TEXT }}>{rows.length} 项</span></div><div className="space-y-3">{rows.map((row, index) => <ActionCard key={row.key} item={item} row={row} actions={actions} onToggle={onToggle} index={index}/>)}</div></section> : <p className="rounded-2xl bg-[#f9f2ef] p-5 text-sm leading-6 text-[#697386]">这份内容尚未包含行动项。</p>}</div>{date !== today() && <div className="sticky bottom-0 border-t border-[#eadfd9] bg-[#fffdfb]/95 p-5 backdrop-blur"><button disabled={saving} onClick={() => onCopyToToday(item)} className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold disabled:opacity-60" style={{ backgroundColor: DAILY_SURFACE, color: DAILY_TEXT }}><RefreshCw size={17}/>导入这份历史内容到今天</button></div>}</div></div>;
}

function ImportDialog({ type, date, saving, onClose, onSave }: { type: HubType; date: string; saving: boolean; onClose: () => void; onSave: (type: HubType, title: string, summary: string, payload: string) => void }) {
  const hubModule = modules[type]; const [title, setTitle] = useState(hubModule.label); const [summary, setSummary] = useState(""); const [payload, setPayload] = useState('{\n  "items": [\n    { "id": "1", "title": "", "summary": "" }\n  ]\n}'); const [paste, setPaste] = useState(""); const [pasteError, setPasteError] = useState("");
  function fillFromPaste() { try { const parsed = JSON.parse(paste) as Record<string, unknown>; const nextPayload = parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload) ? parsed.payload : parsed.items ? { items: parsed.items } : parsed; if (typeof parsed.title === "string" && parsed.title.trim()) setTitle(parsed.title.trim()); if (typeof parsed.summary === "string") setSummary(parsed.summary.trim()); setPayload(JSON.stringify(nextPayload, null, 2)); setPasteError(""); } catch { setPasteError("无法识别这份 JSON。请确认没有 Markdown 代码围栏、缺失逗号或中文引号。"); } }
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-[#697386]/45 p-4"><div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-[#fffdfb] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="inline-flex rounded-full px-3 py-1 text-sm font-bold" style={{ backgroundColor: DAILY_ACCENT, color: DAILY_TEXT }}>导入到 {date}</p><h2 className="mt-2 text-2xl font-black">{hubModule.label}</h2></div><button aria-label="关闭" onClick={onClose} className="rounded-full p-2 hover:bg-[#f4ece8]"><X size={20}/></button></div><p className="mt-3 text-sm leading-6 text-[#697386]">粘贴该定时任务生成的完整 JSON 后点击识别即可。此导入只更新「{hubModule.label}」，不会覆盖另外两种内容。</p><label className="mt-5 block text-sm font-bold">一键粘贴任务 JSON<textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'{\n  "title": "…",\n  "summary": "…",\n  "payload": { "items": [] }\n}'} spellCheck={false} className="mt-2 min-h-36 w-full rounded-xl border border-[#abd7fb] bg-[#f4faff] p-3 font-mono text-xs leading-6 outline-none focus:border-[#28628f]"/></label><div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-[#697386]">可直接粘贴任务回复，不用拆分三段。</span><button type="button" onClick={fillFromPaste} className="shrink-0 rounded-full border border-[#abd7fb] px-3 py-1.5 text-xs font-bold text-[#28628f]">识别并填入</button></div>{pasteError && <p className="mt-2 text-xs font-medium text-[#b63833]">{pasteError}</p>}<label className="mt-5 block text-sm font-bold">标题<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 w-full rounded-xl border border-[#eadfd9] bg-white px-3 py-2.5 outline-none" style={{ outlineColor: DAILY_ACCENT }}/></label><label className="mt-4 block text-sm font-bold">一句摘要<input value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-2 w-full rounded-xl border border-[#eadfd9] bg-white px-3 py-2.5 outline-none" style={{ outlineColor: DAILY_ACCENT }}/></label><label className="mt-4 block text-sm font-bold">内容 JSON<textarea value={payload} onChange={(e) => setPayload(e.target.value)} spellCheck={false} className="mt-2 min-h-48 w-full rounded-xl border border-[#eadfd9] bg-[#f9f2ef] p-3 font-mono text-xs leading-6 outline-none" style={{ outlineColor: DAILY_ACCENT }}/></label><button disabled={saving} onClick={() => onSave(type, title, summary, payload)} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 font-bold disabled:opacity-60" style={{ backgroundColor: DAILY_ACCENT, color: DAILY_TEXT }}>{saving ? "保存中…" : <><Check size={18}/>保存到云端</>}</button></div></div>;
}
