// WhatsApp link lucifer Loud Mic Pro background module.
// Local diagnostics only: no remote fetches, no webhooks, no token/session reads.

const EXT = globalThis.browser ?? globalThis.chrome;
const state = { installedAt: Date.now(), lastHeartbeat: 0, hookActiveTabs: new Set() };

function reply(sendResponse, payload) {
  try { sendResponse(payload); } catch (_) {}
}

if (EXT?.runtime?.onInstalled) {
  EXT.runtime.onInstalled.addListener(() => {
    console.log('[WhatsApp Link BOSS Mic] installed');
  });
}

if (EXT?.runtime?.onMessage) {
  EXT.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'MICMAX_HEARTBEAT') {
      state.lastHeartbeat = Date.now();
      if (sender?.tab?.id != null) state.hookActiveTabs.add(sender.tab.id);
      reply(sendResponse, { ok: true });
      return false;
    }

    if (message.type === 'MICMAX_STATUS_REQUEST') {
      reply(sendResponse, {
        ok: true,
        installedAt: state.installedAt,
        lastHeartbeat: state.lastHeartbeat,
        activeTabs: [...state.hookActiveTabs]
      });
      return false;
    }

    if (message.type === 'MICMAX_RESET_STATUS') {
      state.lastHeartbeat = 0;
      state.hookActiveTabs.clear();
      reply(sendResponse, { ok: true });
      return false;
    }

    return false;
  });
}

// Optional: clean up inactive tabs
setInterval(() => {
  if (EXT?.tabs?.query) {
    EXT.tabs.query({ status: 'complete' }, (tabs) => {
      const activeIds = new Set(tabs.map(t => t.id));
      for (const id of state.hookActiveTabs) {
        if (!activeIds.has(id)) state.hookActiveTabs.delete(id);
      }
    });
  }
}, 30000);

console.log('[WhatsApp Link BOSS Mic] background service started');
