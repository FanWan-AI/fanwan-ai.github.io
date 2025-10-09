const ASIA_SHANGHAI = 'Asia/Shanghai';

export function nowUtcISOString() {
  return new Date().toISOString();
}

export function formatDateKey(date = new Date(), timeZone = ASIA_SHANGHAI) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
