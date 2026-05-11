import { spawn, execSync, ChildProcess } from "child_process";
import net from "net";
import path from "path";
import fs from "fs";
import os from "os";
import { FTRunConfig, TestResult } from "@/types/ft";

// ============= Build Cache =============
// Persists the git commit hash of the last successful build inside workDir.
// On the next run, if HEAD hasn't moved and .next + node_modules still exist,
// both install and build are skipped entirely.

const BUILD_CACHE_FILE = ".ft-build-cache.json";

export function getGitCommit(workDir: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: workDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function readBuildCache(workDir: string): string | null {
  try {
    const cacheFile = path.join(workDir, BUILD_CACHE_FILE);
    if (!fs.existsSync(cacheFile)) return null;
    const { commit } = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    return commit || null;
  } catch {
    return null;
  }
}

export function writeBuildCache(workDir: string, commit: string): void {
  try {
    fs.writeFileSync(
      path.join(workDir, BUILD_CACHE_FILE),
      JSON.stringify({ commit, builtAt: new Date().toISOString() })
    );
  } catch {
    // Non-fatal — worst case the next run rebuilds
  }
}

// ============= Environment Helpers =============

/**
 * Build a clean environment for the cloned repo's dev server.
 * Strips Next.js / gitlog-specific vars so the child process
 * starts fresh with only system-level env + our overrides.
 */
export function buildCleanEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    // Skip Next.js internals that leak from the gitlog host process
    if (key.startsWith("__NEXT_")) continue;
    if (key.startsWith("NEXT_")) continue;
    // Skip gitlog-specific vars
    if (key === "NEXT_RUNTIME") continue;
    if (key === "TURBOPACK") continue;
    clean[key] = val;
  }
  // Force development mode for SSO-skip middleware
  clean.NODE_ENV = "development";
  return { ...clean, ...overrides } as NodeJS.ProcessEnv;
}

// ============= Configuration =============

export const FT_CONFIG = {
  portRangeStart: 10000,
  portRangeEnd: 15000,
  serverReadyTimeout: 90000,
  maxConcurrentRuns: parseInt(process.env.FT_MAX_CONCURRENT || "5"),
  artifactsDir: process.env.FT_ARTIFACTS_DIR || path.join(process.cwd(), "data", "ft-artifacts"),
  cloneDepth: 1,
  cypressTimeout: 300000,
};

// ============= Server Pool =============
// Keeps dev servers alive between runs to avoid the 30-90s startup penalty.
// Servers idle for > 30 minutes are automatically cleaned up.

const SERVER_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface PooledServer {
  port: number;
  process: ChildProcess;
  workDir: string;
  lastUsed: number;
  userId: string;
  owner: string;
  repo: string;
  branch: string;
}

// Singleton map — survives Next.js hot reloads
const globalForPool = globalThis as unknown as { serverPool: Map<string, PooledServer>; poolCleanupTimer: ReturnType<typeof setInterval> | null };
if (!globalForPool.serverPool) globalForPool.serverPool = new Map();
if (!globalForPool.poolCleanupTimer) {
  globalForPool.poolCleanupTimer = setInterval(() => cleanupIdleServers(), 5 * 60 * 1000); // check every 5 min
  // Do not keep build/process alive just because of pool cleanup.
  globalForPool.poolCleanupTimer.unref?.();
}

const serverPool = globalForPool.serverPool;

function poolKey(userId: string, owner: string, repo: string, branch: string): string {
  return `${userId}:${owner}/${repo}@${branch}`;
}

/**
 * Try to acquire a running server from the pool.
 * Returns the port and workDir if a healthy server exists, or null.
 */
export async function acquireServerFromPool(
  userId: string, owner: string, repo: string, branch: string, emit: EventCallback
): Promise<{ port: number; workDir: string; process: ChildProcess } | null> {
  const key = poolKey(userId, owner, repo, branch);
  const pooled = serverPool.get(key);

  if (!pooled) return null;

  // Health check — verify server is still responding
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://localhost:${pooled.port}/sparkx/`, {
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(tid);

    if (res.ok || (res.status >= 300 && res.status < 400)) {
      pooled.lastUsed = Date.now();
      emit({ type: "log", timestamp: Date.now(), message: `Reusing pooled server on port ${pooled.port}` });
      return { port: pooled.port, workDir: pooled.workDir, process: pooled.process };
    }
  } catch {
    // Server is dead — remove from pool
    emit({ type: "log", timestamp: Date.now(), message: `Pooled server on port ${pooled.port} is dead, removing` });
  }

  serverPool.delete(key);
  stopProcess(pooled.process);
  return null;
}

/**
 * Release a server back to the pool instead of killing it.
 */
export function releaseServerToPool(
  userId: string, owner: string, repo: string, branch: string,
  port: number, serverProcess: ChildProcess, workDir: string
): void {
  const key = poolKey(userId, owner, repo, branch);
  serverPool.set(key, {
    port,
    process: serverProcess,
    workDir,
    lastUsed: Date.now(),
    userId,
    owner,
    repo,
    branch,
  });
  console.log(`[Server Pool] Released server to pool: ${key} on port ${port}`);
}

/**
 * Remove servers idle for more than SERVER_IDLE_TIMEOUT_MS.
 */
export function cleanupIdleServers(): void {
  const now = Date.now();
  for (const [key, server] of serverPool.entries()) {
    if (now - server.lastUsed > SERVER_IDLE_TIMEOUT_MS) {
      console.log(`[Server Pool] Cleaning up idle server: ${key} (port ${server.port})`);
      stopProcess(server.process);
      serverPool.delete(key);
    }
  }
}

/**
 * Kill all pooled servers belonging to a specific user.
 * Safe to call during cleanup — does not affect other users' servers.
 */
export function killUserServers(userId: string): number {
  let killed = 0;
  for (const [key, server] of serverPool.entries()) {
    if (key.startsWith(`${userId}:`)) {
      console.log(`[Server Pool] Killing server for user ${userId}: ${key} (port ${server.port})`);
      stopProcess(server.process);
      serverPool.delete(key);
      killed++;
    }
  }
  return killed;
}

/**
 * Get the current pool size (for diagnostics).
 */
export function getServerPoolSize(): number {
  return serverPool.size;
}

// ============= Event Callback Type =============

export type EventCallback = (event: { type: string; timestamp: number; [key: string]: any }) => void;

// ============= Port Management =============

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Bind to wildcard (all interfaces) to detect any server on this port
    // Specific-interface checks (127.0.0.1, ::1) miss servers bound to *:port
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

/**
 * Find an available port in the configured range.
 * @param hint Optional hint to start searching from a specific offset.
 */
export async function findAvailablePort(hint?: number): Promise<number> {
  const start = hint !== undefined
    ? FT_CONFIG.portRangeStart + (hint * 4)
    : FT_CONFIG.portRangeStart;

  for (let i = 0; i < (FT_CONFIG.portRangeEnd - FT_CONFIG.portRangeStart + 1); i++) {
    const port = FT_CONFIG.portRangeStart + ((start - FT_CONFIG.portRangeStart + i) % (FT_CONFIG.portRangeEnd - FT_CONFIG.portRangeStart + 1));
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(
    `No available port in range ${FT_CONFIG.portRangeStart}-${FT_CONFIG.portRangeEnd}.`
  );
}

// ============= Shell Helpers =============

export function execCommand(
  cmd: string,
  args: string[],
  opts?: any,
  onLog?: (msg: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts, stdio: "pipe" });
    let stderr = "";

    proc.stdout?.on("data", (d) => {
      onLog?.(d.toString().trim());
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
    proc.on("error", (err) => {
      reject(new Error(`Failed to start ${cmd}: ${err.message}`));
    });
  });
}

export function execCapture(
  cmd: string,
  args: string[],
  opts?: any,
  onLog?: (msg: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts, stdio: "pipe" });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
      onLog?.(d.toString().trim());
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const error: any = new Error(`${cmd} exited with code ${code}`);
        error.output = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    proc.on("error", (err) => {
      reject(new Error(`Failed to start ${cmd}: ${err.message}`));
    });
  });
}

export function waitForServer(url: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      try {
        const res = await fetch(url);
        if (res.ok || res.status < 500) return resolve();
      } catch {
        // Not ready
      }
      if (Date.now() - start > timeout) {
        return reject(new Error(`Server at ${url} did not start within ${timeout}ms`));
      }
      setTimeout(check, 2000);
    };
    check();
  });
}

// ============= Setup Operations =============

export async function cloneRepo(
  config: FTRunConfig,
  workDir: string,
  emit: EventCallback
): Promise<void> {
  const githubBaseUrl = process.env.GITHUB_BASE_URL || "https://github.com";
  const repoUrl = `${githubBaseUrl}/${config.owner}/${config.repo}.git`;
  const authedUrl = config.githubToken
    ? repoUrl.replace("https://", `https://${config.githubToken}@`)
    : repoUrl;

  await execCommand(
    "git",
    ["clone", "--depth", String(FT_CONFIG.cloneDepth), "--branch", config.branch, authedUrl, workDir],
    undefined,
    (msg) => emit({ type: "log", timestamp: Date.now(), message: msg })
  );

  emit({ type: "log", timestamp: Date.now(), message: `Cloned ${config.owner}/${config.repo}@${config.branch}` });

  // Write metadata for clone identification and dedup
  const meta = { owner: config.owner, repo: config.repo, branch: config.branch, userId: config.userId || config.triggeredBy || null, clonedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(workDir, ".ft-meta.json"), JSON.stringify(meta, null, 2));
}

// ============= Clone Management =============

interface CloneMeta {
  owner: string;
  repo: string;
  branch: string;
  clonedAt: string;
}

const CLONE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

function readCloneMeta(dir: string): CloneMeta | null {
  try {
    const metaPath = path.join(dir, ".ft-meta.json");
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Find an existing clone directory for the given owner/repo/branch.
 * When userId is provided, searches only within the user's directory.
 * Returns the path if found, or null.
 */
export function findExistingClone(owner: string, repo: string, branch: string, userId?: string): string | null {
  // Search in per-user directory first, then shared, then legacy tmpdir
  const searchDirs: string[] = [];
  if (userId) {
    searchDirs.push(path.join(os.tmpdir(), "ft-clones", userId));
  }
  searchDirs.push(path.join(os.tmpdir(), "ft-clones", "_shared"));
  // Legacy: also search tmpdir root for pre-migration clones
  searchDirs.push(os.tmpdir());

  for (const searchDir of searchDirs) {
    let entries: string[];
    try {
      entries = fs.readdirSync(searchDir).filter((e) => e.startsWith("ft-run-"));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(searchDir, entry);
      const meta = readCloneMeta(fullPath);
      if (meta && meta.owner === owner && meta.repo === repo && meta.branch === branch) {
        return fullPath;
      }
    }
  }
  return null;
}

/**
 * Check if a clone directory is older than 2 days.
 */
export function isCloneStale(workDir: string): boolean {
  const meta = readCloneMeta(workDir);
  if (!meta) return true;
  const age = Date.now() - new Date(meta.clonedAt).getTime();
  return age > CLONE_MAX_AGE_MS;
}

/**
 * Remove any existing clone for the same owner/repo/branch (dedup).
 * When userId is provided, scopes to that user's directory.
 */
export function removeDuplicateClones(owner: string, repo: string, branch: string, excludePath?: string, userId?: string): void {
  const searchDirs: string[] = [];
  if (userId) {
    searchDirs.push(path.join(os.tmpdir(), "ft-clones", userId));
  }
  searchDirs.push(path.join(os.tmpdir(), "ft-clones", "_shared"));
  // Legacy cleanup
  searchDirs.push(os.tmpdir());

  for (const searchDir of searchDirs) {
    let entries: string[];
    try {
      entries = fs.readdirSync(searchDir).filter((e) => e.startsWith("ft-run-"));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(searchDir, entry);
      if (fullPath === excludePath) continue;
      const meta = readCloneMeta(fullPath);
      if (meta && meta.owner === owner && meta.repo === repo && meta.branch === branch) {
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`[ft-setup] Removed duplicate clone: ${fullPath}`);
        } catch (err) {
          console.error(`[ft-setup] Failed to remove duplicate clone ${fullPath}:`, err);
        }
      }
    }
  }
}

/**
 * List existing clone directories with metadata.
 * When userId is provided, returns only that user's clones.
 */
export function listClones(userId?: string): Array<{ path: string; owner: string; repo: string; branch: string; clonedAt: string; ageHours: number }> {
  const searchDirs: string[] = [];
  if (userId) {
    searchDirs.push(path.join(os.tmpdir(), "ft-clones", userId));
  } else {
    // List all users + shared
    const ftClonesDir = path.join(os.tmpdir(), "ft-clones");
    try {
      for (const userDir of fs.readdirSync(ftClonesDir)) {
        searchDirs.push(path.join(ftClonesDir, userDir));
      }
    } catch { /* dir may not exist yet */ }
    // Legacy: also check tmpdir root
    searchDirs.push(os.tmpdir());
  }

  const clones: Array<{ path: string; owner: string; repo: string; branch: string; clonedAt: string; ageHours: number }> = [];
  const seen = new Set<string>();

  for (const searchDir of searchDirs) {
    let entries: string[];
    try {
      entries = fs.readdirSync(searchDir).filter((e) => e.startsWith("ft-run-"));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(searchDir, entry);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      const meta = readCloneMeta(fullPath);
      if (meta) {
        const ageMs = Date.now() - new Date(meta.clonedAt).getTime();
        clones.push({
          path: fullPath,
          owner: meta.owner,
          repo: meta.repo,
          branch: meta.branch,
          clonedAt: meta.clonedAt,
          ageHours: Math.round(ageMs / (1000 * 60 * 60)),
        });
      }
    }
  }
  return clones;
}

export async function installDeps(
  workDir: string,
  emit: EventCallback
): Promise<void> {
  await execCommand(
    "npm", ["ci"],
    { cwd: workDir, env: buildCleanEnv() },
    (msg) => emit({ type: "log", timestamp: Date.now(), message: msg })
  );
  emit({ type: "log", timestamp: Date.now(), message: "Dependencies installed" });
}

export async function buildApp(
  workDir: string,
  emit: EventCallback
): Promise<void> {
  emit({ type: "log", timestamp: Date.now(), message: "Building app (npm run build)..." });

  // FT optimisation: inject --no-lint into the build script so Next.js skips
  // ESLint during the production build. For FT purposes code style is irrelevant
  // and ESLint on a large codebase can add 2-5 minutes.
  let originalBuildScript: string | null = null;
  const pkgPath = path.join(workDir, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const current: string = pkg.scripts?.build || "";
    if (current && !current.includes("--no-lint")) {
      const optimised = current.replace(/next build(?=\s|$)/, "next build --no-lint");
      if (optimised !== current) {
        originalBuildScript = current;
        pkg.scripts.build = optimised;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
        emit({ type: "log", timestamp: Date.now(), message: "[build] FT optimisation: ESLint skipped (--no-lint injected)" });
      }
    }
  } catch {
    // Non-fatal — proceed with the original script
  }

  try {
    // Build requires NODE_ENV=production (Next.js rejects non-standard values).
    // NEXT_TELEMETRY_DISABLED skips the optional telemetry flush that adds ~2s.
    await execCommand(
      "npm", ["run", "build"],
      { cwd: workDir, env: buildCleanEnv({ NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" }) },
      (msg) => emit({ type: "log", timestamp: Date.now(), message: `[build] ${msg}` })
    );
    emit({ type: "log", timestamp: Date.now(), message: "App built successfully" });
  } finally {
    // Always restore the original build script so git status stays clean
    if (originalBuildScript !== null) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        pkg.scripts.build = originalBuildScript;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      } catch {
        // Non-fatal
      }
    }
  }
}

export async function startDevServer(
  workDir: string,
  port: number,
  emit: EventCallback
): Promise<ChildProcess> {
  console.log(`\n[Setup Agent] Starting dev server:`);
  console.log(`  Command:  npm run dev`);
  console.log(`  WorkDir:  ${workDir}`);
  console.log(`  PORT env: ${port}`);
  console.log(`  Server URL: http://localhost:${port}`);
  console.log(`  Readiness check: http://localhost:${port}/sparkx/`);
  console.log(`  CYPRESS_BASE_URL will be: http://localhost:${port}/sparkx`);

  const proc = spawn("npm", ["run", "dev"], {
    cwd: workDir,
    env: buildCleanEnv({
      PORT: String(port),
      NODE_OPTIONS: "--max-old-space-size=8192 --openssl-legacy-provider",
    }) as any,
    stdio: "pipe",
    detached: false,
  });

  console.log(`[Setup Agent] Dev server process started (PID: ${proc.pid})`);

  let earlyExitError: string | null = null;
  let stderrBuffer = "";

  proc.stdout?.on("data", (data: Buffer) => {
    emit({ type: "log", timestamp: Date.now(), message: `[server] ${data.toString().trim()}` });
  });
  proc.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    stderrBuffer += msg + "\n";
    emit({ type: "log", timestamp: Date.now(), message: `[server:err] ${msg}` });
  });
  proc.on("exit", (code: number | null) => {
    if (code !== null && code !== 0) {
      earlyExitError = `Dev server exited with code ${code}: ${stderrBuffer.slice(0, 500)}`;
    }
  });

  // Race: wait for server to be ready OR detect early exit
  // Check /sparkx/ (the basePath) since the app serves under /sparkx
  await waitForServerOrExit(`http://localhost:${port}/sparkx/`, FT_CONFIG.serverReadyTimeout, () => earlyExitError);
  emit({ type: "log", timestamp: Date.now(), message: `Dev server ready on port ${port}` });

  // Warm up the critical /console route
  try {
    const warmupUrl = `http://localhost:${port}/sparkx/console?pp-ft-skipsso=true&pp-ft-mockuser=cy_test_user`;
    emit({ type: "log", timestamp: Date.now(), message: `Warming up /sparkx/console route...` });
    const warmupStart = Date.now();
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 180000);
    await fetch(warmupUrl, { signal: controller.signal }).catch(() => {});
    clearTimeout(tid);
    emit({ type: "log", timestamp: Date.now(), message: `Route warmed up in ${Math.round((Date.now() - warmupStart) / 1000)}s` });
  } catch {
    emit({ type: "log", timestamp: Date.now(), message: `Console route warmup timed out — tests may be slow on first visit` });
  }

  // Health-check: verify server responds consistently
  const healthCheckUrl = `http://localhost:${port}/sparkx`;
  let consecutiveOk = 0;
  const requiredConsecutive = 3;
  const healthStart = Date.now();
  const healthTimeout = 30000;

  while (consecutiveOk < requiredConsecutive && Date.now() - healthStart < healthTimeout) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(healthCheckUrl, { signal: controller.signal });
      clearTimeout(tid);
      if (res.ok || res.status < 500) {
        consecutiveOk++;
      } else {
        consecutiveOk = 0;
      }
    } catch {
      consecutiveOk = 0;
    }
    if (consecutiveOk < requiredConsecutive) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (consecutiveOk < requiredConsecutive) {
    emit({ type: "log", timestamp: Date.now(), message: `Warning: health-check did not reach ${requiredConsecutive} consecutive OK responses` });
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));
  emit({ type: "log", timestamp: Date.now(), message: `Server fully ready on port ${port}` });

  return proc;
}

function waitForServerOrExit(
  url: string,
  timeout: number,
  getExitError: () => string | null
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      // Check if process died
      const exitError = getExitError();
      if (exitError) {
        return reject(new Error(exitError));
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
        clearTimeout(timeoutId);
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`[Setup Agent] Readiness check ${url} → HTTP ${res.status} (${elapsed}s elapsed)`);
        // Accept 200, 301, 302, 307, 308 — but NOT 404 (which means the app isn't serving this path)
        if (res.ok || (res.status >= 300 && res.status < 400)) {
          console.log(`[Setup Agent] Server is READY at ${url}`);
          return resolve();
        }
        console.log(`[Setup Agent] Got ${res.status} — not ready yet (expecting 200 or redirect)`);
      } catch (err) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`[Setup Agent] Readiness check failed (${elapsed}s): ${errMsg.slice(0, 80)}`);
      }

      if (Date.now() - start > timeout) {
        return reject(new Error(
          `Server at ${url} did not start within ${timeout / 1000}s. ` +
          `Check if the repo's dev server needs specific env vars or config files.`
        ));
      }
      setTimeout(check, 2000);
    };
    check();
  });
}

export function stopProcess(proc: ChildProcess | null): void {
  if (proc && !proc.killed) {
    proc.kill("SIGTERM");
  }
}

/**
 * Start the app server in production mode (serving pre-built assets).
 * Uses `npm run start` instead of `npm run dev`.
 *
 * Key env vars:
 * - NODE_ENV=development → keeps SSO-skip middleware active
 * - DEPLOY_ENV=staging → makes env.isDev() return false → Next.js serves pre-built assets
 *
 * This eliminates on-demand compilation entirely, reducing memory from 8GB to ~2GB
 * and making the server safe for multiple concurrent Cypress workers.
 */
export async function startProdServer(
  workDir: string,
  port: number,
  emit: EventCallback
): Promise<ChildProcess> {
  const proc = spawn("npm", ["run", "start"], {
    cwd: workDir,
    env: buildCleanEnv({
      PORT: String(port),
      NODE_ENV: "development",
      FT_PROD_MODE: "true",
      NODE_OPTIONS: "--openssl-legacy-provider --max-old-space-size=2048 --max-http-header-size=20480",
    }) as any,
    stdio: "pipe",
    detached: false,
  });

  let earlyExitError: string | null = null;
  let stderrBuffer = "";

  proc.stdout?.on("data", (data: Buffer) => {
    emit({ type: "log", timestamp: Date.now(), message: `[server] ${data.toString().trim()}` });
  });
  proc.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    stderrBuffer += msg + "\n";
    emit({ type: "log", timestamp: Date.now(), message: `[server:err] ${msg}` });
  });
  proc.on("exit", (code: number | null) => {
    if (code !== null && code !== 0) {
      earlyExitError = `Server exited with code ${code}: ${stderrBuffer.slice(0, 500)}`;
    }
  });

  // Wait for server to be ready — no warmup needed since routes are pre-compiled
  await waitForServerOrExit(`http://localhost:${port}`, FT_CONFIG.serverReadyTimeout, () => earlyExitError);
  emit({ type: "log", timestamp: Date.now(), message: `Server root responding on port ${port}` });

  await waitForServerOrExit(`http://localhost:${port}/sparkx`, 60000, () => earlyExitError);
  emit({ type: "log", timestamp: Date.now(), message: `App route /sparkx ready on port ${port}` });

  // Brief settle time
  await new Promise((resolve) => setTimeout(resolve, 3000));
  emit({ type: "log", timestamp: Date.now(), message: `Server fully ready on port ${port} (production mode, pre-built)` });

  return proc;
}

export function cleanupWorkDir(workDir: string): void {
  try {
    if (!fs.existsSync(workDir)) return;
    killProcessesInDir(workDir);
    try { execSync("sleep 1"); } catch { /* ignore */ }
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    try {
      execSync("sleep 2");
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (retryError) {
      console.error(`Failed to clean up ${workDir} after retry:`, retryError);
    }
  }
}

function killProcessesInDir(dir: string): void {
  try {
    const pids = execSync(
      `lsof -ti :${FT_CONFIG.portRangeStart}-${FT_CONFIG.portRangeEnd} 2>/dev/null || true`,
      { encoding: "utf-8" }
    ).trim();

    if (!pids) return;

    for (const pid of pids.split("\n").filter(Boolean)) {
      try {
        const cwd = execSync(`lsof -p ${pid} -Fn 2>/dev/null | grep '^n${dir}' || true`, { encoding: "utf-8" }).trim();
        if (cwd) {
          process.kill(parseInt(pid), "SIGTERM");
          console.log(`[ft-cleanup] Killed process ${pid} (cwd in ${dir})`);
        }
      } catch { /* process may have already exited */ }
    }
  } catch (error) {
    console.error("[ft-cleanup] Error killing processes:", error);
  }
}

export function cleanupStaleServers(currentWorkDir?: string): void {
  try {
    const pids = execSync(
      `lsof -ti :${FT_CONFIG.portRangeStart}-${FT_CONFIG.portRangeEnd} 2>/dev/null || true`,
      { encoding: "utf-8" }
    ).trim();

    if (!pids) return;

    for (const pid of pids.split("\n").filter(Boolean)) {
      try {
        const pidNum = parseInt(pid);
        if (isNaN(pidNum)) continue;
        const cwdInfo = execSync(`lsof -p ${pidNum} -Fn 2>/dev/null | head -20 || true`, { encoding: "utf-8" });
        const isFtRun = cwdInfo.includes("ft-run-");
        const isCurrentRun = currentWorkDir && cwdInfo.includes(currentWorkDir);

        if (isFtRun && !isCurrentRun) {
          process.kill(pidNum, "SIGTERM");
          console.log(`[ft-cleanup] Killed stale server process ${pidNum}`);
        }
      } catch { /* process may have already exited */ }
    }
  } catch (error) {
    console.error("[ft-cleanup] Error cleaning stale servers:", error);
  }
}

export function createWorkDir(runId: string, userId?: string): string {
  if (userId) {
    const userDir = path.join(os.tmpdir(), "ft-clones", userId);
    fs.mkdirSync(userDir, { recursive: true });
    return path.join(userDir, `ft-run-${runId}`);
  }
  const sharedDir = path.join(os.tmpdir(), "ft-clones", "_shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  return path.join(sharedDir, `ft-run-${runId}`);
}

/**
 * Create an isolated worker directory by fully copying the workDir.
 * Each worker gets a complete independent copy including node_modules.
 * This ensures full isolation — no shared TypeScript caches, no symlink
 * conflicts between concurrent tsc/nodemon processes.
 * Returns the path to the worker-specific directory.
 */
export function createWorkerDir(workDir: string, workerId: number): string {
  const workerDir = `${workDir}-worker-${workerId}`;

  // Clean up any leftover from a previous run
  if (fs.existsSync(workerDir)) {
    fs.rmSync(workerDir, { recursive: true, force: true });
  }

  // Full copy — including node_modules for complete isolation.
  // Two concurrent tsc/nodemon processes sharing node_modules via symlink
  // corrupt each other's compilation cache and crash.
  fs.cpSync(workDir, workerDir, { recursive: true });

  // Remove build cache directories — each worker will create its own
  for (const cacheDir of [".next", ".turbo"]) {
    const cachePath = path.join(workerDir, cacheDir);
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { recursive: true, force: true });
    }
  }

  return workerDir;
}

/**
 * Remove a worker directory.
 */
export function cleanupWorkerDir(workerDir: string): void {
  try {
    if (!fs.existsSync(workerDir)) return;
    // Kill any processes still running from this directory
    killProcessesInDir(workerDir);
    try { execSync("sleep 1"); } catch { /* ignore */ }
    fs.rmSync(workerDir, { recursive: true, force: true });
  } catch (error) {
    // Retry once after brief delay
    try {
      execSync("sleep 2");
      fs.rmSync(workerDir, { recursive: true, force: true });
    } catch (retryError) {
      console.error(`Failed to clean up worker dir ${workerDir}:`, retryError);
    }
  }
}

// ============= Git Operations =============

export async function gitCommitAndPush(
  workDir: string,
  message: string,
  emit: EventCallback
): Promise<void> {
  emit({ type: "log", timestamp: Date.now(), message: "Staging fix changes..." });
  await execCommand("git", ["add", "-A"], { cwd: workDir, env: buildCleanEnv() });

  emit({ type: "log", timestamp: Date.now(), message: `Committing: ${message}` });
  await execCommand(
    "git",
    ["commit", "-m", message],
    { cwd: workDir, env: buildCleanEnv() }
  );

  emit({ type: "log", timestamp: Date.now(), message: "Pushing to remote..." });
  await execCommand(
    "git",
    ["push"],
    { cwd: workDir, env: buildCleanEnv() },
    (msg) => emit({ type: "log", timestamp: Date.now(), message: msg })
  );

  emit({ type: "log", timestamp: Date.now(), message: "Fix pushed to remote branch" });
}

// ============= Result Collection =============

export function collectArtifacts(workDir: string, runId: string): string {
  const artifactsDir = path.join(FT_CONFIG.artifactsDir, runId);
  fs.mkdirSync(artifactsDir, { recursive: true });

  // sparkxnodeweb uses cypress-mochawesome-reporter which puts reports in cypress/reports/
  const sources = [
    { src: path.join(workDir, "cypress/reports"), dest: path.join(artifactsDir, "reports") },
    { src: path.join(workDir, "cypress/results"), dest: path.join(artifactsDir, "results") },
    { src: path.join(workDir, "cypress/screenshots"), dest: path.join(artifactsDir, "screenshots") },
    { src: path.join(workDir, "cypress/videos"), dest: path.join(artifactsDir, "videos") },
    { src: path.join(workDir, "cypress/reports/screenshots"), dest: path.join(artifactsDir, "screenshots") },
  ];

  for (const { src, dest } of sources) {
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }

  return artifactsDir;
}

export function parseResultsFromArtifacts(artifactsDir: string): {
  results: TestResult[];
  passed: number;
  failed: number;
  duration: number;
} {
  // Look for JSON reports in both /results and /reports (cypress-mochawesome-reporter)
  const searchDirs = [
    path.join(artifactsDir, "results"),
    path.join(artifactsDir, "reports"),
    path.join(artifactsDir, "reports", ".jsons"),
  ];

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let duration = 0;

  for (const resultsDir of searchDirs) {
  if (fs.existsSync(resultsDir)) {
    const files = fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf-8"));
        const stats = data.stats || {};
        passed += stats.passes || 0;
        failed += stats.failures || 0;
        duration += stats.duration || 0;

        for (const result of data.results || []) {
          for (const suite of result.suites || []) {
            for (const test of suite.tests || []) {
              results.push({
                file: result.file || result.fullFile || "",
                testName: test.fullTitle || test.title || "",
                status: test.pass ? "passed" : test.fail ? "failed" : "pending",
                duration: test.duration || 0,
                error: test.err?.message,
              });
            }
          }
        }
      } catch {
        // Skip unparseable files
      }
    }
  }
  } // end for searchDirs

  return { results, passed, failed, duration };
}

// ============= Spec Splitting =============

export function splitSpecsIntoChunks(specs: string[], workerCount: number): string[][] {
  if (workerCount <= 1 || specs.length <= 1) return [specs];

  const effectiveWorkers = Math.min(workerCount, specs.length);
  const chunks: string[][] = Array.from({ length: effectiveWorkers }, () => []);

  // Round-robin distribution for balanced chunks
  specs.forEach((spec, i) => {
    chunks[i % effectiveWorkers].push(spec);
  });

  return chunks.filter((c) => c.length > 0);
}

// ============= Per-User Repo Management =============

// Lock to prevent concurrent clones for the same user
const cloneLocks = new Map<string, Promise<string>>();

/**
 * Apply patches to commands.ts after git reset --hard overwrites local fixes.
 * This patches the selectIntent command to add retry logic for the combobox
 * dropdown (the combobox may not be interactive immediately after page load).
 */
function applyPostPullPatches(repoPath: string, log: (msg: string) => void): void {
  const commandsPath = path.join(repoPath, "cypress", "support", "commands.ts");
  if (!fs.existsSync(commandsPath)) return;

  let content = fs.readFileSync(commandsPath, "utf-8");

  // Only patch if the retry logic is not already present
  if (content.includes("component's data source is initialized")) return;

  const oldSelectIntent = `  // Click the combobox and type the intent name.
  // Use force:true to bypass any transient spinner overlays that may cover
  // the combobox after LLA completes. The input will still receive the text.
  cy.get(INTENT_SELECTION.searchCombobox)
    .find("input")
    .first()
    .click({ force: true });
  // Re-query after click to avoid detached DOM element
  cy.get(INTENT_SELECTION.searchCombobox)
    .find("input")
    .first()
    .type(intentName, { force: true });

  // Wait for filtered dropdown options and click the matching intent
  cy.get(INTENT_SELECTION.searchCombobox)
    .find('[role="option"]', { timeout: TIMEOUTS.MEDIUM })
    .contains(intentName)
    .click({ force: true });`;

  const newSelectIntent = `  // Click the combobox to open the full dropdown and wait for options to load
  // before typing. This ensures the component's data source is initialized.
  cy.get(INTENT_SELECTION.searchCombobox)
    .find("input")
    .first()
    .click({ force: true });

  // Wait for the dropdown options to appear (unfiltered list)
  cy.get(INTENT_SELECTION.searchCombobox)
    .find('[role="option"]', { timeout: TIMEOUTS.MAX })
    .should("have.length.greaterThan", 0);

  // Now type to filter — the component is guaranteed to be ready
  cy.get(INTENT_SELECTION.searchCombobox)
    .find("input")
    .first()
    .clear({ force: true })
    .type(intentName, { force: true });

  // Wait for the filtered option and click it
  cy.get(INTENT_SELECTION.searchCombobox)
    .find('[role="option"]', { timeout: TIMEOUTS.MEDIUM })
    .contains(intentName)
    .click({ force: true });`;

  if (content.includes(oldSelectIntent)) {
    content = content.replace(oldSelectIntent, newSelectIntent);
    // Also bump the supportedNextButton timeout
    content = content.replace(
      `cy.get(INTENT_SELECTION.supportedNextButton, { timeout: TIMEOUTS.MEDIUM })`,
      `cy.get(INTENT_SELECTION.supportedNextButton, { timeout: TIMEOUTS.EXTENDED })`,
    );
    fs.writeFileSync(commandsPath, content, "utf-8");
    log("Applied selectIntent retry patch to commands.ts");
  }
}

/**
 * Ensure a per-user repo clone exists at repos/{userId}/{repo}.
 * - If it exists: does a quick `git fetch && git reset --hard origin/{branch}`
 * - If not: performs a shallow clone
 * - Returns the absolute path to the repo
 *
 * Concurrent calls for the same user will wait for the first clone to finish.
 */
export async function ensureUserRepo(params: {
  userId: string;
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  source?: "FTRunner" | "FTBuilder";
  onProgress?: (message: string) => void;
}): Promise<{ repoPath: string; cloned: boolean; warning?: string }> {
  const { userId, githubToken, owner, repo, branch, onProgress } = params;
  const log = onProgress || (() => {});

  // Always use flat path: repos/{userId}/{repo}
  const repoPath = path.join(process.cwd(), "repos", userId, repo);
  const lockKey = `${userId}/${repo}`;

  // If another clone is in progress for this user, wait for it
  const existing = cloneLocks.get(lockKey);
  if (existing) {
    log("Waiting for another clone operation to finish...");
    await existing;
    return { repoPath, cloned: false };
  }

  // Check if repo already exists
  if (fs.existsSync(path.join(repoPath, ".git"))) {
    // Verify the clone is from the correct GitHub source
    try {
      const currentRemote = execSync("git remote get-url origin", { cwd: repoPath, encoding: "utf-8" }).trim();
      const expectedHost = (process.env.GITHUB_BASE_URL || "https://github.com").replace("https://", "");
      if (!currentRemote.includes(expectedHost)) {
        log(`Clone is from wrong source (${currentRemote}). Deleting and re-cloning from ${expectedHost}...`);
        fs.rmSync(repoPath, { recursive: true, force: true });
        // Fall through to clone below
      }
    } catch {
      // Can't check remote -- proceed with update attempt
    }
  }

  if (fs.existsSync(path.join(repoPath, ".git"))) {
    log(`Repo exists, switching to ${branch}...`);
    try {
      // Fetch the specific branch (works on shallow clones)
      execSync(`git fetch --depth 1 origin ${branch}:refs/remotes/origin/${branch}`, {
        cwd: repoPath,
        timeout: 60000,
        stdio: "pipe",
        env: buildCleanEnv(),
      });
      // Check current branch
      const currentBranch = execSync("git branch --show-current", { cwd: repoPath, encoding: "utf-8", timeout: 5000 }).trim();
      if (currentBranch !== branch) {
        // Different branch -- checkout (this will lose untracked generated files)
        try {
          execSync(`git checkout ${branch}`, { cwd: repoPath, timeout: 10000, stdio: "pipe", env: buildCleanEnv() });
        } catch {
          execSync(`git checkout -b ${branch} origin/${branch}`, { cwd: repoPath, timeout: 10000, stdio: "pipe", env: buildCleanEnv() });
        }
        execSync(`git reset --hard origin/${branch}`, { cwd: repoPath, timeout: 15000, stdio: "pipe", env: buildCleanEnv() });
        applyPostPullPatches(repoPath, log);
        log(`Switched to ${branch} branch`);
      } else {
        // Same branch — pull latest from remote
        // Save any generated .cy.ts files before reset
        const generatedFiles: Array<{ rel: string; content: string }> = [];
        try {
          const testsDirs = [
            path.join(repoPath, "__tests__"),
            path.join(repoPath, "cypress", "e2e", "_generated"),
          ];
          for (const dir of testsDirs) {
            if (!fs.existsSync(dir)) continue;
            const findCyFiles = (d: string) => {
              for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) findCyFiles(full);
                else if (entry.name.endsWith(".cy.ts")) {
                  // Check if this is untracked (generated, not in git)
                  try {
                    execSync(`git ls-files --error-unmatch "${path.relative(repoPath, full)}"`, { cwd: repoPath, stdio: "pipe" });
                  } catch {
                    // File is untracked = generated
                    generatedFiles.push({ rel: path.relative(repoPath, full), content: fs.readFileSync(full, "utf-8") });
                  }
                }
              }
            };
            findCyFiles(dir);
          }
        } catch { /* ignore */ }

        if (generatedFiles.length > 0) {
          log(`Saving ${generatedFiles.length} generated test file(s) before update`);
        }

        // Hard reset to latest remote
        execSync(`git reset --hard origin/${branch}`, { cwd: repoPath, timeout: 15000, stdio: "pipe", env: buildCleanEnv() });

        // Restore generated files
        for (const gf of generatedFiles) {
          const fullPath = path.join(repoPath, gf.rel);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, gf.content, "utf-8");
        }

        applyPostPullPatches(repoPath, log);
        log(`Updated to latest ${branch} (pulled from remote${generatedFiles.length > 0 ? `, restored ${generatedFiles.length} generated file(s)` : ""})`);
      }
      return { repoPath, cloned: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      log(`Fetch failed (${reason}) — using existing clone without update`);
      return {
        repoPath,
        cloned: false,
        warning: `Could not fetch latest changes from remote (${reason}). Running against the existing local clone — it may be out of date.`,
      };
    }
  }

  // Clone the repo
  const clonePromise = (async () => {
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    log(`Cloning ${owner}/${repo}@${branch}...`);

    const githubBaseUrl = process.env.GITHUB_BASE_URL || "https://github.com";
    const repoUrl = `${githubBaseUrl}/${owner}/${repo}.git`;
    const authedUrl = githubToken
      ? repoUrl.replace("https://", `https://${githubToken}@`)
      : repoUrl;

    await execCommand(
      "git",
      ["clone", "--depth", String(FT_CONFIG.cloneDepth), "--branch", branch, authedUrl, repoPath],
      undefined,
      (msg) => log(msg)
    );

    log(`Clone complete: ${owner}/${repo}@${branch}`);
    return repoPath;
  })();

  cloneLocks.set(lockKey, clonePromise);
  try {
    await clonePromise;
    return { repoPath, cloned: true };
  } catch (cloneErr) {
    // Clone failed (e.g., repo disabled, 403). Fall back to shared clone if it exists.
    const sharedRepo = path.join(process.cwd(), "repos", repo);
    if (fs.existsSync(path.join(sharedRepo, ".git"))) {
      log(`Clone failed (${cloneErr instanceof Error ? cloneErr.message : String(cloneErr)}). Using shared repo at repos/${repo}/`);
      // Copy shared clone to per-user dir so user has their own copy
      try {
        fs.mkdirSync(path.dirname(repoPath), { recursive: true });
        fs.cpSync(sharedRepo, repoPath, { recursive: true });
        log("Copied shared repo to per-user directory");
        return { repoPath, cloned: true };
      } catch {
        // If copy fails too, just use the shared repo directly
        return { repoPath: sharedRepo, cloned: false };
      }
    }
    throw cloneErr;
  } finally {
    cloneLocks.delete(lockKey);
  }
}

/**
 * Get the per-user repo path. Returns null if it doesn't exist yet.
 *
 * FTRunner workspaces are fully isolated: repos/{userId}/{owner}/{repo}/{branch}
 * FTBuilder workspaces use the legacy layout: repos/{userId}/{repo}
 */
export function getUserRepoPath(
  userId: string,
  repo: string,
  opts?: { owner?: string; branch?: string; source?: "FTRunner" | "FTBuilder" }
): string | null {
  // Always use flat path: repos/{userId}/{repo}
  const repoPath = path.join(process.cwd(), "repos", userId, repo);
  if (fs.existsSync(path.join(repoPath, ".git"))) return repoPath;
  return null;
}
