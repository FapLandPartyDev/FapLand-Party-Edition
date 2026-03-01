type EqualFn<T> = (a: T, b: T) => boolean;

const defaultEqual = <T>(left: T, right: T): boolean => Object.is(left, right);

const cloneState = <T>(state: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state)) as T;
}

export class UndoManager<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private currentState: T;
  private readonly maxHistory: number;
  private readonly isEqual: EqualFn<T>;

  constructor(initialState: T, options?: { maxHistory?: number; isEqual?: EqualFn<T> }) {
    this.currentState = cloneState(initialState);
    this.maxHistory = Math.max(10, Math.min(400, options?.maxHistory ?? 100));
    this.isEqual = options?.isEqual ?? defaultEqual;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getCurrentState(): T {
    return this.currentState;
  }

  snapshot(): T {
    return cloneState(this.currentState);
  }

  replace(nextState: T): void {
    if (this.isEqual(this.currentState, nextState)) return;
    this.currentState = cloneState(nextState);
    this.undoStack = [];
    this.redoStack = [];
  }

  push(nextState: T): void {
    if (this.isEqual(this.currentState, nextState)) return;
    this.undoStack.push(cloneState(this.currentState));
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.currentState = cloneState(nextState);
    this.redoStack = [];
  }

  reset(nextState: T): void {
    this.undoStack = [];
    this.redoStack = [];
    this.currentState = cloneState(nextState);
  }

  undo(): T | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(cloneState(this.currentState));
    this.currentState = cloneState(previous);
    return cloneState(this.currentState);
  }

  redo(): T | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneState(this.currentState));
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.currentState = cloneState(next);
    return cloneState(this.currentState);
  }
}
