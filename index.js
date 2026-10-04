'use strict';

const express = require('express');
const line = require('@line/bot-sdk');

const { cfg, validateConfig } = require('./src/config');
const { createStore } = require('./src/store');
const { createQrService } = require('./src/qr');
const { createHandlers } = require('./src/handlers');

async function main() {
  const { errors, warnings } = validateConfig(cfg);
  warnings.forEach((w) => console.warn('[config] ⚠', w));
  if (errors.length) {
    errors.forEach((e) => console.error('[config] ✖', e));
    console.error('แก้ค่า environment ให้ครบแล้วรันใหม่');
    process.exit(1);
  }

  const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: cfg.line.channelAccessToken,
  });

  const store = await createStore(cfg);
  const qr = createQrService(cfg);
  const { handleEvent } = createHandlers({ client, store, cfg, qr });

  console.log(
    `[boot] QR mode=${cfg.qrMode} (local ${qr.localAvailable() ? 'พร้อม' : 'ไม่พร้อม'}) | ต้องอนุมัติลูกค้า=${cfg.requireApproval} | แอดมิน ${cfg.adminUserIds.length} คน`
  );

  const app = express();

  app.get('/', (req, res) => res.send('LINE Bot Server is running!'));

  // cron-job.org ยิงมาที่นี่ทุก 5 นาที  (ใส่ ?deep=1 เพื่อปลุก QR API เดิมด้วย)
  // ตอบเร็วและตัวเล็ก เพราะ cron-job.org จำกัด 30 วินาที / 64 KB
  app.get('/health', (req, res) => {
    if (req.query.deep) qr.pingApiInBackground();
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  qr.registerRoutes(app);

  // ตอบ 200 ให้ LINE ทันที แล้วค่อยประมวลผล: กัน timeout / การส่งซ้ำ / event เดียวพังทั้งชุด
  app.post('/webhook', line.middleware({
    channelAccessToken: cfg.line.channelAccessToken,
    channelSecret: cfg.line.channelSecret,
  }), (req, res) => {
    res.sendStatus(200);
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    Promise.allSettled(events.map(handleEvent)).then((results) => {
      results.forEach((r) => {
        if (r.status === 'rejected') console.error('[webhook] event ผิดพลาด:', r.reason);
      });
    });
  });

  // จัดการ error ของ middleware (เช่น signature ไม่ถูกต้อง)
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (line.SignatureValidationFailed && err instanceof line.SignatureValidationFailed) {
      return res.status(401).send('Invalid signature');
    }
    if (line.JSONParseError && err instanceof line.JSONParseError) {
      return res.status(400).send('Bad request');
    }
    console.error('[express] error:', err);
    return res.status(500).end();
  });

  const server = app.listen(cfg.port, () => console.log(`Server running on port ${cfg.port}`));

  const shutdown = async (signal) => {
    console.log(`[boot] ได้รับ ${signal} กำลังบันทึกข้อมูลก่อนปิด...`);
    server.close();
    try { await store.flush(); } catch (_) { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

main().catch((err) => {
  console.error('[boot] เริ่มระบบไม่สำเร็จ:', err?.message || err);
  process.exit(1);
});
