import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MultiFunPlayerSettingsCard } from "./MultiFunPlayerSettingsCard";

const api = vi.hoisted(() => ({
  status: { query: vi.fn() },
  configure: { mutate: vi.fn() },
}));
vi.mock("../services/trpc", () => ({ trpc: { multifunplayer: api } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("enables the bridge on the chosen port and displays connected clients", async () => {
  api.status.query.mockResolvedValue({ running: false, port: 8080, clients: 0, error: null });
  api.configure.mutate.mockResolvedValue({ running: true, port: 9000, clients: 1, error: null });
  render(<MultiFunPlayerSettingsCard />);
  await waitFor(() =>
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false)
  );
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "9000" } });
  fireEvent.click(screen.getByRole("button", { name: "Enable bridge" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Connected players: 1")
  );
  expect(api.configure.mutate).toHaveBeenCalledWith({ enabled: true, port: 9000 });
  expect(screen.getByText("ws://127.0.0.1:9000/ofs")).toBeTruthy();
});

it("shows startup failures without marking the bridge running", async () => {
  api.status.query.mockResolvedValue({ running: false, port: 8080, clients: 0, error: null });
  api.configure.mutate.mockRejectedValue(new Error("Port already in use"));
  render(<MultiFunPlayerSettingsCard />);
  await waitFor(() =>
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false)
  );
  fireEvent.click(screen.getByRole("button", { name: "Enable bridge" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Port already in use"));
  expect(screen.getByRole("status").textContent).toBe("Bridge stopped");
});
