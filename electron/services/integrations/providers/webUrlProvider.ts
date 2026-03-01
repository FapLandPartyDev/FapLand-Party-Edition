// Placeholder for a future website URL provider (e.g. youtube-dlp integration).
// Intentionally unimplemented in the Stash-only iteration.
export type WebUrlProviderStub = {
  kind: "webUrl";
  implemented: false;
};

export const webUrlProviderStub: WebUrlProviderStub = {
  kind: "webUrl",
  implemented: false,
};
