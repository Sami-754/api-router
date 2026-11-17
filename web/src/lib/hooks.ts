import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import { useRefresh } from "./refresh";
import { useToast } from "../components/ToastProvider";

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useApi<T>(
  path: string | null,
  options: { pollMs?: number; enabled?: boolean } = {},
): ApiState<T> {
  const { nonce } = useRefresh();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [localNonce, setLocalNonce] = useState(0);
  const enabled = options.enabled !== false;
  const previousPath = useRef(path);

  const reload = useCallback(() => setLocalNonce((n) => n + 1), []);

  useEffect(() => {
    if (previousPath.current !== path) {
      previousPath.current = path;
      setData(undefined);
      setError(null);
    }
    if (!path || !enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let alive = true;

    const load = async (initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const result = await api.get<T>(path, controller.signal);
        if (!alive) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!alive || controller.signal.aborted) return;
        setError(errorMessage(err));
      } finally {
        if (alive) setLoading(false);
      }
    };

    void load(true);
    let timer: number | undefined;
    if (options.pollMs) {
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") void load(false);
      }, options.pollMs);
    }
    return () => {
      alive = false;
      controller.abort();
      if (timer) window.clearInterval(timer);
    };
  }, [path, enabled, options.pollMs, nonce, localNonce]);

  return { data, error, loading, reload };
}

export function useAction() {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T>(
      fn: () => Promise<T>,
      options: { success?: string; onDone?: (value: T) => void } = {},
    ): Promise<T | undefined> => {
      setBusy(true);
      try {
        const value = await fn();
        if (options.success) notify(options.success, "ok");
        options.onDone?.(value);
        return value;
      } catch (err) {
        notify(errorMessage(err), "error");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  return { run, busy };
}

export function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* localStorage can be unavailable */
      }
    },
    [key],
  );

  return [value, update] as const;
}
