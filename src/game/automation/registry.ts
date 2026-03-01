export type FieldDescriptor =
  | {
      type: "select";
      name: string;
      label: string;
      options: ReadonlyArray<{ value: string; label: string }>;
    }
  | { type: "number"; name: string; label: string; min?: number; max?: number; step?: number }
  | { type: "text"; name: string; label: string }
  | { type: "toggle"; name: string; label: string }
  | { type: "nodeRef"; name: string; label: string; optional?: boolean }
  | { type: "trackRef"; name: string; label: string }
  | { type: "edgeRef"; name: string; label: string }
  | { type: "ruleRef"; name: string; label: string; optional?: boolean }
  | { type: "perkRef"; name: string; label: string; perkKind?: "perk" | "antiPerk" };

export const AUTOMATION_TRIGGER_DESCRIPTORS = [
  { kind: "node.enter", label: "Node Enter", category: "Node" },
  { kind: "node.leave", label: "Node Leave", category: "Node" },
  { kind: "node.stay", label: "Node Stay", category: "Node" },
  { kind: "player.stateChanged", label: "Player State Changed", category: "Player" },
  { kind: "player.controlUsed", label: "Player Control Used", category: "Player" },
  { kind: "round.lifecycle", label: "Round Lifecycle", category: "Round" },
  { kind: "music.stateChanged", label: "Music State Changed", category: "Media" },
  { kind: "session.timer", label: "Session Timer", category: "Session" },
  { kind: "board.pathChoiceStarted", label: "Path Choice Started", category: "Board" },
  { kind: "board.pathChoiceResolved", label: "Path Choice Resolved", category: "Board" },
] as const;

export type TriggerKind = (typeof AUTOMATION_TRIGGER_DESCRIPTORS)[number]["kind"];

export const TRIGGER_FIELDS: Record<TriggerKind, FieldDescriptor[]> = {
  "node.enter": [{ type: "nodeRef", name: "nodeId", label: "Node", optional: true }],
  "node.leave": [{ type: "nodeRef", name: "nodeId", label: "Node", optional: true }],
  "node.stay": [
    { type: "nodeRef", name: "nodeId", label: "Node", optional: true },
    { type: "number", name: "elapsedMs", label: "Duration (ms)", min: 0, step: 1000 },
    {
      type: "select",
      name: "repeatMode",
      label: "Repeat",
      options: [
        { value: "once", label: "Once" },
        { value: "repeat", label: "Repeat" },
      ],
    },
  ],
  "player.stateChanged": [
    {
      type: "select",
      name: "stateKey",
      label: "State Key",
      options: [
        { value: "hasPerk", label: "Has Perk" },
        { value: "hasAntiPerk", label: "Has Anti-Perk" },
        { value: "shieldRounds", label: "Shield Rounds" },
        { value: "money", label: "Money" },
        { value: "score", label: "Score" },
      ],
    },
  ],
  "player.controlUsed": [
    {
      type: "select",
      name: "control",
      label: "Control",
      options: [
        { value: "", label: "Any Control" },
        { value: "pause", label: "Pause" },
        { value: "skip", label: "Skip" },
      ],
    },
  ],
  "round.lifecycle": [
    {
      type: "select",
      name: "phase",
      label: "Phase",
      options: [
        { value: "queued", label: "Queued" },
        { value: "started", label: "Started" },
        { value: "ended", label: "Ended" },
        { value: "skipped", label: "Skipped" },
      ],
    },
  ],
  "music.stateChanged": [
    {
      type: "select",
      name: "state",
      label: "State",
      options: [
        { value: "trackStarted", label: "Track Started" },
        { value: "trackEnded", label: "Track Ended" },
        { value: "paused", label: "Paused" },
        { value: "resumed", label: "Resumed" },
      ],
    },
  ],
  "session.timer": [
    {
      type: "select",
      name: "timer",
      label: "Timer",
      options: [
        { value: "restPauseStarted", label: "Rest Pause Started" },
        { value: "restPauseElapsed", label: "Rest Pause Elapsed" },
        { value: "turnStarted", label: "Turn Started" },
      ],
    },
  ],
  "board.pathChoiceStarted": [],
  "board.pathChoiceResolved": [],
};

export const AUTOMATION_CONDITION_DESCRIPTORS = [
  { kind: "currentNode", label: "Current Node", category: "Position" },
  { kind: "triggerNode", label: "Trigger Node", category: "Position" },
  { kind: "hasPerk", label: "Has Perk", category: "Player" },
  { kind: "hasAntiPerk", label: "Has Anti-Perk", category: "Player" },
  { kind: "playerMoney", label: "Player Money", category: "Player" },
  { kind: "playerScore", label: "Player Score", category: "Player" },
  { kind: "shieldRounds", label: "Shield Rounds", category: "Player" },
  { kind: "restRemainingMs", label: "Rest Remaining", category: "Timer" },
  { kind: "restState", label: "Rest State", category: "Timer" },
  { kind: "roundState", label: "Round State", category: "Round" },
  { kind: "musicState", label: "Music State", category: "Media" },
  { kind: "currentTrack", label: "Current Track", category: "Media" },
  { kind: "background", label: "Background", category: "Visual" },
  { kind: "ruleCooldown", label: "Rule Cooldown", category: "Rule" },
] as const;

export type ConditionKind = (typeof AUTOMATION_CONDITION_DESCRIPTORS)[number]["kind"];

export const CONDITION_FIELDS: Record<ConditionKind, FieldDescriptor[]> = {
  currentNode: [
    {
      type: "select",
      name: "comparator",
      label: "Comparator",
      options: [
        { value: "is", label: "Is" },
        { value: "isNot", label: "Is Not" },
      ],
    },
    { type: "nodeRef", name: "nodeId", label: "Node" },
  ],
  triggerNode: [
    {
      type: "select",
      name: "comparator",
      label: "Comparator",
      options: [
        { value: "is", label: "Is" },
        { value: "isNot", label: "Is Not" },
      ],
    },
    { type: "nodeRef", name: "nodeId", label: "Node" },
  ],
  hasPerk: [{ type: "perkRef", name: "perkId", label: "Perk", perkKind: "perk" }],
  hasAntiPerk: [{ type: "perkRef", name: "perkId", label: "Anti-Perk", perkKind: "antiPerk" }],
  playerMoney: [
    {
      type: "select",
      name: "comparator",
      label: "Comparator",
      options: [
        { value: "eq", label: "=" },
        { value: "ne", label: "!=" },
        { value: "gt", label: ">" },
        { value: "gte", label: ">=" },
        { value: "lt", label: "<" },
        { value: "lte", label: "<=" },
      ],
    },
    { type: "number", name: "value", label: "Value" },
  ],
  playerScore: [
    {
      type: "select",
      name: "comparator",
      label: "Comparator",
      options: [
        { value: "eq", label: "=" },
        { value: "ne", label: "!=" },
        { value: "gt", label: ">" },
        { value: "gte", label: ">=" },
        { value: "lt", label: "<" },
        { value: "lte", label: "<=" },
      ],
    },
    { type: "number", name: "value", label: "Value" },
  ],
  shieldRounds: [
    {
      type: "select",
      name: "comparator",
      label: "Comparator",
      options: [
        { value: "eq", label: "=" },
        { value: "ne", label: "!=" },
        { value: "gt", label: ">" },
        { value: "gte", label: ">=" },
        { value: "lt", label: "<" },
        { value: "lte", label: "<=" },
      ],
    },
    { type: "number", name: "value", label: "Value" },
  ],
  restRemainingMs: [
    {
      type: "select",
      name: "comparator",
      label: "Comparator",
      options: [
        { value: "eq", label: "=" },
        { value: "ne", label: "!=" },
        { value: "gt", label: ">" },
        { value: "gte", label: ">=" },
        { value: "lt", label: "<" },
        { value: "lte", label: "<=" },
      ],
    },
    { type: "number", name: "value", label: "Value (ms)" },
  ],
  restState: [
    {
      type: "select",
      name: "state",
      label: "State",
      options: [
        { value: "running", label: "Running" },
        { value: "paused", label: "Paused" },
      ],
    },
  ],
  roundState: [
    {
      type: "select",
      name: "state",
      label: "State",
      options: [
        { value: "active", label: "Active" },
        { value: "queued", label: "Queued" },
        { value: "none", label: "None" },
      ],
    },
  ],
  musicState: [
    {
      type: "select",
      name: "state",
      label: "State",
      options: [
        { value: "playing", label: "Playing" },
        { value: "paused", label: "Paused" },
        { value: "stopped", label: "Stopped" },
      ],
    },
  ],
  currentTrack: [
    {
      type: "select",
      name: "comparator",
      label: "Comparator",
      options: [
        { value: "is", label: "Is" },
        { value: "isNot", label: "Is Not" },
      ],
    },
    { type: "trackRef", name: "trackId", label: "Track" },
  ],
  background: [
    {
      type: "select",
      name: "comparator",
      label: "Comparator",
      options: [
        { value: "isSet", label: "Is Set" },
        { value: "isNotSet", label: "Is Not Set" },
      ],
    },
  ],
  ruleCooldown: [
    {
      type: "select",
      name: "state",
      label: "State",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    },
    { type: "ruleRef", name: "ruleId", label: "Rule", optional: true },
  ],
};

export const AUTOMATION_ACTION_DESCRIPTORS = [
  { kind: "timer.pauseRest", label: "Pause Rest Timer", category: "Gameplay" },
  { kind: "timer.resumeRest", label: "Resume Rest Timer", category: "Gameplay" },
  { kind: "timer.setRestRemainingMs", label: "Set Rest Remaining", category: "Gameplay" },
  { kind: "player.grantPauseCharge", label: "Grant Pause Charge", category: "Player" },
  { kind: "player.grantSkipCharge", label: "Grant Skip Charge", category: "Player" },
  { kind: "player.adjustMoney", label: "Adjust Money", category: "Player" },
  { kind: "player.adjustScore", label: "Adjust Score", category: "Player" },
  { kind: "player.applyPerk", label: "Apply Perk", category: "Player" },
  { kind: "player.removePerk", label: "Remove Perk", category: "Player" },
  { kind: "player.applyAntiPerk", label: "Apply Anti-Perk", category: "Player" },
  { kind: "player.removeAntiPerk", label: "Remove Anti-Perk", category: "Player" },
  { kind: "music.playTrack", label: "Play Track", category: "Media" },
  { kind: "music.pause", label: "Pause Music", category: "Media" },
  { kind: "music.resume", label: "Resume Music", category: "Media" },
  { kind: "music.stop", label: "Stop Music", category: "Media" },
  { kind: "music.nextTrack", label: "Next Track", category: "Media" },
  { kind: "music.setPlaylistLoop", label: "Set Playlist Loop", category: "Media" },
  { kind: "background.setPreset", label: "Set Background", category: "Visual" },
  { kind: "background.clearOverride", label: "Clear Background Override", category: "Visual" },
  { kind: "ui.showToast", label: "Show Toast", category: "Visual" },
  { kind: "graph.addNode", label: "Add Node", category: "Graph" },
  { kind: "graph.removeNode", label: "Remove Node", category: "Graph" },
  { kind: "graph.patchNode", label: "Patch Node", category: "Graph" },
  { kind: "graph.addEdge", label: "Add Edge", category: "Graph" },
  { kind: "graph.removeEdge", label: "Remove Edge", category: "Graph" },
  { kind: "graph.patchEdge", label: "Patch Edge", category: "Graph" },
  { kind: "graph.setStartNode", label: "Set Start Node", category: "Graph" },
  { kind: "rule.enable", label: "Enable Rule", category: "Rule" },
  { kind: "rule.disable", label: "Disable Rule", category: "Rule" },
  { kind: "rule.setCooldownMs", label: "Set Rule Cooldown", category: "Rule" },
] as const;

export type ActionKind = (typeof AUTOMATION_ACTION_DESCRIPTORS)[number]["kind"];

export const ACTION_FIELDS: Record<ActionKind, FieldDescriptor[]> = {
  "timer.pauseRest": [],
  "timer.resumeRest": [],
  "timer.setRestRemainingMs": [
    { type: "number", name: "remainingMs", label: "Remaining (ms)", min: 0, step: 1000 },
  ],
  "player.grantPauseCharge": [{ type: "number", name: "amount", label: "Amount", min: 1, step: 1 }],
  "player.grantSkipCharge": [{ type: "number", name: "amount", label: "Amount", min: 1, step: 1 }],
  "player.adjustMoney": [{ type: "number", name: "amount", label: "Amount", step: 10 }],
  "player.adjustScore": [{ type: "number", name: "amount", label: "Amount", step: 10 }],
  "player.applyPerk": [{ type: "perkRef", name: "perkId", label: "Perk", perkKind: "perk" }],
  "player.removePerk": [{ type: "perkRef", name: "perkId", label: "Perk", perkKind: "perk" }],
  "player.applyAntiPerk": [
    { type: "perkRef", name: "perkId", label: "Anti-Perk", perkKind: "antiPerk" },
  ],
  "player.removeAntiPerk": [
    { type: "perkRef", name: "perkId", label: "Anti-Perk", perkKind: "antiPerk" },
  ],
  "music.playTrack": [{ type: "trackRef", name: "trackId", label: "Track" }],
  "music.pause": [],
  "music.resume": [],
  "music.stop": [],
  "music.nextTrack": [],
  "music.setPlaylistLoop": [{ type: "toggle", name: "loop", label: "Loop" }],
  "background.setPreset": [
    { type: "number", name: "opacity", label: "Opacity", min: 0, max: 1, step: 0.05 },
    { type: "number", name: "blur", label: "Blur", min: 0, max: 24, step: 1 },
    { type: "number", name: "dim", label: "Dim", min: 0, max: 1, step: 0.05 },
    {
      type: "select",
      name: "fit",
      label: "Fit",
      options: [
        { value: "cover", label: "Cover" },
        { value: "contain", label: "Contain" },
        { value: "stretch", label: "Stretch" },
        { value: "tile", label: "Tile" },
      ],
    },
    {
      type: "select",
      name: "position",
      label: "Position",
      options: [
        { value: "center", label: "Center" },
        { value: "top", label: "Top" },
        { value: "bottom", label: "Bottom" },
        { value: "left", label: "Left" },
        { value: "right", label: "Right" },
      ],
    },
    { type: "number", name: "scale", label: "Scale", min: 0.25, max: 4, step: 0.25 },
    { type: "number", name: "offsetX", label: "Offset X", step: 1 },
    { type: "number", name: "offsetY", label: "Offset Y", step: 1 },
    {
      type: "select",
      name: "motion",
      label: "Motion",
      options: [
        { value: "fixed", label: "Fixed" },
        { value: "parallax", label: "Parallax" },
      ],
    },
    {
      type: "number",
      name: "parallaxStrength",
      label: "Parallax Strength",
      min: 0,
      max: 1,
      step: 0.05,
    },
  ],
  "background.clearOverride": [],
  "ui.showToast": [
    { type: "text", name: "message", label: "Message" },
    {
      type: "select",
      name: "variant",
      label: "Variant",
      options: [
        { value: "info", label: "Info" },
        { value: "success", label: "Success" },
        { value: "error", label: "Error" },
      ],
    },
  ],
  "graph.addNode": [
    { type: "text", name: "node.id", label: "Node ID" },
    { type: "text", name: "node.name", label: "Name" },
    {
      type: "select",
      name: "node.kind",
      label: "Kind",
      options: [
        { value: "start", label: "Start" },
        { value: "end", label: "End" },
        { value: "path", label: "Path" },
        { value: "safePoint", label: "Safe Point" },
        { value: "campfire", label: "Campfire" },
        { value: "round", label: "Round" },
        { value: "randomRound", label: "Random Round" },
        { value: "perk", label: "Perk" },
        { value: "event", label: "Event" },
        { value: "catapult", label: "Catapult" },
      ],
    },
    { type: "toggle", name: "node.forceStop", label: "Force Stop" },
    { type: "toggle", name: "node.skippable", label: "Skippable" },
    { type: "text", name: "node.visualId", label: "Visual ID" },
    {
      type: "number",
      name: "node.checkpointRestMs",
      label: "Checkpoint Rest (ms)",
      min: 0,
      step: 1000,
    },
    { type: "number", name: "node.pauseBonusMs", label: "Pause Bonus (ms)", min: 0, step: 1000 },
    { type: "number", name: "node.catapultForward", label: "Catapult Forward", min: 1, step: 1 },
    { type: "toggle", name: "node.hiddenFromMap", label: "Hidden from Map" },
    { type: "toggle", name: "node.autoAdvanceAfterCompletion", label: "Auto-advance" },
  ],
  "graph.removeNode": [
    { type: "nodeRef", name: "nodeId", label: "Node" },
    { type: "nodeRef", name: "fallbackNodeId", label: "Fallback Node" },
  ],
  "graph.patchNode": [
    { type: "nodeRef", name: "nodeId", label: "Node" },
    { type: "text", name: "patch.name", label: "Name" },
    {
      type: "select",
      name: "patch.kind",
      label: "Kind",
      options: [
        { value: "start", label: "Start" },
        { value: "end", label: "End" },
        { value: "path", label: "Path" },
        { value: "safePoint", label: "Safe Point" },
        { value: "campfire", label: "Campfire" },
        { value: "round", label: "Round" },
        { value: "randomRound", label: "Random Round" },
        { value: "perk", label: "Perk" },
        { value: "event", label: "Event" },
        { value: "catapult", label: "Catapult" },
      ],
    },
    { type: "toggle", name: "patch.forceStop", label: "Force Stop" },
    { type: "toggle", name: "patch.skippable", label: "Skippable" },
    { type: "text", name: "patch.visualId", label: "Visual ID" },
    {
      type: "number",
      name: "patch.checkpointRestMs",
      label: "Checkpoint Rest (ms)",
      min: 0,
      step: 1000,
    },
    { type: "number", name: "patch.pauseBonusMs", label: "Pause Bonus (ms)", min: 0, step: 1000 },
    { type: "number", name: "patch.catapultForward", label: "Catapult Forward", min: 1, step: 1 },
    { type: "toggle", name: "patch.hiddenFromMap", label: "Hidden from Map" },
    { type: "toggle", name: "patch.autoAdvanceAfterCompletion", label: "Auto-advance" },
  ],
  "graph.addEdge": [
    { type: "text", name: "edge.id", label: "Edge ID" },
    { type: "nodeRef", name: "edge.fromNodeId", label: "From Node" },
    { type: "nodeRef", name: "edge.toNodeId", label: "To Node" },
    { type: "number", name: "edge.gateCost", label: "Gate Cost", min: 0, step: 1 },
    { type: "number", name: "edge.weight", label: "Weight", min: 1, step: 1 },
    { type: "text", name: "edge.label", label: "Label" },
  ],
  "graph.removeEdge": [{ type: "edgeRef", name: "edgeId", label: "Edge" }],
  "graph.patchEdge": [
    { type: "edgeRef", name: "edgeId", label: "Edge" },
    { type: "nodeRef", name: "patch.fromNodeId", label: "From Node" },
    { type: "nodeRef", name: "patch.toNodeId", label: "To Node" },
    { type: "number", name: "patch.gateCost", label: "Gate Cost", min: 0, step: 1 },
    { type: "number", name: "patch.weight", label: "Weight", min: 1, step: 1 },
    { type: "text", name: "patch.label", label: "Label" },
  ],
  "graph.setStartNode": [{ type: "nodeRef", name: "nodeId", label: "Node" }],
  "rule.enable": [{ type: "ruleRef", name: "ruleId", label: "Rule" }],
  "rule.disable": [{ type: "ruleRef", name: "ruleId", label: "Rule" }],
  "rule.setCooldownMs": [
    { type: "ruleRef", name: "ruleId", label: "Rule" },
    { type: "number", name: "cooldownMs", label: "Cooldown (ms)", min: 0, step: 1000 },
  ],
};

export const FIELD_PATH_SEPARATOR = ".";

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(FIELD_PATH_SEPARATOR);
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const parts = path.split(FIELD_PATH_SEPARATOR);
  if (parts.length === 1) {
    return { ...obj, [path]: value };
  }
  const [head, ...rest] = parts;
  const child = (obj[head] as Record<string, unknown> | undefined) ?? {};
  return {
    ...obj,
    [head]: setNestedValue(
      typeof child === "object" && child !== null ? (child as Record<string, unknown>) : {},
      rest.join(FIELD_PATH_SEPARATOR),
      value
    ),
  };
}
