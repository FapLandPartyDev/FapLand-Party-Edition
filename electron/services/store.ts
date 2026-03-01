import Store from "electron-store";

let store: Store | null = null;

function createStore(): Store {
    try {
        return new Store();
    } catch {
        // Node test environments may not expose electron app metadata required by electron-store defaults.
        return new Store({ cwd: process.cwd(), name: "f-land" });
    }
}

export function getStore() {
    if (!store) {
        store = createStore();
    }
    return store;
}
