import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { access, chmod, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

type ManagedProcess = { child: ChildProcess; label: string };

/** Starts the private PostgreSQL socket and Inkway API owned by this app. */
export class LocalBackendManager {
  private readonly children: ManagedProcess[] = [];
  private stopping = false;
  private apiReady = false;
  private apiBinary = "";
  private apiEnv: NodeJS.ProcessEnv = {};
  private apiPort = 0;
  private apiRestartTimer: ReturnType<typeof setTimeout> | undefined;
  private apiRestartAttempt = 0;
  private pgctlPath = "";
  private pgDataPath = "";
  private pgSocketPath = "";
  private pgEnv: NodeJS.ProcessEnv = {};
  private serverPidFile = "";

  async start(): Promise<{ port: number; appToken: string }> {
    this.stopping = false;
    const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
    const postgresRoot = join(resources, "postgres", "18");
    const serverRoot = join(resources, "server");
    const data = join(app.getPath("userData"), "database");
    // PostgreSQL's Unix socket path limit is 103 bytes on macOS. Application
    // Support paths can exceed that, so keep the private socket directory in
    // the OS temp root while database files remain under Inkway userData.
    const profileHash = createHash("sha256").update(app.getPath("userData")).digest("hex").slice(0, 12);
    const sockets = join(tmpdir(), `inkway-pg-${profileHash}`);
    const runtimeDir = join(app.getPath("userData"), "runtime");
    this.serverPidFile = join(runtimeDir, "server.pid");
    const bin = join(postgresRoot, "bin");
    const postgres = join(bin, "postgres");
    const initdb = join(bin, "initdb");
    const pgctl = join(bin, "pg_ctl");
    const createdb = join(bin, "createdb");
    const psql = join(bin, "psql");
    const migration = join(serverRoot, "inkway-migrate");
    const server = join(serverRoot, "inkway-server");
    for (const executable of [postgres, initdb, pgctl, createdb, psql, migration, server]) {
      await access(executable).catch(() => {
        throw new Error(`Inkway local runtime is missing ${executable}`);
      });
    }
    await mkdir(data, { recursive: true, mode: 0o700 });
    await mkdir(sockets, { recursive: true, mode: 0o700 });
    await chmod(sockets, 0o700);
    this.pgSocketPath = sockets;
    await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    await terminatePreviousServer(this.serverPidFile, server);

    const pgEnv = {
      ...localProcessEnv(),
      DYLD_LIBRARY_PATH: [join(postgresRoot, "lib"), process.env.DYLD_LIBRARY_PATH]
        .filter(Boolean)
        .join(":"),
    };
    this.pgctlPath = pgctl;
    this.pgDataPath = data;
    this.pgEnv = pgEnv;
    if (!(await access(join(data, "PG_VERSION")).then(() => true, () => false))) {
      await this.run(initdb, ["-D", data, "--username=inkway", "--auth=trust", "--encoding=UTF8"], pgEnv, "database init");
    }

    const databaseUrl = `postgres://inkway@localhost:5432/inkway?host=${encodeURIComponent(sockets)}&sslmode=disable`;
    const serverPort = await allocateLoopbackPort();
    const token = `inkway_local_${randomBytes(32).toString("base64url")}`;
    try {
      const wasRunning = await this.run(pgctl, ["-D", data, "status"], pgEnv, "database status").then(() => true, () => false);
      if (wasRunning) await this.run(pgctl, ["-D", data, "-m", "fast", "-w", "stop"], pgEnv, "stale database shutdown");
      await this.run(pgctl, ["-D", data, "-l", join(data, "postgres.log"), "-o", `-k ${quoteArg(sockets)} -c listen_addresses='' -p 5432`, "-w", "start"], pgEnv, "database start");
      const databaseExists = execFileSync(psql, ["-h", sockets, "-p", "5432", "-U", "inkway", "-d", "postgres", "-tAc", "SELECT 1 FROM pg_database WHERE datname = 'inkway'"], { env: pgEnv, encoding: "utf8" }).trim() === "1";
      if (!databaseExists) await this.run(createdb, ["-h", sockets, "-p", "5432", "-U", "inkway", "inkway"], pgEnv, "application database creation");
      await this.run(migration, ["up"], { ...pgEnv, DATABASE_URL: databaseUrl }, "database migration");
      const apiEnv = {
        ...localProcessEnv(),
        DATABASE_URL: databaseUrl,
        PORT: String(serverPort),
        INKWAY_LOCAL_MODE: "true",
        INKWAY_BIND_ADDRESS: `127.0.0.1:${serverPort}`,
        INKWAY_LOCAL_APP_TOKEN: token,
        DISABLE_WORKSPACE_CREATION: "true",
        CORS_ALLOWED_ORIGINS: "null,file://,http://localhost:5173,http://localhost:5174",
        APP_ENV: "development",
      };
      this.apiBinary = server;
      this.apiEnv = apiEnv;
      this.apiPort = serverPort;
      const api = this.spawn(server, [], apiEnv, "Inkway API");
      if (api.pid) await writeFile(this.serverPidFile, String(api.pid), { mode: 0o600 });
      this.watchApiProcess(api);
      await waitForHealth(serverPort, api);
      if (api.exitCode !== null || api.signalCode !== null) {
        throw new Error("Inkway local server exited immediately after becoming ready");
      }
      this.apiReady = true;
      this.apiRestartAttempt = 0;
    } catch (error) {
      await this.stop();
      throw error;
    }
    return { port: serverPort, appToken: token };
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.apiReady = false;
    if (this.apiRestartTimer) clearTimeout(this.apiRestartTimer);
    this.apiRestartTimer = undefined;
    for (const { child } of this.children.splice(0).reverse()) {
      if (child.exitCode !== null || child.killed) continue;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    if (this.pgctlPath && this.pgDataPath) {
      await this.run(this.pgctlPath, ["-D", this.pgDataPath, "-m", "fast", "-w", "stop"], this.pgEnv, "database shutdown").catch(() => undefined);
      this.children.splice(0);
    }
    if (this.pgSocketPath) await rm(this.pgSocketPath, { recursive: true, force: true }).catch(() => undefined);
    if (this.serverPidFile) await unlink(this.serverPidFile).catch(() => undefined);
  }

  private spawn(binary: string, args: string[], env: NodeJS.ProcessEnv, label: string): ChildProcess {
    const child = spawn(binary, args, { env, stdio: "ignore" });
    this.children.push({ child, label });
    child.once("error", (error) => console.error(`[local-runtime] ${label} failed`, error.message));
    return child;
  }

  private watchApiProcess(child: ChildProcess): void {
    child.once("exit", (code, signal) => {
      if (this.stopping || !this.apiReady) return;
      console.error(`[local-runtime] Inkway API exited (${code ?? signal ?? "unknown"}); restarting locally`);
      this.scheduleApiRestart();
    });
    child.once("error", (error) => {
      if (this.stopping || !this.apiReady) return;
      console.error("[local-runtime] Inkway API process error; restarting locally", error.message);
      this.scheduleApiRestart();
    });
  }

  private scheduleApiRestart(): void {
    if (this.stopping || this.apiRestartTimer || !this.apiBinary || !this.apiPort) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.apiRestartAttempt, 6));
    this.apiRestartAttempt += 1;
    this.apiRestartTimer = setTimeout(() => {
      this.apiRestartTimer = undefined;
      if (this.stopping) return;
      const child = this.spawn(this.apiBinary, [], this.apiEnv, "Inkway API restart");
      this.watchApiProcess(child);
      if (child.pid && this.serverPidFile) {
        void writeFile(this.serverPidFile, String(child.pid), { mode: 0o600 }).catch((error) => {
          console.error("[local-runtime] could not refresh API pid file", error);
        });
      }
      void waitForHealth(this.apiPort, child).then(() => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error("Inkway local server exited immediately after becoming ready");
        }
        this.apiRestartAttempt = 0;
        console.log("[local-runtime] Inkway API restarted");
      }).catch((error) => {
        console.error("[local-runtime] Inkway API restart failed", error);
        if (!this.stopping) this.scheduleApiRestart();
      });
    }, delay);
  }

  private run(binary: string, args: string[], env: NodeJS.ProcessEnv, label: string): Promise<void> {
    const child = this.spawn(binary, args, env, label);
    return new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${label} exited with status ${code ?? "unknown"}`)));
    });
  }
}

async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate local API port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForHealth(port: number, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Inkway local server exited before becoming ready (status ${child.exitCode ?? child.signalCode ?? "unknown"})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Inkway local server did not become ready: ${lastError}`);
}

async function terminatePreviousServer(pidFile: string, expectedBinary: string): Promise<void> {
  const rawPid = await readFile(pidFile, "utf8").catch(() => "");
  const pid = Number(rawPid.trim());
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    const { execFileSync } = await import("node:child_process");
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
    if (command.startsWith(expectedBinary)) {
      process.kill(pid, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 300));
      try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
    }
  } catch { /* stale PID or process already exited */ }
  await unlink(pidFile).catch(() => undefined);
}

function quoteArg(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function localProcessEnv(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
}
