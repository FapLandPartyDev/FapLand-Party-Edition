declare module "serialport" {
  export const SerialPort: {
    new (options: {
      path: string;
      baudRate: number;
      dataBits: 8;
      stopBits: 1;
      parity: "none";
      autoOpen: false;
    }): {
      isOpen: boolean;
      open: (callback: (error?: Error | null) => void) => void;
      close: (callback?: () => void) => void;
      write: (data: string) => void;
      on: (event: string, callback: (...args: unknown[]) => void) => void;
      removeAllListeners: () => void;
    };
    list: () => Promise<Array<{ path: string; manufacturer?: string }>>;
  };
}
