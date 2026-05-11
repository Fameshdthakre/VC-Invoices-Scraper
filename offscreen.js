/* ═══════════════════════════════════════════
   VC Invoice Scraper — Offscreen Script
   Keeps the Service Worker alive and handles
   audio notifications.
   ═══════════════════════════════════════════ */

// Hearbeat to ensure we stay active
setInterval(() => {
  console.log("Offscreen heartbeat...");
}, 20000);

// Listen for messages from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PLAY_NOTIFICATION") {
    playNotificationSound(msg.isError);
  }
});

function playNotificationSound(isError = false) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.type = isError ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isError ? 200 : 800, ctx.currentTime);
    if (!isError) {
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
    }
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.error("Audio error:", e);
  }
}
