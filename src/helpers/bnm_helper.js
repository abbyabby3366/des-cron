const BASE_URL = 'https://api.bnm.gov.my/public';
const HEADERS = {
  'Accept': 'application/vnd.BNM.API.v1+json'
};

export function getGMT8Parts(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hour12: false
  });
  const parts = {};
  for (const p of formatter.formatToParts(d)) {
    parts[p.type] = p.value;
  }
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    dd: parts.day,
    mm: parts.month,
    yy: parts.year,
    hh: hour,
    min: parts.minute,
    sec: parts.second,
    weekday: parts.weekday,
    dateStr: `${parts.day}-${parts.month}-${parts.year}`,
    timeStr: `${hour}:${parts.minute}`,
    dateTimeStr: `${parts.day}-${parts.month}-${parts.year} ${hour}:${parts.minute}`
  };
}

export function formatIsoDateToDDMMYY(isoDateStr) {
  if (!isoDateStr || typeof isoDateStr !== 'string') return String(isoDateStr);
  const match = isoDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1].slice(-2)}`;
  }
  return isoDateStr;
}

async function fetchBNM(endpoint) {
  const url = `${BASE_URL}/${endpoint}`;
  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Format Exchange Rate (Base: MYR)
 */
async function formatExchangeRate(currencyCode) {
  const code = currencyCode.toUpperCase();
  const res = await fetchBNM(`exchange-rate/${code}?session=1200`);
  const item = res.data;
  
  if (!item || !item.rate) {
    throw new Error(`No rate data found for ${code}`);
  }

  const buying = item.rate.buying_rate ?? 'N/A';
  const selling = item.rate.selling_rate ?? 'N/A';
  const middle = item.rate.middle_rate ?? 'N/A';
  const lastUpdated = res.meta?.last_updated ? formatIsoDateToDDMMYY(res.meta.last_updated) : 'N/A';
  const rateDate = item.rate.date ? formatIsoDateToDDMMYY(item.rate.date) : 'N/A';

  return `💵 *${item.currency_code}MYR = ${middle}*
• *Buying*: ${buying}
• *Selling*: ${selling}
• *Date*: ${rateDate}
• *Last Updated*: ${lastUpdated}`;
}

/**
 * Format Overnight Policy Rate (OPR)
 */
async function formatOPR() {
  const res = await fetchBNM('opr');
  const data = res.data;

  if (!data) {
    throw new Error('No OPR data found');
  }

  const changeSign = data.change_in_opr > 0 ? '+' : '';
  const effDate = data.date ? formatIsoDateToDDMMYY(data.date) : 'N/A';

  return `🏦 *Overnight Policy Rate (OPR)*
• *OPR Level*: ${data.new_opr_level}%
• *Change*: ${changeSign}${data.change_in_opr}%
• *Effective*: ${effDate}`;
}

/**
 * Format Kijang Emas gold coin trading prices
 */
async function formatKijangEmas() {
  const res = await fetchBNM('kijang-emas');
  const data = res.data;

  if (!data) {
    throw new Error('No Kijang Emas data found');
  }

  const formatPrice = (val) => typeof val === 'number' ? `MYR ${val.toLocaleString()}` : val;
  const effDate = data.effective_date ? formatIsoDateToDDMMYY(data.effective_date) : 'N/A';

  return `🪙 *Kijang Emas Gold Prices*
• *1 oz*: Buy ${formatPrice(data.one_oz.buying)} / Sell ${formatPrice(data.one_oz.selling)}
• *1/2 oz*: Buy ${formatPrice(data.half_oz.buying)} / Sell ${formatPrice(data.half_oz.selling)}
• *1/4 oz*: Buy ${formatPrice(data.quarter_oz.buying)} / Sell ${formatPrice(data.quarter_oz.selling)}
• *Effective*: ${effDate}`;
}

function resolveCountdown(targetStr) {
  let targetMs = NaN;
  const ddmmyyyy = targetStr.match(/^(\d{2})-(\d{2})-(\d{2}|\d{4})$/);
  const yyyymmdd = targetStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ddmmyyyy) {
    const day = parseInt(ddmmyyyy[1], 10);
    const month = parseInt(ddmmyyyy[2], 10);
    let year = parseInt(ddmmyyyy[3], 10);
    if (year < 100) year += 2000;
    targetMs = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`).getTime();
  } else if (yyyymmdd) {
    targetMs = new Date(`${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}T00:00:00+08:00`).getTime();
  }
  if (isNaN(targetMs)) {
    return `[Invalid date: ${targetStr}]`;
  }
  const nowParts = getGMT8Parts(Date.now());
  const todayStartMs = new Date(`20${nowParts.yy}-${nowParts.mm}-${nowParts.dd}T00:00:00+08:00`).getTime();
  const diffDays = Math.round((targetMs - todayStartMs) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day';
  if (diffDays > 1) return `${diffDays} days`;
  if (diffDays === -1) return '1 day ago';
  return `${Math.abs(diffDays)} days ago`;
}

/**
 * Resolve placeholders of form:
 * - {{date}}, {{time}}, {{datetime}}, {{day}}
 * - {{countdown:DD-MM-YY}} or {{countdown:DD-MM-YYYY}} or {{countdown:YYYY-MM-DD}}
 * - {{bnm:XYZ}} or {{bnm:rates:XYZ}} or {{bnm:gold}} or {{bnm:opr}}
 */
export async function resolvePlaceholders(templateText) {
  if (!templateText) return templateText;

  const nowParts = getGMT8Parts(Date.now());
  let resolvedText = templateText
    .replace(/\{\{date\}\}/gi, nowParts.dateStr)
    .replace(/\{\{time\}\}/gi, nowParts.timeStr)
    .replace(/\{\{datetime\}\}/gi, nowParts.dateTimeStr)
    .replace(/\{\{day\}\}/gi, nowParts.weekday);

  resolvedText = resolvedText.replace(/\{\{countdown:([0-9-]+)\}\}/gi, (_, dateArg) => {
    return resolveCountdown(dateArg.trim());
  });

  const regex = /\{\{bnm:([a-zA-Z0-9:-]+)\}\}/g;
  const matches = [...resolvedText.matchAll(regex)];

  if (matches.length === 0) return resolvedText;

  for (const match of matches) {
    const fullPlaceholder = match[0];
    const key = match[1].toLowerCase();

    let replacement = '';
    try {
      if (key === 'gold' || key === 'kijang') {
        replacement = await formatKijangEmas();
      } else if (key === 'opr' || key === 'interest') {
        replacement = await formatOPR();
      } else if (key.startsWith('rates:') || key.startsWith('exchange:')) {
        const parts = key.split(':');
        const currency = parts[1];
        replacement = await formatExchangeRate(currency);
      } else if (key.length === 3) {
        replacement = await formatExchangeRate(key);
      } else {
        replacement = fullPlaceholder;
      }
    } catch (err) {
      console.error(`[BNM-Helper] Failed to resolve placeholder ${fullPlaceholder}:`, err.message);
      replacement = `[Error fetching ${key.toUpperCase()} data: ${err.message}]`;
    }

    resolvedText = resolvedText.replace(fullPlaceholder, replacement);
  }

  return resolvedText;
}
