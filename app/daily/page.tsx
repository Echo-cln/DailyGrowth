"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check, ChevronLeft, ChevronRight,
  Dumbbell, LineChart, Newspaper, Plus, RefreshCw, Sparkles, X,
} from "lucide-react";

type HubType = "growth_brief" | "market_brief" | "workout_plan";
type HubItem = {
  id: string; content_type: HubType; title: string; summary: string;
  payload: Record<string, unknown>; content_date: string;
};
type ActionState = { item_id: string; action_key: string; completed: boolean };
type HubLine = { key: string; title: string; detail: string; url?: string };

const modules: Record<HubType, { label: string; hint: string; color: string; icon: typeof Newspaper }> = {
  growth_brief: { label: "每日简报", hint: "信息、机会与值得留意的事", color: "bg-[#abd7fb]", icon: Newspaper },
  market_brief: { label: "基金市场", hint: "独立的市场观察，不与日常简报混在一起", color: "bg-[#fcceb4]", icon: LineChart },
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

  return <main className="min-h-screen bg-[#f9f2ef] text-[#243247]">
    <header className="sticky top-0 z-20 border-b border-[#eadfd9] bg-[#fffdfb]/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/daily" className="flex items-center gap-2 font-black tracking-tight"><span className="grid h-9 w-9 place-items-center rounded-2xl bg-[#f98c53] text-white">D</span><span>DailyGlow</span></Link>
        <nav className="hidden items-center gap-5 text-sm font-semibold md:flex"><Link className="text-[#f98c53]" href="/daily">每日中心</Link><Link href="/">溯 · 辞</Link><span className="text-[#697386]">洞察</span><span className="text-[#697386]">训练</span></nav>
        <Link href="/" className="rounded-full bg-[#243247] px-4 py-2 text-sm font-semibold text-white">学习中心</Link>
      </div>
    </header>
    <section className="mx-auto max-w-6xl px-5 pb-16 pt-8">
      <div className="rounded-[2rem] border border-[#eadfd9] bg-[#fffdfb] p-6 shadow-[0_16px_45px_rgba(36,50,71,0.07)] md:p-9">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div><p className="mb-3 flex items-center gap-2 text-sm font-bold text-[#f98c53]"><Sparkles size={16}/>你的每日成长桌面</p><h1 className="text-3xl font-black tracking-tight md:text-5xl">今天，慢慢变好。</h1><p className="mt-3 text-[#697386]">{friendlyDate(date)} · 已完成 {completed} 项行动</p></div>
          <div className="flex items-center gap-2 rounded-full bg-[#f4ece8] p-1"><button aria-label="前一天" onClick={() => setDate(shiftDate(date, -1))} className="rounded-full p-2 hover:bg-white"><ChevronLeft size={18}/></button><span className="min-w-28 text-center text-sm font-bold">{date}</span><button aria-label="后一天" onClick={() => setDate(shiftDate(date, 1))} className="rounded-full p-2 hover:bg-white"><ChevronRight size={18}/></button></div>
        </div>
      </div>
      {error && <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-[#f98c53]/40 bg-[#fff7f2] px-5 py-4 text-sm"><span>{error}</span><Link className="shrink-0 font-bold text-[#f98c53]" href="/">去登录</Link></div>}
      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {(Object.keys(modules) as HubType[]).map((type) => <HubCard key={type} type={type} item={items.find((item) => item.content_type === type)} actions={actions} loading={loading} onImport={() => setImporting(type)} onToggle={toggle} onOpen={setOpened}/>) }
      </div>
      <section className="mt-8 rounded-[2rem] border border-[#eadfd9] bg-[#fffdfb] p-6 md:p-8"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-bold text-[#f98c53]">内容来源</p><h2 className="mt-1 text-xl font-black">每日内容，不再混成一团</h2></div><RefreshCw size={20} className="text-[#697386]"/></div><p className="mt-3 max-w-3xl leading-7 text-[#697386]">简报、基金市场分析和训练计划是三条独立记录：你可以让不同的 ChatGPT 定时任务分别生成，再粘贴 JSON 导入。数据会保存到你的云端账户，换设备登录仍能看到。</p><button onClick={() => setImporting("growth_brief")} className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#eadfd9] px-4 py-2 text-sm font-bold hover:border-[#f98c53]"><Plus size={16}/>导入今日内容</button></section>
    </section>
    {importing && <ImportDialog type={importing} date={date} saving={saving} onClose={() => setImporting(null)} onSave={saveImport}/>} 
    {opened && <DetailDialog item={opened} actions={actions} date={date} saving={saving} onClose={() => setOpened(null)} onToggle={toggle} onCopyToToday={copyToToday}/>} 
  </main>;
}

function HubCard({ type, item, actions, loading, onImport, onToggle, onOpen }: { type: HubType; item?: HubItem; actions: ActionState[]; loading: boolean; onImport: () => void; onToggle: (itemId: string, actionKey: string, checked: boolean) => void; onOpen: (item: HubItem) => void }) {
  const hubModule = modules[type]; const Icon = hubModule.icon; const rows = item ? linesFrom(item) : [];
  return <article className="overflow-hidden rounded-[2rem] border border-[#eadfd9] bg-[#fffdfb] shadow-sm"><div className={`${hubModule.color} p-6`}><div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/65"><Icon size={21}/></span><span className="rounded-full bg-white/60 px-3 py-1 text-xs font-bold">独立通道</span></div><h2 className="mt-7 text-2xl font-black">{hubModule.label}</h2><p className="mt-1 min-h-10 text-sm leading-5 text-[#243247]/75">{item?.summary || hubModule.hint}</p></div><div className="min-h-55 p-6">{loading ? <p className="text-sm text-[#697386]">正在同步…</p> : !item ? <div className="flex h-38 flex-col justify-between"><p className="text-sm leading-6 text-[#697386]">今天还没有导入。每种内容只会覆盖自己的同类版本。</p><button onClick={onImport} className="inline-flex w-fit items-center gap-2 rounded-full bg-[#243247] px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/>导入{hubModule.label}</button></div> : <><p className="mb-4 text-lg font-black">{item.title}</p><div className="space-y-3">{rows.slice(0, 3).map((row) => { const checked = actions.some((state) => state.item_id === item.id && state.action_key === row.key && state.completed); return <label key={row.key} className="flex cursor-pointer gap-3 rounded-2xl bg-[#f9f2ef] p-3"><input checked={checked} onChange={(event) => onToggle(item.id, row.key, event.target.checked)} type="checkbox" className="mt-1 h-4 w-4 accent-[#f98c53]"/><span><b className={checked ? "line-through opacity-50" : ""}>{row.title}</b>{row.detail && <small className="mt-1 block leading-5 text-[#697386]">{row.detail}</small>}</span></label>; })}</div><button onClick={() => onOpen(item)} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-[#f98c53]">查看完整内容 <ChevronRight size={16}/></button></>}</div></article>;
}

function DetailDialog({ item, actions, date, saving, onClose, onToggle, onCopyToToday }: { item: HubItem; actions: ActionState[]; date: string; saving: boolean; onClose: () => void; onToggle: (itemId: string, actionKey: string, checked: boolean) => void; onCopyToToday: (item: HubItem) => void }) {
  const meta = modules[item.content_type]; const Icon = meta.icon; const rows = linesFrom(item);
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-[#243247]/45 p-4"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-[#fffdfb] shadow-2xl"><div className={`${meta.color} sticky top-0 z-10 flex items-start justify-between p-6`}><div><span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/65"><Icon size={20}/></span><p className="mt-4 text-sm font-bold text-[#243247]/70">{friendlyDate(item.content_date)} · {meta.label}</p><h2 className="mt-1 text-2xl font-black">{item.title}</h2>{item.summary && <p className="mt-2 max-w-xl text-sm leading-6 text-[#243247]/75">{item.summary}</p>}</div><button aria-label="关闭" onClick={onClose} className="rounded-full bg-white/55 p-2 hover:bg-white"><X size={20}/></button></div><div className="space-y-3 p-6">{rows.length ? rows.map((row, index) => { const checked = actions.some((state) => state.item_id === item.id && state.action_key === row.key && state.completed); return <div key={row.key} className="rounded-2xl border border-[#eadfd9] p-4"><label className="flex cursor-pointer gap-3"><input checked={checked} onChange={(event) => onToggle(item.id, row.key, event.target.checked)} type="checkbox" className="mt-1 h-4 w-4 accent-[#f98c53]"/><span><small className="font-bold text-[#f98c53]">{String(index + 1).padStart(2, "0")}</small><b className={`mt-1 block ${checked ? "line-through opacity-50" : ""}`}>{row.title}</b>{row.detail && <p className="mt-2 text-sm leading-6 text-[#697386]">{row.detail}</p>}</span></label>{row.url && <a href={row.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#28628F]">打开相关内容 <ChevronRight size={15}/></a>}</div>; }) : <p className="rounded-2xl bg-[#f9f2ef] p-5 text-sm leading-6 text-[#697386]">这份内容尚未包含行动项。下次导入时在 JSON 的 items 中加入 title 和 summary，即可在这里逐项完成。</p>}</div>{date !== today() && <div className="sticky bottom-0 border-t border-[#eadfd9] bg-[#fffdfb]/95 p-5 backdrop-blur"><button disabled={saving} onClick={() => onCopyToToday(item)} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#243247] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"><RefreshCw size={17}/>导入这份历史内容到今天</button></div>}</div></div>;
}

function ImportDialog({ type, date, saving, onClose, onSave }: { type: HubType; date: string; saving: boolean; onClose: () => void; onSave: (type: HubType, title: string, summary: string, payload: string) => void }) {
  const hubModule = modules[type]; const [title, setTitle] = useState(hubModule.label); const [summary, setSummary] = useState(""); const [payload, setPayload] = useState('{\n  "items": [\n    { "id": "1", "title": "", "summary": "" }\n  ]\n}');
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-[#243247]/45 p-4"><div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-[#fffdfb] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-[#f98c53]">导入到 {date}</p><h2 className="mt-1 text-2xl font-black">{hubModule.label}</h2></div><button aria-label="关闭" onClick={onClose} className="rounded-full p-2 hover:bg-[#f4ece8]"><X size={20}/></button></div><p className="mt-3 text-sm leading-6 text-[#697386]">粘贴该定时任务生成的 JSON。此导入只更新「{hubModule.label}」，不会覆盖另外两种内容。</p><label className="mt-5 block text-sm font-bold">标题<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 w-full rounded-xl border border-[#eadfd9] bg-white px-3 py-2.5 outline-none focus:border-[#f98c53]"/></label><label className="mt-4 block text-sm font-bold">一句摘要<input value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-2 w-full rounded-xl border border-[#eadfd9] bg-white px-3 py-2.5 outline-none focus:border-[#f98c53]"/></label><label className="mt-4 block text-sm font-bold">内容 JSON<textarea value={payload} onChange={(e) => setPayload(e.target.value)} spellCheck={false} className="mt-2 min-h-48 w-full rounded-xl border border-[#eadfd9] bg-[#f9f2ef] p-3 font-mono text-xs leading-6 outline-none focus:border-[#f98c53]"/></label><button disabled={saving} onClick={() => onSave(type, title, summary, payload)} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#f98c53] px-5 py-3 font-bold text-white disabled:opacity-60">{saving ? "保存中…" : <><Check size={18}/>保存到云端</>}</button></div></div>;
}
