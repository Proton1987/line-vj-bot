'use strict';

const DEFAULT_MAX_MINUTES = 72 * 60;

// ทำให้ข้อความอยู่ในรูปมาตรฐาน: ตัวเลขไทย -> อารบิก, หน่วยชั่วโมง -> "H", หน่วยนาที -> "M"
function normalize(text) {
  return String(text)
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[：﹕]/g, ':')
    .replace(/,/g, '')
    .toLowerCase()
    .replace(/ชั?่?วโมง/g, ' H ')
    .replace(/ช\.?\s?ม\.?/g, ' H ')
    .replace(/นาที/g, ' M ')
    .replace(/(?<![a-z])(?:hours?|hrs?|h)(?![a-z])/g, ' H ')
    .replace(/(?<![a-z])(?:minutes?|mins?|m)(?![a-z])/g, ' M ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "8.30" -> 8 ชม. 30 นาที | "8.5" -> 8 ชม. 30 นาที | "8.75" -> 8 ชม. 45 นาที
// ทศนิยม 2 หลักที่ < 60 ตีเป็นนาที (ตามที่คนไทยพิมพ์ 8.30) นอกนั้นตีเป็นเศษของชั่วโมง
function decimalToMinutes(intStr, fracStr, hasExtraMinutes) {
  const hours = parseInt(intStr, 10);
  let extra;
  if (fracStr.length === 2 && !hasExtraMinutes && parseInt(fracStr, 10) < 60) {
    extra = parseInt(fracStr, 10);
  } else {
    extra = Math.round(parseFloat('0.' + fracStr) * 60);
  }
  return hours * 60 + extra;
}

/**
 * คืนค่าเป็น object เสมอ:
 *  { type: 'ok', minutes }
 *  { type: 'ambiguous', number }   เลขล้วน <= 24 (ไม่รู้ว่าชั่วโมงหรือนาที)
 *  { type: 'invalid' }             มีตัวเลขแต่อ่านเป็นเวลาไม่ได้
 *  { type: 'toolarge', maxMinutes }
 *  { type: 'none' }                ไม่มีตัวเลขเลย (แชทปกติ ไม่ต้องตอบ)
 */
function parseDuration(text, { maxMinutes = DEFAULT_MAX_MINUTES } = {}) {
  if (!text || !/[0-9๐-๙]/.test(text)) return { type: 'none' };
  const s = normalize(text);

  let minutes = null;

  const clock = s.match(/(?<![\d.:])(\d{1,3}):(\d{1,2})(?![\d:])/);
  if (clock) {
    const mm = parseInt(clock[2], 10);
    if (mm >= 60) return { type: 'invalid' };
    minutes = parseInt(clock[1], 10) * 60 + mm;
  } else {
    const hMatch = s.match(/(\d+)(?:\.(\d+))?\s*H/);
    const mMatch = s.match(/(\d+(?:\.\d+)?)\s*M/);

    if (hMatch || mMatch) {
      const explicitMin = mMatch ? Math.round(parseFloat(mMatch[1])) : null;
      if (hMatch) {
        let hasExtra = explicitMin !== null;
        let trailing = 0;
        if (!hasExtra) {
          // "8 ชม 30" (ไม่มีคำว่านาที) -> ตัวเลขท้ายคือนาที
          const after = s.slice(hMatch.index + hMatch[0].length);
          const t = after.match(/^\s*(\d{1,2})(?![\d.:])/);
          if (t && parseInt(t[1], 10) < 60) {
            trailing = parseInt(t[1], 10);
            hasExtra = true;
          }
        }
        const base =
          hMatch[2] !== undefined
            ? decimalToMinutes(hMatch[1], hMatch[2], hasExtra)
            : parseInt(hMatch[1], 10) * 60;
        minutes = base + (explicitMin || 0) + trailing;
      } else {
        minutes = explicitMin;
      }
    } else {
      const bare = s.match(/^(\d+)(?:\.(\d+))?$/);
      if (!bare) return { type: 'invalid' };
      if (bare[2] !== undefined) {
        minutes = decimalToMinutes(bare[1], bare[2], false);
      } else {
        const n = parseInt(bare[1], 10);
        if (n === 0) return { type: 'invalid' };
        if (n <= 24) return { type: 'ambiguous', number: n };
        minutes = n;
      }
    }
  }

  if (!Number.isFinite(minutes) || minutes <= 0) return { type: 'invalid' };
  if (minutes > maxMinutes) return { type: 'toolarge', maxMinutes };
  return { type: 'ok', minutes };
}

function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  const parts = [];
  if (h > 0) parts.push(h + ' ชม.');
  if (m > 0 || h === 0) parts.push(m + ' นาที');
  return parts.join(' ');
}

module.exports = { parseDuration, formatDuration, normalize, DEFAULT_MAX_MINUTES };
