import { authenticate } from "@/lib/supabase-rest";

export async function POST(request: Request) {
  try {
    await authenticate(request);
  } catch {
    return Response.json({ error: "请先登录" }, { status: 401 });
  }
  return Response.json({
    error: "自动补全尚未启用：需要 Oxford/Cambridge 授权明确允许将词典内容保存到云端，并配置服务端 API 凭据。取得授权前不会写入词库。",
  }, { status: 409 });
}
