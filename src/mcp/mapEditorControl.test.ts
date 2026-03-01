// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createElement, useEffect, useRef, useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ZLiveMapConfig } from "./mapEditorSchema";
import {
  controlMapEditor,
  patchMapConfig,
  registerMapEditor,
  type LiveMapEditor,
} from "./mapEditorControl";
import { createUiControl } from "./uiControl";
import { UndoManager } from "../features/map-editor/UndoManager";
import type { EditorGraphConfig } from "../features/map-editor/EditorState";

const fixture = () =>
  ZLiveMapConfig.parse({
    mode: "graph",
    startNodeId: "start",
    nodes: [
      { id: "start", name: "Start", kind: "start" },
      { id: "end", name: "End", kind: "end" },
    ],
    edges: [{ id: "edge", fromNodeId: "start", toNodeId: "end" }],
    perkSelection: {},
    perkPool: {},
    intermediarySelection: {},
    probabilityScaling: {},
    resetIntermediaryProbabilityAfterTrigger: false,
    resetAntiPerkProbabilityAfterTrigger: false,
    economy: {},
    style: {},
    music: {},
  }) as EditorGraphConfig;

afterEach(cleanup);

it("reads the live React selection and edits the visible draft through UI IPC with Undo/Redo", async () => {
  function Editor() {
    const [config, setConfig] = useState(fixture);
    const configRef = useRef(config);
    configRef.current = config;
    const history = useRef(new UndoManager(config));
    const api = useRef<LiveMapEditor>(null!);
    api.current = {
      read: () => ({
        playlistId: "p",
        config: configRef.current,
        selection: { primaryNodeId: "end" },
        viewport: { x: 20, y: 40, zoom: 1.5 },
      }),
      busy: () => false,
      apply: (next) => {
        configRef.current = next;
        history.current.push(next);
        setConfig(next);
      },
      undo: () => {
        const next = history.current.undo()!;
        configRef.current = next;
        setConfig(next);
      },
      redo: () => {
        const next = history.current.redo()!;
        configRef.current = next;
        setConfig(next);
      },
      saveDraft: async () => true,
      publish: async () => ({ published: true }),
    };
    useEffect(() => registerMapEditor(() => api.current), []);
    return createElement("div", {}, config.nodes[1].name);
  }
  render(createElement(Editor));
  const ui = createUiControl(vi.fn());
  const before = await controlMapEditor({ operation: "inspect" });
  expect(before.selection).toEqual({ primaryNodeId: "end" });
  expect(before.viewport).toEqual({ x: 20, y: 40, zoom: 1.5 });
  await act(async () => {
    await ui({
      action: "mapEditor",
      editor: {
        operation: "patch",
        expectedRevision: before.revision,
        patches: [{ op: "set", path: ["nodes", 1, "name"], value: "Agent edit" }],
      },
    });
  });
  expect(screen.getByText("Agent edit")).toBeTruthy();
  await act(async () => {
    const state = await controlMapEditor({ operation: "inspect" });
    await controlMapEditor({ operation: "undo", expectedRevision: state.revision });
  });
  expect(screen.getByText("End")).toBeTruthy();
  await act(async () => {
    const state = await controlMapEditor({ operation: "inspect" });
    await controlMapEditor({ operation: "redo", expectedRevision: state.revision });
  });
  expect(screen.getByText("Agent edit")).toBeTruthy();
});

it("rejects stale human edits, selection changes, busy editor operations and closed editors", async () => {
  let config = fixture();
  let selected = "start";
  const apply = vi.fn();
  const editor = {
    read: () => ({ playlistId: "p", config, selected }),
    busy: () => false,
    apply,
    undo: vi.fn(),
    redo: vi.fn(),
    saveDraft: async () => true,
    publish: vi.fn(),
  };
  const stop = registerMapEditor(() => editor);
  try {
    const before = await controlMapEditor({ operation: "inspect" });
    config = { ...config, nodes: config.nodes.map((n) => ({ ...n, name: "Human edit" })) };
    await expect(
      controlMapEditor({ operation: "undo", expectedRevision: before.revision })
    ).rejects.toThrow("changed");
    const next = await controlMapEditor({ operation: "inspect" });
    selected = "end";
    await expect(
      controlMapEditor({ operation: "redo", expectedRevision: next.revision })
    ).rejects.toThrow("changed");
    const latest = await controlMapEditor({ operation: "inspect" });
    editor.busy = () => true;
    await expect(
      controlMapEditor({ operation: "undo", expectedRevision: latest.revision })
    ).rejects.toThrow("busy");
    expect(apply).not.toHaveBeenCalled();
  } finally {
    stop();
  }
  await expect(controlMapEditor({ operation: "inspect" })).rejects.toThrow(
    "Open the advanced map editor"
  );
});

it("applies graph edits atomically, preserves other fields and rejects invalid data/paths", () => {
  const config = fixture();
  const next = patchMapConfig(config, [
    { op: "set", path: ["nodes", 2], value: { id: "new", name: "New", kind: "path" } },
    { op: "remove", path: ["edges", 0] },
    { op: "set", path: ["nodes", 2, "styleHint"], value: { x: 120, y: 240 } },
  ]);
  expect(next.nodes).toHaveLength(3);
  expect(next.edges).toEqual([]);
  expect(next.music).toEqual(config.music);
  expect(config.nodes).toHaveLength(2);
  expect(config.edges).toHaveLength(1);
  for (const path of [
    ["__proto__", "polluted"],
    ["nodes", 100],
    ["nodes", "length"],
    ["missing", "name"],
  ]) {
    expect(() => patchMapConfig(config, [{ op: "set", path, value: "invalid" }])).toThrow();
  }
  expect(() =>
    patchMapConfig(config, [
      { op: "set", path: ["nodes", 0, "name"], value: "Uncommitted" },
      { op: "set", path: ["dice", "min"], value: 100 },
    ])
  ).toThrow();
  expect(config.nodes[0].name).toBe("Start");
  expect(() => patchMapConfig(config, [{ op: "remove", path: ["music"] }])).toThrow();
});

it("saves drafts separately from publishing and propagates failures", async () => {
  const saveDraft = vi.fn(async () => true);
  const publish = vi.fn(async () => ({ published: true }));
  const stop = registerMapEditor(() => ({
    read: () => ({ playlistId: "p", config: fixture() }),
    busy: () => false,
    apply: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    saveDraft,
    publish,
  }));
  try {
    const state = await controlMapEditor({ operation: "inspect" });
    const saved = await controlMapEditor({
      operation: "saveDraft",
      expectedRevision: state.revision,
    });
    expect(saved.result).toEqual({ draftSaved: true });
    expect(publish).not.toHaveBeenCalled();
    const published = await controlMapEditor({
      operation: "publish",
      expectedRevision: saved.revision,
    });
    expect(published.result).toEqual({ published: true });
    saveDraft.mockResolvedValue(false);
    await expect(
      controlMapEditor({ operation: "saveDraft", expectedRevision: published.revision })
    ).rejects.toThrow("saving failed");
  } finally {
    stop();
  }
});
