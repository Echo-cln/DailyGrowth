import { authenticate } from "@/lib/supabase-rest";

type Row = Record<string, unknown>;

function collectExamples(value: unknown, output: string[]) {
  if (Array.isArray(value)) value.forEach((item) => collectExamples(item, output));
  else if (value && typeof value === "object") {
    const row = value as Row;
    if (Array.isArray(row.examples)) {
      for (const example of row.examples) {
        if (example && typeof example === "object" && typeof (example as Row).text === "string") output.push(String((example as Row).text));
      }
    }
    Object.values(row).forEach((item) => collectExamples(item, output));
  }
}

export async function GET(request: Request) {
  try {
    await authenticate(request);
    const word = String(new URL(request.url).searchParams.get("word") || "").trim().toLowerCase();
    if (!/^[a-z][a-z'-]{0,80}$/.test(word)) return Response.json({ error: "单词格式不正确" }, { status: 400 });
    const appId = process.env.OXFORD_APP_ID;
    const appKey = process.env.OXFORD_APP_KEY;
    if (!appId || !appKey) return Response.json({ error: "Oxford 词典服务尚未配置" }, { status: 424 });

    const apiBase = (process.env.OXFORD_API_BASE_URL || "https://od-api.oxforddictionaries.com/api/v2").replace(/\/+$/, "");
    const response = await fetch(`${apiBase}/words/en-gb?q=${encodeURIComponent(word)}&fields=examples`, {
      headers: { app_id: appId, app_key: appKey, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return Response.json({ error: "Oxford 暂未返回该词例句" }, { status: 502 });
    const payload = await response.json();
    const candidates: string[] = [];
    collectExamples(payload, candidates);
    const sentence = candidates.find((item) => item.length >= 12 && item.length <= 260);
    if (!sentence) return Response.json({ error: "Oxford 暂无可展示例句" }, { status: 404 });
    return Response.json({ sentence, source: "Oxford Dictionaries API · 本次实时查询，不写入云端" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "获取词典例句失败" }, { status: 500 });
  }
}
