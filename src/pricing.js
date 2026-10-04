'use strict';

const DEFAULT_RATES = { hourlyRate: 15, packageHours: 8, packagePrice: 100 };

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function positive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// รวมเรตของลูกค้า (ถ้ามีกรอกในชีต) กับเรตเริ่มต้น
function resolveRates(customer, defaults = DEFAULT_RATES) {
  return {
    hourlyRate: positive(customer && customer.hourlyRate) ?? defaults.hourlyRate,
    packageHours: positive(customer && customer.packageHours) ?? defaults.packageHours,
    packagePrice: positive(customer && customer.packagePrice) ?? defaults.packagePrice,
  };
}

/**
 * kind:
 *  - 'normal'        ต่ำกว่าแพ็กเกจ คิดตามนาที
 *  - 'capped'        คิดตามนาทีแล้วเกินราคาเหมา -> จ่ายแค่ราคาเหมา
 *  - 'package_plus'  ครบแพ็กเกจ + ส่วนเกินคิดตามนาที
 */
function calculatePrice(totalMinutes, rates = DEFAULT_RATES, minCharge = 1) {
  const { hourlyRate, packageHours, packagePrice } = { ...DEFAULT_RATES, ...rates };
  const perMinute = hourlyRate / 60;
  const packageMinutes = packageHours * 60;

  let kind;
  let base;
  let extraMinutes = 0;
  let extra = 0;

  if (totalMinutes >= packageMinutes) {
    kind = 'package_plus';
    base = packagePrice;
    extraMinutes = totalMinutes - packageMinutes;
    extra = extraMinutes * perMinute;
  } else {
    const normal = totalMinutes * perMinute;
    if (normal > packagePrice) {
      kind = 'capped';
      base = packagePrice;
    } else {
      kind = 'normal';
      base = normal;
    }
  }

  const raw = round2(base + extra);
  const minApplied = raw < minCharge;
  return {
    amount: minApplied ? minCharge : raw,
    kind,
    minApplied,
    minCharge,
    extraMinutes,
    extra: round2(extra),
    hourlyRate,
    packageHours,
    packagePrice,
  };
}

module.exports = { DEFAULT_RATES, resolveRates, calculatePrice, round2 };
