import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, join, relative, resolve, sep, extname } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { Accounts, sessionAge } from "./server/accounts.mjs";
import { HttpError } from "./server/errors.mjs";
import { qiniuConfigured, uploadImage } from "./server/qiniu.mjs";
import {
  ContentStore, filePath, revision, validateContent, validateFiles, visibleContent, visibleWork, writeAtomic,
} from "./server/content.mjs";

const root = import.meta.dirname;
const site = realpathSync(join(root, "site"));
const maxJson = 4 * 1024 ** 2;
const maxImage = 12 * 1024 ** 2;
const maxDownload = 128 * 1024 ** 2;
const pages = new Set(["/", "/index.html", "/staff.html", "/news.html", "/picks.html", "/about.html", "/account.html"]);
const adminAssets = new Map([
  ["/admin/view.html", "index.html"], ["/admin/admin.css", "admin.css"], ["/admin/admin.js", "admin.js"],
]);
const mimeTypes = new Map(Object.entries({
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
}));
const csp = "default-src 'self'; img-src 'self' https: http:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const notFound = () => new HttpError(404, "找不到此资源。");

function inside(parent, child) {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
}

function dataDirectory(value) {
  const path = resolve(value);
  for (let probe = path; ; probe = resolve(probe, "..")) {
    try {
      const actual = resolve(realpathSync(probe), relative(probe, path));
      if (inside(site, actual)) throw Error("Private data must be stored outside the public site directory.");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return realpathSync(path);
}

function sendJsonBody(response, body, status) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(response.req.method === "HEAD" ? undefined : body);
}

function json(response, value, status = 200) {
  sendJsonBody(response, JSON.stringify(value), status);
}

function redirect(response, location) {
  response.writeHead(303, { Location: location, "Content-Length": "0" });
  response.end();
}

function bodySize(request, limit) {
  const size = Number(request.headers["content-length"]);
  if (!Number.isSafeInteger(size) || size < 1 || size > limit) {
    throw new HttpError(400, "文件或请求为空，或已超过大小限制。");
  }
  return size;
}

async function readBody(request, limit) {
  const size = bodySize(request, limit);
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > size) throw new HttpError(400, "请求大小无效。");
    chunks.push(chunk);
  }
  if (received !== size) throw new HttpError(400, "请求没有完整传输。");
  return Buffer.concat(chunks, size);
}

async function readJson(request) {
  if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(400, "数据格式须为 JSON。");
  }
  const bytes = await readBody(request, maxJson);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8").trimStart());
  } catch {
    throw new HttpError(400, "请求中的 JSON 无效。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "请求格式不正确。");
  return value;
}

function imageType(header) {
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (header.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpg";
  if (["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6))) return "gif";
  if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new HttpError(400, "请选择 PNG、JPEG、WebP 或 GIF 图片。");
}

function sendFile(request, response, path, type, extra = {}) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw notFound();
    throw error;
  }
  if (!stat.isFile()) throw notFound();
  response.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, ...extra });
  if (request.method === "HEAD") response.end();
  else pipeline(createReadStream(path), response).catch(() => response.destroy());
}

function staticAsset(path) {
  try {
    const parts = decodeURIComponent(path).split("/").slice(1);
    if (parts.some((part) => !part || part.startsWith(".") || /[\\:\u0000]/.test(part))) throw notFound();
    const target = realpathSync(join(site, ...parts));
    if (inside(site, target) && !relative(site, target).split(sep).some((part) => part.startsWith("."))) return target;
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code) && !(error instanceof URIError)) throw error;
  }
  throw notFound();
}

function nameForDownload(request) {
  const value = request.headers["x-file-name"] || "download";
  let name;
  try {
    name = decodeURIComponent(value);
  } catch {
    name = value;
  }
  const basename = name.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return [...basename].slice(0, 200).join("") || "download";
}

async function uploadPrivate(request, accounts, directory, requireAdmin) {
  const kind = request.headers["x-file-kind"];
  if (!["cover", "download"].includes(kind)) throw new HttpError(400, "请选择封面或下载文件。");
  const size = bodySize(request, kind === "cover" ? maxImage : maxDownload);
  const name = nameForDownload(request);
  const files = join(directory, "files");
  mkdirSync(files, { recursive: true, mode: 0o700 });
  const id = randomBytes(24).toString("hex");
  const pending = join(files, "." + id);
  const target = join(files, id);
  try {
    await pipeline(request, createWriteStream(pending, { flags: "wx", mode: 0o600 }));
    if (statSync(pending).size !== size) throw new HttpError(400, "文件没有完整传输。");
    let mime = "application/octet-stream";
    const file = await open(pending, "r+");
    try {
      if (kind === "cover") {
        const header = Buffer.alloc(12);
        await file.read(header);
        mime = mimeTypes.get("." + imageType(header));
      }
      await file.sync();
    } finally {
      await file.close();
    }
    requireAdmin();
    renameSync(pending, target);
    try {
      accounts.addFile(id, name, kind, mime, size);
    } catch (error) {
      rmSync(target, { force: true });
      throw error;
    }
    return { path: "/api/files/" + id, name };
  } finally {
    rmSync(pending, { force: true });
  }
}

function makeServer(directory, accounts, origin) {
  const contents = new ContentStore(directory, join(root, "content-default.js"));
  const configuredHost = origin && new URL(origin).host;
  const listeners = new Set();
  function broadcast(message) {
    for (const listener of listeners) {
      if (!listener.write(message)) listener.destroy();
    }
  }
  const notifyUpdate = () => broadcast("event: changed\ndata: 1\n\n");
  const heartbeat = setInterval(() => broadcast(": heartbeat\n\n"), 15_000);
  heartbeat.unref();

  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const port = server.address().port;
      const host = request.headers.host?.toLowerCase();
      const hosts = configuredHost ? [configuredHost] : [`localhost:${port}`, `127.0.0.1:${port}`];
      if (!hosts.includes(host)) throw new HttpError(403, "站点地址无效。");
      const requestOrigin = origin || "http://" + host;
      const url = new URL(request.url, requestOrigin);
      if (url.origin !== requestOrigin || !request.url.startsWith("/")) throw new HttpError(403, "站点地址无效。");
      const path = url.pathname;
      const method = request.method;
      const read = method === "GET" || method === "HEAD";
      const adminRoute = path === "/admin" || path === "/admin/";
      if (path.startsWith("/api/") || path.startsWith("/admin/") || adminRoute) response.setHeader("Vary", "Cookie");
      const cookieName = origin ? "__Host-tea_session" : `tea_session_${port}`;
      const token = (request.headers.cookie || "").split(";").map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
      const sessionToken = /^[a-zA-Z0-9_-]{43}$/.test(token || "") ? token : null;
      const account = accounts.session(sessionToken);
      const setup = () => !origin && !accounts.hasAdministrator();
      const requireAdmin = () => {
        const active = accounts.session(sessionToken);
        if (active?.role !== "admin") throw new HttpError(active ? 403 : 401, "请使用管理员账号登录。");
        return active;
      };
      const setSession = (next) => {
        response.setHeader("Set-Cookie", `${cookieName}=${next || ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${next ? sessionAge : 0}${origin ? "; Secure" : ""}`);
      };

      if (read && (pages.has(path) || adminRoute)) {
        if (adminRoute && account?.role !== "admin") return redirect(response, "/account.html?next=admin");
        if (path === "/admin") return redirect(response, "/admin/" + url.search);
        return sendFile(request, response, join(site, "index.html"), mimeTypes.get(".html"), { "Content-Security-Policy": csp });
      }
      if (read && path.startsWith("/assets/")) {
        const file = staticAsset(path);
        // 图片变化很少，长缓存；脚本样式靠 ?v= 版本号，给短缓存即可。
        const cache = /^\/assets\/(?:img|catalog-covers)\//.test(path)
          ? "public, max-age=2592000"
          : path.startsWith("/assets/uploads/") ? "public, max-age=604800" : "public, max-age=3600";
        response.setHeader("Cache-Control", cache);
        return sendFile(request, response, file, mimeTypes.get(extname(file).toLowerCase()) || "application/octet-stream");
      }
      if (read && adminAssets.has(path)) {
        requireAdmin();
        const file = join(root, "admin", adminAssets.get(path));
        return sendFile(request, response, file, mimeTypes.get(extname(file)));
      }
      if (read && path === "/api/session") return json(response, { account, setup: setup() });
      if (read && path === "/api/content") {
        const body = JSON.stringify({
          content: visibleContent(contents.read().content, account, requestOrigin), account, setup: setup(),
        });
        const tag = '"' + revision(body) + '"';
        response.setHeader("ETag", tag);
        if (request.headers["if-none-match"] === tag) {
          response.writeHead(304);
          return response.end();
        }
        return sendJsonBody(response, body, 200);
      }
      if (method === "GET" && path === "/api/updates") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" });
        response.write("retry: 3000\n\n");
        listeners.add(response);
        response.on("close", () => listeners.delete(response));
        return;
      }
      if (read && filePath.test(path)) {
        if (!account) throw notFound();
        const id = filePath.exec(path)[1];
        const file = accounts.file(id);
        if (!file || (account.role !== "admin" && !contents.read().content.works.some((work) =>
          visibleWork(work, account) && [work.cover, work.linkHref].includes(path)))) throw notFound();
        const encoded = encodeURIComponent(file.name).replace(/['()*]/g, (character) => "%" + character.charCodeAt(0).toString(16));
        const headers = file.kind === "download" ? { "Content-Disposition": "attachment; filename*=UTF-8''" + encoded } : {};
        return sendFile(request, response, join(directory, "files", id), file.mime, headers);
      }
      if (!read && request.headers.origin !== requestOrigin) throw new HttpError(403, "请从站点页面操作。");
      if (method === "POST" && path === "/api/logout") {
        accounts.logout(sessionToken);
        setSession(null);
        return json(response, { account: null });
      }
      if (method === "POST" && ["/api/login", "/api/setup", "/api/register"].includes(path)) {
        if (path === "/api/setup" && !setup()) throw new HttpError(403, "此入口仅用于首次本机设置。");
        if (path === "/api/register" && account) throw new HttpError(409, "请退出当前账号后注册。");
        const values = await readJson(request);
        const client = (origin ? request.headers["x-real-ip"] || request.socket.remoteAddress : request.socket.remoteAddress).slice(0, 64);
        let session;
        if (path === "/api/setup") {
          session = await accounts.create({ ...values, role: "admin" }, { first: true, signIn: true });
        } else if (path === "/api/register") {
          session = await accounts.register(values, client);
        } else {
          session = await accounts.login(values, client);
        }
        accounts.logout(sessionToken);
        setSession(session.token);
        return json(response, { account: session.account });
      }

      if (path.startsWith("/admin/api/")) {
        requireAdmin();
        if (path === "/admin/api/content" && read) {
          const { content, revision } = contents.read();
          return json(response, { content, revision });
        }
        if (path === "/admin/api/content" && method === "PUT") {
          const data = await readJson(request);
          requireAdmin();
          const content = validateContent(data.content);
          validateFiles(content, accounts);
          const saved = contents.save(data.revision, content);
          if (saved.revision !== data.revision) notifyUpdate();
          return json(response, saved);
        }
        if (path === "/admin/api/validate" && method === "POST") {
          const content = validateContent(await readJson(request));
          requireAdmin();
          validateFiles(content, accounts);
          return json(response, { content });
        }
        if (path === "/admin/api/accounts") {
          if (read) return json(response, { account, accounts: accounts.list() });
          if (method === "PUT" || method === "POST") {
            const values = await readJson(request);
            const { username } = requireAdmin();
            if (method === "PUT") {
              await accounts.update(username, values);
              notifyUpdate();
            } else {
              await accounts.create(values, { actor: username });
            }
            return json(response, { accounts: accounts.list() });
          }
        }
        if (path === "/admin/api/upload" && method === "POST") {
          const raw = await readBody(request, maxImage);
          requireAdmin();
          const type = imageType(raw);
          // 优先传到对象存储（封面不占主服务器带宽），没配 AK 就退回本地目录。
          if (qiniuConfigured()) {
            const url = await uploadImage(raw, type, mimeTypes.get("." + type));
            return json(response, { path: url }, 201);
          }
          const name = revision(raw).slice(0, 32) + "." + type;
          const uploads = join(site, "assets", "uploads");
          mkdirSync(uploads, { recursive: true });
          writeAtomic(join(uploads, name), raw);
          return json(response, { path: "assets/uploads/" + name }, 201);
        }
        if (path === "/admin/api/private-upload" && method === "POST") {
          return json(response, await uploadPrivate(request, accounts, directory, requireAdmin), 201);
        }
      }
      throw notFound();
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      if (response.headersSent || response.destroyed) response.destroy();
      else json(response, { error: error instanceof HttpError ? error.message : "暂时无法完成操作。" }, error.status || 500);
    }
  });
  server.setTimeout(30000);
  server.on("close", () => clearInterval(heartbeat));
  return server;
}

async function askPassword() {
  if (!process.stdin.isTTY) throw Error("Run --create-admin in an interactive terminal.");
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    process.stderr.write("管理员密码：");
    const password = await input.question("");
    process.stderr.write("\n再次输入密码：");
    const confirm = await input.question("");
    process.stderr.write("\n");
    if (password !== confirm) throw Error("两次输入的密码不同。");
    return password;
  } finally {
    input.close();
  }
}

try {
  const { values } = parseArgs({ options: {
    port: { type: "string", default: "8778" }, "data-dir": { type: "string", default: join(root, "data") },
    origin: { type: "string" }, "create-admin": { type: "string" },
  } });
  let origin;
  if (values.origin) {
    const url = new URL(values.origin);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw Error("--origin must be an HTTPS origin, for example https://tea-kompeito.com");
    }
    origin = url.origin;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error("Invalid port");
  process.umask(0o077);
  const directory = dataDirectory(values["data-dir"]);
  const accounts = new Accounts(join(directory, "accounts.sqlite3"));
  if (values["create-admin"]) {
    if (accounts.hasAdministrator()) throw Error("管理员已存在。");
    const password = await askPassword();
    await accounts.create({ username: values["create-admin"], password, role: "admin" }, { first: true });
    console.log("管理员已创建。");
  } else {
    const server = makeServer(directory, accounts, origin);
    server.listen(port, "127.0.0.1", () => console.log(`Site: ${origin || "http://127.0.0.1:" + server.address().port}/`));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
