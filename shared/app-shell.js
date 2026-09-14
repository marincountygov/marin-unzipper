(() => {
  "use strict";

  const menuToggle = document.querySelector("#menu-toggle");
  const navigation = document.querySelector("#app-nav");
  const menuQuery = window.matchMedia("(max-width: 720px)");

  function closeMenu() {
    menuToggle?.setAttribute("aria-expanded", "false");
    navigation?.removeAttribute("data-open");
  }

  if (menuToggle && navigation) {
    menuToggle.addEventListener("click", () => {
      const open = menuToggle.getAttribute("aria-expanded") !== "true";
      menuToggle.setAttribute("aria-expanded", String(open));
      if (open) navigation.setAttribute("data-open", "true");
      else navigation.removeAttribute("data-open");
    });

    navigation.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement && menuQuery.matches) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
        closeMenu();
        menuToggle.focus();
      }
    });

    menuQuery.addEventListener("change", (event) => {
      if (!event.matches) closeMenu();
    });
  }

  document.querySelectorAll(".menu").forEach((menu) => {
    const toggle = menu.querySelector(":scope > .menu-toggle");
    const panel = menu.querySelector(":scope > .menu-panel");
    if (!toggle || !panel) return;

    function closeMenuPanel() {
      toggle.setAttribute("aria-expanded", "false");
      panel.hidden = true;
    }

    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      document.querySelectorAll(".menu-toggle[aria-expanded='true']").forEach((otherToggle) => {
        if (otherToggle !== toggle) {
          otherToggle.setAttribute("aria-expanded", "false");
          otherToggle.closest(".menu")?.querySelector(":scope > .menu-panel")?.setAttribute("hidden", "");
        }
      });
      toggle.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });

    panel.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) closeMenuPanel();
    });

    document.addEventListener("click", (event) => {
      if (toggle.getAttribute("aria-expanded") === "true" && !menu.contains(event.target)) closeMenuPanel();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        closeMenuPanel();
        toggle.focus();
      }
    });
  });

  // MarinOS banner menu: refresh from the published catalog so new apps
  // appear automatically. If the fetch fails, the static links in index.html
  // remain in place as a fallback. Cache the catalog for six hours.
  const marinosMenuPanel = document.querySelector("#marinos-menu-panel");
  if (marinosMenuPanel) {
    const CATALOG_URL = "https://marincountygov.github.io/marin-os/catalog.json";
    const CACHE_KEY = "marinos-catalog-cache-v2";
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

    function readCatalogCache() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== "number") return null;
        if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
        return parsed.entries;
      } catch {
        return null;
      }
    }

    function writeCatalogCache(entries) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ entries, fetchedAt: Date.now() }));
      } catch {
        // Storage unavailable; fetching again on the next load is acceptable.
      }
    }

    function renderMarinosMenu(entries) {
      if (!Array.isArray(entries)) return;
      const current = window.location.href;
      const items = entries.filter((entry) => entry && entry.url && entry.name && !current.startsWith(entry.url));
      if (!items.length) return;

      const allLink = marinosMenuPanel.querySelector(".marinos-menu__all");
      marinosMenuPanel.querySelectorAll("a:not(.marinos-menu__all)").forEach((link) => link.remove());

      const links = items
        .map((entry) => {
          const icon =
            entry.icon && entry.icon.viewBox && entry.icon.markup
              ? `<span class="marinos-menu__icon" aria-hidden="true"><svg viewBox="${entry.icon.viewBox}">${entry.icon.markup}</svg></span>`
              : "";
          return `<a href="${entry.url}">${icon}${entry.name}</a>`;
        })
        .join("");

      if (allLink) allLink.insertAdjacentHTML("beforebegin", links);
      else marinosMenuPanel.insertAdjacentHTML("beforeend", links);
    }

    const cachedEntries = readCatalogCache();
    if (cachedEntries) {
      renderMarinosMenu(cachedEntries);
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      fetch(CATALOG_URL, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad response"))))
        .then((entries) => {
          writeCatalogCache(entries);
          renderMarinosMenu(entries);
        })
        .catch(() => {
          // Leave the page's static banner links as-is.
        })
        .finally(() => clearTimeout(timeout));
    }
  }

  const documentHeadings = document.querySelectorAll(
    ".docs-content h2, .docs-content h3, .docs-content h4, .content h2, .content h3, .content h4"
  );

  const claimedHeadingIds = new Set(Array.from(document.querySelectorAll("[id]"), (element) => element.id));

  function headingTargetId(heading) {
    if (heading.id) return heading.id;

    const section = heading.closest("section[id]");
    if (section && section.querySelector(":scope > h2, :scope > h3, :scope > h4") === heading) {
      return section.id;
    }

    const base = heading.textContent
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section";
    let id = base;
    let suffix = 2;
    while (claimedHeadingIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    heading.id = id;
    claimedHeadingIds.add(id);
    return id;
  }

  documentHeadings.forEach((heading) => {
    if (heading.querySelector(".heading-anchor")) return;
    const targetId = headingTargetId(heading);

    const anchor = document.createElement("a");
    anchor.className = "heading-anchor";
    anchor.href = `#${targetId}`;
    anchor.setAttribute("aria-label", `Link to ${heading.textContent.trim()}`);
    anchor.textContent = "#";
    heading.append(" ", anchor);
  });

  const toc = document.querySelector(".docs-toc, .toc");
  const tocLinks = toc
    ? Array.from(toc.querySelectorAll('a[href^="#"]')).filter((link) => link.hash.length > 1)
    : [];
  const tocTargets = tocLinks
    .map((link) => ({ link, target: document.getElementById(decodeURIComponent(link.hash.slice(1))) }))
    .filter((item) => item.target);

  let scrollScheduled = false;

  function updateCurrentSection() {
    scrollScheduled = false;
    if (!tocTargets.length) return;

    const threshold = Math.max(96, window.innerHeight * 0.28);
    let current = tocTargets[0];

    tocTargets.forEach((item) => {
      if (item.target.offsetParent === null) return;
      if (item.target.getBoundingClientRect().top <= threshold) current = item;
    });

    tocTargets.forEach((item) => {
      if (item === current) item.link.setAttribute("aria-current", "location");
      else item.link.removeAttribute("aria-current");
    });
  }

  function scheduleCurrentSectionUpdate() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    window.requestAnimationFrame(updateCurrentSection);
  }

  if (tocTargets.length) {
    window.addEventListener("scroll", scheduleCurrentSectionUpdate, { passive: true });
    window.addEventListener("resize", scheduleCurrentSectionUpdate);
    window.addEventListener("hashchange", scheduleCurrentSectionUpdate);
    updateCurrentSection();
  }

  document.querySelectorAll("table").forEach((table) => {
    const sortButtons = table.querySelectorAll("thead button[data-sort-key]");
    const tbody = table.querySelector(":scope > tbody");
    if (!sortButtons.length || !tbody) return;

    let activeKey = null;
    let direction = "ascending";

    function applySort(key) {
      direction = activeKey === key && direction === "ascending" ? "descending" : "ascending";
      activeKey = key;

      const rows = Array.from(tbody.children);
      rows.sort((a, b) => {
        const valueA = a.getAttribute(`data-sort-${key}`) ?? "";
        const valueB = b.getAttribute(`data-sort-${key}`) ?? "";
        const result = valueA.localeCompare(valueB, undefined, { numeric: true, sensitivity: "base" });
        return direction === "ascending" ? result : -result;
      });
      tbody.append(...rows);

      sortButtons.forEach((button) => {
        button.closest("th")?.setAttribute("aria-sort", button.dataset.sortKey === key ? direction : "none");
      });
    }

    sortButtons.forEach((button) => {
      button.addEventListener("click", () => applySort(button.dataset.sortKey));
    });
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-value]");
    if (!button) return;
    const value = button.dataset.copyValue;
    const status = document.querySelector("#app-status-message, [data-copy-status]");

    navigator.clipboard
      .writeText(value)
      .then(() => {
        button.classList.add("is-copied");
        clearTimeout(button.copyResetTimeout);
        button.copyResetTimeout = setTimeout(() => button.classList.remove("is-copied"), 1500);
        if (status) status.textContent = button.dataset.copyAnnounce || `Copied ${value}`;
      })
      .catch(() => {
        if (status) status.textContent = `Couldn't copy ${value}; copy it manually.`;
      });
  });

  document.querySelectorAll('[data-action="share"]').forEach((button) => {
    button.addEventListener("click", async () => {
      const status = button.closest(".doc-actions")?.querySelector(".doc-action-status") ?? null;
      try {
        await navigator.clipboard.writeText(window.location.href);
        if (status) status.textContent = "Link copied";
      } catch {
        if (status) status.textContent = "Couldn't copy; copy the address bar link instead.";
      }
    });
  });

  const tabSections = document.querySelectorAll("[data-tab-section]");
  if (tabSections.length) {
    const tabNames = [];
    tabSections.forEach((section) => {
      const name = section.dataset.tabSection;
      if (!tabNames.includes(name)) tabNames.push(name);
    });
    const tabNav = document.querySelector("#app-nav");

    function showTabFromHash() {
      const hash = window.location.hash.slice(1);
      const activeName = tabNames.includes(hash) ? hash : tabNames[0];
      tabSections.forEach((section) => {
        section.hidden = section.dataset.tabSection !== activeName;
      });
      if (tabNav) {
        tabNav.querySelectorAll('a[href^="#"]').forEach((link) => {
          if (link.getAttribute("href") === `#${activeName}`) link.setAttribute("aria-current", "page");
          else link.removeAttribute("aria-current");
        });
      }
    }

    showTabFromHash();
    window.addEventListener("hashchange", showTabFromHash);
  }

  document.querySelectorAll("[data-updates-repo]").forEach((section) => {
    const appName = section.dataset.appName || "This app";
    const status = section.querySelector("[data-updates-status]");
    if (status) {
      status.textContent = `${appName} does not load update data automatically. Use the repository link on this page to review release history.`;
    }
  });
})();
