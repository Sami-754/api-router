import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useToast } from "./ToastProvider";
import { Icon, type IconName } from "./Icon";
import { quotaPct, quotaTone } from "../lib/format";
import type { QuotaWindow } from "../lib/types";

type Tone = "ok" | "warn" | "bad" | "neutral" | "accent";

export function statusTone(status?: string | null): Tone {
  const value = String(status ?? "").toLowerCase();
  if (
    [
      "success",
      "active",
      "enabled",
      "healthy",
      "ok",
      "valid",
      "online",
    ].includes(value)
  )
    return "ok";
  if (
    [
      "disabled",
      "cooldown",
      "degraded",
      "warn",
      "warning",
      "off",
      "soft",
    ].includes(value)
  )
    return "warn";
  if (
    ["invalid", "error", "failed", "bad", "offline", "exhausted"].includes(
      value,
    )
  )
    return "bad";
  return "neutral";
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  busy?: boolean;
  icon?: IconName;
}

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} btn--${size}${className ? ` ${className}` : ""}`}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? (
        <span className="spinner" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: IconName;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

export function StatusPill({
  children,
  tone,
  dot = true,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={`pill pill--${tone ?? "neutral"}`}>
      {dot && <span className="pill__dot" />}
      {children}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function QuotaBar({
  quota,
  showPct = true,
}: {
  quota?: QuotaWindow | null;
  showPct?: boolean;
}) {
  const pct = quotaPct(quota);
  if (pct === null) return <span className="muted">—</span>;
  const tone = quotaTone(quota);
  return (
    <span className="quota">
      <span
        className="quota__track"
        title={`${quota?.usedValue ?? 0} / ${quota?.limitValue ?? 0} ${quota?.metric ?? ""}`}
      >
        <span
          className={`quota__fill quota__fill--${tone}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      {showPct && <span className="quota__pct">{pct}%</span>}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: Array<{ label: string; to?: string }>;
}) {
  return (
    <header className="page-head">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((item, index) => (
            <span key={`${item.label}-${index}`} className="breadcrumb__item">
              {item.to ? <Link to={item.to}>{item.label}</Link> : item.label}
              {index < breadcrumb.length - 1 && (
                <Icon name="chevron-right" size={12} />
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="page-head__row">
        <div className="page-head__text">
          <h1>{title}</h1>
          {subtitle && <p className="page-head__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-head__actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="section" id={id}>
      {(title || actions) && (
        <div className="section__head">
          <div>
            {title && <h2 className="section__title">{title}</h2>}
            {description && <p className="section__desc">{description}</p>}
          </div>
          {actions && <div className="section__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  message,
  action,
  icon = "info",
}: {
  title: string;
  message?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={18} />
      </div>
      <div>
        <p className="empty__title">{title}</p>
        {message && <p className="empty__message">{message}</p>}
        {action && <div className="empty__action">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <Icon name="alert" size={16} />
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      <div className="skeleton skeleton--title" />
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="skeleton skeleton--line"
          style={{ width: `${92 - index * 7}%` }}
        />
      ))}
    </div>
  );
}

export function CopyButton({
  value,
  label,
  compact,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const { notify } = useToast();
  return (
    <button
      type="button"
      className={`copy-btn${compact ? " copy-btn--compact" : ""}`}
      title={`Copy ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          notify("Copied", "ok");
        } catch {
          notify("Copy failed", "error");
        }
      }}
    >
      <Icon name="copy" size={13} />
      {label && <span>{label}</span>}
    </button>
  );
}

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={`tab${value === item.id ? " tab--active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="tab__count">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  onChange,
  total,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  total?: number;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="pagination">
      <span className="pagination__meta">
        {total !== undefined ? `${total.toLocaleString()} rows · ` : ""}
        page {page} of {pageCount}
      </span>
      <div className="pagination__actions">
        <Button
          size="sm"
          variant="ghost"
          icon="chevron-left"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Prev
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
        >
          Next
          <Icon name="chevron-right" size={14} />
        </Button>
      </div>
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  variant = "dialog",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "dialog" | "drawer";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size}${variant === "drawer" ? " dialog--drawer" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog__inner">
          <header className="dialog__head">
            <div>
              <h2>{title}</h2>
              {description && <p className="dialog__desc">{description}</p>}
            </div>
            <IconButton label="Close" icon="x" onClick={onClose} />
          </header>
          <div className="dialog__body">{children}</div>
          {footer && <footer className="dialog__foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field${className ? ` ${className}` : ""}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "error";
}) {
  return (
    <div className={`notice notice--${tone}`}>
      <Icon name={tone === "info" ? "info" : "alert"} size={15} />
      <div>{children}</div>
    </div>
  );
}

export function KeyValue({
  items,
  columns = 2,
}: {
  items: Array<{ key: ReactNode; value: ReactNode }>;
  columns?: number;
}) {
  return (
    <dl
      className="kv"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item, index) => (
        <div className="kv__row" key={index}>
          <dt className="kv__key">{item.key}</dt>
          <dd className="kv__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProviderChip({ id }: { id: string }) {
  return (
    <Link className="provider-chip" to={`/providers/${encodeURIComponent(id)}`}>
      {id}
    </Link>
  );
}
