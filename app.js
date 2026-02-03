const taskList = document.getElementById("taskList");
const goalList = document.getElementById("goalList");
const taskSheet = document.getElementById("taskSheet");
const goalSheet = document.getElementById("goalSheet");
const settingsSheet = document.getElementById("settingsSheet");
const todayCount = document.getElementById("todayCount");
const goalCount = document.getElementById("goalCount");
const notificationsToggle = document.getElementById("notificationsToggle");
const installBtn = document.getElementById("installBtn");

const STORAGE_KEY = "routineflow-data-v1";
const DB_NAME = "routineflow-db";
const DB_STORE = "schedule";

const state = {
  tasks: [],
  goals: [],
  settings: {
    notifications: false,
  },
};

const weekMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const loadState = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.tasks && parsed.goals) {
      Object.assign(state, parsed);
    }
  } catch (error) {
    console.warn("Failed to load state", error);
  }
};

const saveState = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const persistAndSync = async () => {
  saveState();
  await writeScheduleToDb();
  await registerReminderSync();
};

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

const writeScheduleToDb = async () => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(
      {
        tasks: state.tasks,
        goals: state.goals,
        settings: state.settings,
        updatedAt: Date.now(),
      },
      "data"
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
    return task.days.length ? task.days.join(", ") : "Custom";
  }
  if (task.repeat === "weekdays") return "Weekdays";
  if (task.repeat === "weekends") return "Weekends";
  return "Daily";
};

const nextReminderLabel = (task) => {
  const now = new Date();
  const [hours, minutes] = task.time.split(":").map(Number);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next < now) next.setDate(next.getDate() + 1);
  const dayLabel = next.toLocaleDateString(undefined, { weekday: "short" });
  return `${dayLabel} ${task.time}`;
};

const renderTasks = () => {
  taskList.innerHTML = "";
  todayCount.textContent = `${state.tasks.length} tasks`;

  if (state.tasks.length === 0) {
    taskList.innerHTML = "<p class='task-sub'>No routines yet. Add your first one.</p>";
    return;
  }

  state.tasks.forEach((task) => {
    const card = document.createElement("div");
    card.className = "task-card";

    card.innerHTML = `
      <div class="task-meta">
        <div>
          <p class="task-title">${task.title}</p>
          <p class="task-sub">Next reminder: ${nextReminderLabel(task)}</p>
        </div>
        <button class="ghost" data-action="toggle" data-id="${task.id}">
          ${task.done ? "Done" : "Mark done"}
        </button>
      </div>
      <div class="badge-row">
        <span class="badge">${task.time}</span>
        <span class="badge">${formatRepeat(task)}</span>
        <span class="badge">${task.alarm ? "Alarm on" : "Alarm off"}</span>
      </div>
      ${task.notes ? `<p class="task-sub">${task.notes}</p>` : ""}
    `;

    if (task.done) {
      card.style.opacity = "0.6";
    }

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
    if (!task.alarm) return;
    const [hours, minutes] = task.time.split(":").map(Number);
    const reminder = new Date(now);
    reminder.setHours(hours, minutes, 0, 0);
    if (reminder < now) reminder.setDate(reminder.getDate() + 1);
    const delay = reminder.getTime() - now.getTime();
    setTimeout(() => {
      new Notification(task.title, {
        body: task.notes || `Reminder scheduled for ${task.time}`,
      });
    }, delay);
  });

  state.goals.forEach((goal) => {
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

  document.getElementById("taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const repeat = data.get("repeat");
    const days = Array.from(dayButtons)
      .filter((chip) => chip.classList.contains("active"))
      .map((chip) => chip.dataset.day);
    const task = {
      id: crypto.randomUUID(),
      title: data.get("title"),
      time: data.get("time"),
      repeat,
      days,
      alarm: data.get("alarm") === "on",
      notes: data.get("notes"),
      done: false,
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

  taskList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === "toggle") {
      const task = state.tasks.find((item) => item.id === target.dataset.id);
      if (task) {
        task.done = !task.done;
        await persistAndSync();
        renderTasks();
      }
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
    await writeScheduleToDb();
    await registerReminderSync();
  });

  document.getElementById("resetDay").addEventListener("click", async () => {
    state.goals.forEach((goal) => {
      goal.progress = 0;
      goal.lastReset = new Date().toDateString();
    });
    await persistAndSync();
    renderGoals();
  });

};

const setupInstallPrompt = () => {
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.classList.remove("hidden");
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    installBtn.classList.add("hidden");
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
