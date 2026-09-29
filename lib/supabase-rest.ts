type Json = Record<string, unknown> | Record<string, unknown>[];

function required(name: string, fallback?: string) {
  const value = process.env[name] || (fallback ? process.env[fallback] : "");
  if (!value) throw new Error(`服务器缺少环境变量 ${name}`);
  return value;
}

export function supabaseUrl() {
  return required("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL").replace(/\/$/, "");
}

export function publishableKey() {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}

export function secretKey() {
  return required("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
}

async function parseResponse(response: Response) {
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message: unknown }).message)
        : typeof payload === "string"
          ? payload
          : `Supabase 请求失败（${response.status}）`;
    throw new Error(message);
  }
  return payload;
}

export async function dbRequest<T = Record<string, unknown>[]>(
  path: string,
  options: {
    method?: string;
    body?: Json;
    prefer?: string;
    range?: string;
  } = {},
): Promise<T> {
  const key = secretKey();
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;
  if (options.range) headers.Range = options.range;
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  return (await parseResponse(response)) as T;
}

export type AuthUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

export async function authenticate(request: Request): Promise<AuthUser> {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: publishableKey(),
      Authorization: authorization,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("UNAUTHORIZED");
  return (await response.json()) as AuthUser;
}

export async function authRequest<T>(
  path: string,
  body: Record<string, unknown>,
  admin = false,
): Promise<T> {
  const key = admin ? secretKey() : publishableKey();
  const response = await fetch(`${supabaseUrl()}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return (await parseResponse(response)) as T;
}

export function jsonDate(timeZone = "Asia/Shanghai", date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
