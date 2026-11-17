import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { useAction } from "../../lib/hooks";
import type { Account, Credential } from "../../lib/types";
import { Dialog, Field, Notice } from "../../components/ui";

export function AddKeyDialog({
  open,
  onClose,
  onDone,
  accounts,
  accountId,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  accounts: Account[];
  accountId?: string;
}) {
  const { run, busy } = useAction();
  const [selectedAccount, setSelectedAccount] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedAccount(accountId ?? accounts[0]?.id ?? "");
    setLabel("");
    setSecret("");
  }, [open, accountId, accounts]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(
      () =>
        api.post<Credential>("/api/credentials", {
          accountId: selectedAccount,
          label: label.trim() || null,
          secret,
        }),
      { success: "Key stored", onDone: () => onDone() },
    );
    if (result) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add key"
      description="Secrets are encrypted at rest and never returned by the API."
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="add-key-form"
            className="btn btn--primary"
            disabled={busy || !selectedAccount || !secret}
          >
            {busy ? "Storing…" : "Store key"}
          </button>
        </>
      }
    >
      {!accounts.length && (
        <Notice tone="warn">Add an account before storing a key.</Notice>
      )}
      <form id="add-key-form" className="form-grid" onSubmit={submit}>
        <Field label="Account" className="field--full">
          <select
            value={selectedAccount}
            onChange={(event) => setSelectedAccount(event.target.value)}
            required
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.id}{" "}
                {account.displayName ? `— ${account.displayName}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label" hint="Human-friendly note, e.g. main or backup.">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="main"
          />
        </Field>
        <Field label="Secret">
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="off"
            placeholder="sk-…"
            required
          />
        </Field>
      </form>
    </Dialog>
  );
}
