import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface RefreshContextValue {
  nonce: number;
  bump: () => void;
}

const RefreshContext = createContext<RefreshContextValue>({
  nonce: 0,
  bump: () => {},
});

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [nonce, setNonce] = useState(0);
  const bump = useCallback(() => setNonce((n) => n + 1), []);
  const value = useMemo(() => ({ nonce, bump }), [nonce, bump]);
  return (
    <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
  );
}

export function useRefresh(): RefreshContextValue {
  return useContext(RefreshContext);
}
