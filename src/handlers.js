'use strict';

const { parseDuration, formatDuration } = require('./parseTime');
const { resolveRates, calculatePrice } = require('./pricing');
const { newOrderId, nowTH } = require('./store');
const flex = require('./flex');

const OPEN_STATUSES = ['pending', 'slip_received', 'rejected'];

function createHandlers({ client, store, cfg, qr, logger = console }) {
  const seenEvents = new Map(); // webhookEventId -> เวลา
  const rateState = new Map(); // userId -> { times: [], warned }
  const throttles = new Map(); // key -> เวลา
  const recentOrders = new Map(); // `${userId}:${minutes}` -> { orderId, ts }

  const isAdmin = (userId) => cfg.adminUserIds.includes(userId);

  // ล้างหน่วยความจำเป็นระยะ
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [k, t] of seenEvents) if (now - t > 10 * 60 * 1000) seenEvents.delete(k);
    for (const [k, t] of throttles) if (now - t > 60 * 60 * 1000) throttles.delete(k);
    for (const [k, v] of recentOrders) if (now - v.ts > 5 * 60 * 1000) recentOrders.delete(k);
    for (const [k, v] of rateState) if (!v.times.some((t) => now - t < 60 * 1000)) rateState.delete(k);
  }, 5 * 60 * 1000);
  if (cleaner.unref) cleaner.unref();

  /* ---------- utilities ---------- */
  function throttled(key, ms) {
    const now = Date.now();
    if (now - (throttles.get(key) || 0) < ms) return true;
    throttles.set(key, now);
    return false;
  }

  // 'ok' | 'warn' | 'drop'
  function checkRate(userId) {
    const now = Date.now();
    const st = rateState.get(userId) || { times: [], warned: false };
    st.times = st.times.filter((t) => now - t < 60 * 1000);
    st.times.push(now);
    if (st.times.length <= cfg.rateLimitPerMin) {
      st.warned = false;
      rateState.set(userId, st);
      return 'ok';
    }
    rateState.set(userId, st);
    if (!st.warned) {
      st.warned = true;
      return 'warn';
    }
    return 'drop';
  }

  async function getProfileSafe(userId) {
    try {
      return await client.getProfile(userId);
    } catch (_) {
      return null;
    }
  }

  async function ensureCustomer(userId) {
    let c = store.getCustomer(userId);
    if (!c) {
      const profile = await getProfileSafe(userId);
      c = await store.upsertCustomer({ userId, displayName: profile?.displayName || '', status: 'pending' });
    }
    return c;
  }

  async function push(to, messages) {
    try {
      await client.pushMessage({ to, messages: Array.isArray(messages) ? messages : [messages] });
      return true;
    } catch (err) {
      logger.error(`[push] ส่งถึง ${to.slice(0, 6)}… ไม่สำเร็จ:`, err?.message || err);
      return false;
    }
  }

  async function notifyAdmins(messages) {
    if (cfg.adminUserIds.length === 0) {
      logger.warn('[admin] ไม่มี ADMIN_USER_IDS จึงไม่ได้แจ้งเตือนแอดมิน');
      return;
    }
    await Promise.all(cfg.adminUserIds.map((id) => push(id, messages)));
  }

  function makeCtx(event) {
    const ctx = {
      event,
      userId: event.source?.userId,
      isUser: event.source?.type === 'user',
      replied: false,
      async reply(messages) {
        if (!event.replyToken) return;
        ctx.replied = true;
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: Array.isArray(messages) ? messages : [messages],
        });
      },
    };
    return ctx;
  }

  // ต้องได้รับอนุมัติก่อนถึงออก QR ได้ (ถ้าเปิด REQUIRE_APPROVAL)
  async function ensureAllowed(ctx) {
    const customer = await ensureCustomer(ctx.userId);
    if (!cfg.requireApproval || isAdmin(ctx.userId) || customer.status === 'approved') return customer;
    if (customer.status === 'revoked') {
      await ctx.reply(flex.notRegistered(cfg.adminUrl));
      return null;
    }
    await ctx.reply(flex.notRegistered(cfg.adminUrl));
    if (!throttled(`reg:${ctx.userId}`, 10 * 60 * 1000)) {
      await notifyAdmins(flex.adminNewCustomer(customer, 'ลูกค้าขอใช้งาน'));
    }
    return null;
  }

  /* ---------- flow หลัก ---------- */
  async function presentConfirm(ctx, minutes) {
    const customer = await ensureAllowed(ctx);
    if (!customer) return;
    const pricing = calculatePrice(minutes, resolveRates(customer, cfg.rates), cfg.minCharge);
    await ctx.reply(flex.confirmCard({ minutes, pricing, adminUrl: cfg.adminUrl }));
  }

  async function confirmOrder(ctx, minutes) {
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > cfg.maxMinutes) {
      return ctx.reply(flex.invalidTime(cfg.adminUrl));
    }
    const customer = await ensureAllowed(ctx);
    if (!customer) return;

    const pricing = calculatePrice(minutes, resolveRates(customer, cfg.rates), cfg.minCharge);

    // กดยืนยันซ้ำภายใน 2 นาที -> ใช้ออเดอร์เดิม
    const key = `${ctx.userId}:${minutes}`;
    const recent = recentOrders.get(key);
    let order = recent && Date.now() - recent.ts < 2 * 60 * 1000 ? store.getOrder(recent.orderId) : null;
    if (!order || order.status !== 'pending' || order.amount !== pricing.amount) {
      order = await store.addOrder({
        orderId: newOrderId(),
        userId: ctx.userId,
        displayName: customer.displayName || '',
        thliveId: customer.thliveId || '',
        minutes,
        amount: pricing.amount,
        status: 'pending',
      });
      recentOrders.set(key, { orderId: order.orderId, ts: Date.now() });
    }

    let qrUrl;
    try {
      ({ url: qrUrl } = await qr.prepareImageUrl(order.amount));
    } catch (err) {
      logger.error('[order] สร้าง QR ไม่ได้:', err.message);
      await store.updateOrder(order.orderId, { note: 'สร้าง QR ไม่สำเร็จ' });
      await ctx.reply(flex.qrFailed(cfg.adminUrl));
      await notifyAdmins({
        type: 'text',
        text: `⚠ สร้าง QR ไม่สำเร็จ\nลูกค้า: ${customer.displayName || ctx.userId}\nออเดอร์ ${order.orderId} ยอด ${flex.fmtBaht(order.amount)} บาท\nสาเหตุ: ${err.message}`,
      });
      return;
    }

    await ctx.reply([flex.paymentCard({ order, pricing, adminUrl: cfg.adminUrl }), flex.qrImage(qrUrl)]);
  }

  async function onSlip(ctx) {
    const customer = await ensureCustomer(ctx.userId);
    const order = store.latestOrderForUser(ctx.userId, OPEN_STATUSES);

    if (order) {
      await store.updateOrder(order.orderId, { status: 'slip_received', slipAt: nowTH() });
      await ctx.reply(flex.slipReceived(order));
      if (!throttled(`slip:${ctx.userId}`, 60 * 1000)) {
        await notifyAdmins(flex.adminSlip({ order, customer }));
      }
    } else {
      await ctx.reply(flex.slipNoOrder(cfg.adminUrl));
      if (!throttled(`slip-none:${ctx.userId}`, 5 * 60 * 1000)) {
        await notifyAdmins({
          type: 'text',
          text: `📷 ${customer.displayName || ctx.userId} ส่งรูปมา แต่ไม่มีออเดอร์ค้างชำระ\n(ตรวจในแชท LINE OA)`,
        });
      }
    }
  }

  async function onFollow(ctx) {
    const existing = store.getCustomer(ctx.userId);
    const customer = existing || (await ensureCustomer(ctx.userId));
    await ctx.reply(flex.welcome(cfg.adminUrl, resolveRates(customer, cfg.rates)));
    if (!existing && !throttled(`follow:${ctx.userId}`, 10 * 60 * 1000)) {
      await notifyAdmins(flex.adminNewCustomer(customer, 'ผู้ใช้ใหม่เพิ่มเพื่อน'));
    }
  }

  /* ---------- แอดมิน ---------- */
  async function adminReview(ctx, action, orderId) {
    if (!isAdmin(ctx.userId)) return;
    const order = store.getOrder(orderId);
    if (!order) return ctx.reply({ type: 'text', text: `ไม่พบออเดอร์ ${orderId}` });

    if (action === 'paid') {
      if (order.status === 'paid') {
        return ctx.reply({ type: 'text', text: `ออเดอร์ ${orderId} ยืนยันชำระไปแล้ว` });
      }
      await store.updateOrder(orderId, { status: 'paid', paidAt: nowTH() });
      const ok = await push(order.userId, flex.paidNotice(order));
      return ctx.reply({
        type: 'text',
        text: `✅ บันทึกชำระแล้ว ${orderId} (${flex.fmtBaht(order.amount)} บาท)${ok ? '\nแจ้งลูกค้าแล้ว' : '\n⚠ แจ้งลูกค้าไม่สำเร็จ ลองแจ้งเอง'}`,
      });
    }

    if (order.status === 'paid') {
      return ctx.reply({ type: 'text', text: `ออเดอร์ ${orderId} ชำระแล้ว ไม่สามารถปฏิเสธได้` });
    }
    await store.updateOrder(orderId, { status: 'rejected' });
    const ok = await push(order.userId, flex.rejectedNotice(order, cfg.adminUrl));
    return ctx.reply({
      type: 'text',
      text: `❌ บันทึกสลิปไม่ถูกต้อง ${orderId}${ok ? '\nแจ้งลูกค้าแล้ว' : '\n⚠ แจ้งลูกค้าไม่สำเร็จ'}`,
    });
  }

  async function approveUser(ctx, userId, thliveId) {
    const patch = { userId, status: 'approved' };
    if (thliveId) patch.thliveId = thliveId;
    if (!store.getCustomer(userId)) {
      const profile = await getProfileSafe(userId);
      patch.displayName = profile?.displayName || '';
    }
    const c = await store.upsertCustomer(patch);
    const ok = await push(userId, flex.approvedNotice());
    return ctx.reply({
      type: 'text',
      text: `✅ อนุมัติ ${c.displayName || userId} แล้ว${thliveId ? `\nTHLive ID: ${thliveId}` : ''}${ok ? '\nแจ้งลูกค้าแล้ว' : '\n⚠ แจ้งลูกค้าไม่สำเร็จ'}`,
    });
  }

  async function adminCommand(ctx, textIn) {
    const [cmd, ...args] = textIn.split(/\s+/);
    switch (cmd.toLowerCase()) {
      case '/help':
        return ctx.reply({ type: 'text', text: flex.ADMIN_HELP });
      case '/pending': {
        const list = store.listOrders(OPEN_STATUSES, 10);
        if (list.length === 0) return ctx.reply({ type: 'text', text: 'ไม่มีรายการค้าง 🎉' });
        const lines = list.map(
          (o) => `${o.orderId}\n  ${o.displayName || o.userId.slice(0, 8)} | ${formatDuration(o.minutes)} | ${flex.fmtBaht(o.amount)}฿ | ${flex.STATUS_LABEL[o.status] || o.status}`
        );
        return ctx.reply({ type: 'text', text: `รายการค้าง (ล่าสุด ${list.length})\n${lines.join('\n')}` });
      }
      case '/approve':
        if (!args[0]) return ctx.reply({ type: 'text', text: 'ใช้: /approve <userId> [THLiveID]' });
        return approveUser(ctx, args[0], args[1]);
      case '/revoke': {
        if (!args[0]) return ctx.reply({ type: 'text', text: 'ใช้: /revoke <userId>' });
        const c = store.getCustomer(args[0]);
        if (!c) return ctx.reply({ type: 'text', text: 'ไม่พบ userId นี้' });
        await store.upsertCustomer({ userId: args[0], status: 'revoked' });
        return ctx.reply({ type: 'text', text: `🚫 ระงับ ${c.displayName || args[0]} แล้ว` });
      }
      default:
        return ctx.reply({ type: 'text', text: 'ไม่รู้จักคำสั่ง พิมพ์ /help ดูคำสั่งทั้งหมด' });
    }
  }

  /* ---------- ตัวแยกประเภท event ---------- */
  async function onText(ctx) {
    const userText = ctx.event.message.text.trim();

    if (/^(myid|\/myid|ไอดีของฉัน)$/i.test(userText)) {
      return ctx.reply({ type: 'text', text: `userId ของคุณ:\n${ctx.userId}` });
    }
    if (userText.startsWith('/') && isAdmin(ctx.userId)) return adminCommand(ctx, userText);

    // ในกลุ่ม/ห้องแชท ไม่ตอบอะไรนอกจากคำสั่งแอดมิน (กันบอทรบกวนกลุ่ม)
    if (!ctx.isUser) return;

    const rate = checkRate(ctx.userId);
    if (rate === 'drop') return;
    if (rate === 'warn') {
      return ctx.reply({ type: 'text', text: 'ส่งข้อความถี่เกินไปครับ รอสักครู่แล้วลองใหม่นะครับ 🙏' });
    }

    if (userText === 'วิธีใช้งาน') return ctx.reply(flex.instruction(cfg.adminUrl));
    if (userText === 'ราคา' || userText === 'อัตราค่าบริการ') {
      const customer = store.getCustomer(ctx.userId);
      return ctx.reply(flex.welcome(cfg.adminUrl, resolveRates(customer, cfg.rates)));
    }

    const parsed = parseDuration(userText, { maxMinutes: cfg.maxMinutes });
    switch (parsed.type) {
      case 'none':
        return; // แชทปกติกับแอดมิน ไม่ต้องตอบ
      case 'ambiguous':
        return ctx.reply(flex.ambiguous(parsed.number));
      case 'toolarge':
        return ctx.reply(flex.tooLarge(parsed.maxMinutes, cfg.adminUrl));
      case 'invalid':
        return ctx.reply(flex.invalidTime(cfg.adminUrl));
      default:
        return presentConfirm(ctx, parsed.minutes);
    }
  }

  async function onPostback(ctx) {
    const params = new URLSearchParams(ctx.event.postback?.data || '');
    const a = params.get('a');

    // action ของแอดมิน: ตรวจสิทธิ์ก่อนเสมอ (ในกลุ่มก็ตรวจที่ userId คนกด)
    if (a === 'paid' || a === 'reject') return adminReview(ctx, a, params.get('o'));
    if (a === 'approve_user') {
      if (!isAdmin(ctx.userId)) return;
      return approveUser(ctx, params.get('u'));
    }

    if (!ctx.isUser) return;
    const rate = checkRate(ctx.userId);
    if (rate !== 'ok') return;

    const m = parseInt(params.get('m'), 10);
    if (a === 'confirm') return confirmOrder(ctx, m);
    if (a === 'pick') {
      if (!Number.isInteger(m) || m <= 0 || m > cfg.maxMinutes) return ctx.reply(flex.invalidTime(cfg.adminUrl));
      return presentConfirm(ctx, m);
    }
    if (a === 'edit') {
      return ctx.reply({ type: 'text', text: 'พิมพ์เวลาใหม่ได้เลยครับ เช่น 8.30ชม หรือ 2:30' });
    }
  }

  async function route(ctx) {
    const { event } = ctx;
    if (!ctx.userId) return;

    if (event.type === 'follow') return onFollow(ctx);
    if (event.type === 'postback') return onPostback(ctx);
    if (event.type === 'message') {
      if (event.message.type === 'text') return onText(ctx);
      if (event.message.type === 'image' && ctx.isUser) {
        if (checkRate(ctx.userId) === 'drop') return;
        return onSlip(ctx);
      }
    }
  }

  // เรียกจาก webhook: ห้ามโยน error ออกไป และไม่ประมวลผลซ้ำเมื่อ LINE ส่ง event เดิมมาอีก
  async function handleEvent(event) {
    const id = event.webhookEventId;
    if (id) {
      if (seenEvents.has(id)) return;
      seenEvents.set(id, Date.now());
    }
    const ctx = makeCtx(event);
    try {
      await route(ctx);
    } catch (err) {
      logger.error('[event] จัดการ event ไม่สำเร็จ:', err?.originalError?.response?.data || err?.message || err);
      if (!ctx.replied && ctx.isUser && event.replyToken) {
        try {
          await ctx.reply({ type: 'text', text: 'ขออภัยครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง หรือติดต่อแอดมินครับ 🙏' });
        } catch (_) {
          /* reply token อาจถูกใช้/หมดอายุแล้ว */
        }
      }
    }
  }

  return { handleEvent };
}

module.exports = { createHandlers };
