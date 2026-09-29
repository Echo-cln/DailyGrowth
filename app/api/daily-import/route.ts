import { dbRequest, jsonDate } from "@/lib/supabase-rest";

type HubType = "growth_brief" | "market_brief" | "workout_plan";
const validTypes = new Set<HubType>(["growth_brief", "market_brief", "workout_plan"]);
const badRequest = (error: string) => Response.json({ error }, { status: 400 });

function importConfig() {
  const importKey = process.env.DAILYGLOW_IMPORT_KEY || "";
  const userId = process.env.DAILYGLOW_IMPORT_USER_ID || "";
  if (!importKey || !userId) throw new Error("服务器尚未配置自动导入环境变量");
  return { importKey, userId };
}

export async function POST(request: Request) {
  let config: { importKey: string; userId: string };
  try {
    config = importConfig();
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "自动导入未配置" }, { status: 503 });
  }
  if (request.headers.get("x-dailyglow-import-key") !== config.importKey)
    return Response.json({ error: "导入密钥无效" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest("请求内容必须是 JSON");
  }
  const contentType = String(body.contentType || "") as HubType;
  const contentDate = String(body.contentDate || jsonDate());
  const title = String(body.title || "").trim();
  const summary = String(body.summary || "").trim();
  const payload = body.payload;
  if (!validTypes.has(contentType)) return badRequest("不支持的内容类型");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contentDate)) return badRequest("日期格式应为 YYYY-MM-DD");
  if (!title || title.length > 120) return badRequest("标题不能为空，且最多 120 个字符");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return badRequest("payload 必须是 JSON 对象");
  if (JSON.stringify(payload).length > 100_000) return badRequest("导入内容过大");

  const rows = await dbRequest<Record<string, unknown>[]>(
    "daily_hub_items?on_conflict=user_id,content_date,content_type",
    {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: {
        user_id: config.userId,
        content_date: contentDate,
        content_type: contentType,
        schema_version: 1,
        title,
        summary,
        payload,
        import_source: "scheduled_cloud",
        updated_at: new Date().toISOString(),
      },
    },
  );
  return Response.json({ ok: true, item: rows[0] });
}
