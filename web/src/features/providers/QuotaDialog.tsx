import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  QUOTA_METRICS,
  QUOTA_SOURCES,
  WINDOW_KINDS,
} from "../../lib/constants";
import { useAction } from "../../lib/hooks";
import type { QuotaWindow } from "../../lib/types";
import { Dialog, Field } from "../../components/ui";

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function QuotaDialog({
  open,
  onClose,
  onDone,
  credentialId,
  quota,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  credentialId: string;
  quota?: QuotaWindow;
}) {
  const { run, busy } = useAction();
  const [metric, setMetric] = useState<QuotaWindow["metric"]>("requests");
  const [limitValue, setLimitValue] = useState("1000");
  const [usedValue, setUsedValue] = useState("0");
  const [windowKind, setWindowKind] =
    useState<QuotaWindow["windowKind"]>("calendar_day");
  const [resetAt, setResetAt] = useState("");
  const [hard, setHard] = useState(true);
  const [source, setSource] = useState<QuotaWindow["source"]>("configured");

  useEffect(() => {
    if (!open) return;
    setMetric(quota?.metric ?? "requests");
    setLimitValue(String(quota?.limitValue ?? 1000));
    setUsedValue(String(quota?.usedValue ?? 0));
    setWindowKind(quota?.windowKind ?? "calendar_day");
    setResetAt(toLocalInput(quota?.resetAt));
    setHard(quota?.hard ?? true);
    setSource(quota?.source ?? "configured");
  }, [open, quota]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const resetIso = resetAt ? new Date(resetAt).toISOString() : null;
    const result = await run(
      () =>
        api.post<QuotaWindow>("/api/quotas", {
          id: quota?.id,
          credentialId,
          metric,
          limitValue: Number(limitValue),
          usedValue: Number(usedValue),
          windowKind,
          resetAt: resetIso,
          hard,
          source,
        }),
      {
        success: quota ? "Quota window updated" : "Quota window added",
        onDone: () => onDone(),
      },
    );
    if (result) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={quota ? "Edit quota window" : "Add quota window"}
      description={`Credential ${credentialId}`}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="quota-form"
            className="btn btn--primary"
            disabled={busy || !limitValue}
          >
            {busy ? "Saving…" : quota ? "Save window" : "Add window"}
          </button>
        </>
      }
    >
      <form id="quota-form" className="form-grid" onSubmit={submit}>
        <Field label="Metric">
          <select
            value={metric}
            onChange={(event) =>
              setMetric(event.target.value as QuotaWindow["metric"])
            }
          >
            {QUOTA_METRICS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Window">
          <select
            value={windowKind}
            onChange={(event) =>
              setWindowKind(event.target.value as QuotaWindow["windowKind"])
            }
          >
            {WINDOW_KINDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Limit">
          <input
            type="number"
            min={0}
            value={limitValue}
            onChange={(event) => setLimitValue(event.target.value)}
            required
          />
        </Field>
        <Field label="Used">
          <input
            type="number"
            min={0}
            value={usedValue}
            onChange={(event) => setUsedValue(event.target.value)}
          />
        </Field>
        <Field
          label="Reset at"
          hint="Leave empty for a fixed/rolling window with no reset time."
        >
          <input
            type="datetime-local"
            value={resetAt}
            onChange={(event) => setResetAt(event.target.value)}
          />
        </Field>
        <Field label="Source">
          <select
            value={source}
            onChange={(event) =>
              setSource(event.target.value as QuotaWindow["source"])
            }
          >
            {QUOTA_SOURCES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Enforcement">
          <select
            value={hard ? "true" : "false"}
            onChange={(event) => setHard(event.target.value === "true")}
          >
            <option value="true">hard — blocks routing</option>
            <option value="false">soft — advisory</option>
          </select>
        </Field>
      </form>
    </Dialog>
  );
}
