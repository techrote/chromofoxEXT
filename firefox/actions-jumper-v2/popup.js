"use strict";
const Core = globalThis.ActionsJumperCore;
const field = document.getElementById("repo");
const list = document.getElementById("suggestions");
const prefix = document.getElementById("ghost-prefix");
const suffix = document.getElementById("ghost-suffix");
const status = document.getElementById("status");

let owner = "techrote";
let names = [];
let history = {};
let entries = [];
let active = -1;
let dismissed = false;
let loading = false;

function setStatus(value, error = false) {
  status.textContent = value;
  status.classList.toggle("error", error);
}

function updateGhost() {
  const text = field.value;
  const winner = entries[active < 0 ? 0 : active]?.name;
  const ghostTail = dismissed ? "" : Core.ghostSuffix(text, winner);
  prefix.textContent = ghostTail ? text : "";
  suffix.textContent = ghostTail;
  // Empty-field favourites should appear as ghost text, not overlap placeholder text.
  field.placeholder = ghostTail ? "" : `Repository in ${owner}…`;
}

function hideResults() {
  list.hidden = true;
  field.setAttribute("aria-expanded", "false");
  field.removeAttribute("aria-activedescendant");
  prefix.textContent = "";
  suffix.textContent = "";
}

function render() {
  entries = Core.rankRepositories(names, history, owner, field.value);
  active = -1;
  list.replaceChildren();
  if (!dismissed) {
    entries.forEach((entry, index) => {
      const li = document.createElement("li");
      li.id = `repo-option-${index}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      const title = document.createElement("span");
      title.textContent = entry.name;
      li.append(title);
      if (entry.count) {
        const meta = document.createElement("span");
        meta.className = "usage-count";
        meta.textContent = `${entry.count}×`;
        li.append(meta);
      }
      li.addEventListener("mousedown", event => event.preventDefault());
      li.addEventListener("click", () => void jump(entry.name));
      list.append(li);
    });
    list.hidden = entries.length === 0;
  } else {
    list.hidden = true;
  }
  field.setAttribute("aria-expanded", String(!list.hidden));
  field.removeAttribute("aria-activedescendant");
  updateGhost();
}

function setActive(index) {
  if (!entries.length) return;
  dismissed = false;
  active = ((index % entries.length) + entries.length) % entries.length;
  list.hidden = false;
  field.setAttribute("aria-expanded", "true");
  [...list.children].forEach((li, i) => {
    li.setAttribute("aria-selected", String(i === active));
  });
  const selected = list.children[active];
  field.setAttribute("aria-activedescendant", selected.id);
  selected.scrollIntoView({ block: "nearest" });
  updateGhost();
}

async function jump(name) {
  try {
    const repo = String(name || "").trim();
    if (!Core.validRepo(repo)) {
      setStatus("Enter a valid repository name.", true);
      return;
    }
    await browser.runtime.sendMessage({ type: "navigate", repo });
    window.close();
  } catch (error) {
    setStatus(error.message || "Navigation failed.", true);
  }
}

field.addEventListener("input", () => {
  dismissed = false;
  setStatus(loading ? "Loading…" : "");
  render();
});

field.addEventListener("keydown", event => {
  if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    const winner = !dismissed ? entries[active < 0 ? 0 : active]?.name : null;
    if (winner && Core.ghostSuffix(field.value, winner)) {
      event.preventDefault();
      field.value = winner;
      dismissed = false;
      render();
    }
  } else if (event.key === "ArrowDown" && entries.length && !dismissed) {
    event.preventDefault();
    setActive(active + 1);
  } else if (event.key === "ArrowUp" && entries.length && !dismissed) {
    event.preventDefault();
    setActive(active < 0 ? entries.length - 1 : active - 1);
  } else if (event.key === "Escape") {
    dismissed = true;
    hideResults();
  }
});

// Enter accepts the top-ranked suggestion, unless Ctrl is held for an exact repo.
document.getElementById("jump-form").addEventListener("submit", event => {
  event.preventDefault();
  const wanted = dismissed ? field.value : (entries[active < 0 ? 0 : active]?.name || field.value);
  void jump(wanted);
});

field.addEventListener("keydown", event => {
  if (event.key === "Enter" && event.ctrlKey) {
    event.preventDefault();
    void jump(field.value);
  }
});

document.getElementById("settings").addEventListener("click", async () => {
  try {
    await browser.runtime.sendMessage({ type: "openSettings" });
    window.close();
  } catch (error) {
    setStatus(error.message || "Could not open configuration.", true);
  }
});

(async () => {
  try {
    const snap = await browser.runtime.sendMessage({ type: "snapshot" });
    owner = snap.owner;
    names = snap.names;
    history = snap.usage;
    field.placeholder = `Repository in ${owner}…`;
    render();
    field.focus();
    loading = true;
    if (!names.length) setStatus("Loading…");
    const fresh = await browser.runtime.sendMessage({ type: "refresh", owner });
    const updated = await browser.runtime.sendMessage({ type: "snapshot" });
    names = updated.names;
    history = updated.usage;
    loading = false;
    render();
    setStatus(fresh.error || (fresh.truncated ? "First 1000 public repos loaded" : ""), !!fresh.error);
  } catch (error) {
    loading = false;
    setStatus(`Suggestions unavailable: ${error.message}`, true);
    field.focus();
  }
})();
