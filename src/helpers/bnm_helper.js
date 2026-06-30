const BASE_URL = 'https://api.bnm.gov.my/public';
const HEADERS = {
  'Accept': 'application/vnd.BNM.API.v1+json'
};

async function fetchBNM(endpoint) {
  const url = `${BASE_URL}/${endpoint}`;
  const response = await fetch(url, { headers: HEADERS });
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
  const session = res.meta?.session ?? 'N/A';
  const lastUpdated = res.meta?.last_updated ?? 'N/A';

  return `💵 *${item.currency_code}MYR = ${middle}*
• *Buying*: ${buying}
• *Selling*: ${selling}
• *Date*: ${item.rate.date}
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

  return `🏦 *Overnight Policy Rate (OPR)*
• *OPR Level*: ${data.new_opr_level}%
• *Change*: ${changeSign}${data.change_in_opr}%
• *Effective*: ${data.date}`;
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

  return `🪙 *Kijang Emas Gold Prices*
• *1 oz*: Buy ${formatPrice(data.one_oz.buying)} / Sell ${formatPrice(data.one_oz.selling)}
• *1/2 oz*: Buy ${formatPrice(data.half_oz.buying)} / Sell ${formatPrice(data.half_oz.selling)}
• *1/4 oz*: Buy ${formatPrice(data.quarter_oz.buying)} / Sell ${formatPrice(data.quarter_oz.selling)}
• *Effective*: ${data.effective_date}`;
}

/**
 * Resolve placeholders of form {{bnm:XYZ}} or {{bnm:rates:XYZ}} or {{bnm:gold}} or {{bnm:opr}}
 */
export async function resolvePlaceholders(templateText) {
  if (!templateText) return templateText;

  const regex = /\{\{bnm:([a-zA-Z0-9:-]+)\}\}/g;
  const matches = [...templateText.matchAll(regex)];

  if (matches.length === 0) return templateText;

  let resolvedText = templateText;
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
        replacement = fullPlaceholder; // keep unresolved placeholder if format is unrecognized
      }
    } catch (err) {
      console.error(`[BNM-Helper] Failed to resolve placeholder ${fullPlaceholder}:`, err.message);
      replacement = `[Error fetching ${key.toUpperCase()} data: ${err.message}]`;
    }

    resolvedText = resolvedText.replace(fullPlaceholder, replacement);
  }

  return resolvedText;
}
