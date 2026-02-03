const CACHE_NAME = "routineflow-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./help.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then((cache) =>
                cache.put(event.request, response.clone())
              );
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      }

      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(event.request, response.clone())
            );
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

const DB_NAME = "routineflow-db";
const DB_STORE = "schedule";

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

const readSchedule = async () => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const request = tx.objectStore(DB_STORE).get("data");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const writeSchedule = async (data) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(data, "data");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const weekMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const getNextDueDate = (task, fromDate = new Date()) => {
  if (task.snoozeUntil) return new Date(task.snoozeUntil);
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

    if (task.repeat === "daily") next.setDate(next.getDate() + 1);
    if (task.repeat === "weekly") next.setDate(next.getDate() + 7);
    if (task.repeat === "monthly") next.setMonth(next.getMonth() + 1);
    if (task.repeat === "custom") next.setDate(next.getDate() + 1);
  }

  return null;
};

const shouldNotifyTask = (task, now, lastNotified) => {
  if (!task.alarm || task.done) return false;
  const due = getNextDueDate(task, now);
  if (!due) return false;

  const windowMs = 10 * 60 * 1000;
  const isDue = Math.abs(now - due) <= windowMs;
  if (!isDue) return false;

  if (!lastNotified) return true;
  return now.getTime() - lastNotified > windowMs;
};

const shouldNotifyGoal = (goal, now, lastNotified) => {
  if (goal.progress >= goal.target) return false;
  const intervalMs = goal.interval * 60 * 1000;
  if (!lastNotified) return true;
  return now.getTime() - lastNotified >= intervalMs;
};

const handleReminderCheck = async () => {
  const schedule = await readSchedule();
  if (!schedule || !schedule.settings || !schedule.settings.notifications) return;

  const now = new Date();
  const lastNotified = schedule.lastNotified || { tasks: {}, goals: {} };
  let updated = false;

  for (const task of schedule.tasks || []) {
    const last = lastNotified.tasks[task.id];
    if (shouldNotifyTask(task, now, last)) {
      await self.registration.showNotification(task.title, {
        body: task.notes || "Reminder is due.",
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
      });
      lastNotified.tasks[task.id] = now.getTime();
      updated = true;
    }
  }

  for (const goal of schedule.goals || []) {
    const last = lastNotified.goals[goal.id];
    if (shouldNotifyGoal(goal, now, last)) {
      await self.registration.showNotification(goal.title, {
        body: `Add ${goal.unit} to reach ${goal.target} today.`,
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
      });
      lastNotified.goals[goal.id] = now.getTime();
      updated = true;
    }
  }

  if (updated) {
    await writeSchedule({ ...schedule, lastNotified });
  }
};

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "routineflow-reminders") {
    event.waitUntil(handleReminderCheck());
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "routineflow-reminders") {
    event.waitUntil(handleReminderCheck());
  }
});
