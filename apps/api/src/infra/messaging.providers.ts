import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { CONFIG, type AppConfig } from '../config/config';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Отправка email. Драйверы: smtp (production/Mailpit), log, memory (тесты). */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private transporter: Transporter | null = null;
  /** Отправленные письма (только драйвер memory). */
  readonly outbox: OutgoingEmail[] = [];

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    if (config.MAIL_DRIVER === 'smtp') this.transporter = nodemailer.createTransport(config.SMTP_URL);
  }

  async send(mail: OutgoingEmail) {
    switch (this.config.MAIL_DRIVER) {
      case 'memory':
        this.outbox.push(mail);
        return;
      case 'log':
        this.logger.log(`[email:log] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
        return;
      case 'smtp':
        await this.transporter!.sendMail({ from: this.config.MAIL_FROM, ...mail });
    }
  }
}

/** SMS. Драйверы: smsru (боевой, требует SMSRU_API_ID), log, memory. */
@Injectable()
export class SmsService {
  private readonly logger = new Logger('Sms');
  readonly outbox: { to: string; text: string }[] = [];

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async send(to: string, text: string) {
    switch (this.config.SMS_DRIVER) {
      case 'memory':
        this.outbox.push({ to, text });
        return;
      case 'log':
        this.logger.log(`[sms:log] to=${to} text="${text}"`);
        return;
      case 'smsru': {
        if (!this.config.SMSRU_API_ID) throw new Error('SMSRU_API_ID не задан');
        const url = new URL('https://sms.ru/sms/send');
        url.searchParams.set('api_id', this.config.SMSRU_API_ID);
        url.searchParams.set('to', to.replace('+', ''));
        url.searchParams.set('msg', text);
        url.searchParams.set('json', '1');
        const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
        const body = (await res.json()) as { status?: string; status_text?: string };
        if (body.status !== 'OK') throw new Error(`SMS.ru error: ${body.status_text ?? res.status}`);
      }
    }
  }
}

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Push-уведомления через Expo Push Service (FCM/APNs под капотом). */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');
  readonly outbox: PushMessage[] = [];

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** Возвращает список токенов, признанных недействительными (их нужно удалить). */
  async send(msg: PushMessage): Promise<string[]> {
    if (!msg.tokens.length) return [];
    switch (this.config.PUSH_DRIVER) {
      case 'memory':
        this.outbox.push(msg);
        return [];
      case 'log':
        this.logger.log(`[push:log] tokens=${msg.tokens.length} title="${msg.title}"`);
        return [];
      case 'expo': {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (this.config.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${this.config.EXPO_ACCESS_TOKEN}`;
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers,
          body: JSON.stringify(msg.tokens.map((to) => ({ to, title: msg.title, body: msg.body, data: msg.data, sound: 'default' }))),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
        const invalid: string[] = [];
        body.data?.forEach((r, i) => {
          if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') invalid.push(msg.tokens[i]);
        });
        return invalid;
      }
    }
  }
}
