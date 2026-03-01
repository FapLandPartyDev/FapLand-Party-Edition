import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ForegroundMediaContextValue = {
  activeForegroundVideoCount: number;
  register: (id: string) => void;
  unregister: (id: string) => void;
  setPlaying: (id: string, playing: boolean) => void;
};

const ForegroundMediaContext = createContext<ForegroundMediaContextValue | null>(null);

export function ForegroundMediaProvider({ children }: { children: React.ReactNode }) {
  const [registry, setRegistry] = useState<Record<string, boolean>>({});

  const register = useCallback((id: string) => {
    setRegistry((prev) => (id in prev ? prev : { ...prev, [id]: false }));
  }, []);

  const unregister = useCallback((id: string) => {
    setRegistry((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setPlaying = useCallback((id: string, playing: boolean) => {
    setRegistry((prev) => {
      if (prev[id] === playing) return prev;
      return { ...prev, [id]: playing };
    });
  }, []);

  const value = useMemo<ForegroundMediaContextValue>(
    () => ({
      activeForegroundVideoCount: Object.values(registry).filter(Boolean).length,
      register,
      unregister,
      setPlaying,
    }),
    [register, registry, setPlaying, unregister]
  );

  return (
    <ForegroundMediaContext.Provider value={value}>{children}</ForegroundMediaContext.Provider>
  );
}

export function useForegroundMedia() {
  const context = useContext(ForegroundMediaContext);
  if (!context) {
    throw new Error("useForegroundMedia must be used within a ForegroundMediaProvider.");
  }
  return context;
}
