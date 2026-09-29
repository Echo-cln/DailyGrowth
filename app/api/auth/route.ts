import {
  authenticate,
  authRequest,
  dbRequest,
  publishableKey,
  supabaseUrl,
} from "@/lib/supabase-rest";

type Session = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string; phone?: string };
};
type Row = Record<string, unknown>;
type ContactMethod = "email" | "phone";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function normalizePhone(value: string) {
  const compact = value.replace(/[\s()-]/g, "");
  if (/^1\d{10}$/.test(compact)) return `+86${compact}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : "";
}
function validateNewPassword(password: string, confirmPassword: string) {
  if (password.length < 8) throw new Error("新密码至少需要 8 位");
  if (password !== confirmPassword) throw new Error("两次输入的新密码不一致");
}
function usernameFrom(identity: string) {
  const base = identity.split("@")[0].replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 32);
  return base.length >= 3 ? base : `user_${Date.now()}`;
}
async function provisionLearner(user: Session["user"], displayName: string) {
  const profile = await dbRequest<Row[]>(
    `profiles?select=id,status&id=eq.${user.id}&limit=1`,
  );
  if (profile.length) {
    if (profile[0].status !== "active") throw new Error("该账户当前不可用");
    return;
  }
  const identity = user.email || user.phone || user.id;
  await dbRequest("profiles", {
    method: "POST",
    body: {
      id: user.id,
      username: usernameFrom(identity),
      display_name: displayName || usernameFrom(identity),
      email: user.email || null,
      role: "learner",
      status: "active",
    },
    prefer: "return=minimal",
  });
}
async function updateAuthenticatedUser(token: string, body: Row) {
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publishableKey(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  const payload: Row = text
    ? (() => {
        try { return JSON.parse(text) as Row; } catch { return { message: text }; }
      })()
    : {};
  if (!response.ok) throw new Error(String(payload.message || payload.msg || "密码更新失败"));
  return payload;
}
async function requireAdmin(request: Request) {
  const user = await authenticate(request);
  const profiles = await dbRequest<Row[]>(
    `profiles?select=id,role,status&id=eq.${user.id}&limit=1`,
  );
  if (!profiles.length || profiles[0].role !== "admin" || profiles[0].status !== "active")
    throw new Error("仅管理员可以创建账户");
  return user;
}
async function signOutCurrentSession(token: string) {
  const response = await fetch(`${supabaseUrl()}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: publishableKey(), Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("退出登录失败");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      email?: string;
      phone?: string;
      contactMethod?: ContactMethod;
      password?: string;
      confirmPassword?: string;
      currentPassword?: string;
      refreshToken?: string;
      displayName?: string;
      code?: string;
    };
    const action = String(body.action || "");
    const email = String(body.email || "").trim().toLowerCase();
    const phone = normalizePhone(String(body.phone || ""));
    const password = String(body.password || "");
    const confirmPassword = String(body.confirmPassword || "");
    const contactMethod: ContactMethod = body.contactMethod === "phone" ? "phone" : "email";
    const identity = contactMethod === "phone" ? phone : email;
    const displayName = String(body.displayName || "").trim().slice(0, 50) || "学习者";

    if (action === "refresh") {
      if (!body.refreshToken) throw new Error("缺少 refreshToken");
      return Response.json(await authRequest<Session>("token?grant_type=refresh_token", { refresh_token: body.refreshToken }));
    }
    if (action === "request-registration-code") {
      if (contactMethod === "email" ? !validEmail(email) : !phone)
        throw new Error(contactMethod === "email" ? "请输入有效邮箱" : "请输入有效手机号（中国大陆号码可直接输入 11 位）");
      validateNewPassword(password, confirmPassword);
      await authRequest("signup", contactMethod === "email"
        ? { email, password, data: { display_name: displayName } }
        : { phone, password, data: { display_name: displayName }, channel: "sms" },
      );
      return Response.json({ ok: true, message: "验证码已发送。" });
    }
    if (action === "complete-registration") {
      if (contactMethod === "email" ? !validEmail(email) : !phone)
        throw new Error("注册信息不完整");
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) throw new Error("请输入收到的 6 位验证码");
      const session = await authRequest<Session>("verify", contactMethod === "email"
        ? { email, token: code, type: "signup" }
        : { phone, token: code, type: "sms" },
      );
      if (!session.access_token || !session.refresh_token || !session.user?.id)
        throw new Error("验证成功但未取得登录会话，请重新登录");
      await provisionLearner(session.user, displayName);
      return Response.json(session, { status: 201 });
    }
    if (action === "request-password-reset") {
      if (!validEmail(email)) throw new Error("请输入有效邮箱");
      // A generic response prevents account enumeration.
      try { await authRequest("recover", { email }); } catch { /* hidden */ }
      return Response.json({ ok: true, message: "如该邮箱已开通账户，验证码已发送。" });
    }
    if (action === "reset-password") {
      if (!validEmail(email)) throw new Error("请输入有效邮箱");
      validateNewPassword(password, confirmPassword);
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) throw new Error("请输入邮件中的 6 位验证码");
      const session = await authRequest<Session>("verify", { email, token: code, type: "recovery" });
      await updateAuthenticatedUser(session.access_token, { password });
      return Response.json({ ok: true, message: "密码已重置，请使用新密码登录。" });
    }
    if (action === "change-password") {
      const user = await authenticate(request);
      validateNewPassword(password, confirmPassword);
      const currentPassword = String(body.currentPassword || "");
      if (!currentPassword || !user.email) throw new Error("请输入当前密码，且当前账户需绑定邮箱");
      await authRequest<Session>("token?grant_type=password", { email: user.email, password: currentPassword });
      await updateAuthenticatedUser(request.headers.get("authorization")!.slice(7), { password, current_password: currentPassword });
      return Response.json({ ok: true, message: "密码已修改。" });
    }
    if (action === "update-display-name") {
      const user = await authenticate(request);
      if (!displayName) throw new Error("账户名称不能为空");
      const token = request.headers.get("authorization")!.slice(7);
      await updateAuthenticatedUser(token, { data: { display_name: displayName } });
      await dbRequest(`profiles?id=eq.${user.id}`, { method: "PATCH", body: { display_name: displayName }, prefer: "return=minimal" });
      return Response.json({ ok: true, message: "账户名称已修改。" });
    }
    if (action === "logout") {
      await authenticate(request);
      await signOutCurrentSession(request.headers.get("authorization")!.slice(7));
      return Response.json({ ok: true, message: "已安全退出。" });
    }
    if (action === "admin-create-user") {
      await requireAdmin(request);
      if (!validEmail(email)) throw new Error("请输入有效邮箱");
      validateNewPassword(password, confirmPassword);
      const profileExists = await dbRequest<Row[]>(`profiles?select=id&email=eq.${encodeURIComponent(email)}&limit=1`);
      if (profileExists.length) throw new Error("该邮箱已经开通账户");
      const created = await authRequest<{ id?: string; user?: { id?: string } }>("admin/users", {
        email, password, email_confirm: true,
        user_metadata: { display_name: displayName },
        app_metadata: { role: "learner" },
      }, true);
      const userId = String(created.user?.id || created.id || "");
      if (!userId) throw new Error("账户创建后未返回用户 ID");
      await dbRequest("profiles", {
        method: "POST",
        body: { id: userId, username: usernameFrom(email), display_name: displayName, email, role: "learner", status: "active" },
        prefer: "return=minimal",
      });
      return Response.json({ ok: true, message: "账户已创建并开通。" }, { status: 201 });
    }

    if (action !== "login") return Response.json({ error: "未知登录操作" }, { status: 400 });
    if (contactMethod === "email" ? !validEmail(email) : !phone)
      return Response.json({ error: contactMethod === "email" ? "请输入有效邮箱" : "请输入有效手机号" }, { status: 400 });
    if (password.length < 8) return Response.json({ error: "密码至少 8 位" }, { status: 400 });
    return Response.json(await authRequest<Session>("token?grant_type=password", contactMethod === "email" ? { email, password } : { phone, password }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 400 });
  }
}
