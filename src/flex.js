'use strict';

const { formatDuration } = require('./parseTime');

const GREEN = '#06C755';

/* ---------- helper ---------- */
const fmtBaht = (n) =>
  Number.isInteger(n)
    ? n.toLocaleString('th-TH')
    : n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

const text = (t, o = {}) => ({ type: 'text', text: t, wrap: true, ...o });
const vbox = (contents, o = {}) => ({ type: 'box', layout: 'vertical', contents, ...o });
const row = (label, value, valueOpts = {}) => ({
  type: 'box',
  layout: 'baseline',
  spacing: 'sm',
  contents: [
    text(label, { color: '#888888', size: 'sm', flex: 3 }),
    text(value, { color: '#333333', size: 'sm', flex: 5, align: 'end', weight: 'bold', ...valueOpts }),
  ],
});
const uriButton = (label, uri, o = {}) => ({
  type: 'button', style: 'primary', height: 'sm', color: GREEN,
  action: { type: 'uri', label, uri }, ...o,
});
const postbackButton = (label, data, displayText, o = {}) => ({
  type: 'button', style: 'primary', height: 'sm', color: GREEN,
  action: { type: 'postback', label, data, displayText }, ...o,
});
const footer = (contents) => vbox(contents, { spacing: 'sm', flex: 0 });
const bubble = ({ header, body, foot, size = 'mega' }) => ({
  type: 'bubble', size, header, body, footer: foot,
});
const flexMsg = (altText, contents, quickReply) => ({
  type: 'flex', altText: altText.slice(0, 400), contents, ...(quickReply ? { quickReply } : {}),
});

// quick reply label จำกัด 20 ตัวอักษร
const qUri = (label, uri) => ({ type: 'action', action: { type: 'uri', label, uri } });
const qMsg = (label, t) => ({ type: 'action', action: { type: 'message', label, text: t } });
const qPost = (label, data, displayText) => ({
  type: 'action', action: { type: 'postback', label, data, displayText },
});
const quick = (...items) => ({ items });

const STATUS_LABEL = {
  pending: 'รอชำระเงิน',
  slip_received: 'รอแอดมินตรวจสลิป',
  paid: 'ชำระเงินแล้ว',
  rejected: 'สลิปไม่ถูกต้อง',
};

// อธิบายวิธีคิดเงินให้ลูกค้าเห็น
function describePricing(p) {
  const lines = [];
  if (p.kind === 'package_plus') {
    lines.push(`🎉 โปรเหมา ${fmtNum(p.packageHours)} ชม. ${fmtBaht(p.packagePrice)} บาท`);
    if (p.extraMinutes > 0) {
      lines.push(`+ ส่วนเกิน ${formatDuration(p.extraMinutes)} = ${fmtBaht(p.extra)} บาท`);
    }
  } else if (p.kind === 'capped') {
    lines.push(`🎉 ถึงเพดานโปรเหมา จ่ายสูงสุด ${fmtBaht(p.packagePrice)} บาท (ไม่เกิน ${fmtNum(p.packageHours)} ชม.)`);
  }
  if (p.minApplied) lines.push(`ยอดขั้นต่ำ ${fmtBaht(p.minCharge)} บาท`);
  return lines;
}

/* ---------- ข้อความถึงลูกค้า ---------- */
function welcome(adminUrl, rates) {
  const r = rates;
  const perHrPackage = r.packagePrice / r.packageHours;
  return flexMsg(
    'ยินดีต้อนรับ! อัตราค่าบริการรับดันฟีดห้องไลฟ์สด 📌',
    bubble({
      header: vbox(
        [
          text('ยินดีต้อนรับครับ! 👋', { weight: 'bold', color: '#FFFFFF', size: 'sm' }),
          text('บริการรับดันฟีดห้องไลฟ์สด 📌', { weight: 'bold', color: '#FFFFFF', size: 'lg', margin: 'xs' }),
        ],
        { backgroundColor: GREEN }
      ),
      body: vbox(
        [
          vbox(
            [
              text('📌 สำหรับผู้ใช้งานใหม่ (ยังไม่เคยใช้บริการ):', { weight: 'bold', size: 'xs', color: '#E65100' }),
              text('กรุณาทักหาแอดมินก่อนเพื่อตั้งค่าระบบ โดยแจ้งรายละเอียดดังนี้:\n1. โปรโมชันที่ต้องการ\n2. เลข ID THLive\n3. ชื่อบัญชี THLive', {
                size: 'xxs', color: '#5D4037', margin: 'xs',
              }),
            ],
            { backgroundColor: '#FFF3E0', paddingAll: 'md', cornerRadius: 'md', borderColor: '#FF9800', borderWidth: '1px' }
          ),
          text('💵 อัตราค่าบริการ', { weight: 'bold', size: 'md', color: '#111111', margin: 'md' }),
          vbox(
            [
              text(`🔹 รายชั่วโมง: ชั่วโมงละ ${fmtBaht(r.hourlyRate)} บาท`, { size: 'xs', color: '#333333' }),
              text(`🔹 เหมาสุดคุ้ม (${fmtNum(r.packageHours)} ชม.): เพียง ${fmtBaht(r.packagePrice)} บาท`, {
                size: 'xs', color: '#1DB446', weight: 'bold',
              }),
              text(`(ตก ชม. ละ ${fmtNum(perHrPackage)} บาท จากปกติ ${fmtBaht(r.hourlyRate * r.packageHours)}.-)`, {
                size: 'xxs', color: '#777777', margin: 'none',
              }),
              text(`🔹 เกิน ${fmtNum(r.packageHours)} ชม.: ชม. ที่ ${fmtNum(r.packageHours + 1)} ขึ้นไป +${fmtBaht(r.hourlyRate)} บาท/ชม. (คิดตามจริงเป็นนาที)`, {
                size: 'xs', color: '#333333',
              }),
            ],
            { spacing: 'sm', backgroundColor: '#F8F9FA', paddingAll: 'md', cornerRadius: 'md' }
          ),
          { type: 'separator', margin: 'md' },
          text('👉 ลูกค้าเดิม พิมพ์เวลาที่ไลฟ์เข้ามาในแชท (เช่น 8.30ชม หรือ 2:30) ระบบจะสรุปยอดให้ตรวจสอบ แล้วสร้าง QR Code ชำระเงินให้ครับ!', {
            size: 'xs', color: GREEN, weight: 'bold', margin: 'md',
          }),
          vbox(
            [text('⚠️ แอดมินอาจจะตอบช้า แนะนำทักมาอีกรอบช่วง 17:00 น. - 23:00 น. ครับ', { size: 'xxs', color: '#D97706', weight: 'bold' })],
            { backgroundColor: '#FFF8E1', paddingAll: 'sm', cornerRadius: 'sm', margin: 'md' }
          ),
        ],
        { spacing: 'md' }
      ),
      foot: footer([uriButton('💬 ติดต่อแอดมิน (ตั้งค่า/แจ้งข้อมูล)', adminUrl)]),
    }),
    quick(qUri('💬 คุยกับแอดมิน', adminUrl), qMsg('❓ วิธีใช้งาน', 'วิธีใช้งาน'))
  );
}

function instruction(adminUrl) {
  const ex = (t, o = {}) => text(t, { size: 'xs', color: '#555555', ...o });
  return flexMsg(
    '📌 คู่มือวิธีใช้งานพิมพ์สั่งการคำนวณราคา',
    bubble({
      header: vbox([text('❓ วิธีพิมพ์คำนวณราคา', { weight: 'bold', color: '#FFFFFF', size: 'md' })], { backgroundColor: '#17A2B8' }),
      body: vbox(
        [
          text('พิมพ์เวลาที่ไลฟ์เข้ามาในแชทได้ทันทีครับ ตัวอย่างเช่น:', { size: 'xs', color: '#333333' }),
          vbox(
            [
              ex('• 8.30ชม หรือ 8.30 ชม. (8 ชั่วโมง 30 นาที)', { color: '#1DB446', weight: 'bold' }),
              ex('• 2:30 (2 ชั่วโมง 30 นาที)'),
              ex('• 4 ชม (4 ชั่วโมง)'),
              ex('• 8 ชม 30 นาที'),
              ex('• 540 นาที (คำนวณเป็นนาที)'),
            ],
            { spacing: 'xs', backgroundColor: '#F8F9FA', paddingAll: 'md', cornerRadius: 'md' }
          ),
          text('ถ้าพิมพ์เป็นตัวเลขล้วน เช่น "8" ระบบจะถามว่าหมายถึงชั่วโมงหรือนาที', { size: 'xxs', color: '#777777' }),
          text('⚡ ระบบจะสรุปยอดให้ตรวจสอบ เมื่อกดยืนยันจะส่ง PromptPay QR Code ให้สแกนชำระ จากนั้นส่งสลิปมาในแชทนี้ได้เลย', {
            size: 'xs', color: GREEN, weight: 'bold',
          }),
        ],
        { spacing: 'md' }
      ),
      foot: footer([uriButton('💬 ติดต่อแอดมิน', adminUrl)]),
    }),
    quick(qUri('💬 คุยกับแอดมิน', adminUrl), qMsg('💰 ดูราคาบริการ', 'ราคา'))
  );
}

// การ์ดให้ลูกค้าตรวจสอบก่อนออก QR
function confirmCard({ minutes, pricing, adminUrl }) {
  const dur = formatDuration(minutes);
  const notes = describePricing(pricing);
  return flexMsg(
    `ตรวจสอบรายการ: ${dur} ยอด ${fmtBaht(pricing.amount)} บาท`,
    bubble({
      header: vbox(
        [
          text('ตรวจสอบรายการก่อนชำระ', { weight: 'bold', color: '#1DB446', size: 'sm' }),
          text('บริการรับดันฟีดห้องไลฟ์ 📌', { weight: 'bold', size: 'lg', margin: 'xs', color: '#111111' }),
        ],
        { backgroundColor: '#F8F9FA' }
      ),
      body: vbox(
        [
          row('⏱️ เวลาไลฟ์', `${dur} (${minutes} นาที)`),
          row('💰 ยอดชำระ', `${fmtBaht(pricing.amount)} บาท`, { color: '#1DB446', size: 'xl' }),
          ...notes.map((n) => text(n, { size: 'xs', color: '#E65100', align: 'center', margin: 'sm' })),
          text('ถูกต้องไหมครับ? กด "ยืนยัน" เพื่อรับ QR Code', { size: 'xs', color: '#777777', align: 'center', margin: 'md' }),
        ],
        { spacing: 'md' }
      ),
      foot: footer([
        postbackButton('✅ ยืนยัน สร้าง QR', `a=confirm&m=${minutes}`, `ยืนยัน ${dur}`),
        postbackButton('✏️ พิมพ์เวลาใหม่', 'a=edit', 'ขอแก้ไขเวลา', { style: 'secondary', color: undefined }),
      ]),
    }),
    quick(qUri('💬 คุยกับแอดมิน', adminUrl), qMsg('❓ วิธีใช้งาน', 'วิธีใช้งาน'))
  );
}

// สรุปยอดหลังยืนยัน (ส่งคู่กับรูป QR)
function paymentCard({ order, pricing, adminUrl }) {
  const dur = formatDuration(order.minutes);
  return flexMsg(
    `สรุปยอดชำระ ${fmtBaht(order.amount)} บาท (ออเดอร์ ${order.orderId})`,
    bubble({
      header: vbox(
        [
          text('สรุปยอดชำระเงิน', { weight: 'bold', color: '#1DB446', size: 'sm' }),
          text('บริการรับดันฟีดห้องไลฟ์ 📌', { weight: 'bold', size: 'lg', margin: 'xs', color: '#111111' }),
        ],
        { backgroundColor: '#F8F9FA' }
      ),
      body: vbox(
        [
          row('🧾 ออเดอร์', order.orderId, { size: 'xs' }),
          row('⏱️ เวลาไลฟ์', `${dur} (${order.minutes} นาที)`),
          row('💰 ยอดชำระ', `${fmtBaht(order.amount)} บาท`, { color: '#1DB446', size: 'xl' }),
          ...describePricing(pricing).map((n) => text(n, { size: 'xs', color: '#E65100', align: 'center', margin: 'sm' })),
          text('📲 สแกน QR ด้านล่างเพื่อชำระ แล้วส่งสลิปมาในแชทนี้ได้เลยครับ', { size: 'xs', color: GREEN, weight: 'bold', margin: 'md' }),
        ],
        { spacing: 'md' }
      ),
      foot: footer([uriButton('💬 ติดต่อแอดมิน', adminUrl)]),
    }),
    quick(qUri('💬 คุยกับแอดมิน', adminUrl), qMsg('❓ วิธีใช้งาน', 'วิธีใช้งาน'))
  );
}

function qrImage(url) {
  return { type: 'image', originalContentUrl: url, previewImageUrl: url };
}

const withHelp = (t, adminUrl) => ({
  type: 'text',
  text: t,
  quickReply: quick(qMsg('❓ วิธีใช้งาน', 'วิธีใช้งาน'), qUri('💬 ติดต่อแอดมิน', adminUrl)),
});

const invalidTime = (adminUrl) =>
  withHelp('⚠ อ่านเวลาไม่ออกครับ\nกรุณาพิมพ์ เช่น:\n- 8.30ชม\n- 2:30\n- 4 ชม\n- 8 ชม 30 นาที\n- 540 นาที', adminUrl);

const tooLarge = (maxMinutes, adminUrl) =>
  withHelp(`⚠ เวลามากเกินไปครับ (สูงสุด ${formatDuration(maxMinutes)} ต่อครั้ง)\nหากต้องการใช้บริการต่อเนื่อง กรุณาติดต่อแอดมินครับ`, adminUrl);

function ambiguous(n) {
  return {
    type: 'text',
    text: `"${n}" หมายถึงอะไรครับ?`,
    quickReply: quick(
      qPost(`${n} ชั่วโมง`, `a=pick&m=${n * 60}`, `${n} ชั่วโมง`),
      qPost(`${n} นาที`, `a=pick&m=${n}`, `${n} นาที`)
    ),
  };
}

const notRegistered = (adminUrl) =>
  withHelp('🔒 บัญชีของคุณยังไม่ได้ลงทะเบียนใช้งานครับ\nแจ้งแอดมินให้แล้ว กรุณาแจ้งโปรโมชัน, เลข ID THLive และชื่อบัญชี THLive กับแอดมิน เมื่ออนุมัติแล้วจะมีข้อความแจ้งกลับครับ', adminUrl);

const qrFailed = (adminUrl) =>
  withHelp('ขออภัยครับ ระบบสร้าง QR ขัดข้องชั่วคราว 🙏\nแจ้งแอดมินให้แล้ว กรุณารอสักครู่ หรือติดต่อแอดมินโดยตรงได้เลยครับ', adminUrl);

const slipReceived = (order) => ({
  type: 'text',
  text: `✅ รับสลิปแล้วครับ\nออเดอร์ ${order.orderId}\nยอด ${fmtBaht(order.amount)} บาท\nรอแอดมินตรวจสอบสักครู่ จะมีข้อความแจ้งกลับครับ`,
});

const slipNoOrder = (adminUrl) =>
  withHelp('รับรูปแล้วครับ แต่ยังไม่พบรายการที่รอชำระ\nถ้าชำระเงินแล้ว แอดมินจะตรวจสอบให้ หรือพิมพ์เวลาไลฟ์เพื่อสร้างรายการใหม่ได้เลยครับ', adminUrl);

const paidNotice = (order) => ({
  type: 'text',
  text: `✅ ชำระเงินเรียบร้อยครับ\nออเดอร์ ${order.orderId}\nยอด ${fmtBaht(order.amount)} บาท\nขอบคุณที่ใช้บริการครับ 🙏`,
});

const rejectedNotice = (order, adminUrl) =>
  withHelp(`⚠ ตรวจสอบสลิปออเดอร์ ${order.orderId} แล้วยังไม่ถูกต้องครับ\nกรุณาส่งสลิปใหม่ หรือติดต่อแอดมินครับ`, adminUrl);

const approvedNotice = () => ({
  type: 'text',
  text: '✅ แอดมินอนุมัติบัญชีของคุณแล้วครับ\nพิมพ์เวลาที่ไลฟ์ (เช่น 8.30ชม) เพื่อรับ QR ชำระเงินได้เลย',
});

/* ---------- ข้อความถึงแอดมิน ---------- */
function adminSlip({ order, customer, noteLine }) {
  const dur = formatDuration(order.minutes);
  return flexMsg(
    `🧾 สลิปใหม่ ${order.orderId} ${fmtBaht(order.amount)} บาท`,
    bubble({
      size: 'kilo',
      header: vbox([text('🧾 ลูกค้าส่งสลิปแล้ว', { weight: 'bold', color: '#FFFFFF', size: 'md' })], { backgroundColor: '#F59E0B' }),
      body: vbox(
        [
          row('ลูกค้า', customer?.displayName || '(ไม่ทราบชื่อ)'),
          row('THLive ID', String(customer?.thliveId || '-')),
          row('ออเดอร์', order.orderId, { size: 'xs' }),
          row('เวลาไลฟ์', dur),
          row('ยอด', `${fmtBaht(order.amount)} บาท`, { color: '#1DB446' }),
          text(noteLine || 'ดูรูปสลิปได้ในแชทกับลูกค้าที่ LINE Official Account Manager', { size: 'xxs', color: '#777777', margin: 'md' }),
        ],
        { spacing: 'sm' }
      ),
      foot: footer([
        postbackButton('✅ ยืนยันชำระแล้ว', `a=paid&o=${order.orderId}`, `ยืนยันชำระ ${order.orderId}`),
        postbackButton('❌ สลิปไม่ถูกต้อง', `a=reject&o=${order.orderId}`, `ปฏิเสธ ${order.orderId}`, { style: 'secondary', color: undefined }),
      ]),
    })
  );
}

function adminNewCustomer(customer, reason) {
  return flexMsg(
    `👤 ${reason}: ${customer.displayName || customer.userId}`,
    bubble({
      size: 'kilo',
      header: vbox([text(`👤 ${reason}`, { weight: 'bold', color: '#FFFFFF', size: 'md' })], { backgroundColor: '#17A2B8' }),
      body: vbox(
        [
          row('ชื่อ', customer.displayName || '(ไม่ทราบชื่อ)'),
          row('สถานะ', String(customer.status || 'pending')),
          text(`userId: ${customer.userId}`, { size: 'xxs', color: '#777777', margin: 'md' }),
          text('ใส่ THLive ID/โปรโมชันพิเศษได้ที่ชีต Customers', { size: 'xxs', color: '#777777' }),
        ],
        { spacing: 'sm' }
      ),
      foot: footer([postbackButton('✅ อนุมัติลูกค้า', `a=approve_user&u=${customer.userId}`, 'อนุมัติลูกค้า')]),
    })
  );
}

const ADMIN_HELP = [
  'คำสั่งแอดมิน',
  '/pending  ดูรายการที่ยังไม่ชำระ/รอตรวจสลิป',
  '/approve <userId> [THLiveID]  อนุมัติลูกค้า',
  '/revoke <userId>  ระงับลูกค้า',
  '/help  ดูคำสั่งนี้',
  '',
  'พิมพ์ myid เพื่อดู userId ของตัวเอง (ใช้ตั้งค่า ADMIN_USER_IDS)',
].join('\n');

module.exports = {
  fmtBaht, STATUS_LABEL, describePricing,
  welcome, instruction, confirmCard, paymentCard, qrImage,
  invalidTime, tooLarge, ambiguous, notRegistered, qrFailed,
  slipReceived, slipNoOrder, paidNotice, rejectedNotice, approvedNotice,
  adminSlip, adminNewCustomer, ADMIN_HELP,
};