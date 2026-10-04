# LINE Bot คำนวณราคา + PromptPay QR + รับสลิป (v2)

## โครงสร้างไฟล์
```
index.js            เซิร์ฟเวอร์ + webhook + /health
src/config.js       อ่าน/ตรวจ environment
src/parseTime.js    แปลงข้อความเวลา -> นาที
src/pricing.js      สูตรราคา (รองรับเรตรายลูกค้า)
src/flex.js         ข้อความ Flex ทั้งหมด
src/store.js        เก็บข้อมูล Google Sheets / ไฟล์สำรอง
src/qr.js           สร้างรูป QR (ในเครื่อง หรือผ่าน API เดิม)
src/handlers.js     ลอจิกทั้งหมด: ยืนยัน, QR, สลิป, แอดมิน
test/               เทสต์ (npm test)
```

## 1) ตั้งค่า Google Sheets (ที่เก็บออเดอร์/ลูกค้า — ทำครั้งเดียว)
Render ฟรี **ไม่มีดิสก์ถาวร** ข้อมูลในไฟล์จะหายเมื่อรีสตาร์ท จึงเก็บใน Google Sheets แทน (แอดมินเปิดดู/แก้ไขได้เอง)

1. https://console.cloud.google.com → สร้างโปรเจกต์ → เปิดใช้ **Google Sheets API**
2. IAM & Admin → Service Accounts → สร้าง → แท็บ Keys → Add key → JSON (ดาวน์โหลดไฟล์)
3. สร้าง Google Sheet ใหม่ (ว่างเปล่า) แล้วกด Share ให้ **อีเมลของ service account** (`...@...iam.gserviceaccount.com`) เป็น **Editor**
4. คัดลอก Sheet ID จาก URL: `docs.google.com/spreadsheets/d/<<SHEET_ID>>/edit`
5. บอทจะสร้างแท็บ `Orders` และ `Customers` พร้อมหัวตารางให้เองตอนเริ่มทำงาน

ใน Render ตั้ง `GOOGLE_SHEET_ID` และ `GOOGLE_SERVICE_ACCOUNT_JSON` (วางเนื้อหาไฟล์ JSON ทั้งก้อน)

แท็บ **Customers**: คอลัมน์ `hourlyRate`, `packageHours`, `packagePrice` เว้นว่าง = ใช้ราคามาตรฐาน กรอกเพื่อให้ลูกค้ารายนั้นได้เรต/โปรเฉพาะ (บอทรีเฟรชข้อมูลทุก 2 นาที)

## 2) Deploy บน Render
1. อัปโหลดโค้ดขึ้น GitHub → Render → New → **Web Service** → เลือก repo
2. Build Command: `npm install` | Start Command: `npm start` | Instance: Free
3. Environment: ตั้งค่าตาม `.env.example` (อย่างน้อย `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `PROMPTPAY_NUMBER`, `ADMIN_LINE_URL`, `GOOGLE_*`)
4. `PUBLIC_BASE_URL` ไม่ต้องตั้ง Render ใส่ `RENDER_EXTERNAL_URL` ให้เอง
5. ดู Logs ต้องเห็น `[store] ใช้ Google Sheets` และ `Server running`

## 3) ตั้ง Webhook ใน LINE Developers
Messaging API → Webhook URL: `https://<ชื่อบริการ>.onrender.com/webhook` → เปิด Use webhook → กด Verify

## 4) cron-job.org (กันหลับ)
สร้าง Cronjob ใหม่:
- URL: `https://<ชื่อบริการ>.onrender.com/health`
- Schedule: ทุก **5 นาที** (Render ฟรีหลับหลังไม่มี traffic 15 นาที)
- Method GET (ค่าเริ่มต้น) และเปิดแจ้งเตือนเมื่อ job ล้มเหลวไว้ได้
- ถ้ายังใช้ QR API เดิม (`QR_MODE=api`) ให้ใช้ `/health?deep=1` เพื่อปลุกตัวนั้นไปด้วย

## 5) ตั้งแอดมิน
1. เพิ่มเพื่อนบอท พิมพ์ `myid` → ได้ userId
2. ใส่ใน `ADMIN_USER_IDS` (คั่นคอมมาได้) แล้ว redeploy
3. พิมพ์ `/help` ในแชทกับบอทเพื่อดูคำสั่งแอดมิน

## ขั้นตอนการใช้งานจริง
1. ลูกค้าพิมพ์เวลา → การ์ดสรุปยอด → กด **ยืนยัน**
2. บอทส่ง QR → ลูกค้าโอนแล้วส่งรูปสลิปในแชท
3. แอดมินได้แจ้งเตือน (พร้อมปุ่ม ✅ ยืนยันชำระ / ❌ ไม่ถูกต้อง) ดูรูปสลิปในแชท LINE OA Manager แล้วกดปุ่ม
4. บอทแจ้งลูกค้าอัตโนมัติ และสถานะอัปเดตในชีต `Orders`

## เปิดระบบอนุมัติลูกค้า (ทำเมื่อพร้อม)
ตั้ง `REQUIRE_APPROVAL=true` → ลูกค้าที่ยังไม่อนุมัติจะไม่ได้ QR และแอดมินจะได้ปุ่ม "อนุมัติ" ส่งไปให้
ลูกค้าเดิมที่มีอยู่จึงแค่พิมพ์เวลามา 1 ครั้ง แอดมินกดอนุมัติครั้งเดียวก็ใช้ได้ตลอด

## ข้อควรรู้
- Render ฟรี: **750 ชั่วโมง/เดือนรวมทุกบริการในบัญชี** บริการที่ถูกปลุก 24 ชม. กินประมาณ 744 ชม. ดังนั้นจึงควรมีบริการเดียว (บอทนี้) — ใช้ `QR_MODE=auto` ให้บอทสร้าง QR เอง แล้วปิดบริการ QR API เดิม
- ข้อความ **push** (แจ้งแอดมิน/แจ้งลูกค้าหลังอนุมัติ) นับโควตาข้อความของ OA ส่วน reply ไม่นับ จึงแนะนำแอดมิน 1-2 คน
- การตรวจสลิปยังเป็นการกดยืนยันโดยแอดมิน (ยังไม่ตรวจอัตโนมัติ)
