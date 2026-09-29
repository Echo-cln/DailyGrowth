import { authenticate, dbRequest, jsonDate } from "@/lib/supabase-rest";

type HubType = "growth_brief" | "market_brief" | "workout_plan";
const validTypes = new Set<HubType>(["growth_brief", "market_brief", "workout_plan"]);
const badRequest = (error: string) => Response.json({ error }, { status: 400 });
const unauthorized = () => Response.json({ error: "请先登录", code: "UNAUTHORIZED" }, { status: 401 });

function dateFor(request: Request) {
  const value = new URL(request.url).searchParams.get("date") || jsonDate();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function currentUser(request: Request) {
  try {
    return await authenticate(request);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  const date = dateFor(request);
  if (!date) return badRequest("日期格式应为 YYYY-MM-DD");
  const items = await dbRequest<Record<string, unknown>[]>(
    `daily_hub_items?select=*&user_id=eq.${user.id}&content_date=eq.${date}&order=updated_at.desc`,
  );
  const ids = items.map((item) => String(item.id)).filter(Boolean);
  const actions = ids.length
    ? await dbRequest<Record<string, unknown>[]>(
        `daily_hub_action_states?select=*&user_id=eq.${user.id}&item_id=in.(${ids.join(",")})`,
      )
    : [];
  return Response.json({ date, items, actions });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest("请求内容必须是 JSON");
  }
  const action = String(body.action || "");
  if (action === "upsert-content") {
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
          user_id: user.id,
          content_date: contentDate,
          content_type: contentType,
          schema_version: 1,
          title,
          summary,
          payload,
          import_source: String(body.importSource || "manual_import"),
          updated_at: new Date().toISOString(),
        },
      },
    );
    return Response.json({ item: rows[0] });
  }
  if (action === "set-action-state") {
    const itemId = String(body.itemId || "");
    const actionKey = String(body.actionKey || "").trim();
    const completed = Boolean(body.completed);
    if (!/^[0-9a-f-]{36}$/i.test(itemId) || !actionKey || actionKey.length > 120)
      return badRequest("动作记录参数不正确");
    const owned = await dbRequest<Record<string, unknown>[]>(
      `daily_hub_items?select=id&user_id=eq.${user.id}&id=eq.${itemId}&limit=1`,
    );
    if (!owned.length) return Response.json({ error: "未找到可操作内容" }, { status: 404 });
    const rows = await dbRequest<Record<string, unknown>[]>(
      "daily_hub_action_states?on_conflict=user_id,item_id,action_key",
      {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: {
          user_id: user.id,
          item_id: itemId,
          action_key: actionKey,
          completed,
          completed_at: completed ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
      },
    );
    return Response.json({ state: rows[0] });
  }
  return badRequest("不支持的操作");
}
