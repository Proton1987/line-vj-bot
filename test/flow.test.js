'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BaseStore } = require('../src/store');
const { createHandlers } = require('../src/handlers');

const ADMIN = 'Uadmin000000000000000000000000001';
const CUST = 'Ucust0000000000000000000000000001';
const silent = { log() {}, warn() {}, error() {} };

function setup(over = {}) {
  const replies = [];
  const pushes = [];
  const client = {
    replyMessage: async (r) => { replies.push(r); },
    pushMessage: async (p) => { pushes.push(p); },
    getProfile: async () => ({ displayName: 'ลูกค้าทดสอบ' }),
  };
  const cfg = {
    adminUrl: 'https://line.me/ti/p/~admin', adminUserIds: [ADMIN],
    rates: { hourlyRate: 15, packageHours: 8, packagePrice: 100 },
    minCharge: 1, maxMinutes: 72 * 60, requireApproval: false, rateLimitPerMin: 10, ...over,
  };
  const store = new BaseStore();
  const qr = { prepareImageUrl: async (amt) => ({ url: `https://bot.example/qr/${amt.toFixed(2)}/sig.png`, via: 'local' }) };
  const { handleEvent } = createHandlers({ client, store, cfg, qr, logger: silent });
  let n = 0;
  const ev = (userId, extra) => ({ webhookEventId: `e${++n}`, replyToken: `t${n}`, source: { type: 'user', userId }, ...extra });
  const text = (userId, t) => ev(userId, { type: 'message', message: { type: 'text', text: t } });
  const postback = (userId, data) => ev(userId, { type: 'postback', postback: { data } });
  const image = (userId) => ev(userId, { type: 'message', message: { type: 'image', id: '1' } });
  return { handleEvent, replies, pushes, store, text, postback, image, ev };
}

test('ข้อความปกติ (ไม่มีตัวเลข) บอทเงียบ', async () => {
  const s = setup();
  await s.handleEvent(s.text(CUST, 'สวัสดีครับ'));
  assert.equal(s.replies.length, 0);
});

test('"8.30 ชม." -> การ์ดยืนยัน 107.5 บาท (ไม่ใช่ 430)', async () => {
  const s = setup();
  await s.handleEvent(s.text(CUST, '8.30 ชม.'));
  assert.equal(s.replies.length, 1);
  const msg = s.replies[0].messages[0];
  assert.equal(msg.type, 'flex');
  assert.match(JSON.stringify(msg), /a=confirm&m=510/);
  assert.match(JSON.stringify(msg), /107\.50/);
  assert.equal(s.store.orders.length, 0, 'ยังไม่สร้างออเดอร์จนกว่าจะกดยืนยัน');
});

test('เลข "8" -> ถามว่าชั่วโมงหรือนาที', async () => {
  const s = setup();
  await s.handleEvent(s.text(CUST, '8'));
  const qrItems = s.replies[0].messages[0].quickReply.items.map((i) => i.action.data);
  assert.deepEqual(qrItems, ['a=pick&m=480', 'a=pick&m=8']);
});

test('ยืนยัน -> ออเดอร์ + การ์ด + รูป QR; กดซ้ำใช้ออเดอร์เดิม', async () => {
  const s = setup();
  await s.handleEvent(s.postback(CUST, 'a=confirm&m=510'));
  assert.equal(s.store.orders.length, 1);
  assert.equal(s.store.orders[0].amount, 107.5);
  const msgs = s.replies[0].messages;
  assert.equal(msgs[0].type, 'flex');
  assert.equal(msgs[1].type, 'image');
  assert.match(msgs[1].originalContentUrl, /^https:\/\//);
  await s.handleEvent(s.postback(CUST, 'a=confirm&m=510'));
  assert.equal(s.store.orders.length, 1, 'ไม่ซ้ำ');
});

test('event ซ้ำ (redelivery) ไม่ถูกประมวลผลสองครั้ง', async () => {
  const s = setup();
  const e = s.text(CUST, '2:30');
  await s.handleEvent(e);
  await s.handleEvent(e);
  assert.equal(s.replies.length, 1);
});

test('ส่งสลิป -> รับสลิป + แจ้งแอดมิน -> แอดมินกดยืนยัน -> แจ้งลูกค้า', async () => {
  const s = setup();
  await s.handleEvent(s.postback(CUST, 'a=confirm&m=480'));
  const orderId = s.store.orders[0].orderId;

  await s.handleEvent(s.image(CUST));
  assert.equal(s.store.getOrder(orderId).status, 'slip_received');
  assert.equal(s.pushes.length, 1);
  assert.equal(s.pushes[0].to, ADMIN);
  assert.match(JSON.stringify(s.pushes[0].messages), new RegExp(`a=paid&o=${orderId}`));

  // คนที่ไม่ใช่แอดมินกดปุ่มอนุมัติ -> ไม่มีผล
  await s.handleEvent(s.postback(CUST, `a=paid&o=${orderId}`));
  assert.equal(s.store.getOrder(orderId).status, 'slip_received');

  await s.handleEvent(s.postback(ADMIN, `a=paid&o=${orderId}`));
  assert.equal(s.store.getOrder(orderId).status, 'paid');
  assert.equal(s.pushes.at(-1).to, CUST);
});

test('ส่งรูปโดยไม่มีออเดอร์ค้าง -> ตอบแบบไม่พบรายการ', async () => {
  const s = setup();
  await s.handleEvent(s.image(CUST));
  assert.match(s.replies[0].messages[0].text, /ยังไม่พบรายการ/);
});

test('REQUIRE_APPROVAL: ยังไม่อนุมัติ -> ไม่ออก QR และแจ้งแอดมิน; อนุมัติแล้วใช้ได้', async () => {
  const s = setup({ requireApproval: true });
  await s.handleEvent(s.postback(CUST, 'a=confirm&m=60'));
  assert.equal(s.store.orders.length, 0);
  assert.match(s.replies[0].messages[0].text, /ยังไม่ได้ลงทะเบียน/);
  assert.equal(s.pushes[0].to, ADMIN);

  await s.handleEvent(s.postback(ADMIN, `a=approve_user&u=${CUST}`));
  assert.equal(s.store.getCustomer(CUST).status, 'approved');
  await s.handleEvent(s.postback(CUST, 'a=confirm&m=60'));
  assert.equal(s.store.orders.length, 1);
});

test('เรตรายลูกค้าจากชีตถูกใช้', async () => {
  const s = setup();
  await s.store.upsertCustomer({ userId: CUST, displayName: 'VIP', status: 'approved', hourlyRate: 10, packageHours: 6, packagePrice: 50 });
  await s.handleEvent(s.postback(CUST, 'a=confirm&m=420'));
  assert.equal(s.store.orders[0].amount, 60);
});

test('คำสั่งแอดมิน /pending และ /approve; ผู้ใช้ทั่วไปใช้ไม่ได้', async () => {
  const s = setup();
  await s.handleEvent(s.postback(CUST, 'a=confirm&m=120'));
  await s.handleEvent(s.text(ADMIN, '/pending'));
  assert.match(s.replies.at(-1).messages[0].text, /รายการค้าง/);
  await s.handleEvent(s.text(ADMIN, `/approve ${CUST} 123456`));
  assert.equal(s.store.getCustomer(CUST).thliveId, '123456');
  const before = s.replies.length;
  await s.handleEvent(s.text(CUST, '/pending'));
  assert.equal(s.replies.length, before, 'ผู้ใช้ทั่วไปไม่ได้รับคำตอบ');
});

test('myid ตอบ userId', async () => {
  const s = setup();
  await s.handleEvent(s.text(CUST, 'myid'));
  assert.match(s.replies[0].messages[0].text, new RegExp(CUST));
});

test('rate limit: เกิน 10 ครั้ง/นาที เตือนครั้งเดียวแล้วเงียบ', async () => {
  const s = setup();
  for (let i = 0; i < 14; i++) await s.handleEvent(s.text(CUST, '2 ชม'));
  assert.equal(s.replies.length, 11); // 10 การ์ด + 1 คำเตือน
});

test('QR สร้างไม่ได้ -> แจ้งลูกค้า + แจ้งแอดมิน ไม่ล่ม', async () => {
  const replies = [], pushes = [];
  const client = { replyMessage: async (r) => replies.push(r), pushMessage: async (p) => pushes.push(p), getProfile: async () => ({ displayName: 'x' }) };
  const cfg = { adminUrl: 'https://x', adminUserIds: [ADMIN], rates: { hourlyRate: 15, packageHours: 8, packagePrice: 100 }, minCharge: 1, maxMinutes: 4320, requireApproval: false, rateLimitPerMin: 10 };
  const qr = { prepareImageUrl: async () => { throw new Error('API ไม่ตอบสนอง'); } };
  const { handleEvent } = createHandlers({ client, store: new BaseStore(), cfg, qr, logger: silent });
  await handleEvent({ webhookEventId: 'q1', replyToken: 't', source: { type: 'user', userId: CUST }, type: 'postback', postback: { data: 'a=confirm&m=60' } });
  assert.match(replies[0].messages[0].text, /ระบบสร้าง QR ขัดข้อง/);
  assert.equal(pushes[0].to, ADMIN);
});

test('error ใน handler ไม่โยนออกไป (webhook ไม่พัง)', async () => {
  const client = { replyMessage: async () => { throw new Error('token หมดอายุ'); }, pushMessage: async () => {}, getProfile: async () => null };
  const cfg = { adminUrl: 'https://x', adminUserIds: [], rates: { hourlyRate: 15, packageHours: 8, packagePrice: 100 }, minCharge: 1, maxMinutes: 4320, requireApproval: false, rateLimitPerMin: 10 };
  const { handleEvent } = createHandlers({ client, store: new BaseStore(), cfg, qr: {}, logger: silent });
  await assert.doesNotReject(handleEvent({ webhookEventId: 'z', replyToken: 't', source: { type: 'user', userId: CUST }, type: 'message', message: { type: 'text', text: '2 ชม' } }));
});

test('ในกลุ่ม: ไม่ตอบข้อความทั่วไป', async () => {
  const s = setup();
  await s.handleEvent({ webhookEventId: 'g1', replyToken: 't', source: { type: 'group', groupId: 'G1', userId: CUST }, type: 'message', message: { type: 'text', text: '2 ชม' } });
  assert.equal(s.replies.length, 0);
});
