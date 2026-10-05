'use strict';

const jsQR = require('jsqr');
const jimpLib = require('jimp');
const axios = require('axios');

// รองรับทั้ง jimp v0.x (export เป็น Jimp ตรงๆ) และ v1.x (export แบบ { Jimp })
const Jimp = jimpLib.Jimp || jimpLib;

const isConfigured = (cfg) => Boolean(cfg.slipokBranchId && cfg.slipokApiKey);

/** ดาวน์โหลดรูปที่ลูกค้าส่งในแชท LINE เป็น Buffer */
async function downloadLineImage(messageId, channelAccessToken) {
  const res = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${channelAccessToken}` },
    responseType: 'arraybuffer',
    timeout: 8000,
    maxContentLength: 10 * 1024 * 1024,
  });
  return Buffer.from(res.data);
}

/** อ่าน QR payload จากรูปภาพ (คืน null ถ้าไม่พบ QR) */
async function decodeQrFromBuffer(imageBuffer) {
  try {
    const image = await Jimp.read(imageBuffer);
    const { width, height, data } = image.bitmap;
    const code = jsQR(new Uint8ClampedArray(data), width, height);
    return code ? code.data : null;
  } catch (err) {
    console.error('[slip] อ่าน QR จากรูปภาพล้มเหลว:', err.message);
    return null;
  }
}

/**
 * ส่ง QR payload ไปตรวจกับ SlipOK
 * คืน { ok: true, data } เมื่อสลิปผ่าน
 * คืน { ok: false, code, message } เมื่อ SlipOK ปฏิเสธสลิป (เช่น 1012 ซ้ำ, 1013 ยอดไม่ตรง, 1014 บัญชีผู้รับไม่ตรง)
 * throw เมื่อเรียก SlipOK ไม่ได้ (เครือข่าย/timeout/ยังไม่ตั้งค่า)
 */
async function verifySlip(qrData, cfg, { amount } = {}) {
  if (!isConfigured(cfg)) {
    throw new Error('ยังไม่ได้ตั้งค่า SLIPOK_BRANCH_ID หรือ SLIPOK_API_KEY');
  }

  const body = { data: qrData, log: true }; // log: true = เปิดตรวจสลิปซ้ำ + ตรวจบัญชีผู้รับ
  if (Number.isFinite(Number(amount)) && Number(amount) > 0) body.amount = Number(amount);

  try {
    const res = await axios.post(`https://api.slipok.com/api/line/apikey/${cfg.slipokBranchId}`, body, {
      headers: { 'x-authorization': cfg.slipokApiKey, 'Content-Type': 'application/json' },
      timeout: 8000,
    });
    if (res.data?.success === true && res.data.data) return { ok: true, data: res.data.data };
    return { ok: false, code: res.data?.code, message: res.data?.message || 'ไม่ทราบสาเหตุ' };
  } catch (err) {
    const d = err.response?.data;
    if (d && (d.code !== undefined || d.message)) {
      return { ok: false, code: d.code, message: d.message || 'ไม่ทราบสาเหตุ' };
    }
    throw err; // ไม่มี response จาก SlipOK (เครือข่าย/timeout)
  }
}

module.exports = { isConfigured, downloadLineImage, decodeQrFromBuffer, verifySlip };