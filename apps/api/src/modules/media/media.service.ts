import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { MediaItem } from '@lotok/shared';
import { CONFIG, type AppConfig } from '../../config/config';
import { DB, type Db } from '../../database/database.module';
import { media } from '../../database/schema';
import { AntivirusService, sniffFile } from '../../infra/file-security';
import { JobsService } from '../../infra/jobs.service';
import { SecurityEventsService } from '../../infra/platform.services';
import { StorageService } from '../../infra/storage.service';
import { AppError, Errors } from '../../common/errors';
import { sha256 } from '../../common/util';
import { presentMedia } from './media.presenter';

export const MEDIA_PURPOSES = ['listing', 'avatar', 'chat', 'org_logo'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

const VARIANTS = [
  { name: 'thumb', width: 400, height: 300, fit: 'cover' as const, quality: 72 },
  { name: 'medium', width: 960, height: 720, fit: 'inside' as const, quality: 78 },
  { name: 'large', width: 1600, height: 1200, fit: 'inside' as const, quality: 82 },
];
/** Защита от «декомпрессионных бомб»: не более 50 Мп. */
const MAX_PIXELS = 50_000_000;

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger('Media');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly av: AntivirusService,
    private readonly jobs: JobsService,
    private readonly security: SecurityEventsService,
  ) {}

  onModuleInit() {
    this.jobs.register('media.process', (d: { mediaId: string }) => this.process(d.mediaId));
  }

  async upload(ownerId: string, purpose: MediaPurpose, file: { buffer: Buffer; originalname: string; size: number }): Promise<MediaItem> {
    if (!file?.buffer?.length) throw Errors.badRequest('file_required', 'Файл не передан');
    const sniff = sniffFile(file.buffer, file.originalname);
    if (!sniff) {
      await this.security.record('upload_rejected_type', { userId: ownerId, meta: { name: file.originalname.slice(0, 100), size: file.size } });
      throw new AppError(415, 'unsupported_file_type', 'Формат файла не поддерживается');
    }
    if (purpose !== 'chat' && sniff.kind !== 'image') throw Errors.badRequest('image_required', 'Можно загрузить только изображение');
    const maxMb = sniff.kind === 'image' ? this.config.UPLOAD_MAX_IMAGE_MB : this.config.UPLOAD_MAX_DOCUMENT_MB;
    if (file.size > maxMb * 1024 * 1024) throw new AppError(413, 'file_too_large', `Максимальный размер файла — ${maxMb} МБ`);

    const scan = await this.av.scan(file.buffer);
    if (!scan.clean) {
      await this.security.record('upload_malware', { userId: ownerId, meta: { signature: scan.signature } });
      throw Errors.unprocessable('malware_detected', 'Файл не прошёл антивирусную проверку');
    }

    const hash = sha256(file.buffer);
    const id = crypto.randomUUID();
    const originalKey = `originals/${ownerId}/${id}.${sniff.ext}`;
    await this.storage.put('private', originalKey, file.buffer, sniff.mime);
    const safeName = file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200) || `file.${sniff.ext}`;
    const [row] = await this.db
      .insert(media)
      .values({
        id,
        ownerId,
        kind: sniff.kind,
        purpose,
        status: 'pending',
        originalKey,
        mime: sniff.mime,
        size: file.size,
        sha256: hash,
        fileName: safeName,
      })
      .returning();
    await this.jobs.enqueue('media.process', { mediaId: id });
    return presentMedia(this.storage, row);
  }

  /** Фоновая обработка: перекодирование изображений (удаляет EXIF/GPS и полезную нагрузку полиглотов), генерация размеров. */
  async process(mediaId: string) {
    const [row] = await this.db.select().from(media).where(eq(media.id, mediaId));
    if (!row || row.status === 'ready') return;
    await this.db.update(media).set({ status: 'processing' }).where(eq(media.id, mediaId));
    try {
      const buf = await this.storage.get('private', row.originalKey);
      const visibility = row.purpose === 'chat' ? 'private' : 'public';
      if (row.kind === 'document') {
        const key = `docs/${row.ownerId}/${row.id}`;
        await this.storage.put('private', key, buf, row.mime, 'attachment');
        await this.db.update(media).set({ status: 'ready', variants: { original: key } }).where(eq(media.id, mediaId));
        return;
      }
      const img = sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false }).rotate();
      const meta = await img.metadata();
      const variants: Record<string, string> = {};
      const prefix = `${row.purpose}/${row.id.slice(0, 2)}/${row.id}`;
      for (const v of VARIANTS) {
        const out = await img
          .clone()
          .resize({ width: v.width, height: v.height, fit: v.fit, withoutEnlargement: v.fit === 'inside', position: 'attention' })
          .webp({ quality: v.quality })
          .toBuffer();
        const key = `${prefix}/${v.name}.webp`;
        await this.storage.put(visibility, key, out, 'image/webp');
        variants[v.name] = key;
      }
      if (row.purpose === 'chat') {
        const full = await img.clone().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        variants.original = `${prefix}/original.jpg`;
        await this.storage.put('private', variants.original, full, 'image/jpeg');
      }
      const oriented = (meta.orientation ?? 1) >= 5;
      await this.db
        .update(media)
        .set({
          status: 'ready',
          variants,
          width: (oriented ? meta.height : meta.width) ?? null,
          height: (oriented ? meta.width : meta.height) ?? null,
          error: null,
        })
        .where(eq(media.id, mediaId));
      await this.storage.delete('private', row.originalKey).catch(() => undefined);
    } catch (e) {
      this.logger.warn({ err: e, mediaId }, 'Media processing failed');
      await this.db
        .update(media)
        .set({ status: 'failed', error: (e as Error).message.slice(0, 500) })
        .where(eq(media.id, mediaId));
    }
  }

  async get(ownerId: string, id: string): Promise<MediaItem> {
    const [row] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.ownerId, ownerId)));
    if (!row) throw Errors.notFound('Файл');
    return presentMedia(this.storage, row);
  }

  async remove(ownerId: string, id: string) {
    const [row] = await this.db
      .delete(media)
      .where(and(eq(media.id, id), eq(media.ownerId, ownerId)))
      .returning();
    if (!row) throw Errors.notFound('Файл');
    const visibility = row.purpose === 'chat' || row.kind === 'document' ? 'private' : 'public';
    for (const key of Object.values(row.variants)) await this.storage.delete(visibility, key).catch(() => undefined);
    await this.storage.delete('private', row.originalKey).catch(() => undefined);
  }

  async readPrivate(key: string, exp: number, sig: string) {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) throw Errors.forbidden('Ссылка устарела', 'link_expired');
    if (!this.storage.verifySignature(`${key}:${exp}`, sig)) throw Errors.forbidden('Неверная подпись', 'bad_signature');
    return this.storage.get('private', key);
  }
}
