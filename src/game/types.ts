export type EffectTarget = "self" | "opponent" | "all";

export type NumericStat = "diceMin" | "diceMax" | "roundPauseMs" | "perkFrequency" | "perkLuck";

export type NumericDeltaEffect = {
  kind: "numericDelta";
  stat: NumericStat;
  amount: number;
  target?: EffectTarget;
  min?: number;
  max?: number;
};

export type TriggerPerkChoiceEffect = {
  kind: "triggerPerkChoice";
};

export type ProbabilityStat = "intermediaryProbability" | "antiPerkProbability";

export type ProbabilityDeltaEffect = {
  kind: "probabilityDelta";
  stat: ProbabilityStat;
  amount: number;
  min?: number;
  max?: number;
  singlePlayerOnly?: boolean;
};

export type ScoreDeltaEffect = {
  kind: "scoreDelta";
  amount: number;
  min?: number;
  max?: number;
  target?: EffectTarget;
};

export type RoundControlType = "pause" | "skip";

export type GrantRoundControlEffect = {
  kind: "grantRoundControl";
  control: RoundControlType;
  amount: number;
};

export type RoundControlDeltaEffect = {
  kind: "roundControlDelta";
  control: RoundControlType;
  amount: number;
};

export type SetShieldRoundsEffect = {
  kind: "setShieldRounds";
  rounds: number;
};

export type CleanseAntiPerksEffect = {
  kind: "cleanseAntiPerks";
};

export type SetPendingRollMultiplierEffect = {
  kind: "setPendingRollMultiplier";
  multiplier: number;
};

export type SetPendingRollCeilingEffect = {
  kind: "setPendingRollCeiling";
  ceiling: number;
};

export type SetPendingIntensityCapEffect = {
  kind: "setPendingIntensityCap";
  cap: number;
};

export type GameEffect =
  | NumericDeltaEffect
  | TriggerPerkChoiceEffect
  | ProbabilityDeltaEffect
  | ScoreDeltaEffect
  | GrantRoundControlEffect
  | RoundControlDeltaEffect
  | SetShieldRoundsEffect
  | CleanseAntiPerksEffect
  | SetPendingRollMultiplierEffect
  | SetPendingRollCeilingEffect
  | SetPendingIntensityCapEffect;

export type BoardFieldKind =
  | "start"
  | "end"
  | "path"
  | "safePoint"
  | "round"
  | "randomRound"
  | "perk"
  | "event"
  | "catapult";

export type RoundRef = {
  slot: number;
};

export type BoardField = {
  id: string;
  name: string;
  kind: BoardFieldKind;
  fixedRoundId?: string;
  forceStop?: boolean;
  skippable?: boolean;
  randomPoolId?: string;
  checkpointRestMs?: number;
  visualId?: string;
  giftGuaranteedPerk?: boolean;
  catapultForward?: number;
  catapultLandingOnly?: boolean;
  styleHint?: {
    x?: number;
    y?: number;
    color?: string;
    icon?: string;
    size?: number;
    width?: number;
    height?: number;
  };
  round?: RoundRef;
  effects?: GameEffect[];
};

export type MapTextAnnotation = {
  id: string;
  text: string;
  styleHint: {
    x: number;
    y: number;
    color?: string;
    size?: number;
  };
};

export type MapBackgroundMedia = {
  kind: "image" | "video";
  uri: string;
  name?: string;
  fit: "cover" | "contain" | "stretch" | "tile";
  position: "center" | "top" | "bottom" | "left" | "right";
  opacity: number;
  blur: number;
  dim: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  motion: "fixed" | "parallax";
  parallaxStrength: number;
};

export type RoadPalette = {
  presetId?: string;
  body: string;
  railA: string;
  railB: string;
  glow: string;
  center: string;
  gate: string;
  marker: string;
};

export type MapStyle = {
  background?: MapBackgroundMedia;
  roadPalette?: RoadPalette;
};

export type RuntimeGraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  gateCost: number;
  weight: number;
  label?: string;
};

export type RuntimeGraphRandomPoolCandidate = {
  roundId: string;
  weight: number;
};

export type RuntimeGraphRandomPool = {
  id: string;
  candidates: RuntimeGraphRandomPoolCandidate[];
};

export type RuntimeGraphConfig = {
  startNodeId: string;
  pathChoiceTimeoutMs: number;
  edges: RuntimeGraphEdge[];
  edgesById: Record<string, RuntimeGraphEdge>;
  outgoingEdgeIdsByNodeId: Record<string, string[]>;
  randomRoundPoolsById: Record<string, RuntimeGraphRandomPool>;
  nodeIndexById: Record<string, number>;
};

export type PerkKind = "perk" | "antiPerk";
export type PerkRarity = "common" | "rare" | "epic" | "legendary";
export type PerkIconKey =
  | "loadedDice"
  | "steadySteps"
  | "longInterlude"
  | "jammedDice"
  | "cementBoots"
  | "coldStreak"
  | "scoreLeech"
  | "panicLoop"
  | "stickyFingers"
  | "snakeEyes"
  | "milker"
  | "noRest"
  | "highspeed"
  | "virus"
  | "virusMax"
  | "succubus"
  | "jackhammer"
  | "pause"
  | "skip"
  | "heal"
  | "shield"
  | "cleaner"
  | "doubler"
  | "lazyHero"
  | "gooooal"
  | "beGentle"
  | "treasureMagnet"
  | "drySpell"
  | "luckyStar"
  | "badOmen"
  | "highRoller"
  | "couponClipper"
  | "imClose"
  | "unknown";

export type PerkDefinition = {
  id: string;
  name: string;
  description: string;
  iconKey: PerkIconKey;
  cost: number;
  rarity?: PerkRarity;
  kind: PerkKind;
  target: Exclude<EffectTarget, "all">;
  durationRounds?: number | null;
  application?: "persistent" | "immediate";
  effects: GameEffect[];
  requiresHandy?: boolean;
  requiresMoaning?: boolean;
};

export type RoundAudioEffect = {
  kind: "continuousMoaning";
  sourcePerkId: string;
};

export type InventoryItem = {
  itemId: string;
  perkId: string;
  kind: PerkKind;
  name: string;
  cost: number;
  acquiredTurn: number;
};

export type ActivePerkEffect = {
  id: string;
  name?: string;
  kind: PerkKind;
  remainingRounds: number | null;
  effects: GameEffect[];
  appliedTurn: number;
  appliedAfterRoll: boolean;
};

export type PlaylistMusicTrack = {
  id: string;
  uri: string;
  name: string;
};

export type PlaylistMusicConfig = {
  tracks: PlaylistMusicTrack[];
  loop: boolean;
};

export type GameConfig = {
  board: BoardField[];
  mapTextAnnotations?: MapTextAnnotation[];
  mapStyle?: MapStyle;
  runtimeGraph: RuntimeGraphConfig;
  dice: {
    min: number;
    max: number;
  };
  perkSelection: {
    optionsPerPick: number;
    triggerChancePerCompletedRound: number;
    includeAntiPerksInChoices?: boolean;
  };
  perkPool: {
    enabledPerkIds: string[];
    enabledAntiPerkIds: string[];
  };
  probabilityScaling: {
    initialIntermediaryProbability: number;
    initialAntiPerkProbability: number;
    intermediaryIncreasePerRound: number;
    antiPerkIncreasePerRound: number;
    maxIntermediaryProbability: number;
    maxAntiPerkProbability: number;
  };
  singlePlayer: {
    totalIndices: number;
    safePointIndices: number[];
    normalRoundIdsByIndex: Record<number, string>;
    cumRoundIds: string[];
  };
  economy: {
    startingMoney: number;
    moneyPerCompletedRound: number;
    startingScore: number;
    scorePerCompletedRound: number;
    scorePerIntermediary: number;
    scorePerActiveAntiPerk: number;
    scorePerCumRoundSuccess: number;
  };
  roundStartDelayMs: number;
  playlistMusic?: PlaylistMusicConfig;
};

export type PlayerStats = {
  diceMin: number;
  diceMax: number;
  roundPauseMs: number;
  perkFrequency: number;
  perkLuck: number;
};

export type PlayerState = {
  id: string;
  name: string;
  currentNodeId: string;
  position: number;
  stats: PlayerStats;
  money: number;
  score: number;
  perks: string[];
  antiPerks: string[];
  inventory: InventoryItem[];
  activePerkEffects: ActivePerkEffect[];
  roundControl?: {
    pauseCharges: number;
    skipCharges: number;
  };
  shieldRoundsRemaining?: number;
  pendingRollMultiplier?: number | null;
  pendingRollCeiling?: number | null;
  pendingIntensityCap?: number | null;
};

export type ActiveRound = {
  fieldId: string;
  nodeId: string;
  roundId: string;
  roundName: string;
  skippable?: boolean;
  selectionKind: "fixed" | "random" | "cum";
  poolId: string | null;
  phaseKind: "normal" | "cum";
  campaignIndex: number | null;
};

export type PathChoiceOption = {
  edgeId: string;
  toNodeId: string;
  toFieldName: string;
  gateCost: number;
  label?: string;
};

export type PendingPathChoice = {
  playerId: string;
  fromNodeId: string;
  remainingSteps: number;
  traversedNodeIds: string[];
  options: PathChoiceOption[];
};

export type PendingPerkSelection = {
  playerId: string;
  fromFieldId: string;
  options: PerkDefinition[];
};

export type CompletedRoundSummary = {
  intermediaryCount: number;
  activeAntiPerkCount: number;
  cumOutcome?: CumRoundOutcome;
};

export type CumRoundOutcome = "came_as_told" | "did_not_cum" | "failed_instruction";

export type GameCompletionReason = "finished" | "self_reported_cum" | "cum_instruction_failed";

export type GameState = {
  config: GameConfig;
  players: PlayerState[];
  currentPlayerIndex: number;
  turn: number;
  sessionPhase: "normal" | "cum" | "completed";
  bonusRolls: number;
  nextCumRoundIndex: number;
  highscore: number;
  intermediaryProbability: number;
  antiPerkProbability: number;
  queuedRound: ActiveRound | null;
  activeRound: ActiveRound | null;
  queuedRoundAudioEffect: RoundAudioEffect | null;
  activeRoundAudioEffect: RoundAudioEffect | null;
  pendingPathChoice: PendingPathChoice | null;
  pendingPerkSelection: PendingPerkSelection | null;
  lastTraversalPathNodeIds: string[];
  playedRoundIdsByPool: Record<string, string[]>;
  log: string[];
  lastRoll: number | null;
  completionReason: GameCompletionReason | null;
};
