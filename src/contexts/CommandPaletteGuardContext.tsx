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

type CommandPaletteGuardValue = {
  blocked: boolean;
  reason: string | null;
  registerBlock: (id: symbol, reason: string) => void;
  unregisterBlock: (id: symbol) => void;
};

const CommandPaletteGuardContext = createContext<CommandPaletteGuardValue>({
  blocked: false,
  reason: null,
  registerBlock: () => {},
  unregisterBlock: () => {},
});

export function useCommandPaletteGuard() {
  return useContext(CommandPaletteGuardContext);
}

export function BlockCommandPalette({
  children,
  reason = "You cannot use the command palette here.",
}: {
  children: ReactNode;
  reason?: string;
}) {
  const { registerBlock, unregisterBlock } = useCommandPaletteGuard();
  const blockIdRef = useRef(Symbol("command-palette-block"));

  useEffect(() => {
    const blockId = blockIdRef.current;
    registerBlock(blockId, reason);
    return () => unregisterBlock(blockId);
  }, [reason, registerBlock, unregisterBlock]);

  return <>{children}</>;
}

export function CommandPaletteGuardProvider({ children }: { children: ReactNode }) {
  const [blocks, setBlocks] = useState<Array<{ id: symbol; reason: string }>>([]);

  const registerBlock = useCallback((id: symbol, reason: string) => {
    setBlocks((current) => {
      const next = current.filter((block) => block.id !== id);
      next.push({ id, reason });
      return next;
    });
  }, []);

  const unregisterBlock = useCallback((id: symbol) => {
    setBlocks((current) => current.filter((block) => block.id !== id));
  }, []);

  const value = useMemo<CommandPaletteGuardValue>(
    () => ({
      blocked: blocks.length > 0,
      reason: blocks.at(-1)?.reason ?? null,
      registerBlock,
      unregisterBlock,
    }),
    [blocks, registerBlock, unregisterBlock]
  );

  return (
    <CommandPaletteGuardContext.Provider value={value}>
      {children}
    </CommandPaletteGuardContext.Provider>
  );
}
