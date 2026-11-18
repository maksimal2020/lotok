import { sniffFile } from '../infra/file-security';
import { OrganizationsService } from '../modules/organizations/organizations.service';
import { expandQuery } from '../modules/search/synonyms';
import { YooKassaProvider } from '../modules/payments/providers/yookassa.provider';
import { loadConfig } from '../config/config';
import { haversineKm, escapeLike } from './util';

describe('file signature sniffing', () => {
  const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(64)]);
  it('detects images by magic bytes', () => {
    expect(sniffFile(pad([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniffFile(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe('image/png');
    expect(sniffFile(Buffer.concat([Buffer.from('RIFF0000WEBP'), Buffer.alloc(32)]))?.mime).toBe('image/webp');
  });
  it('rejects executables and scripts regardless of extension', () => {
    expect(sniffFile(pad([0x4d, 0x5a]), 'cat.jpg')).toBeNull();
    expect(sniffFile(Buffer.from('#!/bin/sh\nrm -rf /\n'.padEnd(64)), 'run.txt')).not.toBeNull(); // текст допустим, но отдаётся как attachment
    expect(sniffFile(Buffer.from('<svg onload=alert(1)>'.padEnd(64)), 'x.svg')).toBeNull();
  });
  it('rejects macro-enabled office files', () => {
    const docm = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/vbaProject.bin'), Buffer.alloc(32)]);
    expect(sniffFile(docm, 'a.docx')).toBeNull();
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml'), Buffer.alloc(32)]);
    expect(sniffFile(docx, 'a.docx')?.ext).toBe('docx');
    expect(sniffFile(docx, 'a.docm')).toBeNull();
  });
});

describe('INN checksum', () => {
  it('validates legal entity and individual INN', () => {
    expect(OrganizationsService.validInn('7707083893')).toBe(true);
    expect(OrganizationsService.validInn('7707083894')).toBe(false);
    expect(OrganizationsService.validInn('500100732259')).toBe(true);
    expect(OrganizationsService.validInn('500100732250')).toBe(false);
  });
});

describe('search synonyms', () => {
  it('expands russian brand spellings', () => {
    expect(expandQuery('айфон 13')).toContain('iphone 13');
    expect(expandQuery('тойота камри').length).toBeGreaterThan(1);
    expect(expandQuery('диван')).toEqual(['диван']);
  });
});

describe('YooKassa webhook source check', () => {
  const provider = new YooKassaProvider(loadConfig({ YOOKASSA_SHOP_ID: '1', YOOKASSA_SECRET_KEY: 'test_x' }));
  const body = Buffer.from(JSON.stringify({ event: 'payment.succeeded', object: { id: 'p1', status: 'succeeded' } }));
  it('accepts notifications from YooKassa networks only', async () => {
    expect((await provider.parseWebhook(body, {}, '185.71.76.5')).signatureValid).toBe(true);
    expect((await provider.parseWebhook(body, {}, '::ffff:77.75.156.11')).signatureValid).toBe(true);
    expect((await provider.parseWebhook(body, {}, '8.8.8.8')).signatureValid).toBe(false);
    expect((await provider.parseWebhook(body, {}, null)).signatureValid).toBe(false);
  });
  it('builds stable dedup keys', async () => {
    const a = await provider.parseWebhook(body, {}, '185.71.76.5');
    const b = await provider.parseWebhook(body, {}, '185.71.76.5');
    expect(a.eventId).toBe(b.eventId);
    expect(provider.testMode).toBe(true);
  });
});

describe('utils', () => {
  it('computes distances', () => {
    expect(haversineKm(55.7558, 37.6173, 59.9343, 30.3351)).toBeCloseTo(633, -1);
  });
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off')).toBe('50\\%\\_off');
  });
});

describe('config', () => {
  it('refuses dev secrets and inline queue in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});
