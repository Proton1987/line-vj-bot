'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, formatDuration } = require('../src/parseTime');
const { calculatePrice, resolveRates } = require('../src/pricing');

const ok = (text, minutes) =>
  test(`parse "${text}" -> ${minutes} นาที`, () => {
    assert.deepEqual(parseDuration(text), { type: 'ok', minutes });
  });

// บั๊กเดิม: มีจุดหลัง "ชม" ทำให้ได้ 30 ชั่วโมง
ok('8.30 ชม.', 510);
ok('8.30ชม.', 510);
ok('2.5 ชม.', 150);
ok('8.30ชม', 510);
ok('8.30 ชั่วโมง', 510);
ok('2.5ชม', 150);
ok('1.75 ชม', 105);      // .75 >= 60 -> เศษชั่วโมง
// รูปแบบอื่น
ok('2:30', 150);
ok('4 ชม', 240);
ok('4ชม.', 240);
ok('8 ชม 30 นาที', 510);
ok('8 ชม 30', 510);       // บั๊กเดิม: ตัด 30 ทิ้ง
ok('8 ชม. 30 น.'.replace(' น.', ' นาที'), 510);
ok('30 นาที 2 ชม', 150);
ok('540 นาที', 540);
ok('540', 540);
ok('90', 90);
ok('๒:๓๐', 150);          // เลขไทย
ok('2h30m', 150);
ok('3 hrs', 180);
ok('ไลฟ์ 3 ชม ครับ', 180);
ok('8.30', 510);

test('เลขล้วน <= 24 ต้องถามกลับ', () => {
  assert.deepEqual(parseDuration('8'), { type: 'ambiguous', number: 8 });
  assert.deepEqual(parseDuration('24'), { type: 'ambiguous', number: 24 });
});
test('แชทปกติไม่มีตัวเลข -> none', () => {
  assert.equal(parseDuration('สวัสดีครับ').type, 'none');
  assert.equal(parseDuration('').type, 'none');
});
test('นาทีเกิน 59 ใน hh:mm -> invalid', () => {
  assert.equal(parseDuration('2:90').type, 'invalid');
});
test('มีตัวเลขแต่ไม่ใช่เวลา -> invalid', () => {
  assert.equal(parseDuration('ขอ 5 คน').type, 'invalid');
  assert.equal(parseDuration('0').type, 'invalid');
});
test('เกินเพดาน -> toolarge', () => {
  assert.equal(parseDuration('999999').type, 'toolarge');
  assert.equal(parseDuration('100 ชม').type, 'toolarge');
  assert.equal(parseDuration('72 ชม').type, 'ok');
});
test('formatDuration', () => {
  assert.equal(formatDuration(510), '8 ชม. 30 นาที');
  assert.equal(formatDuration(45), '45 นาที');
  assert.equal(formatDuration(120), '2 ชม.');
});

/* ---- ราคา ---- */
test('ราคา: 1 ชม = 15, 4 ชม = 60', () => {
  assert.equal(calculatePrice(60).amount, 15);
  assert.equal(calculatePrice(240).amount, 60);
});
test('ราคา: ชนเพดาน 100 ที่ 7 ชม', () => {
  const p = calculatePrice(420);
  assert.equal(p.amount, 100);
  assert.equal(p.kind, 'capped');
});
test('ราคา: 8 ชม = 100, 8.30 = 107.5, 9 ชม = 115', () => {
  assert.equal(calculatePrice(480).amount, 100);
  assert.equal(calculatePrice(510).amount, 107.5);
  assert.equal(calculatePrice(540).amount, 115);
  assert.equal(calculatePrice(510).kind, 'package_plus');
});
test('ราคา: ยอดขั้นต่ำ', () => {
  const p = calculatePrice(1, undefined, 1);
  assert.equal(p.amount, 1);
  assert.equal(p.minApplied, true);
});
test('ราคา: เรตรายลูกค้า', () => {
  const rates = resolveRates({ hourlyRate: 10, packageHours: 6, packagePrice: 50 });
  assert.equal(calculatePrice(360, rates).amount, 50);
  assert.equal(calculatePrice(420, rates).amount, 60);
  assert.deepEqual(resolveRates({ hourlyRate: '' }).hourlyRate, 15);
});
