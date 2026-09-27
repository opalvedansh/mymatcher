import { ApiError } from '@/api/client';
import { requestChatUpload } from '@/api';
import type { ChatAttachmentKind } from '@/api/types';

/** A file picked or recorded on this device, not yet uploaded. */
export interface LocalFile {
  kind: ChatAttachmentKind;
  uri: string;
  mime: string;
  name?: string;
  size?: number | null;
  width?: number;
  height?: number;
  duration_ms?: number;
  waveform?: number[];
  /** Web: the picked File, which is its own Blob. */
  webFile?: Blob;
}

export class UploadError extends Error {}

async function readBlob(file: LocalFile): Promise<Blob> {
  if (file.webFile) return file.webFile;
  // React Native's fetch reads file:// URIs into a native-backed Blob, so a
  // large video is never copied into JS memory; on web this reads blob: URLs.
  const res = await fetch(file.uri);
  return res.blob();
}

function put(url: string, body: Blob, mime: string, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    // XHR rather than fetch: it is the only one that reports upload progress
    // on both React Native and the web.
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadError(`Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new UploadError('Upload failed. Check your connection.'));
    xhr.onabort = () => reject(new UploadError('Upload cancelled'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}

/**
 * Uploads a chat attachment straight to storage and returns the storage path
 * (and the normalised type) to send with the message. The API only hands out
 * the signed URL; the bytes never pass through it.
 */
export async function uploadChatFile(
  matchId: string,
  file: LocalFile,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ path: string; mime: string }> {
  const blob = await readBlob(file);
  // "audio/mp4;codecs=..." from a browser recorder: the server wants the bare type.
  const mime = (file.mime || blob.type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const size = blob.size || file.size || 0;

  let target;
  try {
    target = await requestChatUpload(matchId, { kind: file.kind, mime, size, name: file.name });
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) throw new UploadError(err.message);
    throw new UploadError('Could not start the upload. Try again.');
  }
  onProgress?.(0);
  await put(target.upload_url, blob, mime, onProgress, signal);
  onProgress?.(1);
  return { path: target.path, mime };
}
