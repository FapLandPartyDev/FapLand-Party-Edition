import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ControllerProvider } from "../../controller";
import { createInitialGameState } from "../../game/engine";
import type { GameConfig, GameState } from "../../game/types";
import { GameScene } from "./GameScene";

type PixiDisplayObject = {
  cursor?: string;
  eventHandlers?: Record<string, Array<() => void>>;
  children?: PixiDisplayObject[];
  text?: string;
};

const {
  mockedUseGameAnimation,
  pixiDisplayObjects,
  pointerTapHandlers,
  rafCallbacks,
  handyMock,
} = vi.hoisted(() => ({
  mockedUseGameAnimation: vi.fn(),
  pixiDisplayObjects: [] as PixiDisplayObject[],
  pointerTapHandlers: [] as Array<() => void>,
  rafCallbacks: [] as FrameRequestCallback[],
  handyMock: {
    connected: false,
    manuallyStopped: false,
    offsetMs: 0,
    toggleManualStop: vi.fn(),
    forceStop: vi.fn(),
    adjustOffset: vi.fn(async (deltaMs: number) => deltaMs),
    resetOffset: vi.fn(async () => undefined),
  },
}));

vi.mock("../../hooks/useSfwMode", () => ({
  useSfwMode: () => false,
}));

vi.mock("pixi.js", () => {
  class DisplayObject {
    x = 0;
    y = 0;
    width = 120;
    height = 32;
    visible = true;
    alpha = 1;
    rotation = 0;
    interactive = false;
    interactiveChildren = true;
    eventMode = "auto";
    cursor = "";
    children: unknown[] = [];
    text = "";
    style: Record<string, unknown> = {};
    eventHandlers: Record<string, Array<() => void>> = {};
    scale = {
      x: 1,
      y: 1,
      set: vi.fn((x: number, y?: number) => {
        this.scale.x = x;
        this.scale.y = y ?? x;
      }),
    };
    anchor = {
      x: 0,
      y: 0,
      set: vi.fn((x: number, y?: number) => {
        this.anchor.x = x;
        this.anchor.y = y ?? x;
      }),
    };
    pivot = {
      x: 0,
      y: 0,
      set: vi.fn((x: number, y?: number) => {
        this.pivot.x = x;
        this.pivot.y = y ?? x;
      }),
    };
    position = {
      x: 0,
      y: 0,
      set: vi.fn((x: number, y?: number) => {
        this.position.x = x;
        this.position.y = y ?? x;
      }),
    };

    constructor(options?: { text?: string; style?: Record<string, unknown> }) {
      if (options?.text) this.text = options.text;
      if (options?.style) this.style = options.style;
      const proxy: this = new Proxy(this, {
        get: (target, prop, receiver) => {
          if (prop in target) return Reflect.get(target, prop, receiver);
          const fn = vi.fn(() => proxy);
          Reflect.set(target, prop, fn);
          return fn;
        },
      });
      return proxy;
    }

    addChild(...children: unknown[]) {
      this.children.push(...children);
      return children[0] ?? null;
    }

    removeChild(...children: unknown[]) {
      this.children = this.children.filter((child) => !children.includes(child));
      return children[0] ?? null;
    }

    removeChildren() {
      this.children = [];
      return [];
    }

    destroy() {}

    on(eventName: string, handler?: () => void) {
      if (handler) {
        const handlers = this.eventHandlers[eventName] ?? [];
        handlers.push(handler);
        this.eventHandlers[eventName] = handlers;
        if (eventName === "pointertap") {
          pointerTapHandlers.push(handler);
        }
      }
      return this;
    }
  }

  class Application {
    canvas = document.createElement("canvas");
    stage = new DisplayObject();
    renderer = { resize: vi.fn() };
    ticker = { add: vi.fn(), remove: vi.fn() };

    async init() {}

    destroy() {}
  }

  class Graphics extends DisplayObject {}
  class Container extends DisplayObject {}
  class Text extends DisplayObject {}
  class Rectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number
    ) {}
  }
  class TextStyle {
    constructor(public options: Record<string, unknown>) {}
  }

  pixiDisplayObjects.length = 0;
  pointerTapHandlers.length = 0;
  const trackClass = <TBase extends new (...args: any[]) => DisplayObject>(Base: TBase) =>
    class extends Base {
      constructor(...args: any[]) {
        super(...args);
        pixiDisplayObjects.push(this);
      }
    };

  return {
    Application,
    Container: trackClass(Container),
    Graphics: trackClass(Graphics),
    Rectangle,
    Text: trackClass(Text),
    TextStyle,
  };
});

vi.mock("../../game/useGameAnimation", () => ({
  DICE_RESULT_REVEAL_DURATION: 0.4,
  DICE_ROLL_DURATION: 0.8,
  LANDING_DURATION: 0.3,
  PERK_REVEAL_DURATION: 0.3,
  STEP_DURATION: 0.25,
  useGameAnimation: mockedUseGameAnimation,
}));

vi.mock("../../contexts/HandyContext", () => ({
  useHandy: () => handyMock,
}));

vi.mock("../../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: vi.fn(async () => false),
      },
    },
  },
}));

vi.mock("../../utils/audio", () => ({
  playRoundRewardSound: vi.fn(),
  playRoundRewardTickSound: vi.fn(),
}));

vi.mock("./RoundVideoOverlay", () => ({
  RoundVideoOverlay: () => null,
}));

vi.mock("./RoundStartTransition", () => ({
  RoundStartTransition: () => null,
}));

vi.mock("./InventoryDockButton", () => ({
  InventoryDockButton: () => null,
}));

vi.mock("./PerkInventoryPanel", () => ({
  PerkInventoryPanel: () => null,
}));

vi.mock("./ControllerHints", () => ({
  default: () => null,
}));

function makeConfig(): GameConfig {
  return {
    board: [
      { id: "start", name: "Start", kind: "start" },
      { id: "path-1", name: "Path 1", kind: "path" },
    ],
    runtimeGraph: {
      startNodeId: "start",
      pathChoiceTimeoutMs: 6000,
      edges: [{ id: "edge-1", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 }],
      edgesById: {
        "edge-1": { id: "edge-1", fromNodeId: "start", toNodeId: "path-1", gateCost: 0, weight: 1 },
      },
      outgoingEdgeIdsByNodeId: {
        start: ["edge-1"],
      },
      randomRoundPoolsById: {},
      nodeIndexById: {
        start: 0,
        "path-1": 1,
      },
    },
    dice: { min: 1, max: 6 },
    perkSelection: {
      optionsPerPick: 3,
      triggerChancePerCompletedRound: 0.35,
    },
    perkPool: {
      enabledPerkIds: ["loaded-dice", "shield", "steady-steps"],
      enabledAntiPerkIds: [],
    },
    probabilityScaling: {
      initialIntermediaryProbability: 0,
      initialAntiPerkProbability: 0,
      intermediaryIncreasePerRound: 0.02,
      antiPerkIncreasePerRound: 0.015,
      maxIntermediaryProbability: 1,
      maxAntiPerkProbability: 0.75,
    },
    singlePlayer: {
      totalIndices: 1,
      safePointIndices: [],
      normalRoundIdsByIndex: {},
      cumRoundIds: [],
    },
    economy: {
      startingMoney: 200,
      moneyPerCompletedRound: 50,
      startingScore: 0,
      scorePerCompletedRound: 100,
      scorePerIntermediary: 30,
      scorePerActiveAntiPerk: 25,
      scorePerCumRoundSuccess: 420,
    },
    roundStartDelayMs: 2000,
  };
}

function withPendingPerkSelection(
  base: GameState,
  options: Array<{ id: string; name: string; cost: number }>
): GameState {
  return {
    ...base,
    pendingPerkSelection: {
      playerId: base.players[0]!.id,
      fromFieldId: "perk-1",
      options: options.map((option) => ({
        id: option.id,
        name: option.name,
        description: option.name,
        iconKey: "loadedDice",
        cost: option.cost,
        kind: "perk",
        target: "self",
        application: "persistent",
        effects: [],
      })),
    },
  };
}

function getPerkOverlayPointerTapHandlers(): Array<() => void> {
  return pointerTapHandlers.slice(-5);
}

function flushAnimationFrames() {
  const callbacks = [...rafCallbacks];
  rafCallbacks.length = 0;
  for (const callback of callbacks) {
    callback(16);
  }
}

describe("GameScene keyboard perk selection", () => {
  const handleRoll = vi.fn();
  const handleStartQueuedRound = vi.fn();
  const handleCompleteRound = vi.fn();
  const handleSelectPathEdge = vi.fn();
  const handleSelectPerk = vi.fn();
  const handleSkipPerk = vi.fn();
  const handleApplyInventoryItemToSelf = vi.fn();
  const handleConsumeInventoryItem = vi.fn();
  const handleApplyExternalPerk = vi.fn();
  const handleAdjustPlayerMoney = vi.fn();
  const handleUseRoundControl = vi.fn();
  const handleConsumeAntiPerkById = vi.fn();
  const tickAnim = vi.fn(() => ({ kind: "idle" as const }));

  let currentState: GameState;

  beforeEach(() => {
    cleanup();
    pixiDisplayObjects.length = 0;
    pointerTapHandlers.length = 0;
    rafCallbacks.length = 0;
    handyMock.connected = false;
    handyMock.manuallyStopped = false;
    handyMock.offsetMs = 0;
    handyMock.toggleManualStop.mockReset();
    handyMock.forceStop.mockReset();
    handyMock.adjustOffset.mockReset();
    handyMock.adjustOffset.mockImplementation(async (deltaMs: number) => deltaMs);
    handyMock.resetOffset.mockReset();
    handyMock.resetOffset.mockImplementation(async () => undefined);
    mockedUseGameAnimation.mockImplementation(() => ({
      state: currentState,
      animPhase: { kind: "idle" as const },
      nextAutoRollInSec: null,
      pathChoiceRemainingMs: null,
      handleRoll,
      handleStartQueuedRound,
      handleCompleteRound,
      handleSelectPathEdge,
      handleSelectPerk,
      handleSkipPerk,
      handleApplyInventoryItemToSelf,
      handleConsumeInventoryItem,
      handleApplyExternalPerk,
      handleAdjustPlayerMoney,
      handleUseRoundControl,
      handleConsumeAntiPerkById,
      tickAnim,
    }));

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );

    let frameId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const nextId = ++frameId;
        callbacks.set(nextId, callback);
        rafCallbacks.push(callback);
        return nextId;
      })
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        callbacks.delete(id);
      })
    );

    Object.defineProperty(window.navigator, "getGamepads", {
      configurable: true,
      value: vi.fn(() => []),
    });

    handleRoll.mockReset();
    handleStartQueuedRound.mockReset();
    handleCompleteRound.mockReset();
    handleSelectPathEdge.mockReset();
    handleSelectPerk.mockReset();
    handleSkipPerk.mockReset();
    handleApplyInventoryItemToSelf.mockReset();
    handleConsumeInventoryItem.mockReset();
    handleApplyExternalPerk.mockReset();
    handleAdjustPlayerMoney.mockReset();
    handleUseRoundControl.mockReset();
    handleConsumeAntiPerkById.mockReset();
    tickAnim.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  async function renderScene() {
    const initialState = createInitialGameState(makeConfig());
    currentState ??= initialState;
    const view = render(
      <ControllerProvider>
        <GameScene
          initialState={initialState}
          sessionStartedAtMs={Date.now()}
          installedRounds={[]}
          onGiveUp={vi.fn()}
          intermediaryLoadingPrompt="Loading"
          intermediaryLoadingDurationSec={5}
          intermediaryReturnPauseSec={4}
          onApplyPerkDirectlyChange={vi.fn()}
        />
      </ControllerProvider>
    );
    await Promise.resolve();
    flushAnimationFrames();
    return view;
  }

  it("resets perk selection to the first option when a new prompt opens", async () => {
    currentState = withPendingPerkSelection(createInitialGameState(makeConfig()), [
      { id: "loaded-dice", name: "Loaded Dice", cost: 10 },
      { id: "shield", name: "Shield", cost: 20 },
    ]);

    const view = await renderScene();

    fireEvent.keyDown(window, { key: "ArrowDown" });

    currentState = withPendingPerkSelection(createInitialGameState(makeConfig()), [
      { id: "steady-steps", name: "Steady Steps", cost: 15 },
      { id: "shield", name: "Shield", cost: 20 },
    ]);

    view.rerender(
      <ControllerProvider>
        <GameScene
          initialState={createInitialGameState(makeConfig())}
          sessionStartedAtMs={Date.now()}
          installedRounds={[]}
          onGiveUp={vi.fn()}
          intermediaryLoadingPrompt="Loading"
          intermediaryLoadingDurationSec={5}
          intermediaryReturnPauseSec={4}
          onApplyPerkDirectlyChange={vi.fn()}
        />
      </ControllerProvider>
    );
    await Promise.resolve();
    flushAnimationFrames();

    fireEvent.keyDown(window, { key: " " });

    expect(handleSkipPerk).not.toHaveBeenCalled();
    expect(handleSelectPerk).toHaveBeenCalledTimes(1);
    expect(handleSelectPerk).toHaveBeenCalledWith("steady-steps", { applyDirectly: false });
  });

  it("handles space as a single perk selection action", async () => {
    currentState = withPendingPerkSelection(createInitialGameState(makeConfig()), [
      { id: "loaded-dice", name: "Loaded Dice", cost: 10 },
      { id: "shield", name: "Shield", cost: 20 },
    ]);

    await renderScene();

    fireEvent.keyDown(window, { key: " " });

    expect(handleSelectPerk).toHaveBeenCalledTimes(1);
    expect(handleSelectPerk).toHaveBeenCalledWith("loaded-dice", { applyDirectly: false });
    expect(handleRoll).not.toHaveBeenCalled();
  });

  it("adjusts the global TheHandy offset with physical bracket hotkeys", async () => {
    handyMock.offsetMs = 10;
    await renderScene();

    fireEvent.keyDown(window, { code: "BracketLeft" });
    fireEvent.keyDown(window, { code: "BracketRight" });
    fireEvent.keyDown(window, { code: "BracketLeft", shiftKey: true });
    fireEvent.keyDown(window, { code: "BracketRight", shiftKey: true });
    fireEvent.keyDown(window, { code: "Backslash" });

    expect(handyMock.adjustOffset).toHaveBeenNthCalledWith(1, -25);
    expect(handyMock.adjustOffset).toHaveBeenNthCalledWith(2, 25);
    expect(handyMock.adjustOffset).toHaveBeenNthCalledWith(3, -1);
    expect(handyMock.adjustOffset).toHaveBeenNthCalledWith(4, 1);
    expect(handyMock.resetOffset).toHaveBeenCalledTimes(1);
  });

  it("does not trigger TheHandy offset hotkeys while typing in an input", async () => {
    await renderScene();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { code: "BracketLeft" });
    fireEvent.keyDown(input, { code: "BracketRight", shiftKey: true });
    fireEvent.keyDown(input, { code: "Backslash" });

    expect(handyMock.adjustOffset).not.toHaveBeenCalled();
    expect(handyMock.resetOffset).not.toHaveBeenCalled();

    input.remove();
  });

  it("selects an affordable perk via pointer tap", async () => {
    currentState = withPendingPerkSelection(createInitialGameState(makeConfig()), [
      { id: "loaded-dice", name: "Loaded Dice", cost: 10 },
      { id: "shield", name: "Shield", cost: 20 },
    ]);

    await renderScene();

    const tapHandler = getPerkOverlayPointerTapHandlers()[0];
    expect(tapHandler).toBeDefined();

    tapHandler?.();

    expect(handleSelectPerk).toHaveBeenCalledTimes(1);
    expect(handleSelectPerk).toHaveBeenCalledWith("loaded-dice", { applyDirectly: false });
  });

  it("does not select an unaffordable perk via pointer tap", async () => {
    currentState = withPendingPerkSelection(createInitialGameState(makeConfig()), [
      { id: "loaded-dice", name: "Loaded Dice", cost: 999 },
      { id: "shield", name: "Shield", cost: 20 },
    ]);

    await renderScene();

    const tapHandler = getPerkOverlayPointerTapHandlers()[0];
    expect(tapHandler).toBeDefined();

    tapHandler?.();

    expect(handleSelectPerk).not.toHaveBeenCalled();
  });

  it("skips perk selection via pointer tap", async () => {
    currentState = withPendingPerkSelection(createInitialGameState(makeConfig()), [
      { id: "loaded-dice", name: "Loaded Dice", cost: 10 },
      { id: "shield", name: "Shield", cost: 20 },
    ]);

    await renderScene();

    const overlayHandlers = getPerkOverlayPointerTapHandlers();
    const tapHandler = overlayHandlers[4] ?? overlayHandlers[3];
    expect(tapHandler).toBeDefined();

    tapHandler?.();

    expect(handleSkipPerk).toHaveBeenCalledTimes(1);
  });
});
