import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { ChatMessageKind } from '@/api/types';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** 0:07, 1:05, 1:02:09 */
export function formatDuration(ms?: number | null) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 840 B, 12 KB, 3.4 MB */
export function formatBytes(bytes?: number | null) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// toLocaleTimeString with options builds a new Intl formatter on every call,
// which adds up across a thread of bubbles. Built once, lazily.
let clockFormat: Intl.DateTimeFormat | null | undefined;
function getClockFormat() {
  if (clockFormat === undefined) {
    try {
      clockFormat = typeof Intl !== 'undefined' && Intl.DateTimeFormat
        ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
        : null;
    } catch {
      clockFormat = null;
    }
  }
  return clockFormat;
}

export const formatClock = (iso: string) => {
  const date = new Date(iso);
  const fmt = getClockFormat();
  return fmt ? fmt.format(date) : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "last seen today at 9:41", "last seen yesterday at 18:02", "last seen 12 Sep" */
export function formatLastSeen(iso?: string | null) {
  if (!iso) return null;
  const at = new Date(iso);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, now)) return `last seen today at ${formatClock(iso)}`;
  if (sameDay(at, yesterday)) return `last seen yesterday at ${formatClock(iso)}`;
  const days = (now.getTime() - at.getTime()) / 86_400_000;
  if (days < 7) return `last seen ${at.toLocaleDateString('en-IN', { weekday: 'long' })} at ${formatClock(iso)}`;
  return `last seen ${at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'application/zip': 'ZIP',
  'application/x-zip-compressed': 'ZIP',
};

/** "PDF", "DOCX" — from the name when it has an extension, else the type. */
export function fileTypeLabel(name?: string | null, mime?: string | null) {
  const ext = /\.([A-Za-z0-9]{1,6})$/.exec(name || '')?.[1];
  if (ext) return ext.toUpperCase();
  return (mime && EXTENSION_BY_MIME[mime]) || 'FILE';
}

/** An icon and a tint for a document bubble. */
export function fileVisual(name?: string | null, mime?: string | null): { icon: IconName; color: string } {
  const type = fileTypeLabel(name, mime);
  if (type === 'PDF') return { icon: 'document-text', color: '#F4574B' };
  if (['DOC', 'DOCX', 'PAGES', 'ODT', 'RTF', 'TXT'].includes(type)) return { icon: 'document-text', color: '#4C8DF6' };
  if (['XLS', 'XLSX', 'CSV', 'NUMBERS', 'ODS'].includes(type)) return { icon: 'grid', color: '#2FB36B' };
  if (['PPT', 'PPTX', 'KEY', 'ODP'].includes(type)) return { icon: 'easel', color: '#F08C2E' };
  if (type === 'ZIP') return { icon: 'archive', color: '#9A9A9A' };
  if (mime?.startsWith('image/')) return { icon: 'image', color: '#B37FEB' };
  if (mime?.startsWith('video/')) return { icon: 'videocam', color: '#B37FEB' };
  if (mime?.startsWith('audio/')) return { icon: 'musical-notes', color: '#B37FEB' };
  return { icon: 'document', color: '#9A9A9A' };
}

/** "📷 Photo", "🎤 Voice message (0:12)", "📄 brief.pdf": a one-line description of a message. */
export function describeMessage(
  kind: ChatMessageKind | undefined | null,
  text: string,
  extra: { name?: string | null; label?: string | null; duration_ms?: number | null } = {},
) {
  switch (kind) {
    case 'image':
      return `📷 ${text || 'Photo'}`;
    case 'video':
      return `🎥 ${text || 'Video'}`;
    case 'audio':
      return `🎤 Voice message${extra.duration_ms ? ` (${formatDuration(extra.duration_ms)})` : ''}`;
    case 'document':
      return `📄 ${extra.name || extra.label || 'Document'}`;
    default:
      return text;
  }
}

/** A MIME type for a picked file when the picker did not provide one. */
export function guessMime(name?: string | null) {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name || '')?.[1]?.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    rtf: 'application/rtf',
    zip: 'application/zip',
    pages: 'application/vnd.apple.pages',
    numbers: 'application/vnd.apple.numbers',
    key: 'application/vnd.apple.keynote',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
  };
  return (ext && map[ext]) || 'application/octet-stream';
}
