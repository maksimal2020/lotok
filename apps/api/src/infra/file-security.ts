import { Inject, Injectable, Logger } from '@nestjs/common';
import net from 'node:net';
import { CONFIG, type AppConfig } from '../config/config';

export interface SniffResult {
  mime: string;
  ext: string;
  kind: 'image' | 'document';
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

/**
 * Определение типа файла по сигнатуре (magic bytes), а не по имени/Content-Type от клиента.
 * Белый список: изображения JPEG/PNG/WebP/AVIF/GIF, документы PDF/DOCX/XLSX/TXT.
 */
export function sniffFile(buf: Buffer, fileName = ''): SniffResult | null {
  if (buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return { mime: 'image/gif', ext: 'gif', kind: 'image' };
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', ext: 'avif', kind: 'image' };
    return null;
  }
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: 'pdf', kind: 'document' };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const lower = fileName.toLowerCase();
    const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('latin1');
    // OOXML без макросов: [Content_Types].xml в архиве, расширение docx/xlsx; .docm/.xlsm отклоняются.
    if (!head.includes('[Content_Types].xml') && !buf.includes(Buffer.from('[Content_Types].xml'))) return null;
    if (buf.includes(Buffer.from('vbaProject.bin'))) return null;
    if (lower.endsWith('.docx')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', kind: 'document' };
    if (lower.endsWith('.xlsx')) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', kind: 'document' };
    return null;
  }
  if (fileName.toLowerCase().endsWith('.txt') && isProbablyText(buf)) return { mime: 'text/plain', ext: 'txt', kind: 'document' };
  return null;
}

function isProbablyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  for (const b of sample) if (b === 0) return false;
  return true;
}

/**
 * Антивирусная проверка. Драйвер clamav — протокол clamd INSTREAM по TCP.
 * Драйвер none допустим только при отсутствии пользовательских документов в production (см. DEPLOYMENT.md).
 */
@Injectable()
export class AntivirusService {
  private readonly logger = new Logger('Antivirus');
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async scan(buf: Buffer): Promise<{ clean: boolean; signature?: string }> {
    if (this.config.AV_DRIVER === 'none') return { clean: true };
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.config.CLAMAV_HOST, port: this.config.CLAMAV_PORT });
      let response = '';
      socket.setTimeout(30_000);
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const chunkSize = 64 * 1024;
        for (let i = 0; i < buf.length; i += chunkSize) {
          const chunk = buf.subarray(i, i + chunkSize);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length, 0);
          socket.write(len);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (d) => (response += d.toString()));
      socket.on('end', () => {
        const r = response.replace(/\0/g, '').trim();
        if (r.endsWith('OK')) resolve({ clean: true });
        else if (r.includes('FOUND')) resolve({ clean: false, signature: r.replace('stream: ', '').replace(' FOUND', '') });
        else reject(new Error(`clamd: ${r}`));
      });
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('clamd timeout'));
      });
      socket.on('error', (e) => {
        this.logger.error(e);
        reject(e);
      });
    });
  }
}
