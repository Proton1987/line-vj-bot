'use strict';

require('dotenv').config();

const env = (key, fallback = '') => String(process.env[key] ?? fallback).trim();
const num = (key, fallback) => {
  const n = Number(env(key, String(fallback)));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const bool = (key, fallback = false) => {
  const v = env(key, fallback ? 'true' : 'false').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
};

function parseGoogleCredentials(raw) {
  if (!raw) return null;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const json = JSON.parse(text);
    if (json.client_email && json.private_key) return json;
  } catch (_) {
    /* ตรวจสอบใน validate */
  }
  return null;
}

const cfg = {
  port: num('PORT', 3000),

  line: {
    channelAccessToken: env('LINE_CHANNEL_ACCESS_TOKEN'),
    channelSecret: env('LINE_CHANNEL_SECRET'),
  },

  // เก็บเฉพาะตัวเลข (รองรับพิมพ์ 081-234-5678)
  promptpayId: env('PROMPTPAY_NUMBER').replace(/\D/g, ''),
  adminUrl: env('ADMIN_LINE_URL', 'https://line.me/ti/p/~YOUR_ADMIN_ID'),
  adminUserIds: env('ADMIN_USER_IDS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ราคา
  rates: {
    hourlyRate: num('HOURLY_RATE', 15),
    packageHours: num('PACKAGE_HOURS', 8),
    packagePrice: num('PACKAGE_PRICE', 100),
  },
  minCharge: num('MIN_CHARGE_BAHT', 1),
  maxMinutes: Math.round(num('MAX_HOURS', 72) * 60),

  // ต้องให้แอดมินอนุมัติลูกค้าก่อนถึงจะออก QR ได้หรือไม่
  requireApproval: bool('REQUIRE_APPROVAL', false),

  // QR: auto | local | api
  qrMode: env('QR_MODE', 'auto').toLowerCase(),
  apiBase: env('PROMPTPAY_API_BASE', 'https://my-promptpay-api.onrender.com').replace(/\/+$/, ''),
  publicBaseUrl: (env('PUBLIC_BASE_URL') || env('RENDER_EXTERNAL_URL')).replace(/\/+$/, ''),

  rateLimitPerMin: num('RATE_LIMIT_PER_MIN', 10),

  // SlipOK: ตรวจสลิปอัตโนมัติ (ไม่ตั้ง = แอดมินกดยืนยันเองเหมือนเดิม)
  slipokBranchId: env('SLIPOK_BRANCH_ID'),
  slipokApiKey: env('SLIPOK_API_KEY'),

  // ที่เก็บข้อมูล
  googleSheetId: env('GOOGLE_SHEET_ID'),
  googleCredentials: parseGoogleCredentials(env('GOOGLE_SERVICE_ACCOUNT_JSON')),
  googleCredentialsRaw: env('GOOGLE_SERVICE_ACCOUNT_JSON'),
  dataFile: env('DATA_FILE', './data/store.json'),
};

// คีย์เซ็นลิงก์รูป QR (ใช้ LINE secret ถ้าไม่ตั้งเอง)
cfg.qrSecret = env('QR_SIGN_SECRET') || cfg.line.channelSecret;

function validateConfig(c) {
  const errors = [];
  const warnings = [];

  if (!c.line.channelAccessToken) errors.push('ไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN');
  if (!c.line.channelSecret) errors.push('ไม่ได้ตั้ง LINE_CHANNEL_SECRET');
  if (!c.promptpayId) {
    errors.push('ไม่ได้ตั้ง PROMPTPAY_NUMBER');
  } else if (![10, 13, 15].includes(c.promptpayId.length)) {
    warnings.push(
      `PROMPTPAY_NUMBER มี ${c.promptpayId.length} หลัก (ปกติ: เบอร์โทร 10 / บัตรประชาชน 13 / e-Wallet 15) กรุณาตรวจสอบ`
    );
  }

  if (!/^https?:\/\//.test(c.adminUrl) || c.adminUrl.includes('YOUR_ADMIN_ID')) {
    warnings.push('ADMIN_LINE_URL ยังเป็นค่าตัวอย่าง ปุ่ม "ติดต่อแอดมิน" จะใช้งานไม่ได้');
  }
  if (c.adminUserIds.length === 0) {
    warnings.push('ไม่ได้ตั้ง ADMIN_USER_IDS จะไม่มีแจ้งเตือนสลิป/ลูกค้าใหม่ และสั่งงานแอดมินไม่ได้ (พิมพ์ myid ในแชทบอทเพื่อดู userId)');
  }
  if (!['auto', 'local', 'api'].includes(c.qrMode)) {
    errors.push('QR_MODE ต้องเป็น auto, local หรือ api');
  }
  if (Boolean(c.slipokBranchId) !== Boolean(c.slipokApiKey)) {
    warnings.push('ตั้ง SLIPOK_BRANCH_ID / SLIPOK_API_KEY ไม่ครบทั้งคู่ ระบบตรวจสลิปอัตโนมัติจะไม่ทำงาน');
  }
  if (c.publicBaseUrl && !c.publicBaseUrl.startsWith('https://')) {
    warnings.push('PUBLIC_BASE_URL ต้องเป็น https:// (LINE รับเฉพาะรูปจาก https)');
  }
  if (c.googleSheetId && !c.googleCredentials) {
    errors.push('ตั้ง GOOGLE_SHEET_ID แล้ว แต่ GOOGLE_SERVICE_ACCOUNT_JSON อ่านไม่ได้ (ต้องเป็น JSON หรือ base64 ของ JSON)');
  }
  if (!c.googleSheetId) {
    warnings.push('ยังไม่ได้ต่อ Google Sheets: ข้อมูลออเดอร์จะเก็บในไฟล์ชั่วคราวและ "หายเมื่อ Render รีสตาร์ท"');
  }
  return { errors, warnings };
}

module.exports = { cfg, validateConfig };