// Date of birth typed as DD/MM/YYYY on a number pad, which has no "/" key.

export const MIN_AGE = 13;

/**
 * Formats typed digits as DD/MM/YYYY. The slash appears as soon as the day or
 * month is complete while typing forward, but not after a backspace, so
 * deleting a slash never re-adds it and traps the cursor.
 */
export function formatDob(text: string, prev = ''): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += '/' + digits.slice(2, 4);
  if (digits.length > 4) out += '/' + digits.slice(4);
  const typingForward = text.length > prev.length;
  if (typingForward && (digits.length === 2 || digits.length === 4)) out += '/';
  return out;
}

function ageOn(birth: Date, today: Date): number {
  let age = today.getFullYear() - birth.getFullYear();
  const hadBirthday =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hadBirthday) age -= 1;
  return age;
}

export type DobCheck =
  | { ok: true; iso: string }
  | { ok: false; error: string | null };

/** Validates a DD/MM/YYYY string. `error` is null while the date is still being typed. */
export function checkDob(value: string, today = new Date()): DobCheck {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return { ok: false, error: null };

  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const birth = new Date(year, month - 1, day);
  const isRealDate =
    year >= 1900 &&
    birth.getFullYear() === year &&
    birth.getMonth() === month - 1 &&
    birth.getDate() === day;

  if (!isRealDate) return { ok: false, error: 'Enter a real date as DD/MM/YYYY.' };
  if (birth > today) return { ok: false, error: "Your date of birth can't be in the future." };
  if (ageOn(birth, today) < MIN_AGE) {
    return { ok: false, error: `You need to be at least ${MIN_AGE} to use Matchr.` };
  }
  return { ok: true, iso: `${yyyy}-${mm}-${dd}` };
}
