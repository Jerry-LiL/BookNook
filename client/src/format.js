export function money(cents) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

// Date columns arrive as YYYY-MM-DD. Build the calendar date in local time
// so a due date does not shift a day for timezones behind UTC.
export function prettyDate(value) {
  if (!value) return '';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function errorText(error) {
  if (error?.issues?.length) {
    return error.issues.map((issue) => issue.message).join(' ');
  }
  return error?.message || 'Something went wrong';
}
