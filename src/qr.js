'use strict';

const crypto = require('crypto');
const axios = require('axios');

const sign = (secret, text) =>
  crypto.createHmac('sha256', secret).update(text).digest('hex').slice(0, 20);

function createQrService(cfg, logger = console) {
  let libs = null; // null = ยังไม่ลองโหลด, false = โหลดไม่ได้

  function loadLibs() {
    if (libs !== null) return libs;
    try {
      const gen = require('promptpay-qr');
      libs = { generatePayload: gen.default || gen, qrcode: require('qrcode') };
    } catch (_) {
      libs = false;
    }
    return libs;
  }

  const localAvailable = () => Boolean(loadLibs() && cfg.publicBaseUrl && cfg.promptpayId);
  const usesApi = () => cfg.qrMode === 'api' || (cfg.qrMode === 'auto' && !localAvailable());

  async function renderPng(amount) {
    const { generatePayload, qrcode } = loadLibs();
    const payload = generatePayload(cfg.promptpayId, { amount: Number(amount) });
    return qrcode.toBuffer(payload, { type: 'png', width: 720, margin: 3, errorCorrectionLevel: 'M' });
  }

  function localUrl(amount) {
    const a = Number(amount).toFixed(2);
    return `${cfg.publicBaseUrl}/qr/${a}/${sign(cfg.qrSecret, a)}.png`;
  }

  function apiUrl(amount) {
    let base = String(cfg.apiBase || 'https://my-promptpay-api.onrender.com').trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(base)) {
      base = base.replace(/^http:\/\//i, 'https://');
      if (!/^https:\/\//i.test(base)) base = 'https://' + base;
    }
    const ppId = encodeURIComponent(String(cfg.promptpayId || '').trim());
    const amt = Number(amount);
    return `${base}/qr/${ppId}/${amt}.png?format=card&lang=th&v=${Date.now().toString(36)}`;
  }

  // ปลุก API เดิม (Render ฟรี) แต่จำกัดเวลารวม เพื่อไม่ให้ reply token หมดอายุ
  async function ensureApiAwake({ budgetMs = 20000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < budgetMs) {
      try {
        const res = await axios.get(cfg.apiBase + '/health', { timeout: 6000 });
        if (res.status === 200) return true;
      } catch (_) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    return false;
  }

  // คืน { url, via } หรือ throw ถ้าสร้างไม่ได้ทุกวิธี
  async function prepareImageUrl(amount) {
    const order = [];
    if (cfg.qrMode === 'local') order.push('local');
    else if (cfg.qrMode === 'api') order.push('api', 'local');
    else order.push('local', 'api');

    let lastErr = null;
    for (const way of order) {
      try {
        if (way === 'local') {
          if (!localAvailable()) throw new Error('local QR ใช้ไม่ได้ (ขาด promptpay-qr/qrcode หรือ PUBLIC_BASE_URL)');
          return { url: localUrl(amount), via: 'local' };
        }
        if (!(await ensureApiAwake())) throw new Error('QR API ไม่ตอบสนอง');
        return { url: apiUrl(amount), via: 'api' };
      } catch (err) {
        lastErr = err;
        logger.warn(`[qr] วิธี ${way} ล้มเหลว: ${err.message}`);
      }
    }
    throw lastErr || new Error('สร้าง QR ไม่ได้');
  }

  // ปลุก API แบบไม่รอผล (ใช้กับ /health?deep=1 จาก cron-job.org)
  function pingApiInBackground() {
    if (!usesApi() && cfg.qrMode !== 'api') return;
    axios.get(cfg.apiBase + '/health', { timeout: 25000 }).catch(() => {});
  }

  function registerRoutes(app) {
    app.get('/qr/:amount/:file', async (req, res) => {
      try {
        const amount = req.params.amount;
        const sig = String(req.params.file).replace(/\.png$/i, '');
        const n = Number(amount);
        if (!/^\d{1,7}\.\d{2}$/.test(amount) || !(n > 0)) return res.status(400).end();
        const expected = sign(cfg.qrSecret, amount);
        const ok =
          sig.length === expected.length &&
          crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
        if (!ok) return res.status(403).end();
        if (!loadLibs() || !cfg.promptpayId) return res.status(503).end();

        const png = await renderPng(amount);
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        return res.send(png);
      } catch (err) {
        logger.error('[qr] สร้างรูปไม่สำเร็จ:', err.message);
        return res.status(500).end();
      }
    });
  }

  return { prepareImageUrl, registerRoutes, pingApiInBackground, localAvailable, renderPng };
}

module.exports = { createQrService };