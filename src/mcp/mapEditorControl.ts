import { ZLiveMapConfig, ZMapEditorRequest, type MapEditorRequest } from "./mapEditorSchema";
import type { EditorGraphConfig } from "../features/map-editor/EditorState";

type EditorState = { playlistId: string | null; config: EditorGraphConfig; [key: string]: unknown };
export type LiveMapEditor = {
  read: () => EditorState;
  busy: () => boolean;
  apply: (config: EditorGraphConfig) => void;
  undo: () => void;
  redo: () => void;
  saveDraft: () => Promise<boolean>;
  publish: () => Promise<unknown>;
};

let current: (() => LiveMapEditor) | null = null;
let revision = 0;
let signature: string | undefined;
let busy = false;
export function registerMapEditor(getEditor: () => LiveMapEditor) {
  current = getEditor;
  signature = undefined;
  return () => {
    if (current === getEditor) {
      current = null;
      signature = undefined;
    }
  };
}

function observe(editor: LiveMapEditor) {
  const state = editor.read();
  // Include selection and viewport: deictic requests such as "this tile" must stay current.
  const next = JSON.stringify(state);
  if (signature !== next) {
    signature = next;
    revision++;
  }
  return { ...state, revision: String(revision) };
}

export function mapEditorAvailable() {
  return current !== null;
}

export function patchMapConfig(
  config: EditorGraphConfig,
  patches: NonNullable<MapEditorRequest["patches"]>
) {
  const next = structuredClone(config);
  for (const patch of patches) {
    if (patch.path.some((key) => ["__proto__", "prototype", "constructor"].includes(String(key))))
      throw new Error("Invalid patch path.");
    let parent: unknown = next;
    const keys = patch.path;
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (!parent || typeof parent !== "object") throw new Error("Patch path does not exist.");
      const object = parent as Record<string | number, unknown>;
      if (Array.isArray(parent) && (typeof key !== "number" || key > parent.length))
        throw new Error("Array paths require an in-range numeric index.");
      if (index < keys.length - 1) {
        if (!Object.hasOwn(object, key)) throw new Error("Patch path does not exist.");
        parent = object[key];
      } else if (patch.op === "remove") {
        if (!Object.hasOwn(object, key)) throw new Error("Patch path does not exist.");
        if (Array.isArray(parent)) parent.splice(key as number, 1);
        else delete object[key];
      } else {
        if (!Object.hasOwn(patch, "value")) throw new Error("Set requires a value.");
        object[key] = structuredClone(patch.value);
      }
    }
  }
  return ZLiveMapConfig.parse(next) as EditorGraphConfig;
}

export async function controlMapEditor(
  raw: MapEditorRequest
): Promise<EditorState & { revision: string; result?: unknown }> {
  const input = ZMapEditorRequest.parse(raw);
  if (!current)
    throw new Error("Open the advanced map editor first using fland_ui navigate /map-editor.");
  const editor = current();
  const before = observe(editor);
  if (input.operation === "inspect") return before;
  if (!input.expectedRevision || input.expectedRevision !== before.revision)
    throw new Error("The live editor changed. Inspect it again and use the new expectedRevision.");
  if (busy || editor.busy())
    throw new Error("The editor is busy. Inspect again after the current operation finishes.");
  busy = true;
  try {
    let result: unknown;
    switch (input.operation) {
      case "patch":
        if (!input.patches)
          throw new Error("Provide patches relative to the config returned by inspect.");
        editor.apply(patchMapConfig(before.config, input.patches));
        break;
      case "undo":
        editor.undo();
        break;
      case "redo":
        editor.redo();
        break;
      case "saveDraft":
        if (!before.playlistId) throw new Error("Choose or create a playlist in the editor first.");
        if (!(await editor.saveDraft()))
          throw new Error("Draft saving failed. Inspect the visible editor for details.");
        result = { draftSaved: true };
        break;
      case "publish":
        result = await editor.publish();
        break;
    }
    // Read the latest React closure after a render; config refs also update synchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { ...observe(current ? current() : editor), result };
  } finally {
    busy = false;
  }
}
