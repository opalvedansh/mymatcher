// Dates of birth arrive as ISO YYYY-MM-DD. Only the age derived from one is
// ever shown; the date itself stays private.

const MIN_AGE = 13;

/** Whole years old on `today`, or null when `iso` is not a real date in the past. */
function ageFromDob(iso, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return null;
  const [year, month, day] = m.slice(1).map(Number);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) {
    return null;
  }

  let age = today.getUTCFullYear() - year;
  const thisMonth = today.getUTCMonth() + 1;
  if (thisMonth < month || (thisMonth === month && today.getUTCDate() < day)) age -= 1;
  return age < 0 ? null : age;
}

module.exports = { MIN_AGE, ageFromDob };
