import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E } from '../env';

export const uid = () => Math.random().toString(36).slice(2, 8);

export async function lastMail(request: APIRequestContext, to: string) {
  let res;
  for (let i = 0; i < 20; i++) {
    res = await request.get(`${E2E.api}/api/v1/_test/mail?to=${encodeURIComponent(to)}`);
    if (res.ok()) return (await res.json()) as { subject: string; text: string };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no mail for ${to}`);
}

/** Регистрация через интерфейс и подтверждение email по ссылке из письма. */
export async function registerViaUi(page: Page, name: string) {
  const email = `e2e-${uid()}@test.local`;
  const password = 'Passw0rd!';
  await page.goto('/auth/register');
  await page.getByLabel('Имя').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /обработку персональных данных/ }).check();
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/\/profile/);
  const mail = await lastMail(page.request, email);
  const link = /(http\S+verify-email\?token=[\w-]+)/.exec(mail.text)![1];
  await page.goto(link.replace(/^http:\/\/[^/]+/, ''));
  await expect(page.getByRole('heading', { name: 'Email подтверждён' })).toBeVisible();
  return { email, password };
}

export async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

/** Фото для загрузки: настоящий JPEG 1200×900, созданный sharp (уже установлен в монорепозитории). */
export async function photo(color: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require('sharp');
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer();
}
