import { authenticate, dbRequest } from "@/lib/supabase-rest";

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
    const response = await fetch(`https://od-api.oxforddictionaries.com/api/v2/words/en-gb?q=${encodeURIComponent(word)}&fields=examples`, {
      headers: { app_id: appId, app_key: appKey, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return Response.json({ error: "Oxford 暂未返回该词例句" }, { status: 502 });
    const payload = await response.json();
    const candidates: string[] = [];
    collectExamples(payload, candidates);
    const sentence = candidates.find((item) => item.length >= 12 && item.length <= 260);
    if (!sentence) return Response.json({ error: "Oxford 暂无可展示例句" }, { status: 404 });
    const words = await dbRequest<Row[]>(`vocabulary_words?select=id&normalized_lemma=eq.${encodeURIComponent(word)}&limit=1`);
    if (words[0]?.id) {
      const senses = await dbRequest<Row[]>(`vocabulary_senses?select=id&word_id=eq.${words[0].id}&order=sense_no&limit=1`);
      if (senses[0]?.id) {
        const exists = await dbRequest<Row[]>(`vocabulary_examples?select=id&sense_id=eq.${senses[0].id}&source_label=eq.${encodeURIComponent("Oxford Dictionaries API")}&limit=1`);
        if (!exists.length) await dbRequest("vocabulary_examples", { method: "POST", body: { sense_id: senses[0].id, sentence, translation: "", source_type: "dictionary", source_label: "Oxford Dictionaries API", verified: true, rank: 2 }, prefer: "return=minimal" });
      }
    }
    return Response.json({ sentence, source: "Oxford Dictionaries API" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "获取词典例句失败" }, { status: 500 });
  }
}
