import { authenticate } from "@/lib/supabase-rest";

export async function POST(request: Request) {
  try {
    await authenticate(request);
  } catch {
    return Response.json({ error: "请先登录" }, { status: 401 });
  }
  return Response.json({
    error: "自动写入词典资料已暂停。当前请通过 Oxford Learner’s Dictionaries 或 Cambridge 官方页面查询；取得允许云端保存的许可后再启用自动补全。",
  }, { status: 409 });
}
