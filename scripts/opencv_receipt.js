(function () {
  'use strict';

  let worker = null;
  let seq = 0;
  const pending = new Map();

  function newWorker() {
    if (worker) {
      try { worker.terminate(); } catch (_) {}
    }

    worker = new Worker('opencv_worker.js');

    worker.onmessage = function (event) {
      const msg = event.data || {};
      const job = pending.get(msg.id);
      if (!job) return;

      clearTimeout(job.timer);
      pending.delete(msg.id);

      if (msg.ok) {
        const bytes = new Uint8Array(msg.buffer);
        job.ok(bytes, Number(msg.confidence || 0));
      } else {
        job.err(msg.error || 'WEB_SCAN_FAILED');
      }
    };

    worker.onerror = function (event) {
      const message = event && event.message ? event.message : 'WEB_WORKER_ERROR';

      for (const [, job] of pending) {
        clearTimeout(job.timer);
        try { job.err(message); } catch (_) {}
      }
      pending.clear();

      try { worker.terminate(); } catch (_) {}
      worker = null;
    };

    return worker;
  }

  function getWorker() {
    return worker || newWorker();
  }

  window.receiptScanner = {
    scan: function (raw, ok, err) {
      try {
        const id = ++seq;
        const input = Uint8Array.from(raw);
        const buffer = input.buffer;

        const timer = setTimeout(function () {
          const job = pending.get(id);
          if (!job) return;

          pending.delete(id);
          try { job.err('SCAN_TIMEOUT'); } catch (_) {}

          // Takılmış WASM/worker'ı öldür; sonraki taramada temiz worker açılır.
          try { if (worker) worker.terminate(); } catch (_) {}
          worker = null;
        }, 25000);

        pending.set(id, { ok: ok, err: err, timer: timer });

        getWorker().postMessage(
          { id: id, buffer: buffer },
          [buffer]
        );
      } catch (e) {
        try { err(e && e.message ? e.message : String(e)); } catch (_) {}
      }
    }
  };
})();
