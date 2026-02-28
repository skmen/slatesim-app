export const getPreviousDateStr = (dateStr: string, daysBack: number = 1): string => {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return dateStr;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const back = Number.isFinite(daysBack) ? Math.max(0, Math.floor(daysBack)) : 1;

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return dateStr;
  }

  // Use UTC from explicit parts to avoid local timezone drift.
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() - back);

  const y = utcDate.getUTCFullYear();
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

