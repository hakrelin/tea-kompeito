import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HttpError } from "./errors.mjs";

export const filePath = /^\/api\/files\/([0-9a-f]{48})$/;
const levels = new Map([["public", 0], ["member", 1], ["restricted", 2]]);
const accountLevels = new Map([["member", 1], ["reader", 2], ["admin", 2]]);
const illustrations = new Set(["assets/img/work-cover.webp",
  ...Array.from({ length: 6 }, (_, i) => `assets/img/cover${i + 1}.webp`)]);
const prefix = "window.TEA_CONTENT = ";
const identifier = /^[a-zA-Z0-9_-]{1,100}$/;

const invalid = (message) => { throw new HttpError(400, message); };
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function fields(value, names, label, required = []) {
  if (!isRecord(value)) invalid(label + "格式不正确。");
  const row = {};
  for (const name of names.split(" ")) {
    const text = Object.hasOwn(value, name) ? value[name] : "";
    if (typeof text !== "string" || text.length > 30000 || !text.isWellFormed()) {
      invalid(label + "包含无效文字或文字过长。");
    }
    row[name] = text.trim();
  }
  if (required.some((key) => !row[key])) invalid(label + "有必填项未填写。");
  return row;
}

function checkUrl(value, label, image = false) {
  if (!value) return;
  try {
    if (/[\u0000-\u0020\\]/.test(value) || value.startsWith("//")) throw Error();
    const url = new URL(value, "https://relative.invalid/");
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
    if (!hasScheme) {
      if (!value.split(/[?#]/, 1)[0].split("/").includes("..")) return;
    } else if (/^https?:\/\//i.test(value) && url.hostname) {
      return;
    } else if (!image && url.protocol === "mailto:" && url.pathname) {
      return;
    }
  } catch {
    // Report a field-specific validation error below.
  }
  invalid(label + "链接无效。请填写站内路径或完整网址。");
}

function rows(value, label, names, { required, urls = [], images = [], ids = false } = {}) {
  if (!Array.isArray(value) || value.length > 2000) invalid(label + "列表格式不正确或条目过多。");
  const seen = new Set();
  return value.map((entry, index) => {
    const itemLabel = `${label}第 ${index + 1} 项`;
    const row = fields(entry, names, itemLabel, required);
    if (ids) {
      if (!identifier.test(row.id) || seen.has(row.id)) invalid(itemLabel + "的编号无效或重复。");
      seen.add(row.id);
    }
    for (const field of urls) checkUrl(row[field], itemLabel);
    for (const field of images) checkUrl(row[field], itemLabel + "的图片", true);
    return row;
  });
}

export function validateContent(data) {
  if (!isRecord(data)) invalid("站点数据格式不正确。");
  const titles = ["title", "worksTitle", "staffTitle", "newsTitle", "picksTitle", "aboutTitle"];
  const settings = fields(data.settings, titles.join(" ") + " brand banner worksNote newsNote picksNote aboutNote", "站点设置", titles);
  const slots = Object.hasOwn(data.settings, "staffSlots") ? data.settings.staffSlots : 12;
  if (!Number.isInteger(slots) || slots < 0 || slots > 240) invalid("最少纸人数必须为 0 到 240 之间的整数。");
  settings.staffSlots = slots;
  for (const key of ["brand", "banner"]) checkUrl(settings[key], "站点图片", true);

  const works = rows(data.works, "作品", "id name orig type status source tl et tw pr cover link linkHref desc keywords access",
    { required: ["id", "name"], urls: ["linkHref"], images: ["cover"], ids: true });
  for (const [index, work] of works.entries()) {
    // Earlier workboard imports kept the credit in the description and search keywords.
    if (work.id.startsWith("board-") && !Object.hasOwn(data.works[index], "source")) {
      const legacySource = /^图源：([^\r\n]+)$/.exec(work.desc)?.[1].trim();
      if (legacySource) {
        work.source = legacySource;
        work.desc = "";
        if (work.keywords === legacySource) work.keywords = "";
      }
    }
    work.access ||= "public";
    if (!levels.has(work.access)) invalid("作品可见范围无效。");
    const { cover, linkHref } = work;
    if (work.access === "public") {
      if (filePath.test(cover) || filePath.test(linkHref)) invalid("公开作品请使用公开的封面和链接。");
    } else if ((cover && !illustrations.has(cover) && !filePath.test(cover)) || (linkHref && !filePath.test(linkHref))) {
      invalid(`《${work.name}》的受限封面和下载文件须通过受限上传保存。`);
    }
  }
  const staff = rows(data.staff, "人员", "name role bio", { required: ["name", "role"] });
  const news = rows(data.news, "公告", "title date body href keywords", { required: ["title", "date"], urls: ["href"] });
  for (const item of news) {
    const date = new Date(item.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.date.startsWith("0000-") ||
        Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== item.date) {
      invalid("公告日期须为有效的年月日。");
    }
  }
  const picks = rows(data.picks, "推荐", "title source body cover href keywords",
    { required: ["title"], urls: ["href"], images: ["cover"] });
  const about = fields(data.about, "contactTitle contactNote seal", "关于页");
  about.sections = rows(data.about.sections, "关于栏目", "id title body keywords", { required: ["id"], ids: true });
  about.contacts = rows(data.about.contacts, "联系方式", "name value href", { required: ["name", "value"], urls: ["href"] });
  return { settings, works, staff, news, picks, about };
}

export function visibleWork(work, account) {
  return (accountLevels.get(account?.role) ?? 0) >= levels.get(work.access);
}

export function visibleContent(data, account, origin) {
  const works = data.works.filter((work) => visibleWork(work, account));
  const hidden = new Set(data.works.filter((work) => !visibleWork(work, account)).map((work) => work.id));
  if (!hidden.size) return data;
  const relatedVisible = ({ href }) => {
    const url = new URL(href, origin + "/");
    return url.origin !== origin || !["/index.html", "/"].includes(url.pathname) ||
      !url.searchParams.getAll("work").some((id) => hidden.has(id));
  };
  return {
    ...data, works, news: data.news.filter(relatedVisible), picks: data.picks.filter(relatedVisible),
    about: { ...data.about, contacts: data.about.contacts.filter(relatedVisible) },
  };
}

export function validateFiles(data, accounts) {
  const assigned = new Map();
  for (const work of data.works) {
    for (const [field, kind] of [["cover", "cover"], ["linkHref", "download"]]) {
      const id = filePath.exec(work[field])?.[1];
      if (!id) continue;
      if (accounts.file(id)?.kind !== kind) invalid(`《${work.name}》的受限文件无效，请重新上传。`);
      if (assigned.has(id) && assigned.get(id) !== work.id) invalid("每份受限文件只能关联一部作品，请为其他作品单独上传。");
      assigned.set(id, work.id);
    }
  }
}

export const revision = (raw) => createHash("sha256").update(raw).digest("hex");

export function writeAtomic(path, raw) {
  const temporary = join(dirname(path), "." + randomUUID() + ".tmp");
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, raw);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export class ContentStore {
  constructor(directory, seed) {
    this.file = join(directory, "content.js");
    this.backup = join(directory, "content-backup.js");
    this.seed = seed;
  }

  read() {
    let raw;
    try {
      raw = readFileSync(this.file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      raw = readFileSync(this.seed);
    }
    const source = raw.toString("utf8").trim();
    if (!source.startsWith(prefix) || !source.endsWith(";")) throw Error("Invalid site content file");
    return { raw, content: validateContent(JSON.parse(source.slice(prefix.length, -1))), revision: revision(raw) };
  }

  save(expected, content) {
    const current = this.read();
    if (expected !== current.revision) {
      throw new HttpError(409, "项目文件已有更新。请先导出草稿，再刷新后台核对后保存。");
    }
    const raw = Buffer.from(prefix + JSON.stringify(content, null, 2) + ";\n");
    if (!raw.equals(current.raw)) {
      writeAtomic(this.backup, current.raw);
      writeAtomic(this.file, raw);
    }
    return { content, revision: revision(raw) };
  }
}
