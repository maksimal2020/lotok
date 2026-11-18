import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CONFIG, type AppConfig } from '../config/config';

export type Visibility = 'public' | 'private';

/**
 * Объектное хранилище. Драйвер s3 — любой S3-совместимый сервис (MinIO, Yandex Object Storage, VK Cloud).
 * Драйвер local — файловая система, для локальной разработки и тестов.
 * Публичные файлы (фото объявлений) отдаются напрямую, приватные (вложения чатов) — по подписанным ссылкам.
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client | null;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.s3 =
      config.STORAGE_DRIVER === 's3'
        ? new S3Client({
            endpoint: config.S3_ENDPOINT,
            region: config.S3_REGION,
            forcePathStyle: config.S3_FORCE_PATH_STYLE,
            credentials: config.S3_ACCESS_KEY ? { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY ?? '' } : undefined,
          })
        : null;
  }

  private bucket(v: Visibility) {
    return v === 'public' ? this.config.S3_BUCKET : this.config.S3_PRIVATE_BUCKET;
  }

  private localPath(v: Visibility, key: string) {
    const safe = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.resolve(this.config.STORAGE_LOCAL_DIR, v, safe);
  }

  async put(v: Visibility, key: string, body: Buffer, contentType: string, contentDisposition?: string) {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket(v),
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentDisposition: contentDisposition,
          CacheControl: v === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
        }),
      );
      return;
    }
    const p = this.localPath(v, key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(v: Visibility, key: string): Promise<Buffer> {
    if (this.s3) {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket(v), Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    return readFile(this.localPath(v, key));
  }

  async delete(v: Visibility, key: string) {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket(v), Key: key }));
      return;
    }
    await rm(this.localPath(v, key), { force: true });
  }

  publicUrl(key: string): string {
    if (this.s3) {
      const base = this.config.S3_PUBLIC_URL ?? `${this.config.S3_ENDPOINT}/${this.config.S3_BUCKET}`;
      return `${base.replace(/\/$/, '')}/${key}`;
    }
    return `${this.config.API_PUBLIC_URL}/files/${key}`;
  }

  /** Временная ссылка на приватный файл. */
  async privateUrl(key: string, fileName: string | null, ttlSec = 600): Promise<string> {
    if (this.s3) {
      return getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: this.config.S3_PRIVATE_BUCKET,
          Key: key,
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName ?? 'file')}`,
        }),
        { expiresIn: ttlSec },
      );
    }
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = this.sign(`${key}:${exp}`);
    return `${this.config.API_PUBLIC_URL}/api/v1/media/private?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  }

  sign(value: string) {
    return createHmac('sha256', this.config.APP_SIGNING_SECRET).update(value).digest('base64url');
  }

  verifySignature(value: string, sig: string): boolean {
    const expected = Buffer.from(this.sign(value));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  localRoot() {
    return path.resolve(this.config.STORAGE_LOCAL_DIR, 'public');
  }

  async ping(): Promise<boolean> {
    if (this.s3) {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
      return true;
    }
    await mkdir(this.config.STORAGE_LOCAL_DIR, { recursive: true });
    await access(this.config.STORAGE_LOCAL_DIR);
    return true;
  }
}
