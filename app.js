const taskList = document.getElementById("taskList");
const goalList = document.getElementById("goalList");
const taskSheet = document.getElementById("taskSheet");
const goalSheet = document.getElementById("goalSheet");
const settingsSheet = document.getElementById("settingsSheet");
const listSheet = document.getElementById("listSheet");
const todayCount = document.getElementById("todayCount");
const goalCount = document.getElementById("goalCount");
const notificationsToggle = document.getElementById("notificationsToggle");
const installBtn = document.getElementById("installBtn");
const installBanner = document.getElementById("installBanner");
const installBannerBtn = document.getElementById("installBannerBtn");
const smartTabs = document.getElementById("smartTabs");
const searchInput = document.getElementById("searchInput");
const listFilter = document.getElementById("listFilter");
const sortSelect = document.getElementById("sortSelect");
const listSelect = document.getElementById("listSelect");
const addListBtn = document.getElementById("addListBtn");
const undoToast = document.getElementById("undoToast");
const undoText = document.getElementById("undoText");
const undoBtn = document.getElementById("undoBtn");

const STORAGE_KEY = "routineflow-data-v2";
const DB_NAME = "routineflow-db";
const DB_STORE = "schedule";

const state = {
  lists: [],
  tasks: [],
  goals: [],
  settings: {
    notifications: false,
  },
  ui: {
    filter: "today",
    search: "",
    list: "all",
    sort: "due",
  },
};

let undoAction = null;
let undoTimer = null;

const defaultLists = [
  { id: "list-personal", name: "Personal", color: "#1f3a2b" },
  { id: "list-work", name: "Work", color: "#f08c4b" },
];

const weekMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const openDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readScheduleFromDb = async () => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const request = tx.objectStore(DB_STORE).get("data");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const writeScheduleToDb = async () => {
  const existing = await readScheduleFromDb();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(
      {
        tasks: state.tasks,
        goals: state.goals,
        settings: state.settings,
        lastNotified: existing?.lastNotified || { tasks: {}, goals: {} },
        updatedAt: Date.now(),
      },
      "data"
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const saveState = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const persistAndSync = async () => {
  saveState();
  await writeScheduleToDb();
  await registerReminderSync();
};

const loadState = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed) {
      Object.assign(state, parsed);
    }
  } catch (error) {
    console.warn("Failed to load state", error);
  }
};

const ensureDefaultLists = () => {
  if (!state.lists || state.lists.length === 0) {
    state.lists = defaultLists;
  }
};

const openSheet = (sheet) => {
  sheet.classList.add("active");
  sheet.setAttribute("aria-hidden", "false");
};

const closeSheet = (sheet) => {
  sheet.classList.remove("active");
  sheet.setAttribute("aria-hidden", "true");
};

const formatRepeat = (task) => {
  if (task.repeat === "custom") {
    return task.repeatDays?.length ? task.repeatDays.join(", ") : "Custom";
  }
  if (task.repeat === "weekly") return "Weekly";
  if (task.repeat === "monthly") return "Monthly";
  if (task.repeat === "daily") return "Daily";
  return "Never";
};

const formatPriority = (priority) => {
  if (priority === 3) return { label: "High", className: "high" };
  if (priority === 2) return { label: "Medium", className: "medium" };
  if (priority === 1) return { label: "Low", className: "low" };
  return { label: "None", className: "" };
};

const normalizeTags = (value) =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const parseSubtasks = (value) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((title) => ({ id: crypto.randomUUID(), title, done: false }));

const getListById = (id) => state.lists.find((list) => list.id === id);

const getNextDueDate = (task, fromDate = new Date()) => {
  if (task.snoozeUntil) {
    return new Date(task.snoozeUntil);
  }

  const hasDate = Boolean(task.dueDate);
  const hasTime = Boolean(task.time);

  if (!hasDate && !hasTime) return null;

  const base = new Date(fromDate);
  const target = hasDate ? new Date(task.dueDate) : new Date(fromDate);

  if (hasTime) {
    const [hours, minutes] = task.time.split(":").map(Number);
    target.setHours(hours, minutes, 0, 0);
  } else {
    target.setHours(9, 0, 0, 0);
  }

  if (!hasDate) {
    if (target < base) target.setDate(target.getDate() + 1);
    return target;
  }

  if (task.repeat === "none") return target;

  const repeatDays = task.repeatDays || [];
  let next = new Date(target);
  const maxDays = 370;
  for (let i = 0; i < maxDays; i += 1) {
    if (next >= base) {
      if (task.repeat === "daily") return next;
      if (task.repeat === "weekly") return next;
      if (task.repeat === "monthly") return next;
      if (task.repeat === "custom") {
        const label = weekMap[next.getDay()];
        if (repeatDays.includes(label)) return next;
      }
    }

    if (task.repeat === "daily") {
      next.setDate(next.getDate() + 1);
    } else if (task.repeat === "weekly") {
      next.setDate(next.getDate() + 7);
    } else if (task.repeat === "monthly") {
      next.setMonth(next.getMonth() + 1);
    } else if (task.repeat === "custom") {
      next.setDate(next.getDate() + 1);
    }
  }

  return null;
};

const isDueToday = (task) => {
  const next = getNextDueDate(task);
  if (!next) return false;
  const today = new Date();
  return (
    next.getFullYear() === today.getFullYear() &&
    next.getMonth() === today.getMonth() &&
    next.getDate() === today.getDate()
  );
};

const isScheduled = (task) => Boolean(getNextDueDate(task));

const matchesSearch = (task, query) => {
  if (!query) return true;
  const text = [task.title, task.notes, task.tags?.join(" "), task.link]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes(query.toLowerCase());
};

const applyFilters = (tasks) => {
  let filtered = tasks;

  if (state.ui.filter === "today") {
    filtered = filtered.filter((task) => !task.done && isDueToday(task));
  }

  if (state.ui.filter === "scheduled") {
    filtered = filtered.filter((task) => !task.done && isScheduled(task));
  }

  if (state.ui.filter === "flagged") {
    filtered = filtered.filter((task) => !task.done && task.flagged);
  }

  if (state.ui.filter === "completed") {
    filtered = filtered.filter((task) => task.done);
  }

  if (state.ui.filter === "all") {
    filtered = filtered.filter((task) => !task.done);
  }

  if (state.ui.list !== "all") {
    filtered = filtered.filter((task) => task.listId === state.ui.list);
  }

  if (state.ui.search) {
    filtered = filtered.filter((task) => matchesSearch(task, state.ui.search));
  }

  if (state.ui.sort === "priority") {
    filtered = [...filtered].sort((a, b) => b.priority - a.priority);
  }

  if (state.ui.sort === "title") {
    filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title));
  }

  if (state.ui.sort === "due") {
    filtered = [...filtered].sort((a, b) => {
      const dueA = getNextDueDate(a);
      const dueB = getNextDueDate(b);
      if (!dueA && !dueB) return 0;
      if (!dueA) return 1;
      if (!dueB) return -1;
      return dueA - dueB;
    });
  }

  return filtered;
};

const updateListSelects = () => {
  listFilter.innerHTML = '<option value="all">All lists</option>';
  listSelect.innerHTML = "";
  state.lists.forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    listFilter.appendChild(option.cloneNode(true));
    listSelect.appendChild(option);
  });
  listFilter.value = state.ui.list;
  if (!listSelect.value && state.lists[0]) {
    listSelect.value = state.lists[0].id;
  }
};

const renderTasks = () => {
  const visibleTasks = applyFilters(state.tasks);
  taskList.innerHTML = "";
  todayCount.textContent = `${visibleTasks.length} reminders`;

  if (visibleTasks.length === 0) {
    taskList.innerHTML =
      "<p class='task-sub'>No reminders yet. Add your first one.</p>";
    return;
  }

  visibleTasks.forEach((task) => {
    const list = getListById(task.listId);
    const card = document.createElement("div");
    card.className = `task-card${task.done ? " complete" : ""}`;
    const priority = formatPriority(task.priority);
    const due = getNextDueDate(task);
    const dueLabel = due
      ? due.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "No due date";

    const tags = task.tags?.length
      ? task.tags.map((tag) => `<span class="tag">#${tag}</span>`).join("")
      : "";

    const subtasks = task.subtasks?.length
      ? `<div class="subtask-list">${task.subtasks
          .map(
            (sub) => `
            <label class="subtask">
              <input type="checkbox" data-action="subtask" data-id="${task.id}" data-subid="${sub.id}" ${
                sub.done ? "checked" : ""
              } />
              <span>${sub.title}</span>
            </label>
          `
          )
          .join("")}</div>`
      : "";

    card.innerHTML = `
      <div class="task-meta">
        <div>
          <p class="task-title">${task.title}</p>
          <p class="task-sub">${dueLabel}</p>
        </div>
        <div class="badge-row">
          <span class="badge" style="background:${list?.color || "#f5efe4"};color:#fff;">${
            list?.name || "List"
          }</span>
          ${task.flagged ? '<span class="badge">Flagged</span>' : ""}
        </div>
      </div>
      <div class="badge-row">
        <span class="badge">${formatRepeat(task)}</span>
        <span class="badge">${task.alarm ? "Reminder on" : "Reminder off"}</span>
        <span class="badge priority ${priority.className}">Priority: ${priority.label}</span>
      </div>
      ${tags}
      ${task.link ? `<a class="task-sub" href="${task.link}" target="_blank" rel="noreferrer">Open link</a>` : ""}
      ${subtasks}
      ${task.notes ? `<p class="task-sub">${task.notes}</p>` : ""}
      <div class="task-footer">
        <div class="task-actions">
          <button class="outline" data-action="toggle" data-id="${task.id}">
            ${task.done ? "Undo" : "Complete"}
          </button>
          <button class="ghost" data-action="flag" data-id="${task.id}">
            ${task.flagged ? "Unflag" : "Flag"}
          </button>
          <button class="ghost" data-action="snooze" data-id="${task.id}">Snooze 1h</button>
        </div>
        <span class="task-sub">Created ${new Date(task.createdAt).toLocaleDateString()}</span>
      </div>
    `;

    taskList.appendChild(card);
  });
};

const renderGoals = () => {
  goalList.innerHTML = "";
  goalCount.textContent = `${state.goals.length} goals`;

  if (state.goals.length === 0) {
    goalList.innerHTML = "<p class='task-sub'>No goals yet. Add a progress goal.</p>";
    return;
  }

  state.goals.forEach((goal) => {
    const card = document.createElement("div");
    card.className = "goal-card";
    const percent = Math.min(100, Math.round((goal.progress / goal.target) * 100));

    card.innerHTML = `
      <div class="task-meta">
        <div>
          <p class="task-title">${goal.title}</p>
          <p class="task-sub">${goal.progress}/${goal.target} ${goal.unit} today</p>
        </div>
        <span class="badge">Every ${goal.interval} min</span>
      </div>
      <div class="goal-progress"><span style="width:${percent}%"></span></div>
      <div class="goal-actions">
        <button class="outline" data-action="minus" data-id="${goal.id}">-1</button>
        <button class="primary" data-action="plus" data-id="${goal.id}">+1</button>
        <button class="ghost" data-action="reset" data-id="${goal.id}">Reset</button>
      </div>
    `;

    goalList.appendChild(card);
  });
};

const showUndo = (text, action) => {
  undoText.textContent = text;
  undoAction = action;
  undoToast.classList.remove("hidden");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoToast.classList.add("hidden");
    undoAction = null;
  }, 5000);
};

const setNotificationPreference = (enabled) => {
  state.settings.notifications = enabled;
  saveState();
};

const requestNotifications = async () => {
  if (!("Notification" in window)) {
    alert("Notifications are not supported in this browser.");
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    return true;
  }
  alert("Notifications are blocked. Please enable them in browser settings.");
  return false;
};

const scheduleReminders = () => {
  if (!state.settings.notifications) return;
  const now = new Date();

  state.tasks.forEach((task) => {
    if (!task.alarm || task.done) return;
    const due = getNextDueDate(task, now);
    if (!due) return;
    const delay = due.getTime() - now.getTime();
    if (delay <= 0) return;
    setTimeout(() => {
      new Notification(task.title, {
        body: task.notes || `Reminder scheduled for ${task.time || "today"}`,
      });
    }, delay);
  });

  state.goals.forEach((goal) => {
    if (goal.progress >= goal.target) return;
    const intervalMs = goal.interval * 60 * 1000;
    setInterval(() => {
      if (!state.settings.notifications) return;
      new Notification(goal.title, {
        body: `Add ${goal.unit} to reach ${goal.target} today.`,
      });
    }, intervalMs);
  });
};

const hydrateSettings = () => {
  notificationsToggle.checked = state.settings.notifications;
  updateListSelects();
  listFilter.value = state.ui.list;
  searchInput.value = state.ui.search;
  sortSelect.value = state.ui.sort;
  Array.from(smartTabs.querySelectorAll(".tab")).forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === state.ui.filter);
  });
};

const registerServiceWorker = () => {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
};

const registerReminderSync = async () => {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  if ("periodicSync" in registration) {
    try {
      await registration.periodicSync.register("routineflow-reminders", {
        minInterval: 15 * 60 * 1000,
      });
    } catch (error) {
      console.warn("Periodic sync not available", error);
    }
  }

  if ("sync" in registration) {
    try {
      await registration.sync.register("routineflow-reminders");
    } catch (error) {
      console.warn("Background sync not available", error);
    }
  }
};

const advanceRepeat = (task) => {
  const currentDue = getNextDueDate(task);
  if (!currentDue) return task;
  const nextSeed = new Date(currentDue.getTime() + 60 * 1000);
  const next = getNextDueDate(task, nextSeed);
  if (next) {
    task.dueDate = next.toISOString().slice(0, 10);
  }
  task.snoozeUntil = null;
  return task;
};

const setupEventHandlers = () => {
  document.getElementById("addTaskBtn").addEventListener("click", () => {
    openSheet(taskSheet);
  });
  document.getElementById("addGoalBtn").addEventListener("click", () => {
    openSheet(goalSheet);
  });
  document.getElementById("openSettings").addEventListener("click", () => {
    openSheet(settingsSheet);
  });
  addListBtn.addEventListener("click", () => {
    closeSheet(settingsSheet);
    openSheet(listSheet);
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.close);
      if (target) closeSheet(target);
    });
  });

  const dayButtons = document.querySelectorAll("#repeatDays .chip");
  dayButtons.forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
    });
  });

  smartTabs.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.dataset.filter) return;
    state.ui.filter = target.dataset.filter;
    hydrateSettings();
    renderTasks();
  });

  listFilter.addEventListener("change", () => {
    state.ui.list = listFilter.value;
    renderTasks();
    saveState();
  });

  sortSelect.addEventListener("change", () => {
    state.ui.sort = sortSelect.value;
    renderTasks();
    saveState();
  });

  searchInput.addEventListener("input", () => {
    state.ui.search = searchInput.value.trim();
    renderTasks();
    saveState();
  });

  document.getElementById("taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const repeat = data.get("repeat");
    const repeatDays = Array.from(dayButtons)
      .filter((chip) => chip.classList.contains("active"))
      .map((chip) => chip.dataset.day);

    const task = {
      id: crypto.randomUUID(),
      title: data.get("title"),
      listId: data.get("listId"),
      dueDate: data.get("dueDate"),
      time: data.get("time"),
      repeat,
      repeatDays,
      priority: Number(data.get("priority")),
      tags: normalizeTags(data.get("tags") || ""),
      link: data.get("link"),
      subtasks: parseSubtasks(data.get("subtasks") || ""),
      alarm: data.get("alarm") === "on",
      flagged: data.get("flagged") === "on",
      notes: data.get("notes"),
      done: false,
      createdAt: Date.now(),
      completedAt: null,
      snoozeUntil: null,
    };

    state.tasks.unshift(task);
    await persistAndSync();
    renderTasks();
    closeSheet(taskSheet);
    form.reset();
    dayButtons.forEach((chip) => chip.classList.remove("active"));
  });

  document.getElementById("goalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const goal = {
      id: crypto.randomUUID(),
      title: data.get("title"),
      unit: data.get("unit"),
      target: Number(data.get("target")),
      interval: Number(data.get("interval")),
      progress: 0,
      lastReset: new Date().toDateString(),
    };
    state.goals.unshift(goal);
    await persistAndSync();
    renderGoals();
    closeSheet(goalSheet);
    form.reset();
  });

  document.getElementById("listForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const list = {
      id: crypto.randomUUID(),
      name: data.get("name"),
      color: data.get("color"),
    };
    state.lists.push(list);
    updateListSelects();
    await persistAndSync();
    closeSheet(listSheet);
    form.reset();
  });

  taskList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.dataset.id;
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;

    if (target.dataset.action === "toggle") {
      if (task.done) {
        task.done = false;
        task.completedAt = null;
      } else {
        if (task.repeat !== "none") {
          advanceRepeat(task);
          task.done = false;
        } else {
          task.done = true;
          task.completedAt = Date.now();
          showUndo("Reminder completed", () => {
            task.done = false;
            task.completedAt = null;
            persistAndSync().then(renderTasks);
          });
        }
      }
      await persistAndSync();
      renderTasks();
    }

    if (target.dataset.action === "flag") {
      task.flagged = !task.flagged;
      await persistAndSync();
      renderTasks();
    }

    if (target.dataset.action === "snooze") {
      const snooze = new Date();
      snooze.setHours(snooze.getHours() + 1);
      task.snoozeUntil = snooze.toISOString();
      await persistAndSync();
      renderTasks();
    }
  });

  taskList.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.action === "subtask") {
      const task = state.tasks.find((item) => item.id === target.dataset.id);
      if (!task) return;
      const sub = task.subtasks.find((item) => item.id === target.dataset.subid);
      if (!sub) return;
      sub.done = target.checked;
      await persistAndSync();
    }
  });

  goalList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const goal = state.goals.find((item) => item.id === target.dataset.id);
    if (!goal) return;
    if (target.dataset.action === "plus") {
      goal.progress = Math.min(goal.target, goal.progress + 1);
    }
    if (target.dataset.action === "minus") {
      goal.progress = Math.max(0, goal.progress - 1);
    }
    if (target.dataset.action === "reset") {
      goal.progress = 0;
    }
    await persistAndSync();
    renderGoals();
  });

  notificationsToggle.addEventListener("change", async (event) => {
    const enabled = event.target.checked;
    if (enabled) {
      const granted = await requestNotifications();
      if (!granted) {
        notificationsToggle.checked = false;
        return;
      }
    }
    setNotificationPreference(enabled);
    await persistAndSync();
  });

  document.getElementById("resetDay").addEventListener("click", async () => {
    state.goals.forEach((goal) => {
      goal.progress = 0;
      goal.lastReset = new Date().toDateString();
    });
    await persistAndSync();
    renderGoals();
  });

  undoBtn.addEventListener("click", () => {
    if (undoAction) {
      undoAction();
    }
    undoToast.classList.add("hidden");
  });
};

const setupInstallPrompt = () => {
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.classList.remove("hidden");
    installBanner.classList.remove("hidden");
  });

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add("hidden");
    installBanner.classList.add("hidden");
  };

  installBtn.addEventListener("click", handleInstall);
  installBannerBtn.addEventListener("click", handleInstall);

  window.addEventListener("appinstalled", () => {
    installBtn.classList.add("hidden");
    installBanner.classList.add("hidden");
  });
};

const resetDailyProgressIfNeeded = () => {
  const today = new Date().toDateString();
  let updated = false;
  state.goals.forEach((goal) => {
    if (goal.lastReset !== today) {
      goal.progress = 0;
      goal.lastReset = today;
      updated = true;
    }
  });
  if (updated) saveState();
};

loadState();
ensureDefaultLists();
resetDailyProgressIfNeeded();
hydrateSettings();
renderTasks();
renderGoals();
setupEventHandlers();
setupInstallPrompt();
registerServiceWorker();
writeScheduleToDb();
registerReminderSync();
scheduleReminders();
