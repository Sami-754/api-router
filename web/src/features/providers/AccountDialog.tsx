import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { useAction } from "../../lib/hooks";
import type { Account } from "../../lib/types";
import { Dialog, Field } from "../../components/ui";

export function AccountDialog({
  open,
  onClose,
  onDone,
  providerId,
  account,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  providerId: string;
  account?: Account;
}) {
  const { run, busy } = useAction();
  const [id, setId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    setId(account?.id ?? `${providerId}-main`);
    setDisplayName(account?.displayName ?? "");
    setEnabled(account?.enabled ?? true);
  }, [open, account, providerId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(
      () =>
        api.post<Account>("/api/accounts", {
          id: id.trim(),
          providerId,
          displayName: displayName.trim() || null,
          enabled,
        }),
      {
        success: account ? "Account updated" : "Account added",
        onDone: () => onDone(),
      },
    );
    if (result) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={account ? "Edit account" : "Add account"}
      description="Accounts group keys under a provider. One provider can have many accounts."
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="account-form"
            className="btn btn--primary"
            disabled={busy || !id.trim()}
          >
            {busy ? "Saving…" : account ? "Save account" : "Add account"}
          </button>
        </>
      }
    >
      <form id="account-form" className="form-grid" onSubmit={submit}>
        <Field
          label="Account id"
          className="field--full"
          hint="Permanent identifier; accounts cannot move between providers."
        >
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            disabled={Boolean(account)}
            required
            autoFocus
          />
        </Field>
        <Field label="Display name">
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="main"
          />
        </Field>
        <Field label="State">
          <select
            value={enabled ? "true" : "false"}
            onChange={(event) => setEnabled(event.target.value === "true")}
          >
            <option value="true">enabled</option>
            <option value="false">disabled</option>
          </select>
        </Field>
      </form>
    </Dialog>
  );
}
