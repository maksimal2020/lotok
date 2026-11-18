import type { MediaItem, MediaUrls } from '@lotok/shared';
import type { StorageService } from '../../infra/storage.service';
import type { media } from '../../database/schema';

type MediaRow = typeof media.$inferSelect;

export function mediaUrls(storage: StorageService, row: Pick<MediaRow, 'variants' | 'status'> | null | undefined): MediaUrls | null {
  if (!row || row.status !== 'ready') return null;
  const v = row.variants ?? {};
  const u = (k: string) => (v[k] ? storage.publicUrl(v[k]) : null);
  return { thumb: u('thumb'), medium: u('medium'), large: u('large') };
}

export async function presentMedia(storage: StorageService, row: MediaRow): Promise<MediaItem> {
  const isPrivate = row.kind === 'document' || row.purpose === 'chat';
  let url: string | null = null;
  if (row.status === 'ready') {
    if (isPrivate) url = await storage.privateUrl(row.variants.original ?? row.originalKey, row.fileName);
    else url = row.variants.large ? storage.publicUrl(row.variants.large) : null;
  }
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    fileName: row.fileName,
    urls: isPrivate && row.kind === 'image' && row.status === 'ready'
      ? {
          thumb: await storage.privateUrl(row.variants.thumb, row.fileName),
          medium: await storage.privateUrl(row.variants.medium, row.fileName),
          large: await storage.privateUrl(row.variants.large, row.fileName),
        }
      : (mediaUrls(storage, row) ?? { thumb: null, medium: null, large: null }),
    url,
  };
}
