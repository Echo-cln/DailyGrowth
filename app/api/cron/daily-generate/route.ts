import { dbRequest, jsonDate } from "@/lib/supabase-rest";

type HubType = "growth_brief" | "market_brief" | "workout_plan";
type GeneratedLine = { id: string; title: string; summary: string; url?: string };
type GeneratedContent = { title: string; summary: string; items: GeneratedLine[] };

const dailyTypes: HubType[] = ["growth_brief", "workout_plan"];
const validTypes = new Set<HubType>([...dailyTypes, "market_brief"]);

function config() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const userId = process.env.DAILYGLOW_IMPORT_USER_ID || "";
  if (!apiKey || !userId) throw new Error("自动生成尚未完成服务器配置");
  return { apiKey, userId, model: process.env.DAILYGLOW_OPENAI_MODEL || "gpt-6-astra" };
}

function typeFrom(request: Request): HubType | "all" {
  const value = new URL(request.url).searchParams.get("type") || "all";
  return value === "all" || validTypes.has(value as HubType) ? (value as HubType | "all") : "all";
}

function promptFor(type: HubType, date: string) {
  const common = `今天是 ${date}（中国标准时间）。你是 DailyGlow 的私有每日内容编辑。请只返回一个 JSON 对象，不要 Markdown、解释或代码围栏。JSON 必须符合：{\"title\":\"不超过30字\",\"summary\":\"不超过70字\",\"items\":[{\"id\":\"英文短横线标识\",\"title\":\"不超过36字\",\"summary\":\"不超过120字\",\"url\":\"可选 https 链接\"}]}。items 数量 3 到 5，所有建议都要具体、可勾选，不要编造事实或链接。`;
  if (type === "growth_brief") return `${common}\n使用联网检索，生成「每日简报」：优先选与中国生活、科技、教育、职业成长有关且今天仍值得关注的信息。每条涉及外部事实的项目必须给出来源 url；最后至少给一个不依赖外部链接、今天可以完成的行动。`;
  if (type === "market_brief") return `${common}\n使用联网检索，生成「基金市场观察」：用中性、教育性的语言概述今日重要市场变化、风险点和需要观察的数据。不得给出买卖指令、收益承诺或个性化投资建议；涉及外部事实的项目必须附来源 url。`;
  return `${common}\n生成「今日训练」：用户在家使用瑜伽垫，目标是塑形、减脂、腹肌与手臂线条；需保护膝盖、避免高冲击。固定休息日为周三和周六：这两天只生成散步、拉伸或恢复计划。其他日生成 25–35 分钟、3–5 个动作的低冲击计划，并在每项 summary 写清次数/组数或时长及安全提示。无需检索，也不要提供外部链接。`;
}

function cleanLine(value: unknown, index: number): GeneratedLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const title = String(input.title || "").trim().slice(0, 80);
  if (!title) return null;
  const rawUrl = String(input.url || "").trim();
  return {
    id: String(input.id || `item-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || `item-${index + 1}`,
    title,
    summary: String(input.summary || "").trim().slice(0, 300),
    ...( /^https?:\/\//i.test(rawUrl) ? { url: rawUrl.slice(0, 1_500) } : {}),
  };
}

function parseGenerated(text: string): GeneratedContent {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const data = JSON.parse(trimmed) as Record<string, unknown>;
  const items = (Array.isArray(data.items) ? data.items : []).map(cleanLine).filter((line): line is GeneratedLine => Boolean(line)).slice(0, 5);
  if (items.length < 3) throw new Error("生成内容不完整");
  const title = String(data.title || "DailyGlow 每日内容").trim().slice(0, 120);
  return { title, summary: String(data.summary || "").trim().slice(0, 300), items };
}

async function generate(type: HubType, date: string, apiKey: string, model: string) {
  const body: Record<string, unknown> = { model, input: promptFor(type, date) };
  if (type !== "workout_plan") body.tools = [{ type: "web_search" }];
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = (await response.json()) as { output_text?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || "内容生成服务暂时不可用");
  if (!result.output_text) throw new Error("内容生成服务没有返回文本");
  return parseGenerated(result.output_text);
}

async function alreadyExists(userId: string, date: string, type: HubType) {
  const rows = await dbRequest<Record<string, unknown>[]>(`daily_hub_items?select=id&user_id=eq.${userId}&content_date=eq.${date}&content_type=eq.${type}&limit=1`);
  return rows.length > 0;
}

async function save(userId: string, date: string, type: HubType, content: GeneratedContent) {
  await dbRequest("daily_hub_items?on_conflict=user_id,content_date,content_type", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: userId, content_date: date, content_type: type, schema_version: 1, title: content.title, summary: content.summary, payload: { items: content.items }, import_source: "cloud_auto_openai", updated_at: new Date().toISOString() },
  });
}

/**
 * EdgeOne scheduler entry. This route deliberately only generates today's
 * missing cards once. It cannot be used to rewrite historic data or to fan out
 * unlimited OpenAI calls, even if its public URL is discovered.
 */
export async function POST(request: Request) {
  let settings: ReturnType<typeof config>;
  try { settings = config(); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "自动生成未配置" }, { status: 503 }); }
  const date = jsonDate();
  const selected = typeFrom(request);
  const types = selected === "all" ? dailyTypes : [selected];
  const generated: HubType[] = [];
  const skipped: HubType[] = [];
  try {
    for (const type of types) {
      if (await alreadyExists(settings.userId, date, type)) { skipped.push(type); continue; }
      const content = await generate(type, date, settings.apiKey, settings.model);
      await save(settings.userId, date, type, content);
      generated.push(type);
    }
    return Response.json({ ok: true, date, generated, skipped });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "自动生成失败", date, generated, skipped }, { status: 502 });
  }
}
