self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || "/";
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if ("focus" in client) {
        try {
          if (new URL(client.url).origin === self.location.origin) {
            await client.focus();
            if ("navigate" in client) await client.navigate(target);
            return;
          }
        } catch {}
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || "SILK";
  const options = {
    body: payload.body || "Something needs your attention.",
    tag: payload.tag || `silk-${Date.now()}`,
    data: { url: payload.url || "/", kind: payload.kind || "signal" },
    requireInteraction: payload.urgency === "high",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
