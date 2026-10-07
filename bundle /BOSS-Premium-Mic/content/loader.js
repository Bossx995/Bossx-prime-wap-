(() => {
  if (window.__whatsappLinkLoaded) return;
  window.__whatsappLinkLoaded = true;

  // Inject the page-world audio hook. The companion service.js is a real
  // extension content script so it retains access to chrome.runtime/storage.
  const start = () => {
    try {
      if (!window.__micMaxInjectorReady) {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('core/injector.js');
        s.onload = () => s.remove();
        s.onerror = () => s.remove();
        (document.head || document.documentElement).appendChild(s);
      }
    } catch (_) {}
  };

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
