'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ORDER_COLS = [
  'orderId', 'createdAt', 'userId', 'displayName', 'thliveId',
  'minutes', 'amount', 'status', 'slipAt', 'paidAt', 'note',
];
const CUSTOMER_COLS = [
  'userId', 'displayName', 'thliveId', 'status',
  'hourlyRate', 'packageHours', 'packagePrice', 'createdAt', 'note',
];
const ORDER_NUMERIC = ['minutes', 'amount'];
const CUSTOMER_NUMERIC = ['hourlyRate', 'packageHours', 'packagePrice'];

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

const colLetter = (n) => String.fromCharCode(64 + n); // 1 -> A (ใช้ได้ถึง Z)

function rowToObj(cols, row, numericCols) {
  const obj = {};
  cols.forEach((c, i) => {
    const v = row[i] === undefined || row[i] === null ? '' : row[i];
    obj[c] = numericCols.includes(c) && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
  });
  return obj;
}
const objToRow = (cols, obj) => cols.map((c) => (obj[c] === undefined || obj[c] === null ? '' : obj[c]));

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

/* ---------- Google Sheets (ถาวร แอดมินเปิดดู/แก้ไขได้) ---------- */
class SheetsStore extends BaseStore {
  constructor({ sheetId, credentials, refreshMs = 120000 }) {
    super();
    const { JWT } = require('google-auth-library'); // โหลดเมื่อใช้งานจริงเท่านั้น
    this.sheetId = sheetId;
    this.auth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.refreshMs = refreshMs;
    this._queue = Promise.resolve();
  }

  async _req(method, urlPath, { params, data } = {}) {
    const res = await this.auth.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}${urlPath}`,
      method,
      params,
      data,
    });
    return res.data;
  }

  // ทำงานทีละคิว กันเขียนชนกัน และไม่ให้ error ทำให้ระบบล่ม
  _enqueue(label, fn, dump) {
    this._queue = this._queue.then(fn).catch((err) => {
      const detail = err?.response?.data?.error?.message || err.message;
      console.error(`[store] ${label} ไม่สำเร็จ: ${detail}`);
      if (dump) console.error('[store] ข้อมูลที่ยังไม่ได้บันทึก:', JSON.stringify(dump));
    });
    return this._queue;
  }

  async init() {
    const meta = await this._req('GET', '', { params: { fields: 'sheets.properties.title' } });
    const titles = (meta.sheets || []).map((s) => s.properties.title);
    const missing = ['Orders', 'Customers'].filter((t) => !titles.includes(t));
    if (missing.length) {
      await this._req('POST', ':batchUpdate', {
        data: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      });
    }
    await this._ensureHeader('Orders', ORDER_COLS);
    await this._ensureHeader('Customers', CUSTOMER_COLS);
    await this._load();
    const t = setInterval(() => this._enqueue('รีเฟรชข้อมูล', () => this._load()), this.refreshMs);
    t.unref();
  }

  async _ensureHeader(tab, cols) {
    const range = `${tab}!A1:${colLetter(cols.length)}1`;
    const res = await this._req('GET', `/values/${encodeURIComponent(range)}`);
    if (!res.values || !res.values[0] || res.values[0].length === 0) {
      await this._req('PUT', `/values/${encodeURIComponent(range)}`, {
        params: { valueInputOption: 'RAW' },
        data: { values: [cols] },
      });
    }
  }

  async _load() {
    const oRange = `Orders!A2:${colLetter(ORDER_COLS.length)}`;
    const cRange = `Customers!A2:${colLetter(CUSTOMER_COLS.length)}`;
    const [o, c] = await Promise.all([
      this._req('GET', `/values/${encodeURIComponent(oRange)}`),
      this._req('GET', `/values/${encodeURIComponent(cRange)}`),
    ]);
    const orders = [];
    (o.values || []).forEach((row, i) => {
      const obj = rowToObj(ORDER_COLS, row, ORDER_NUMERIC);
      if (obj.orderId) orders.push({ ...obj, _row: i + 2 });
    });
    const customers = new Map();
    (c.values || []).forEach((row, i) => {
      const obj = rowToObj(CUSTOMER_COLS, row, CUSTOMER_NUMERIC);
      if (obj.userId) customers.set(obj.userId, { ...obj, _row: i + 2 });
    });
    this.orders = orders;
    this.customers = customers;
  }

  async _append(tab, cols, obj) {
    const res = await this._req('POST', `/values/${encodeURIComponent(`${tab}!A:${colLetter(cols.length)}`)}:append`, {
      params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
      data: { values: [objToRow(cols, obj)] },
    });
    const m = /!A(\d+):/.exec(res?.updates?.updatedRange || '');
    if (m) obj._row = Number(m[1]);
  }

  async _update(tab, cols, obj) {
    const range = `${tab}!A${obj._row}:${colLetter(cols.length)}${obj._row}`;
    await this._req('PUT', `/values/${encodeURIComponent(range)}`, {
      params: { valueInputOption: 'RAW' },
      data: { values: [objToRow(cols, obj)] },
    });
  }

  _saveCustomer(c) {
    this._enqueue('บันทึกลูกค้า', () => (c._row ? this._update('Customers', CUSTOMER_COLS, c) : this._append('Customers', CUSTOMER_COLS, c)), c);
  }
  _appendOrder(o) {
    this._enqueue('บันทึกออเดอร์', () => this._append('Orders', ORDER_COLS, o), o);
  }
  _saveOrder(o) {
    this._enqueue('อัปเดตออเดอร์', () => (o._row ? this._update('Orders', ORDER_COLS, o) : this._append('Orders', ORDER_COLS, o)), o);
  }
  async flush() {
    await this._queue;
  }
}

async function createStore(cfg) {
  let store;
  if (cfg.googleSheetId && cfg.googleCredentials) {
    store = new SheetsStore({ sheetId: cfg.googleSheetId, credentials: cfg.googleCredentials });
    console.log('[store] ใช้ Google Sheets');
  } else {
    store = new FileStore(cfg.dataFile);
    console.warn('[store] ใช้ไฟล์ชั่วคราว (ข้อมูลหายเมื่อ Render รีสตาร์ท) แนะนำให้ต่อ Google Sheets');
  }
  await store.init();
  return store;
}

module.exports = { BaseStore, FileStore, SheetsStore, createStore, newOrderId, nowTH, ORDER_COLS, CUSTOMER_COLS };
