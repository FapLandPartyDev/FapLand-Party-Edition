import { createFileRoute, Link } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import licenseManifestUrl from "../generated/licenses.generated.json?url";

export const Route = createFileRoute("/licenses")({
  component: LicensesPage,
});

type LicenseFile = {
  fileName: string;
  content: string;
};

type LicenseEntry = {
  id: string;
  name: string;
  version: string;
  license: string;
  repository: string | null;
  homepage: string | null;
  licenseFiles: LicenseFile[];
};

type LicenseManifest = {
  generatedAt: string;
  project: {
    name: string;
    version: string;
    license: string;
    repository: string | null;
    licenseText: string;
  };
  dependencies: LicenseEntry[];
};

function LicensesPage() {
  const [licenseManifest, setLicenseManifest] = useState<LicenseManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isProjectLicenseOpen, setIsProjectLicenseOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let cancelled = false;

    void fetch(licenseManifestUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load license manifest: ${response.status}`);
        }

        return (await response.json()) as LicenseManifest;
      })
      .then((manifest) => {
        if (cancelled) {
          return;
        }

        setLicenseManifest(manifest);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : "Failed to load license manifest.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredDependencies = useMemo(() => {
    if (!licenseManifest) {
      return [];
    }

    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return licenseManifest.dependencies;
    }

    return licenseManifest.dependencies.filter((dependency) => {
      return (
        dependency.name.toLowerCase().includes(normalizedQuery) ||
        dependency.version.toLowerCase().includes(normalizedQuery) ||
        dependency.license.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [deferredQuery, licenseManifest]);

  useEffect(() => {
    if (filteredDependencies.length === 0) {
      setSelectedId(null);
      return;
    }

    const hasSelectedDependency = filteredDependencies.some(
      (dependency) => dependency.id === selectedId
    );
    if (!hasSelectedDependency) {
      setSelectedId(filteredDependencies[0].id);
    }
  }, [filteredDependencies, selectedId]);

  const selectedDependency =
    filteredDependencies.find((dependency) => dependency.id === selectedId) ?? null;

  if (loadError) {
    return (
      <main className="fixed inset-0 overflow-hidden bg-white text-black">
        <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 px-4 py-6">
          <h1 className="text-3xl font-semibold">Licenses</h1>
          <p className="text-sm text-red-700">{loadError}</p>
          <Link className="underline" to="/settings">
            Back to settings
          </Link>
        </div>
      </main>
    );
  }

  if (!licenseManifest) {
    return (
      <main className="fixed inset-0 overflow-hidden bg-white text-black">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <h1 className="text-3xl font-semibold">Licenses</h1>
          <p className="mt-2 text-sm text-zinc-700">Loading license manifest...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-white text-black">
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Licenses</h1>
            <p className="text-sm text-zinc-700">
              {licenseManifest.dependencies.length} production dependencies
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="underline" to="/settings">
              Back to settings
            </Link>
            <Link className="underline" to="/">
              Main menu
            </Link>
          </div>
        </header>

        <section className="shrink-0 rounded border border-zinc-300">
          <button
            type="button"
            onClick={() => setIsProjectLicenseOpen((current) => !current)}
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-zinc-50"
          >
            <div>
              <h2 className="text-xl font-semibold">
                {licenseManifest.project.name} {licenseManifest.project.version}
              </h2>
              <p className="mt-1 text-sm">License: {licenseManifest.project.license}</p>
            </div>
            <span className="text-sm text-zinc-600">
              {isProjectLicenseOpen ? "Hide project license" : "Show project license"}
            </span>
          </button>
          {isProjectLicenseOpen ? (
            <div className="border-t border-zinc-300 p-4">
              {licenseManifest.project.repository ? (
                <p className="text-sm break-all">
                  Repository:{" "}
                  <a
                    className="underline"
                    href={licenseManifest.project.repository}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {licenseManifest.project.repository}
                  </a>
                </p>
              ) : null}
              {licenseManifest.project.licenseText ? (
                <pre className="mt-4 overflow-x-auto whitespace-pre-wrap border border-zinc-200 bg-zinc-50 p-3 text-xs">
                  {licenseManifest.project.licenseText}
                </pre>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="min-h-0 flex-1 rounded border border-zinc-300">
          <div className="border-b border-zinc-300 p-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium">Find a dependency</span>
              <input
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by package, version, or license"
                type="text"
                value={query}
              />
            </label>
            <p className="mt-2 text-sm text-zinc-600">
              Showing {filteredDependencies.length} of {licenseManifest.dependencies.length} packages
            </p>
          </div>

          <div
            className="grid h-[calc(100%-96px)] min-h-0 grid-cols-[clamp(12rem,32vw,19rem)_minmax(0,1fr)]"
          >
            <div className="min-h-0 border-r border-zinc-300 bg-zinc-50">
              <div className="h-full overflow-y-auto overscroll-contain">
                <div className="sticky top-0 z-10 border-b border-zinc-300 bg-zinc-100 px-4 py-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700">
                    Packages
                  </h2>
                </div>
                {filteredDependencies.length > 0 ? (
                  <div className="flex flex-col">
                    {filteredDependencies.map((dependency) => {
                      const isSelected = dependency.id === selectedDependency?.id;

                      return (
                        <button
                          key={dependency.id}
                          type="button"
                          onClick={() => setSelectedId(dependency.id)}
                          className={`block w-full border-b border-zinc-200 px-4 py-3 text-left transition hover:bg-white ${
                            isSelected
                              ? "border-l-4 border-l-black bg-white"
                              : "border-l-4 border-l-transparent bg-zinc-50"
                          }`}
                        >
                          <div className="text-sm font-semibold">{dependency.name}</div>
                          <div className="mt-1 text-xs text-zinc-600">{dependency.version}</div>
                          <div className="mt-1 text-xs text-zinc-500">{dependency.license}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 text-sm text-zinc-600">No dependencies match this search.</div>
                )}
              </div>
            </div>

            <div className="min-h-0 bg-white">
              <div className="h-full overflow-y-auto overscroll-contain p-4">
                {selectedDependency ? (
                  <section>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                      License Details
                    </p>
                    <h2 className="text-xl font-semibold">
                      {selectedDependency.name} {selectedDependency.version}
                    </h2>
                    <p className="mt-1 text-sm">License: {selectedDependency.license}</p>
                    {selectedDependency.repository ? (
                      <p className="mt-1 break-all text-sm">
                        Repository:{" "}
                        <a
                          className="underline"
                          href={selectedDependency.repository}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {selectedDependency.repository}
                        </a>
                      </p>
                    ) : selectedDependency.homepage ? (
                      <p className="mt-1 break-all text-sm">
                        Homepage:{" "}
                        <a
                          className="underline"
                          href={selectedDependency.homepage}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {selectedDependency.homepage}
                        </a>
                      </p>
                    ) : null}
                    {selectedDependency.licenseFiles.length > 0 ? (
                      selectedDependency.licenseFiles.map((licenseFile) => (
                        <div key={licenseFile.fileName} className="mt-4">
                          <h3 className="text-sm font-semibold">{licenseFile.fileName}</h3>
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap border border-zinc-200 bg-zinc-50 p-3 text-xs">
                            {licenseFile.content}
                          </pre>
                        </div>
                      ))
                    ) : (
                      <p className="mt-3 text-sm text-zinc-600">
                        No license file was found in this package directory. The SPDX identifier
                        above was read from the installed package metadata.
                      </p>
                    )}
                  </section>
                ) : (
                  <p className="text-sm text-zinc-600">Select a dependency to inspect its license.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
