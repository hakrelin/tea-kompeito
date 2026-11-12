const defaultCover = "assets/img/work-cover.webp";

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function linkText(text, href) {
  if (!href) return document.createTextNode(text);
  const link = node("a", "", text);
  link.href = href;
  return link;
}

function cover(src, lazy = false) {
  const image = node("img");
  image.src = src;
  image.alt = "";
  if (lazy) image.loading = "lazy";
  return image;
}

function workCard(work) {
  const button = node("button", "work");
  button.type = "button";
  button.id = "work-" + work.id;
  button.setAttribute("aria-labelledby", "title-" + work.id);
  button.setAttribute("aria-controls", "work-detail");
  button.setAttribute("aria-pressed", "false");
  for (const field of ["name", "orig", "type", "status", "source", "tl", "et", "tw", "pr", "link", "linkHref", "desc"]) {
    button.dataset[field] = work[field] || "";
  }
  button.dataset.search = work.keywords || "";

  const art = node("span", "work-art");
  const frame = node("span", "frame");
  frame.setAttribute("aria-hidden", "true");
  art.append(cover(work.cover || defaultCover, true), frame);

  const caption = node("span", "work-caption");
  const title = node("span", "work-label", work.name);
  title.id = "title-" + work.id;
  caption.append(title);
  if (work.orig) {
    const original = node("span", "work-original", work.orig);
    original.lang = "ja";
    caption.append(original);
  }
  if (work.type) caption.append(node("span", "work-kind", work.type));
  button.append(art, caption);
  return button;
}

function staffPaper(member) {
  const card = node(member ? "article" : "div", "staff");
  const paper = node("span", "staff-paper");
  if (!member) {
    card.dataset.placeholder = "";
    card.setAttribute("aria-hidden", "true");
    card.append(paper);
    return card;
  }

  card.dataset.search = member.bio || "";
  const button = node("button", "staff-trigger");
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "staff-details");
  paper.append(node("span", "role", member.role), node("span", "who", member.name));
  button.append(paper);
  card.append(button);
  return card;
}

function notice(item) {
  const row = node("li");
  row.dataset.search = item.keywords || "";
  const date = node("time", "", item.date.replaceAll("-", "."));
  date.dateTime = item.date;
  const copy = node("div");
  const title = node("h3", "t");
  title.append(linkText(item.title, item.href));
  copy.append(title, node("span", "d", item.body));
  row.append(date, copy);
  return row;
}

function pick(item) {
  const card = node("article", item.cover ? "pick" : "pick pick-text");
  card.dataset.search = item.keywords || "";
  const copy = node("div");
  const title = node("h3");
  title.append(linkText(item.title, item.href));
  copy.append(title);
  if (item.source) copy.append(node("span", "by", item.source));
  if (item.body) copy.append(node("p", "", item.body));
  if (item.cover) card.append(cover(item.cover, true));
  card.append(copy);
  return card;
}

function appendLine(element, text) {
  for (const part of text.split(/(\*\*[^*]+\*\*)/)) {
    element.append(part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? node("strong", "", part.slice(2, -2)) : part);
  }
}

function aboutSection(section) {
  const block = node("section", "prose");
  block.id = section.id;
  block.dataset.search = section.keywords || "";
  if (section.title) block.append(node("h3", "", section.title));
  let list;
  for (const text of section.body.split(/\r?\n/)) {
    const line = text.trim();
    if (line.startsWith("- ")) {
      if (!list) {
        list = node("ul");
        block.append(list);
      }
      const item = node("li");
      appendLine(item, line.slice(2));
      list.append(item);
    } else {
      list = null;
      if (line) {
        const paragraph = node("p");
        appendLine(paragraph, line);
        block.append(paragraph);
      }
    }
  }
  return block;
}

function renderAbout(view, about) {
  const copy = view.querySelector(".about-copy");
  const blocks = about.sections.map(aboutSection);
  if (about.seal) {
    const last = blocks.at(-1) || node("section", "prose");
    const paragraph = node("p");
    paragraph.append(node("span", "stamp", about.seal));
    last.append(paragraph);
    if (!blocks.length) blocks.push(last);
  }
  copy.replaceChildren(...blocks);

  const card = view.querySelector(".about-card");
  card.hidden = !(about.contactTitle || about.contactNote || about.contacts.length);
  if (card.hidden) return;
  card.dataset.search = "联系方式 QQ 群 邮箱 频道";
  if (about.contactTitle) card.append(node("h3", "", about.contactTitle));
  if (about.contactNote) card.append(node("p", "", about.contactNote));
  if (about.contacts.length) {
    const list = node("dl");
    for (const contact of about.contacts) {
      const value = node("dd");
      value.append(linkText(contact.value, contact.href));
      list.append(node("dt", "", contact.name), value);
    }
    card.append(list);
  }
}

export function renderShell(data, account) {
  const { settings } = data;
  for (const link of document.querySelectorAll(".nav a")) {
    link.firstElementChild.textContent = settings[link.dataset.section + "Title"];
  }

  const brand = document.querySelector(".brand a");
  if (settings.brand) {
    const logo = brand.querySelector("img") || node("img");
    logo.src = new URL(settings.brand, location.origin + "/").href;
    logo.alt = settings.title;
    logo.width = 1191;
    logo.height = 177;
    brand.replaceChildren(logo);
  } else {
    brand.replaceChildren(node("span", "brand-text", settings.title));
  }
  const banner = document.querySelector(".hero");
  banner.hidden = !settings.banner;
  if (settings.banner) banner.src = new URL(settings.banner, location.origin + "/").href;
  document.querySelector(".account-entry").textContent = account ? "我的账号" : "登录";
}

export function renderView(view, page, data) {
  const { settings } = data;
  view.querySelector("h2").textContent = settings[page + "Title"];
  const note = view.querySelector(".sample-note");
  if (note) {
    note.textContent = settings[page + "Note"] || "";
    note.hidden = !note.textContent;
  }

  if (page === "works") {
    view.querySelector("#works-grid").replaceChildren(...data.works.map(workCard));
  } else if (page === "staff") {
    const papers = data.staff.map(staffPaper);
    while (papers.length < settings.staffSlots) papers.push(staffPaper());
    view.querySelector("#staff-grid").replaceChildren(...papers);
    view.querySelector("#staff-works").textContent = "查看参与作品";
  } else if (page === "news") {
    view.querySelector(".notice").replaceChildren(...data.news.map(notice));
  } else if (page === "picks") {
    view.querySelector(".picks").replaceChildren(...data.picks.map(pick));
  } else if (page === "about") {
    renderAbout(view, data.about);
  }
}
