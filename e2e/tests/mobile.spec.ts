import { expect, test } from '@playwright/test';
import { registerViaUi } from '../fixtures/helpers';

/** Ключевые сценарии на мобильном экране (Pixel 7): навигация, поиск, фильтры, кабинет. */
test.describe('Мобильная версия', () => {
  test('нижняя навигация и каталог', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Мобильная навигация' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Разместить' })).toBeVisible();
    await page.getByRole('link', { name: 'Все категории →' }).click();
    await expect(page.getByRole('heading', { name: 'Все категории' })).toBeVisible();
    // Нет горизонтальной прокрутки страницы.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('поиск и фильтры в модальном окне', async ({ page }) => {
    await page.goto('/c/transport');
    await page.getByRole('button', { name: 'Фильтры' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Цена, ₽')).toBeVisible();
    await dialog.getByRole('button', { name: 'Показать результаты' }).click();
    await expect(page.getByRole('heading', { name: 'Транспорт' })).toBeVisible();
  });

  test('регистрация и кабинет на телефоне', async ({ page }) => {
    await registerViaUi(page, 'Мобильный Пользователь');
    await page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('link', { name: 'Профиль' }).click();
    await expect(page.getByRole('link', { name: 'Мои объявления' })).toBeVisible();
    await page.goto('/listings/new');
    await expect(page.getByRole('heading', { name: 'Новое объявление' })).toBeVisible();
  });
});
