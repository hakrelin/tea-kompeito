import { renderShell, renderView } from "./content-view.js?v=6";
import { setupAccount } from "./account.js?v=4";
import { setupPublicView } from "./public-views.js?v=3";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const main = document.getElementById("main-content");
const search = document.querySelector(".search");
const query = document.getElementById("q");
const clearSearch = document.querySelector(".clear-search");
const accountLink = document.querySelector(".account-entry");
const navigation = [...document.querySelectorAll(".nav a"), accountLink];
const routes = new Map(navigation.map((link) => [new URL(link.href).pathname, link.dataset.section || "account"]));
routes.set("/", "works");
routes.set("/admin", "admin");
routes.set("/admin/", "admin");
const searchCopy = {
  works: ["搜索作品、参与者…", "搜索作品"],
  staff: ["搜索成员、职位…", "搜索成员"],
  news: ["搜索公告…", "搜索公告"],
  picks: ["搜索推荐…", "搜索推荐"],
  about: ["搜索本页…", "搜索本页"],
};
let session;
let viewLifetime;
let mountedRoute;
let filter;
let adminView;
let adminRequest;
let adminLifetime;
let publicContentChanged = false;
let routeVersion = 0;

function clearView() {
  viewLifetime?.abort();
  main.querySelector("dialog[open]")?.close();
  filter = undefined;
  main.replaceChildren();
}

function renderStatus(message, busy) {
  clearView();
  search.hidden = true;
  main.setAttribute("aria-busy", String(busy));
  const panel = document.createElement("div");
  panel.className = "panel-body";
  const status = document.createElement("p");
  status.className = "empty";
  status.setAttribute("role", "status");
  status.textContent = message;
  panel.append(status);
  main.append(panel);
}

function scrollToRoute(url, fallback) {
  let anchor;
  try {
    anchor = document.getElementById(decodeURIComponent(url.hash.slice(1)));
  } catch {
    // An invalid fragment has no target.
  }
  if (anchor) anchor.scrollIntoView({ block: "start" });
  else if (typeof fallback === "number") window.scrollTo(0, fallback);
}

function routeKey(url) {
  return url.pathname + url.search;
}

function animateView(view) {
  if (reducedMotion.matches) return;
  view.getAnimations().forEach((animation) => animation.cancel());
  view.animate(
    [{ opacity: .48, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
    { duration: 320, easing: "cubic-bezier(.22, .61, .36, 1)" }
  );
}

function discardAdmin() {
  adminLifetime?.abort();
  adminView = undefined;
  adminRequest = undefined;
}

function goToAdminLogin() {
  discardAdmin();
  history.replaceState(null, "", "/account.html?next=admin");
  refreshContent({ focus: true });
}

async function loadAdmin(signal) {
  const response = await fetch("/admin/view.html", { signal });
  if (response.status === 401 || response.status === 403) {
    goToAdminLogin();
    return;
  }
  if (!response.ok) throw Error("Admin view unavailable");
  const template = document.createElement("template");
  template.innerHTML = await response.text();
  const stylesheet = document.querySelector("#admin-style");
  const styleReady = stylesheet ? Promise.resolve() : new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.id = "admin-style";
    link.rel = "stylesheet";
    link.href = "/admin/admin.css?v=3";
    link.onload = resolve;
    link.onerror = () => { link.remove(); reject(Error("Admin style unavailable")); };
    document.head.append(link);
  });
  const [module] = await Promise.all([import("/admin/admin.js?v=4"), styleReady]);
  return { element: template.content.firstElementChild, mount: module.mountAdmin };
}

async function showAdmin(url, options, version) {
  if (!main.querySelector(".admin-app")) renderStatus("正在读取管理后台…", true);
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) throw Error("Session unavailable");
    const { account } = await response.json();
    if (version !== routeVersion) return;
    if (account?.role !== "admin" || account.username !== session.account?.username) {
      goToAdminLogin();
      return;
    }
    if (!adminRequest) {
      adminLifetime = new AbortController();
      adminRequest = loadAdmin(adminLifetime.signal);
    }
    const admin = await adminRequest;
    if (!admin || version !== routeVersion) return;
    if (!adminView) {
      adminView = admin;
      admin.editor = admin.mount(admin.element, url.searchParams, {
        signal: adminLifetime.signal,
        onAuthLost: goToAdminLogin,
        onContentChanged: () => {
          publicContentChanged = true;
          synchronizeContent();
        },
      });
    }
    if (!main.contains(admin.element)) {
      clearView();
      main.append(admin.element);
    }
    admin.editor.show(url.searchParams);
    main.setAttribute("aria-busy", "false");
    if (options.animate) animateView(admin.element.querySelector(".main"));
    if (options.focus) main.focus({ preventScroll: true });
    scrollToRoute(url, options.scroll);
  } catch {
    if (version === routeVersion) {
      discardAdmin();
      renderStatus("管理后台加载失败，请刷新页面。", false);
    }
  }
}

function showRoute({ animate = false, focus = false, scroll, preserveView = false } = {}) {
  const url = new URL(location.href);
  const page = routes.get(url.pathname);
  const version = ++routeVersion;
  for (const link of navigation) {
    if ((link.dataset.section || "account") === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (!session) return;
  if (page === "account" && url.searchParams.get("next") === "admin" && session.account?.role === "admin") {
    history.replaceState(null, "", "/admin/");
    showRoute({ animate, focus, scroll });
    return;
  }
  if (page !== "admin" && publicContentChanged) {
    refreshContent({ animate, focus, scroll });
    return;
  }

  mountedRoute = routeKey(url);
  document.body.dataset.route = page;
  if (page === "admin") {
    query.value = "";
    search.hidden = true;
    document.title = "内容管理 · " + session.content.settings.title;
    showAdmin(url, { animate, focus, scroll }, version);
    return;
  }

  const current = preserveView && main.firstElementChild?.dataset.view === page ? main.firstElementChild : null;
  const searchText = current ? query.value : undefined;
  const listScroll = current?.querySelector("#catalog-scroll")?.scrollTop;
  const selectedWork = current?.querySelector(".work.is-active")?.id.slice(5);
  const staffPage = Number(current?.querySelector("#staff-grid")?.dataset.page || 0);
  if (selectedWork) url.searchParams.set("work", selectedWork);
  clearView();
  viewLifetime = new AbortController();
  const view = document.getElementById("view-" + page).content.firstElementChild.cloneNode(true);
  main.setAttribute("aria-busy", "false");
  main.append(view);
  const { content, account } = session;
  const title = page === "account" ? accountLink.textContent : content.settings[page + "Title"];
  document.title = title + " · " + content.settings.title;

  search.hidden = page === "account";
  if (page === "account") {
    query.value = "";
    setupAccount(view, session, url.searchParams, (returnToWorks) => {
      if (returnToWorks && view.isConnected) history.replaceState(null, "", "/index.html");
      discardAdmin();
      refreshContent({ focus: true });
    });
  } else {
    renderView(view, page, content);
    query.placeholder = searchCopy[page][0];
    query.setAttribute("aria-label", searchCopy[page][1]);
    query.value = searchText ?? history.state?.query ?? url.searchParams.get("q") ?? "";
    filter = setupPublicView(view, page, url.searchParams, viewLifetime.signal, staffPage);
    updateFilter();
    if (listScroll !== undefined) view.querySelector("#catalog-scroll").scrollTop = listScroll;
  }

  if (animate) animateView(view);
  if (focus) main.focus({ preventScroll: true });
  if (!preserveView) scrollToRoute(url, scroll);
}

function updateFilter() {
  clearSearch.hidden = !query.value;
  filter?.(query.value);
}

function rememberSearch() {
  history.replaceState({ ...history.state, query: query.value }, "");
  updateFilter();
}

function resetSearch() {
  query.value = "";
  query.focus();
  rememberSearch();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
      event.altKey || event.shiftKey || link.target || link.hasAttribute("download")) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || !routes.has(url.pathname)) return;
  if (routeKey(url) === routeKey(location) && url.hash) return;
  event.preventDefault();
  if (url.href === location.href && !query.value) return;
  const scroll = window.scrollY;
  const panelTop = scroll + main.getBoundingClientRect().top;
  history.replaceState({ ...history.state, scroll }, "");
  history.pushState(null, "", url);
  showRoute({ animate: true, focus: true, scroll: Math.min(scroll, panelTop) });
});

history.scrollRestoration = "manual";
window.addEventListener("popstate", (event) => {
  const url = new URL(location.href);
  if (routeKey(url) !== mountedRoute || (event.state?.query ?? url.searchParams.get("q") ?? "") !== query.value) {
    showRoute({ animate: true, focus: true, scroll: event.state?.scroll ?? 0 });
  } else {
    scrollToRoute(url, event.state?.scroll);
  }
});

query.addEventListener("input", (event) => {
  if (!event.isComposing) rememberSearch();
});
query.addEventListener("compositionend", rememberSearch);
query.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.isComposing) resetSearch();
});
clearSearch.addEventListener("click", resetSearch);
search.addEventListener("submit", (event) => {
  event.preventDefault();
  rememberSearch();
});

let contentRequest;
let contentTag;
let syncPending = false;

function synchronizeContent() {
  refreshContent({ background: true });
}

function applyContentUpdate(previous, next) {
  const page = routes.get(location.pathname);
  const accountChanged = previous.account?.username !== next.account?.username ||
    previous.account?.role !== next.account?.role;
  if (accountChanged) discardAdmin();
  if (page === "admin") {
    if (next.account?.role !== "admin") goToAdminLogin();
    return;
  }
  const priorSettings = previous.content.settings;
  const settings = next.content.settings;
  if (page === "account") {
    if (accountChanged || previous.setup !== next.setup) showRoute();
    else document.title = accountLink.textContent + " · " + settings.title;
    return;
  }
  const fields = [page + "Title", page + "Note"];
  if (page === "staff") fields.push("staffSlots");
  const sectionChanged = fields.some((field) => priorSettings[field] !== settings[field]) ||
    JSON.stringify(previous.content[page]) !== JSON.stringify(next.content[page]);
  if (accountChanged || sectionChanged) showRoute({ preserveView: true });
  else document.title = settings[page + "Title"] + " · " + settings.title;
}

async function refreshContent({ background = false, ...options } = {}) {
  if (background && contentRequest) {
    syncPending = true;
    return;
  }
  contentRequest?.abort();
  const request = new AbortController();
  contentRequest = request;
  const previous = session;
  if (!background || !previous) {
    routeVersion += 1;
    session = undefined;
    renderStatus("正在加载站点内容…", true);
  }
  try {
    const headers = background && previous && contentTag ? { "If-None-Match": contentTag } : {};
    const response = await fetch("/api/content", { cache: "no-store", signal: request.signal, headers });
    if (response.status === 304) {
      publicContentChanged = false;
      return;
    }
    if (!response.ok) throw new Error("Content unavailable");
    const data = await response.json();
    if (request.signal.aborted) return;
    contentTag = response.headers.get("ETag");
    session = data;
    publicContentChanged = false;
    renderShell(data.content, data.account);
    if (background && previous) applyContentUpdate(previous, data);
    else showRoute(options);
  } catch {
    if (!request.signal.aborted && (!background || !previous)) {
      renderStatus("内容加载失败，请刷新页面。", false);
    }
  } finally {
    if (contentRequest === request) {
      contentRequest = undefined;
      if (syncPending) {
        syncPending = false;
        synchronizeContent();
      }
    }
  }
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) synchronizeContent();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) synchronizeContent();
});

refreshContent();
const updates = new EventSource("/api/updates");
updates.addEventListener("open", synchronizeContent);
updates.addEventListener("changed", synchronizeContent);
