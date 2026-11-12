export function mountAdmin(root, params, { signal, onAuthLost, onContentChanged }) {
  const byId = (id) => root.querySelector("#" + id);
  const ui = {
    status: byId("status"), save: byId("save"), preview: byId("preview"),
    title: byId("page-title"), caption: byId("page-caption"), add: byId("add"),
    aboutTabs: byId("about-tabs"), layout: byId("editor-layout"),
    list: byId("record-list"), filter: byId("record-filter"), records: byId("records"),
    editorTitle: byId("editor-title"), actions: byId("record-actions"),
    fields: byId("fields"), up: byId("up"), down: byId("down"), remove: byId("remove"),
    export: byId("export"), import: byId("import"), importFile: byId("import-file"),
    accountManagement: byId("account-management"), createAccount: byId("create-account"), accounts: byId("accounts"),
  };

  const roles = { member: "普通成员", reader: "授权成员", admin: "管理员" };
  const accessLevels = { public: "公开", member: "登录可见", restricted: "仅授权成员和管理员" };

  const sections = {
    works: {
      title: "作品", item: "作品", label: "name", detail: "type", page: "/index.html", id: true,
      fields: [
        ["name", "作品名称", "required"], ["orig", "原名"],
        ["type", "类型"], ["status", "状态"],
        ["access", "可见范围", "access"],
        ["cover", "封面图片", "image", "受限封面请先选定可见范围，再上传图片。"], ["desc", "作品简介", "textarea"],
        ["source", "图源"], ["tl", "翻译"], ["et", "嵌字"], ["tw", "修图"], ["pr", "校对"],
        ["link", "链接文字"],
        ["linkHref", "作品链接", "download", "公开作品可填写网址。登录可见或仅授权的作品请上传受限文件。"],
        ["keywords", "补充搜索关键词"],
      ],
    },
    staff: {
      title: "人员", item: "成员", label: "name", detail: "role", page: "/staff.html",
      fields: [["name", "成员姓名", "required"], ["role", "职务", "required"], ["bio", "成员介绍", "textarea"]],
    },
    news: {
      title: "汉化公告", item: "公告", label: "title", detail: "date", page: "/news.html",
      fields: [
        ["title", "公告标题", "required"], ["date", "发布日期", "date"],
        ["body", "公告正文", "textarea"], ["href", "标题链接"],
        ["keywords", "补充搜索关键词"],
      ],
    },
    picks: {
      title: "特别推荐", item: "推荐", label: "title", detail: "source", page: "/picks.html",
      fields: [
        ["title", "推荐标题", "required"], ["source", "来源或类型"],
        ["cover", "封面图片", "image"], ["body", "推荐正文", "textarea"],
        ["href", "标题链接"], ["keywords", "补充搜索关键词"],
      ],
    },
    sections: {
      title: "正文栏目", item: "栏目", label: "title", detail: "body", page: "/about.html", id: true,
      fields: [
        ["title", "栏目标题"], ["body", "栏目正文", "textarea", "每行一段。以「- 」开头可写列表，用 **文字** 加粗。"],
        ["keywords", "补充搜索关键词"],
      ],
    },
    contacts: {
      title: "联系方式", item: "联系方式", label: "name", detail: "value", page: "/about.html",
      fields: [["name", "名称", "required"], ["value", "显示内容", "required"], ["href", "跳转链接"]],
    },
    aboutSettings: {
      title: "关于页设置", page: "/about.html",
      fields: [["contactTitle", "联系方式标题"], ["contactNote", "联系说明", "textarea"], ["seal", "印章文字"]],
    },
    settings: {
      title: "站点设置", page: "/",
      fields: [
        ["title", "站点名称", "required"], ["staffSlots", "最少纸人数", "number", "不足时用空白纸人补齐。"],
        ["brand", "刊头图片", "image", "留空显示站点名称。"], ["banner", "横幅图片", "image"],
        ["worksTitle", "作品页名称", "required"], ["staffTitle", "人员页名称", "required"],
        ["newsTitle", "公告页名称", "required"], ["picksTitle", "推荐页名称", "required"],
        ["aboutTitle", "关于页名称", "required"],
        ["worksNote", "作品页提示"], ["newsNote", "公告页提示"], ["picksNote", "推荐页提示"], ["aboutNote", "关于页提示"],
      ],
    },
  };

  let draft;
  let revision;
  let current;
  let aboutTab = "sections";
  let selected = 0;
  let dirty = false;
  let busy = false;
  let accountsBusy = false;
  let currentAccount;

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function currentSection() {
    return sections[current === "about" ? aboutTab : current];
  }

  function collection() {
    if (current === "about") return aboutTab === "aboutSettings" ? draft.about : draft.about[aboutTab];
    return draft[current];
  }

  function setStatus(text, tone = "") {
    ui.status.textContent = text;
    ui.status.dataset.tone = tone;
  }

  function updateControls() {
    ui.save.disabled = !draft || !dirty || busy;
    ui.export.disabled = !draft || busy;
    ui.import.disabled = !draft || busy;
    ui.layout.inert = busy;
    ui.add.disabled = busy;
  }

  function markDirty() {
    dirty = true;
    setStatus("有未保存的更改");
    updateControls();
  }

  async function request(path, options) {
    const response = await fetch("/admin/api/" + path, { ...options, signal });
    if (response.status === 401 || response.status === 403) onAuthLost();
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "请求失败，请重试。");
    return result;
  }

  function show(params) {
    const section = params.get("section");
    const tab = params.get("tab");
    const next = ["about", "accounts", "settings", "works", "staff", "news", "picks"].includes(section) ? section : "works";
    const nextTab = ["sections", "contacts", "aboutSettings"].includes(tab) ? tab : "sections";
    if (current === next && (next !== "about" || aboutTab === nextTab)) return;
    current = next;
    aboutTab = nextTab;
    selected = 0;
    ui.filter.value = "";
    if (!draft) return;
    render();
    if (current === "accounts" && !accountsBusy) loadAccounts();
  }

  function fillOptions(select, options, selected) {
    for (const [value, label] of Object.entries(options)) select.add(new Option(label, value));
    select.value = selected;
    return select;
  }

  function accountField(label, input) {
    const field = make("div", "field");
    const caption = make("label", "", label);
    caption.htmlFor = input.id;
    field.append(caption, input);
    return field;
  }

  function renderAccounts(accounts) {
    ui.accounts.replaceChildren();
    for (const account of accounts) {
      const ownAccount = currentAccount === account.username;
      const form = make("form", "account-row");
      form.method = "post";
      form.setAttribute("aria-label", account.username + " 的账号设置");
      const identity = make("div", "account-identity");
      const enabled = make("input");
      enabled.type = "checkbox";
      enabled.checked = Boolean(account.enabled);
      enabled.disabled = ownAccount;
      const enabledLabel = make("label", "account-enabled");
      enabledLabel.append(enabled, document.createTextNode("启用账号"));
      identity.append(make("strong", "", account.username + (ownAccount ? "（当前）" : "")), enabledLabel);

      const role = fillOptions(make("select"), roles, account.role);
      role.id = "role-" + account.username;
      role.disabled = ownAccount;
      const password = make("input");
      password.id = "password-" + account.username;
      password.type = "password";
      password.minLength = 10;
      password.maxLength = 128;
      password.autocomplete = "new-password";
      password.placeholder = "留空保留原密码";
      const submit = make("button", "secondary account-submit", "更新账号");
      submit.type = "submit";
      form.append(identity, accountField("账号权限", role), accountField("重置密码", password), submit);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        updateAccount("PUT", {
          username: account.username, role: role.value, enabled: enabled.checked, password: password.value,
        }, Boolean(ownAccount && password.value));
      });
      ui.accounts.append(form);
    }
  }

  async function loadAccounts() {
    accountsBusy = true;
    ui.accountManagement.inert = true;
    try {
      const result = await request("accounts");
      currentAccount = result.account.username;
      renderAccounts(result.accounts);
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      accountsBusy = false;
      ui.accountManagement.inert = false;
    }
  }

  async function updateAccount(method, account, reauthenticate = false) {
    if (accountsBusy) return;
    accountsBusy = true;
    ui.accountManagement.inert = true;
    try {
      const result = await request("accounts", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(account),
      });
      if (method === "POST") ui.createAccount.reset();
      renderAccounts(result.accounts);
      setStatus(reauthenticate ? "密码已更新，请重新登录。" : "账号已保存。", "success");
      if (reauthenticate && !dirty) onAuthLost();
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      accountsBusy = false;
      ui.accountManagement.inert = false;
    }
  }

  function titleFor(record, definition, index) {
    return record[definition.label] || (definition.item + " " + (index + 1));
  }

  function updateRecordLabel(row, record, definition, index) {
    row.querySelector("strong").textContent = titleFor(record, definition, index);
    const details = row.querySelector("small");
    details.textContent = (record[definition.detail] || "").split("\n")[0].slice(0, 85);
    details.hidden = !details.textContent;
  }

  function renderRecords() {
    const items = collection();
    const definition = currentSection();
    const keyword = ui.filter.value.trim().normalize("NFKC").toLowerCase();
    ui.records.replaceChildren();
    items.forEach((record, index) => {
      const title = titleFor(record, definition, index);
      if (keyword && !title.normalize("NFKC").toLowerCase().includes(keyword)) return;
      const row = make("button");
      row.type = "button";
      row.dataset.index = String(index);
      if (index === selected) row.setAttribute("aria-current", "true");
      row.append(make("strong"), make("small"));
      updateRecordLabel(row, record, definition, index);
      row.addEventListener("click", () => {
        selected = index;
        render();
        ui.records.querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
      });
      ui.records.append(row);
    });
    if (!ui.records.children.length) {
      ui.records.append(make("p", "editor-empty", items.length ? "没有匹配的条目。" : "还没有条目。"));
    }
  }

  function previewImage(preview, value) {
    try {
      const src = new URL(value, location.origin + "/");
      if (value && ["https:", "http:"].includes(src.protocol)) {
        preview.src = src.href;
        preview.hidden = false;
        return;
      }
    } catch {
      // A partial address can be edited before it is saved.
    }
    preview.hidden = true;
    preview.removeAttribute("src");
  }

  function fieldEditor(model, [key, label, kind, hint], definition) {
    const type = kind || "text";
    const field = make("div", ["textarea", "image", "download"].includes(type) ? "field wide" : "field");
    const caption = make("label", "", label);
    caption.htmlFor = "field-" + key;
    if (["required", "date"].includes(type)) caption.append(make("span", "required", " *"));
    const control = make({ textarea: "textarea", access: "select" }[type] || "input");
    control.id = caption.htmlFor;
    if (type === "access") fillOptions(control, accessLevels, model[key] || "public");
    if (control.tagName === "INPUT") control.type = ["date", "number"].includes(type) ? type : "text";
    control.required = ["required", "date"].includes(type);
    if (type === "number") {
      control.min = "0";
      control.max = "240";
      control.step = "1";
    }
    if (type !== "access") control.value = model[key] ?? "";
    control.addEventListener("input", () => {
      model[key] = type === "number" ? control.valueAsNumber : control.value;
      if (type === "access") ui.fields.querySelector("[data-restricted-upload]").hidden = control.value === "public";
      if (definition.item) {
        const row = ui.records.querySelector('[aria-current="true"]');
        if (row) updateRecordLabel(row, model, definition, selected);
        ui.editorTitle.textContent = titleFor(model, definition, selected);
      }
      markDirty();
    });
    field.append(caption);

    if (type === "image" || type === "download") {
      const isImage = type === "image";
      const box = make("div", "image-field");
      const upload = make("button", "secondary", isImage ? "上传图片" : "上传受限文件");
      upload.type = "button";
      if (!isImage) {
        upload.dataset.restrictedUpload = "";
        upload.hidden = !model.access || model.access === "public";
      }
      const file = make("input");
      file.type = "file";
      if (isImage) file.accept = "image/png,image/jpeg,image/webp,image/gif";
      file.hidden = true;
      const preview = isImage ? make("img", "image-preview") : null;
      if (preview) {
        preview.alt = "当前图片";
        preview.addEventListener("error", () => { preview.hidden = true; });
        previewImage(preview, control.value);
        control.addEventListener("change", () => previewImage(preview, control.value));
      }
      upload.addEventListener("click", () => file.click());
      file.addEventListener("change", async () => {
        const attachment = file.files[0];
        file.value = "";
        if (!attachment) return;
        const restricted = definition === sections.works && model.access && model.access !== "public";
        const headers = { "Content-Type": attachment.type || "application/octet-stream" };
        if (restricted) {
          headers["X-File-Kind"] = isImage ? "cover" : "download";
          headers["X-File-Name"] = encodeURIComponent(attachment.name);
        }
        busy = true;
        updateControls();
        setStatus("正在上传文件…");
        try {
          const result = await request(restricted ? "private-upload" : "upload", {
            method: "POST", headers, body: attachment,
          });
          model[key] = result.path;
          control.value = result.path;
          if (preview) previewImage(preview, control.value);
          if (!isImage && (!model.link || model.link === "待补充")) {
            model.link = "下载文件";
            if (ui.fields.contains(control)) byId("field-link").value = model.link;
          }
          markDirty();
        } catch (error) {
          setStatus(error.message, "error");
        } finally {
          busy = false;
          updateControls();
        }
      });
      box.append(control, upload, file);
      field.append(box);
      if (preview) field.append(preview);
    } else {
      field.append(control);
    }
    if (hint) field.append(make("p", "hint", hint));
    return field;
  }

  function render() {
    byId("site-name").textContent = draft.settings.title;
    for (const button of root.querySelectorAll("[data-section], [data-about]")) {
      if (button.dataset.section === current || button.dataset.about === aboutTab) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }
    ui.accountManagement.hidden = current !== "accounts";
    ui.aboutTabs.hidden = current !== "about";
    if (current === "accounts") {
      ui.title.textContent = "账号与权限";
      ui.caption.textContent = "普通成员可看登录可见作品。授权成员可同时查看仅授权的作品。";
      ui.preview.href = "/index.html";
      ui.add.hidden = true;
      ui.layout.hidden = true;
      return;
    }

    const definition = currentSection();
    const items = collection();
    const isList = Array.isArray(items);
    const model = isList ? items[selected] : items;
    const pageTitle = current === "about" ? "关于我们" : definition.title;

    ui.title.textContent = pageTitle;
    ui.caption.textContent = isList ? "共 " + items.length + " 条" : "";
    ui.preview.href = current === "works" && model && model.id
      ? "/index.html?work=" + encodeURIComponent(model.id) + "#work-detail" : definition.page;
    ui.add.hidden = !isList;
    ui.add.textContent = isList ? "＋ 新增" + definition.item : "";
    ui.layout.hidden = false;
    ui.layout.classList.toggle("single", !isList);
    ui.list.hidden = !isList;
    ui.actions.hidden = !isList || !model;
    ui.up.disabled = selected <= 0;
    ui.down.disabled = !isList || selected >= items.length - 1;
    ui.editorTitle.textContent = model && isList ? titleFor(model, definition, selected) : definition.title;
    if (isList) renderRecords();
    ui.fields.replaceChildren();
    if (model) {
      ui.fields.append(...definition.fields.map((descriptor) => fieldEditor(model, descriptor, definition)));
    } else {
      ui.fields.append(make("p", "editor-empty", "新增一项后即可编辑。"));
    }
  }

  function addRecord() {
    const definition = currentSection();
    const items = collection();
    const record = Object.fromEntries(definition.fields.map(([key]) => [key, ""]));
    if (definition.id) record.id = crypto.randomUUID();
    if (current === "works") record.access = "public";
    if (current === "news") record.date = new Date().toLocaleDateString("sv-SE");
    items.push(record);
    selected = items.length - 1;
    ui.filter.value = "";
    markDirty();
    render();
    ui.fields.querySelector("input, textarea")?.focus();
  }

  function moveRecord(step) {
    const items = collection();
    const index = selected + step;
    if (index < 0 || index >= items.length) return;
    [items[index], items[selected]] = [items[selected], items[index]];
    selected = index;
    markDirty();
    render();
  }

  async function save() {
    if (!dirty || busy) return;
    busy = true;
    updateControls();
    setStatus("正在保存…");
    try {
      const result = await request("content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, content: draft }),
      });
      draft = result.content;
      revision = result.revision;
      dirty = false;
      onContentChanged();
      render();
      setStatus("已保存到项目文件", "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      busy = false;
      updateControls();
    }
  }

  function exportDraft() {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const anchor = make("a");
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = "tea-site-content.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importDraft() {
    const file = ui.importFile.files[0];
    ui.importFile.value = "";
    if (!file) return;
    busy = true;
    updateControls();
    try {
      const result = await request("validate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: file,
      });
      draft = result.content;
      selected = 0;
      ui.filter.value = "";
      markDirty();
      render();
      setStatus("已导入草稿，保存后写入项目文件", "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      busy = false;
      updateControls();
    }
  }

  ui.filter.addEventListener("input", renderRecords);
  ui.add.addEventListener("click", addRecord);
  ui.up.addEventListener("click", () => moveRecord(-1));
  ui.down.addEventListener("click", () => moveRecord(1));
  ui.remove.addEventListener("click", () => {
    const items = collection();
    items.splice(selected, 1);
    selected = Math.max(0, Math.min(selected, items.length - 1));
    markDirty();
    render();
  });
  ui.save.addEventListener("click", save);
  ui.export.addEventListener("click", exportDraft);
  ui.import.addEventListener("click", () => ui.importFile.click());
  ui.importFile.addEventListener("change", importDraft);
  fillOptions(ui.createAccount.elements.role, roles, "member");
  ui.createAccount.addEventListener("submit", (event) => {
    event.preventDefault();
    const account = Object.fromEntries(new FormData(ui.createAccount));
    updateAccount("POST", account);
  });
  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  }, { signal });

  show(params);
  request("content").then((result) => {
    draft = result.content;
    revision = result.revision;
    render();
    if (current === "accounts" && !accountsBusy) loadAccounts();
    setStatus("项目内容已加载");
    updateControls();
  }).catch((error) => setStatus(error.message, "error"));

  return { show };
}
