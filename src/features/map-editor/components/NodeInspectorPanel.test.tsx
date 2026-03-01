import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NodeInspectorPanel } from "./NodeInspectorPanel";
import type { EditorNode } from "../EditorState";

function renderRandomRoundInspector(initialNode?: Partial<EditorNode>) {
  let currentNode: EditorNode = {
    id: "random-round-1",
    name: "Random Round",
    kind: "randomRound",
    selectionMode: "installed",
    ...initialNode,
  };

  const viewRef: { current?: ReturnType<typeof render> } = {};

  function patchNode(_: string, patch: Partial<EditorNode>) {
    currentNode = { ...currentNode, ...patch };
    viewRef.current?.rerender(renderPanel());
  }

  const renderPanel = () => (
    <NodeInspectorPanel
      selectedNode={currentNode}
      outgoingEdges={[]}
      installedRounds={[]}
      randomPoolIds={[]}
      perkOptions={[]}
      antiPerkOptions={[]}
      customPalettes={[]}
      onPatchNode={patchNode}
      onCommitSelection={() => undefined}
      onSetTool={() => undefined}
      onSetConnectFrom={() => undefined}
      onCreateAutomationForNode={() => undefined}
    />
  );

  const view = render(renderPanel());
  viewRef.current = view;

  return {
    ...view,
    getCurrentNode: () => currentNode,
  };
}

function renderSafePointInspector() {
  let currentNode: EditorNode = {
    id: "safe-point-1",
    name: "Safe Point",
    kind: "safePoint",
  };
  const viewRef: { current?: ReturnType<typeof render> } = {};
  const renderPanel = () => (
    <NodeInspectorPanel
      selectedNode={currentNode}
      outgoingEdges={[]}
      installedRounds={[]}
      randomPoolIds={[]}
      perkOptions={[]}
      antiPerkOptions={[]}
      customPalettes={[]}
      saveMode="checkpoint"
      onPatchNode={(_, patch) => {
        currentNode = { ...currentNode, ...patch };
        viewRef.current?.rerender(renderPanel());
      }}
      onCommitSelection={() => undefined}
      onSetTool={() => undefined}
      onSetConnectFrom={() => undefined}
      onCreateAutomationForNode={() => undefined}
    />
  );
  const view = render(renderPanel());
  viewRef.current = view;
  return { ...view, getCurrentNode: () => currentNode };
}

describe("NodeInspectorPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps spaces and commas visible while editing random round filters", () => {
    const { getCurrentNode } = renderRandomRoundInspector();

    const tagsInput = screen.getByPlaceholderText("tag-one, tag-two") as HTMLInputElement;
    tagsInput.focus();
    fireEvent.change(tagsInput, { target: { value: "tag-one, " } });
    expect(tagsInput.value).toBe("tag-one, ");
    expect(getCurrentNode().filter?.tags).toEqual(["tag-one"]);

    fireEvent.change(tagsInput, { target: { value: "tag-one, tag two" } });
    expect(tagsInput.value).toBe("tag-one, tag two");
    expect(getCurrentNode().filter?.tags).toEqual(["tag-one", "tag two"]);

    fireEvent.blur(tagsInput);
    expect(tagsInput.value).toBe("tag-one, tag two");
  });

  it("applies the same editable CSV behavior to author and library filters", () => {
    const { getCurrentNode } = renderRandomRoundInspector();

    const authorInput = screen.getByPlaceholderText("author-one, author-two") as HTMLInputElement;
    authorInput.focus();
    fireEvent.change(authorInput, { target: { value: "author one, author two" } });
    expect(authorInput.value).toBe("author one, author two");
    expect(getCurrentNode().filter?.authorNames).toEqual(["author one", "author two"]);

    const libraryInput = screen.getByPlaceholderText("library-one, library-two") as HTMLInputElement;
    libraryInput.focus();
    fireEvent.change(libraryInput, { target: { value: "library one, library two" } });
    expect(libraryInput.value).toBe("library one, library two");
    expect(getCurrentNode().filter?.libraryLabels).toEqual(["library one", "library two"]);
  });

  it("allows a Cum Point without adding a Cum Round to the pool", () => {
    const { getCurrentNode } = renderSafePointInspector();
    const checkbox = screen.getByRole("checkbox");

    expect((checkbox as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(checkbox);
    expect(getCurrentNode().cumPoint).toBe(true);
  });
});
