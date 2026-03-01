import fs from "node:fs";
import path from "node:path";
import type { Server as HttpServer } from "node:http";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpStatus } from "../../src/mcp/types";
import { listenMcp } from "./http";

export class McpRuntime {
  private http: HttpServer | null = null;
  private enabled = true;
  private port = 32123;
  private error: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private configPath: string,
    private createServer: () => Server
  ) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      this.enabled = config.enabled === true;
      if (Number.isInteger(config.port) && config.port > 0 && config.port <= 65535)
        this.port = config.port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.error = "Invalid MCP configuration. Save settings to repair it.";
    }
  }

  status(): McpStatus {
    return {
      enabled: this.enabled,
      running: this.http !== null,
      port: this.port,
      url: `http://127.0.0.1:${this.port}/mcp`,
      error: this.error,
    };
  }

  configure(input: { enabled: boolean; port: number }): Promise<McpStatus> {
    const task = this.queue.then(async () => {
      if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
        throw new Error("Port must be between 1 and 65535.");
      await this.stop();
      this.enabled = input.enabled;
      this.port = input.port;
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      const temporaryPath = `${this.configPath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify({ enabled: this.enabled, port: this.port }), {
        mode: 0o600,
      });
      fs.renameSync(temporaryPath, this.configPath);
      await this.start();
      return this.status();
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async start(): Promise<void> {
    if (!this.enabled || this.http) return;
    this.error = null;
    try {
      this.http = await listenMcp({
        port: this.port,
        createServer: this.createServer,
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  async stop(): Promise<void> {
    const http = this.http;
    this.http = null;
    if (!http) return;
    await new Promise<void>((resolve) => {
      http.close(() => resolve());
      http.closeAllConnections();
    });
  }
}
