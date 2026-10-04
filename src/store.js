'use strict';
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function nowTH() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function newOrderId() {
  const d = nowTH().slice(2, 10).replace(/-/g, ''); // YYMMDD
  return `ORD-${d}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/* ---------- ฐาน: เก็บในหน่วยความจำ แล้วให้ลูกคลาสบันทึกลงที่เก็บจริง ---------- */
class BaseStore {
  constructor() {
    this.customers = new Map();
    this.orders = [];
  }

  async init() {}

  getCustomer(userId) {
    return this.customers.get(userId) || null;
  }

  async upsertCustomer(patch) {
    const cur = this.customers.get(patch.userId);
    const next = { createdAt: nowTH(), ...(cur || {}), ...patch };
    this.customers.set(next.userId, next);
    this._saveCustomer(next, !cur);
    return next;
  }

  async addOrder(order) {
    const o = { createdAt: nowTH(), status: 'pending', ...order };
    this.orders.push(o);
    this._appendOrder(o);
    return o;
  }

  getOrder(orderId) {
    return this.orders.find((o) => o.orderId === orderId) || null;
  }

  async updateOrder(orderId, patch) {
    const o = this.getOrder(orderId);
    if (!o) return null;
    Object.assign(o, patch);
    this._saveOrder(o);
    return o;
  }

  latestOrderForUser(userId, statuses) {
    for (let i = this.orders.length - 1; i >= 0; i--) {
      const o = this.orders[i];
      if (o.userId === userId && statuses.includes(o.status)) return o;
    }
    return null;
  }

  listOrders(statuses, limit = 10) {
    return this.orders.filter((o) => statuses.includes(o.status)).slice(-limit).reverse();
  }

  // ลูกคลาส override
  _saveCustomer() {}
  _appendOrder() {}
  _saveOrder() {}
  async flush() {}
}

/* ---------- ไฟล์ JSON (สำรอง: Render ฟรีไม่มีดิสก์ถาวร ข้อมูลหายเมื่อรีสตาร์ท) ---------- */
class FileStore extends BaseStore {
  constructor(file) {
    super();
    this.file = path.resolve(file);
    this._timer = null;
  }

  async init() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      (data.customers || []).forEach((c) => this.customers.set(c.userId, c));
      this.orders = data.orders || [];
    } catch (_) {
      /* ไฟล์ยังไม่มี เริ่มใหม่ */
    }
  }

  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._write();
    }, 500);
    this._timer.unref();
  }

  _write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(
        this.file,
        JSON.stringify({ customers: [...this.customers.values()], orders: this.orders }, null, 2)
      );
    } catch (err) {
      console.error('[store] เขียนไฟล์ไม่สำเร็จ:', err.message);
    }
  }

  _saveCustomer() { this._schedule(); }
  _appendOrder() { this._schedule(); }
  _saveOrder() { this._schedule(); }
  async flush() { this._write(); }
}

/* ---------- Supabase Store ---------- */
// nowTH() คืนเวลาไทยแบบไม่มี timezone ("2026-10-05 14:00:00") ต้องใส่ +07:00 ก่อนเก็บลง timestamptz
const toTs = (v) => (v ? String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : '+07:00') : null);
const fromTs = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d);
};

class SupabaseStore extends BaseStore {
  constructor({ url, key }) {
    super();
    if (!url || !key) {
      throw new Error('SUPABASE_URL หรือ SUPABASE_KEY ไม่ได้ถูกตั้งค่า');
    }
    this.supabase = createClient(url, key);
  }

  async init() {
    await this._load();
  }

  async _load() {
    const { data: cData, error: cErr } = await this.supabase.from('customers').select('*');
    if (cErr) console.error('[supabase] โหลด customers ไม่สำเร็จ:', JSON.stringify(cErr));
    if (!cErr && cData) {
      cData.forEach((c) => {
        this.customers.set(c.user_id, {
          userId: c.user_id,
          displayName: c.display_name,
          thliveId: c.thlive_id || '',
          note: c.note || '',
          status: c.status || (c.approved ? 'approved' : 'pending'),
          hourlyRate: c.hourly_rate,
          packageHours: c.package_hours,
          packagePrice: c.package_price,
          createdAt: c.created_at,
        });
      });
    }

    const { data: oData, error: oErr } = await this.supabase.from('orders').select('*').order('created_at', { ascending: true });
    if (oErr) console.error('[supabase] โหลด orders ไม่สำเร็จ:', JSON.stringify(oErr));
    if (!oErr && oData) {
      this.orders = oData.map((o) => ({
        orderId: o.id,
        userId: o.user_id,
        displayName: o.display_name,
        thliveId: o.thlive_id || '',
        minutes: Number(o.hours || 0) * 60,
        amount: Number(o.amount || 0),
        status: o.status,
        slipAt: fromTs(o.slip_at),
        paidAt: fromTs(o.paid_at),
        note: o.note || '',
        createdAt: o.created_at,
      }));
    }
  }

  async _saveCustomer(c) {
    const { error } = await this.supabase.from('customers').upsert({
      user_id: c.userId,
      display_name: c.displayName,
      thlive_id: c.thliveId || null,
      note: c.note || null,
      status: c.status || 'pending',
      approved: c.status === 'approved',
      hourly_rate: c.hourlyRate,
      package_hours: c.packageHours,
      package_price: c.packagePrice,
      updated_at: new Date(),
    });
    if (error) console.error('[supabase] บันทึก customers ไม่สำเร็จ:', JSON.stringify(error));
  }

  async _appendOrder(o) {
    await this._saveOrder(o);
  }

  async _saveOrder(o) {
    const { error } = await this.supabase.from('orders').upsert({
      id: o.orderId,
      user_id: o.userId,
      display_name: o.displayName,
      thlive_id: o.thliveId || null,
      hours: (o.minutes || 0) / 60,
      amount: o.amount,
      status: o.status,
      slip_at: toTs(o.slipAt),
      paid_at: toTs(o.paidAt),
      note: o.note || null,
      updated_at: new Date(),
    });
    if (error) console.error('[supabase] บันทึก orders ไม่สำเร็จ:', JSON.stringify(error));
  }
}


async function createStore(cfg) {
  let store;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    store = new SupabaseStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY });
    console.log('[store] ใช้ Supabase Database');
  } else {
    store = new FileStore(cfg.dataFile);
    console.warn('[store] ใช้ไฟล์ชั่วคราว (ข้อมูลหายเมื่อ Render รีสตาร์ท)');
  }
  await store.init();
  return store;
}

module.exports = { BaseStore, FileStore, SupabaseStore, createStore, newOrderId, nowTH };