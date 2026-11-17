export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ErrorEnvelope {
  error?: { message?: string };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    signal,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && !retried) {
    const waitMs = Math.min(
      15000,
      (Number(res.headers.get("retry-after")) || 5) * 1000,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return request<T>(method, path, body, signal, true);
  }
  const payload = (await res.json().catch(() => null)) as
    (ErrorEnvelope & { data?: T }) | null;
  if (!res.ok) {
    throw new ApiError(
      payload?.error?.message || `HTTP ${res.status}`,
      res.status,
    );
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data as T;
  }
  return payload as T;
}

export const api = {
  get<T>(path: string, signal?: AbortSignal) {
    return request<T>("GET", path, undefined, signal);
  },
  post<T>(path: string, body?: unknown) {
    return request<T>("POST", path, body);
  },
  patch<T>(path: string, body?: unknown) {
    return request<T>("PATCH", path, body);
  },
  del<T>(path: string) {
    return request<T>("DELETE", path);
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
