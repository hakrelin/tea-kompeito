const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function setupPager(grid, onTurn) {
  const pager = grid.parentElement.querySelector(".catalog-pages");
  const pageCount = pager.querySelector(".page-count");
  const [previous, next] = pager.querySelectorAll("[data-page-step]");
  let animation;

  for (const button of [previous, next]) {
    button.addEventListener("click", (event) => {
      if (button.getAttribute("aria-disabled") !== "true") {
        onTurn(Number(button.dataset.pageStep), event);
      }
    });
  }

  return {
    render(page, total) {
      pager.hidden = total <= 1;
      const label = "第 " + (page + 1) + " / " + total + " 页";
      if (!pager.hidden && pageCount.textContent !== label) pageCount.textContent = label;
      previous.setAttribute("aria-disabled", String(page === 0));
      next.setAttribute("aria-disabled", String(page >= total - 1));
    },
    animate(direction) {
      if (!direction || reducedMotion.matches) return;
      animation?.cancel();
      animation = grid.animate(
        [
          { opacity: .55, transform: "translateX(" + (direction * 14) + "px) rotate(" + (direction * .35) + "deg)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 270, easing: "cubic-bezier(.2, .65, .3, 1)" }
      );
    },
  };
}

function setupWorks(view, params, signal) {
  const grid = view.querySelector("#works-grid");

  const creditFields = ["source", "tl", "et", "tw", "pr"];
  const fields = ["orig", "type", "status", ...creditFields, "desc"];
  const works = [...grid.querySelectorAll(".work")];
  const detail = view.querySelector("#work-detail");
  const cover = detail.querySelector("#d-cover");
  const title = detail.querySelector("#d-name");
  const link = detail.querySelector("#d-link");
  const description = detail.querySelector(".work-extra");
  const resultCount = view.querySelector(".catalog-count");
  const workNavigation = detail.querySelector(".detail-navigation");
  const workButtons = [...workNavigation.querySelectorAll("[data-work-step]")];
  const stackedLayout = matchMedia("(max-width: 700px)");
  const viewport = view.querySelector("#catalog-scroll");
  const scrollbar = view.querySelector("#catalog-scrollbar");

  let matches = works;
  let activeWork = null;
  let previousQuery = "";
  const requestedWork = params.get("work");
  let linkedWork = works.find((work) => work.id === "work-" + requestedWork);

  function syncScrollbar() {
    const range = viewport.scrollHeight - viewport.clientHeight;
    scrollbar.hidden = range <= 0;
    scrollbar.value = range > 0 ? 100 * viewport.scrollTop / range : 0;
  }

  viewport.classList.add("with-scrollbar");
  viewport.addEventListener("scroll", syncScrollbar);
  scrollbar.addEventListener("input", () => {
    const range = viewport.scrollHeight - viewport.clientHeight;
    viewport.scrollTop = scrollbar.valueAsNumber * range / 100;
  });
  const catalogResize = new ResizeObserver(syncScrollbar);
  catalogResize.observe(viewport);
  catalogResize.observe(grid);
  signal.addEventListener("abort", () => catalogResize.disconnect(), { once: true });

  function selectWork(work) {
    activeWork = work;
    detail.hidden = !work;
    workNavigation.hidden = matches.length < 2;
    const index = matches.indexOf(work);
    workButtons[0].setAttribute("aria-disabled", String(index <= 0));
    workButtons[1].setAttribute("aria-disabled", String(index >= matches.length - 1));

    for (const button of works) {
      button.classList.toggle("is-active", button === work);
      button.setAttribute("aria-pressed", String(button === work));
    }
    if (!work) return;

    const data = work.dataset;
    cover.src = data.cover || work.querySelector("img").src;
    const name = "《" + data.name + "》";
    if (title.textContent !== name) title.textContent = name;

    for (const field of fields) {
      detail.querySelector("#d-" + field).textContent = data[field] || "—";
    }
    description.hidden = !data.desc;

    link.textContent = data.link || "待补充";
    if (data.linkHref) {
      const anchor = document.createElement("a");
      anchor.href = data.linkHref;
      anchor.textContent = data.link || "打开链接";
      link.replaceChildren(anchor);
    }
  }

  function revealWork(work) {
    if (stackedLayout.matches) return;
    const card = work.getBoundingClientRect();
    const visible = viewport.getBoundingClientRect();
    if (card.top < visible.top + 6) {
      viewport.scrollTop += card.top - visible.top - 6;
    } else if (card.bottom > visible.bottom - 6) {
      viewport.scrollTop += card.bottom - visible.bottom + 6;
    }
  }

  for (const button of workButtons) {
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") === "true") return;
      const index = matches.indexOf(activeWork) + Number(button.dataset.workStep);
      selectWork(matches[index]);
      revealWork(activeWork);
    });
  }

  for (const work of works) {
    work.addEventListener("click", () => {
      selectWork(work);
      if (stackedLayout.matches) {
        detail.focus({ preventScroll: true });
        detail.scrollIntoView({ block: "start" });
      }
    });
  }

  detail.querySelector(".back-to-works").addEventListener("click", (event) => {
    event.preventDefault();
    activeWork?.focus();
  });

  return function showMatches(filtered, searchText) {
    matches = filtered;
    const queryChanged = searchText !== previousQuery;
    const visibleWorks = new Set(matches);
    for (const work of works) work.hidden = !visibleWorks.has(work);

    const requested = visibleWorks.has(linkedWork) ? linkedWork : null;
    const keepSelection = !queryChanged && visibleWorks.has(activeWork);
    selectWork(requested || (keepSelection ? activeWork : matches[0]));
    if (queryChanged) viewport.scrollTop = 0;
    if (requested) revealWork(requested);
    syncScrollbar();

    const count = (searchText ? "找到 " : "共 ") + matches.length + " 部";
    if (resultCount.textContent !== count) resultCount.textContent = count;
    previousQuery = searchText;
    linkedWork = undefined;
  };
}

function setupStaff(view, initialPage) {
  const grid = view.querySelector("#staff-grid");
  const dialog = view.querySelector("#staff-details");

  const papers = [...grid.querySelectorAll(".staff")];
  const pageSize = 12;
  const stackedLayout = matchMedia("(max-width: 700px)");
  const name = dialog.querySelector("#staff-name");
  const role = dialog.querySelector("#staff-role");
  const bio = dialog.querySelector("#staff-bio");
  const link = dialog.querySelector("#staff-works");
  let matches = papers;
  let currentPage = initialPage;
  let previousQuery;

  const pager = setupPager(grid, (step, event) => {
    currentPage += step;
    renderPage();
    pager.animate(step);
    if (stackedLayout.matches && event.detail > 0) grid.scrollIntoView({ block: "start" });
  });

  function renderPage() {
    const total = Math.ceil(matches.length / pageSize);
    currentPage = Math.max(0, Math.min(currentPage, total - 1));
    grid.dataset.page = currentPage;
    const start = currentPage * pageSize;
    const pagePapers = matches.slice(start, start + pageSize);
    for (const paper of papers) paper.hidden = !pagePapers.includes(paper);
    pager.render(currentPage, total);
  }

  for (const button of grid.querySelectorAll(".staff-trigger")) {
    button.addEventListener("click", () => {
      const member = button.querySelector(".who").textContent.trim();
      name.textContent = member;
      role.textContent = button.querySelector(".role").textContent.trim();
      bio.textContent = button.closest(".staff").dataset.search;
      bio.hidden = !bio.textContent;
      link.href = "index.html?" + new URLSearchParams({ q: member });
      button.focus({ preventScroll: true });
      dialog.showModal();
    });
  }

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  return function showMembers(filtered, searchText) {
    matches = searchText ? filtered : papers;
    if (previousQuery !== undefined && searchText !== previousQuery) currentPage = 0;
    previousQuery = searchText;
    renderPage();
  };
}

function setupFilter(view, showResults) {
  const empty = view.querySelector(".empty");
  const searchable = [...view.querySelectorAll("[data-search]")].map((item) => {
    const { search, source, tl, et, tw, pr } = item.dataset;
    return [item, normalize([search, item.textContent, source, tl, et, tw, pr].join(" "))];
  });
  const emptyList = !searchable.length && !view.querySelector(".staff[data-placeholder]");
  return (value) => {
    const searchText = normalize(value).trim();
    const terms = searchText.split(/\s+/).filter(Boolean);
    const visible = [];
    for (const [item, text] of searchable) {
      const match = terms.every((term) => text.includes(term));
      if (match) visible.push(item);
      if (!showResults) item.hidden = !match;
    }
    empty.hidden = visible.length > 0 || (!terms.length && !emptyList);
    showResults?.(visible, searchText);
  };
}

function normalize(text) {
  return text.normalize("NFKC").toLowerCase();
}

export function setupPublicView(view, page, params, signal, staffPage = 0) {
  const showResults = page === "works" ? setupWorks(view, params, signal)
    : page === "staff" ? setupStaff(view, staffPage) : undefined;
  return setupFilter(view, showResults);
}
