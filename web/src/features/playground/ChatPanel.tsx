import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../../lib/hooks";
import { POLICIES } from "../../lib/constants";
import type { ModelInfo, Provider } from "../../lib/types";
import {
  Badge,
  Button,
  CopyButton,
  Field,
  Notice,
  StatusPill,
} from "../../components/ui";

interface ChatMeta {
  via?: string | null;
  policy?: string | null;
  attempts?: string | null;
  latencyMs?: number;
  tokens?: string;
  stopped?: boolean;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  meta?: ChatMeta;
}

export function ChatPanel() {
  const [params] = useSearchParams();
  const models = useApi<ModelInfo[]>("/v1/models");
  const providers = useApi<Provider[]>("/api/providers");
  const settings = useApi<{ defaultPolicy: string }>("/api/settings");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("auto:free");
  const [provider, setProvider] = useState("");
  const [policy, setPolicy] = useState("");
  const [stream, setStream] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("512");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);

  const searchKey = params.toString();
  useEffect(() => {
    const paramsModel = params.get("model");
    const paramsProvider = params.get("provider");
    const paramsPolicy = params.get("policy");
    if (paramsModel) setModel(paramsModel);
    if (paramsProvider) setProvider(paramsProvider);
    if (paramsPolicy) setPolicy(paramsPolicy);
  }, [searchKey, params]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy]);

  const buildPayload = (extraMessage?: string) => {
    const history = messages
      .filter((message) => message.content.trim() && !message.meta?.stopped)
      .map((message) => ({ role: message.role, content: message.content }));
    if (extraMessage?.trim()) {
      history.push({ role: "user", content: extraMessage.trim() });
    }
    const body: Record<string, unknown> = {
      model: model.trim() || "auto:free",
      messages: [
        ...(systemPrompt.trim()
          ? [{ role: "system", content: systemPrompt.trim() }]
          : []),
        ...history,
      ],
      stream,
    };
    if (maxTokens && Number(maxTokens) > 0) body.max_tokens = Number(maxTokens);
    if (temperature !== "" && Number.isFinite(Number(temperature))) {
      body.temperature = Number(temperature);
    }
    const routing: Record<string, string> = {};
    if (provider.trim()) routing.provider = provider.trim();
    if (policy) routing.policy = policy;
    if (Object.keys(routing).length) body.routing = routing;
    return body;
  };

  const patchMessage = (id: number, patch: Partial<ChatMessage>) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, ...patch } : message,
      ),
    );
  };

  const send = async () => {
    if (!input.trim() || busy) return;
    const text = input.trim();
    const userId = nextId.current++;
    const assistantId = nextId.current++;
    const body = buildPayload(text);
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", content: text },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setInput("");
    setError(null);
    setBusy(true);
    const started = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const metaFromHeaders: ChatMeta = {
        via: response.headers.get("x-router-via"),
        policy: response.headers.get("x-router-policy"),
        attempts: response.headers.get("x-router-attempts"),
      };

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      }

      if (!stream) {
        const payload = await response.json();
        const content =
          payload?.choices?.[0]?.message?.content ??
          JSON.stringify(payload, null, 2);
        const usage = payload?.usage;
        patchMessage(assistantId, {
          content,
          meta: {
            ...metaFromHeaders,
            latencyMs: Date.now() - started,
            tokens: usage
              ? `${usage.prompt_tokens ?? 0} in / ${usage.completion_tokens ?? 0} out`
              : undefined,
          },
        });
        return;
      }

      patchMessage(assistantId, {
        content: "",
        meta: { ...metaFromHeaders, latencyMs: Date.now() - started },
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let textOut = "";
      let finished = false;
      while (!finished) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const chunk = trimmed.slice(5).trim();
            if (chunk === "[DONE]") {
              finished = true;
              continue;
            }
            try {
              const parsed = JSON.parse(chunk);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) {
                textOut += delta;
                patchMessage(assistantId, { content: textOut });
              }
            } catch {
              /* partial frame */
            }
          }
        }
      }
      patchMessage(assistantId, {
        content: textOut,
        meta: { ...metaFromHeaders, latencyMs: Date.now() - started },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, meta: { ...message.meta, stopped: true } }
              : message,
          ),
        );
      } else {
        setMessages((current) =>
          current.filter((message) => message.id !== assistantId),
        );
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const clear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
  };

  const preview = JSON.stringify(buildPayload(input || "…"), null, 2);
  const curl = `curl -s ${location.origin}/v1/chat/completions \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(buildPayload(input || "…"))}'`;
  const transcript = messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");

  return (
    <div className="pg-layout">
      <aside className="pg-side">
        <div className="stack" style={{ gap: 12 }}>
          <Field
            label="Model"
            hint="Use provider::model to pin, or auto:free for the free pool."
          >
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              list="playground-models"
              placeholder="auto:free"
            />
            <datalist id="playground-models">
              {(models.data ?? []).map((item) => (
                <option key={item.id} value={item.id} />
              ))}
            </datalist>
          </Field>
          <div className="form-grid">
            <Field label="Provider pin">
              <input
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                list="playground-providers"
                placeholder="(none)"
              />
              <datalist id="playground-providers">
                {(providers.data ?? []).map((item) => (
                  <option key={item.id} value={item.id} />
                ))}
              </datalist>
            </Field>
            <Field label="Policy">
              <select
                value={policy}
                onChange={(event) => setPolicy(event.target.value)}
              >
                <option value="">
                  default ({settings.data?.defaultPolicy ?? "auto"})
                </option>
                {POLICIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={stream}
              onChange={(event) => setStream(event.target.checked)}
            />
            stream response (SSE)
          </label>
          <details>
            <summary className="copy-btn" style={{ cursor: "pointer" }}>
              options
            </summary>
            <div className="stack" style={{ gap: 10, marginTop: 10 }}>
              <Field label="System prompt">
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={3}
                  placeholder="You are a concise routing test assistant."
                />
              </Field>
              <div className="form-grid">
                <Field label="Temperature">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={temperature}
                    onChange={(event) => setTemperature(event.target.value)}
                    placeholder="default"
                  />
                </Field>
                <Field label="Max tokens">
                  <input
                    type="number"
                    min="1"
                    value={maxTokens}
                    onChange={(event) => setMaxTokens(event.target.value)}
                  />
                </Field>
              </div>
            </div>
          </details>
          <div className="row row--wrap">
            <CopyButton value={curl} label="Copy as curl" />
            <CopyButton value={transcript} label="Copy transcript" />
          </div>
          <details>
            <summary className="copy-btn" style={{ cursor: "pointer" }}>
              request preview
            </summary>
            <pre className="code-block" style={{ marginTop: 8 }}>
              {preview}
            </pre>
          </details>
          <p className="muted small">
            Sends through the real router. Route metadata comes from X-Router-*
            response headers.
          </p>
        </div>
      </aside>

      <section className="pg-main">
        <div className="pg-main__head">
          <span className="pg-main__title">Conversation</span>
          <div className="row" style={{ gap: 6 }}>
            <Badge>{messages.length} messages</Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={clear}
              disabled={!messages.length && !busy}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="chat-log" ref={logRef}>
          {!messages.length && (
            <div className="chat-empty">
              Send a message to see the router choose a provider, apply policy,
              and fall back when needed.
            </div>
          )}
          {messages.map((message) => (
            <div
              className={`chat-msg${message.role === "user" ? " chat-msg--user" : ""}`}
              key={message.id}
            >
              <span className="chat-msg__role">{message.role}</span>
              {message.content ||
                (busy && message.role === "assistant" ? (
                  <span className="muted">thinking…</span>
                ) : null)}
              {message.meta && (message.meta.via || message.meta.latencyMs) && (
                <div className="chat-msg__meta">
                  {message.meta.via && (
                    <Badge tone="accent">via {message.meta.via}</Badge>
                  )}
                  {message.meta.policy && <Badge>{message.meta.policy}</Badge>}
                  {message.meta.attempts && (
                    <Badge>{message.meta.attempts} attempts</Badge>
                  )}
                  {message.meta.latencyMs !== undefined && (
                    <Badge>{message.meta.latencyMs}ms</Badge>
                  )}
                  {message.meta.tokens && <Badge>{message.meta.tokens}</Badge>}
                  {message.meta.stopped && (
                    <StatusPill tone="warn">stopped</StatusPill>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {error && (
          <div style={{ padding: "0 14px 10px" }}>
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <div className="chat-composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask something… (Enter sends, Shift+Enter adds a line)"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div
            className="chat-composer__row"
            style={{ justifyContent: "space-between" }}
          >
            <span className="muted small">
              {stream ? "streaming" : "non-streaming"} · {model || "auto:free"}
            </span>
            {busy ? (
              <Button variant="danger" icon="stop" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="send"
                onClick={() => void send()}
                disabled={!input.trim()}
              >
                Send
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
