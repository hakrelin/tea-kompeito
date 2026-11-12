import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { HttpError } from "./errors.mjs";

export const sessionAge = 24 * 60 * 60;
const loginWindow = 15 * 60;
const roles = new Set(["member", "reader", "admin"]);
const hash = promisify(scrypt);
let activeHashes = 0;

function usernameKey(value) {
  const username = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    throw new HttpError(400, "账号须为 3 至 32 个字母、数字、点、下划线或连字符。");
  }
  return username;
}

async function passwordHash(password, salt, minimum = 1) {
  const length = typeof password === "string" ? [...password].length : 0;
  if (length < minimum || length > 128 || !password.isWellFormed()) {
    throw new HttpError(400, minimum === 10 ? "请设置 10 至 128 个字符的密码。" : "密码长度无效。");
  }
  if (activeHashes >= 3) throw new HttpError(429, "登录服务繁忙，请稍后重试。");
  activeHashes += 1;
  try {
    return await hash(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  } finally {
    activeHashes -= 1;
  }
}

async function newPassword(password) {
  const salt = randomBytes(16);
  return [salt, await passwordHash(password, salt, 10)];
}

const epoch = () => Math.floor(Date.now() / 1000);
const sessionKey = (token) => createHash("sha256").update(token, "ascii").digest("hex");

export class Accounts {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS accounts (
        username TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('member', 'reader', 'admin')),
        enabled INTEGER NOT NULL DEFAULT 1, salt BLOB NOT NULL, password BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
        expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_account ON sessions(username);
      CREATE TABLE IF NOT EXISTS login_attempts (client TEXT NOT NULL, username TEXT NOT NULL, time INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS attempts_time ON login_attempts(time);
      CREATE TABLE IF NOT EXISTS registration_attempts (client TEXT NOT NULL, time INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS registrations_time ON registration_attempts(time);
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL
      );
    `);
  }

  transaction(run) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  hasAdministrator() {
    return Boolean(this.db.prepare("SELECT 1 FROM accounts WHERE role = 'admin' AND enabled = 1 LIMIT 1").get());
  }

  list() {
    return this.db.prepare("SELECT username, role, enabled FROM accounts ORDER BY username").all();
  }

  requireAdmin(username) {
    if (!this.db.prepare("SELECT 1 FROM accounts WHERE username = ? AND role = 'admin' AND enabled = 1").get(username)) {
      throw new HttpError(403, "当前账号的管理员权限已变更。");
    }
  }

  async create(value, { first = false, actor, signIn = false } = {}) {
    const { password, role } = value;
    const username = usernameKey(value.username);
    if (!roles.has(role)) throw new HttpError(400, "请选择有效的账号权限。");
    const [salt, stored] = await newPassword(password);
    return this.transaction(() => {
      if (actor) this.requireAdmin(actor);
      if (first && this.hasAdministrator()) throw new HttpError(409, "管理员已经建立，请直接登录。");
      if (this.db.prepare("SELECT 1 FROM accounts WHERE username = ?").get(username)) {
        throw new HttpError(400, "该账号已存在。");
      }
      this.db.prepare("INSERT INTO accounts(username, role, salt, password) VALUES (?, ?, ?, ?)")
        .run(username, role, salt, stored);
      const account = { username, role };
      return signIn ? this.issueSession(account) : account;
    });
  }

  register(value, client) {
    const now = epoch();
    this.transaction(() => {
      this.db.prepare("DELETE FROM registration_attempts WHERE time < ?").run(now - loginWindow);
      const { total } = this.db.prepare("SELECT COUNT(*) AS total FROM registration_attempts WHERE client = ?").get(client);
      if (total >= 6) throw new HttpError(429, "注册尝试过多，请稍后重试。");
      this.db.prepare("INSERT INTO registration_attempts VALUES (?, ?)").run(client, now);
    });
    return this.create({ username: value.username, password: value.password, role: "member" }, { signIn: true });
  }

  issueSession(account) {
    const now = epoch();
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(now);
    this.db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(sessionKey(token), account.username, now + sessionAge);
    return { token, account };
  }

  async update(actor, value) {
    const username = usernameKey(value.username);
    const { role, enabled, password } = value;
    if (!roles.has(role) || typeof enabled !== "boolean") throw new HttpError(400, "账号权限或状态不正确。");
    if (actor === username && (role !== "admin" || !enabled)) {
      throw new HttpError(400, "当前管理员账号须保持启用和管理员权限。");
    }
    const credentials = password == null || password === "" ? null : await newPassword(password);
    this.transaction(() => {
      this.requireAdmin(actor);
      const prior = this.db.prepare("SELECT role, enabled FROM accounts WHERE username = ?").get(username);
      if (!prior) throw new HttpError(400, "账号不存在。");
      if (credentials) this.db.prepare("UPDATE accounts SET salt = ?, password = ? WHERE username = ?").run(...credentials, username);
      this.db.prepare("UPDATE accounts SET role = ?, enabled = ? WHERE username = ?").run(role, Number(enabled), username);
      if (credentials || role !== prior.role || Number(enabled) !== prior.enabled) {
        this.db.prepare("DELETE FROM sessions WHERE username = ?").run(username);
      }
    });
  }

  async login(value, client) {
    const username = usernameKey(value.username);
    const now = epoch();
    this.transaction(() => {
      this.db.prepare("DELETE FROM login_attempts WHERE time < ?").run(now - loginWindow);
      const perUser = this.db.prepare("SELECT COUNT(*) AS total FROM login_attempts WHERE username = ?").get(username).total;
      const perClient = this.db.prepare("SELECT COUNT(*) AS total FROM login_attempts WHERE client = ?").get(client).total;
      if (perUser >= 8 || perClient >= 40) throw new HttpError(429, "登录尝试过多，请稍后重试。");
      this.db.prepare("INSERT INTO login_attempts VALUES (?, ?, ?)").run(client, username, now);
    });
    const user = this.db.prepare("SELECT salt FROM accounts WHERE username = ?").get(username);
    const computed = await passwordHash(value.password, user?.salt ?? Buffer.alloc(16));
    return this.transaction(() => {
      const current = this.db.prepare("SELECT role, enabled, password FROM accounts WHERE username = ?").get(username);
      if (!current?.enabled || !timingSafeEqual(current.password, computed)) {
        throw new HttpError(401, "账号或密码错误，或账号已停用。");
      }
      this.db.prepare("DELETE FROM login_attempts WHERE username = ? AND client = ?").run(username, client);
      return this.issueSession({ username, role: current.role });
    });
  }

  session(token) {
    if (!token) return null;
    return this.db.prepare(`
      SELECT a.username, a.role FROM sessions s JOIN accounts a ON a.username = s.username
      WHERE s.token = ? AND s.expires > ? AND a.enabled = 1
    `).get(sessionKey(token), epoch()) ?? null;
  }

  logout(token) {
    if (token) this.db.prepare("DELETE FROM sessions WHERE token = ?").run(sessionKey(token));
  }

  addFile(id, name, kind, mime, size) {
    this.db.prepare("INSERT INTO files VALUES (?, ?, ?, ?, ?)").run(id, name, kind, mime, size);
  }

  file(id) {
    return this.db.prepare("SELECT * FROM files WHERE id = ?").get(id);
  }
}
