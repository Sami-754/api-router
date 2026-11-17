import { Link } from "react-router-dom";
import {
  fmtAgo,
  fmtLatency,
  fmtNum,
  fmtTime,
  shortModel,
} from "../../lib/format";
import type { RequestGroup } from "../../lib/group";
import {
  Badge,
  Dialog,
  KeyValue,
  StatusPill,
  statusTone,
} from "../../components/ui";

export function RequestDrawer({
  group,
  onClose,
}: {
  group: RequestGroup | null;
  onClose: () => void;
}) {
  const last = group?.last;
  const playgroundLink = last
    ? `/playground?model=${encodeURIComponent(shortModel(last.requestedResourceId))}${
        last.selectedProviderId
          ? `&provider=${encodeURIComponent(last.selectedProviderId)}`
          : ""
      }&policy=${encodeURIComponent(last.policy)}`
    : "/playground";

  return (
    <Dialog
      open={Boolean(group)}
      onClose={onClose}
      title="Request"
      description={group?.id}
      variant="drawer"
      size="lg"
      footer={
        <>
          <Link
            className="btn btn--ghost"
            to={playgroundLink}
            onClick={onClose}
          >
            Open in Playground
          </Link>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onClose}
          >
            Close
          </button>
        </>
      }
    >
      {group && last ? (
        <>
          <div className="selected-route">
            <div className="row row--between">
              <span className="selected-route__name">
                {last.selectedProviderId
                  ? `${last.selectedProviderId}/${last.selectedUpstreamId ?? ""}`
                  : "no route selected"}
              </span>
              <StatusPill
                tone={statusTone(group.success ? "success" : "error")}
              >
                {group.success ? "success" : "error"}
              </StatusPill>
            </div>
            <div className="selected-route__meta">
              {last.selectedAccountId && (
                <Badge>{last.selectedAccountId}</Badge>
              )}
              {last.selectedCredentialId && (
                <Badge>{last.selectedCredentialId}</Badge>
              )}
              <Badge tone="accent">{last.policy}</Badge>
              <Badge>{group.attempts || group.logs.length} attempts</Badge>
              <Badge>{fmtNum(group.totalTokens)} tokens</Badge>
              <Badge>{fmtLatency(last.latencyMs)}</Badge>
            </div>
            {last.selectionReason && (
              <p className="muted small" style={{ marginTop: 4 }}>
                {last.selectionReason}
              </p>
            )}
          </div>

          <div className="drawer-section">
            <div className="drawer-heading">Request</div>
            <KeyValue
              columns={2}
              items={[
                {
                  key: "Requested",
                  value: (
                    <span className="mono">
                      {shortModel(last.requestedResourceId) || "—"}
                    </span>
                  ),
                },
                { key: "Capability", value: last.requestedCapability ?? "—" },
                {
                  key: "Started",
                  value: (
                    <span title={fmtTime(group.createdAt)}>
                      {fmtAgo(group.createdAt)}
                    </span>
                  ),
                },
                { key: "Policy", value: last.policy },
                { key: "Provider pin", value: last.providerPin ?? "—" },
                { key: "Account pin", value: last.accountPin ?? "—" },
                { key: "Credential pin", value: last.credentialPin ?? "—" },
                {
                  key: "Prompt / completion",
                  value: `${fmtNum(last.promptTokens)} / ${fmtNum(last.completionTokens)}`,
                },
              ]}
            />
          </div>

          {!group.success && last.errorMessage && (
            <div className="drawer-section">
              <div className="drawer-heading">Final error</div>
              <div className="attempt attempt--bad">
                <div className="attempt__body">
                  {last.errorClass && (
                    <Badge tone="bad">{last.errorClass}</Badge>
                  )}{" "}
                  <span className="attempt__error">{last.errorMessage}</span>
                </div>
              </div>
            </div>
          )}

          <div className="drawer-section">
            <div className="drawer-heading">
              Attempt chain ({group.logs.length} logged)
            </div>
            <div className="attempt-chain">
              {group.logs.map((log, index) => {
                const attemptNumber =
                  Number(/:attempt(\d+)$/.exec(log.id)?.[1]) || index + 1;
                return (
                  <div
                    className={`attempt${log.status === "error" ? " attempt--bad" : ""}`}
                    key={log.id}
                  >
                    <div className="attempt__head">
                      <span className="attempt__num">{attemptNumber}</span>
                      <span className="attempt__route">
                        {log.selectedProviderId
                          ? `${log.selectedProviderId}/${log.selectedUpstreamId ?? ""}`
                          : "no route"}
                      </span>
                      <StatusPill tone={statusTone(log.status)}>
                        {log.status}
                      </StatusPill>
                      <span className="muted small">
                        {fmtLatency(log.latencyMs)}
                      </span>
                      {log.totalTokens != null && (
                        <span className="muted small">
                          {fmtNum(log.totalTokens)} tokens
                        </span>
                      )}
                      <span className="muted small">
                        {fmtAgo(log.createdAt)}
                      </span>
                    </div>
                    <div className="attempt__body">
                      {log.selectedCredentialId && (
                        <span className="mono small">
                          {log.selectedCredentialId}
                        </span>
                      )}
                      {log.selectionReason && (
                        <div className="muted" style={{ marginTop: 3 }}>
                          {log.selectionReason}
                        </div>
                      )}
                      {log.errorClass && (
                        <div
                          className="attempt__error"
                          style={{ marginTop: 3 }}
                        >
                          {log.errorClass}
                          {log.errorMessage ? ` — ${log.errorMessage}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
