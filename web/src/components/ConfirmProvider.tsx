import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (options && !dialog.open) dialog.showModal();
    if (!options && dialog.open) dialog.close();
  }, [options]);

  const finish = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    const dialog = dialogRef.current;
    setOptions(null);
    if (dialog?.open) dialog.close();
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <dialog
        ref={dialogRef}
        className="dialog dialog--sm"
        onCancel={(event) => {
          event.preventDefault();
          finish(false);
        }}
        onClose={() => {
          if (resolver.current) finish(false);
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) finish(false);
        }}
      >
        {options && (
          <div className="dialog__inner">
            <header className="dialog__head">
              <h2>{options.title}</h2>
            </header>
            <div className="dialog__body">
              <p className="dialog__message">{options.message}</p>
            </div>
            <footer className="dialog__foot">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => finish(false)}
              >
                {options.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                className={`btn ${options.danger ? "btn--danger" : "btn--primary"}`}
                onClick={() => finish(true)}
                autoFocus
              >
                {options.confirmLabel ?? "Confirm"}
              </button>
            </footer>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}
