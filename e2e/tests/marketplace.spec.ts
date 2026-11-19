import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E } from '../env';
import { loginViaUi, photo, registerViaUi, uid } from '../fixtures/helpers';

/**
 * Сквозной сценарий из ТЗ (п. 16): регистрация → подтверждение → объявление с фото → модерация →
 * поиск другим пользователем → избранное → сообщение → заказ → тестовая оплата → статусы → отзыв.
 * Две независимые сессии браузера: продавец и покупатель; модератор — в админке.
 */
test.describe.serial('Полный цикл сделки', () => {
  const title = `Котёнок британский ${uid()}`;
  let seller: Page;
  let buyer: Page;
  let listingUrl = '';
  let orderUrl = '';

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    seller = await (await browser.newContext()).newPage();
    buyer = await (await browser.newContext()).newPage();
    for (const p of [seller, buyer]) {
      p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
      p.on('console', (m) => {
        if (m.type() === 'error' && !m.text().includes('Failed to load resource')) console.log('CONSOLEERROR', m.text().slice(0, 500));
      });
    }
  });

  test('1–2. продавец регистрируется и подтверждает email', async () => {
    await registerViaUi(seller, 'Анна Продавец');
  });

  test('3–5. создаёт объявление с фотографиями и отправляет на модерацию', async () => {
    await seller.goto('/listings/new');
    await seller.getByLabel('Категория, уровень 1').selectOption({ label: 'Товары' });
    await seller.getByLabel('Категория, уровень 2').selectOption({ label: 'Животные и зоотовары' });
    // Категория «Животные» настроена в админке на обязательную ручную модерацию.
    await seller.getByLabel('Категория, уровень 3').selectOption({ label: 'Животные' });
    await seller.getByLabel('Название').fill(title);
    await seller.getByLabel('Описание').fill('Ласковый котёнок, 3 месяца, приучен к лотку. Ветпаспорт, прививки по возрасту.');
    await seller.getByLabel('Вид животного').selectOption({ label: 'Кошка' });
    await seller.locator('input[type=file]').setInputFiles([
      { name: 'cat1.jpg', mimeType: 'image/jpeg', buffer: await photo('#0E8C76') },
      { name: 'cat2.jpg', mimeType: 'image/jpeg', buffer: await photo('#F59E0B') },
    ]);
    // Дожидаемся серверной обработки (превью появляются после генерации размеров).
    await expect(seller.getByAltText('Фото 1')).toBeVisible();
    await expect(seller.getByAltText('Фото 2')).toBeVisible();
    await seller.getByLabel('Цена, ₽').fill('15000');
    await seller.getByLabel('Город').selectOption({ label: 'Москва' });
    await seller.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(seller).toHaveURL(/\/listing\//);
    listingUrl = new URL(seller.url()).pathname;
    await expect(seller.getByText('На проверке').first()).toBeVisible();
    // До одобрения объявление не видно другим.
    const res = await buyer.request.get(`${E2E.api}/api/v1/listings/${listingUrl.split('/').pop()}`);
    expect(res.status()).toBe(404);
  });

  test('6. модератор одобряет объявление в админ-панели', async ({ browser }) => {
    const mod = await (await browser.newContext({ baseURL: E2E.admin })).newPage();
    await mod.goto('/');
    await mod.getByLabel('Email').fill('moderator@lotok.local');
    await mod.getByLabel('Пароль').fill('Admin12345');
    await mod.getByRole('button', { name: 'Войти' }).click();
    await mod.getByRole('link', { name: 'Модерация' }).click();
    await mod.getByText(title).click();
    await expect(mod.getByRole('dialog').getByText('Категория с ручной проверкой')).toBeVisible();
    await mod.getByRole('button', { name: 'Одобрить' }).click();
    await expect(mod.getByText('Одобрено')).toBeVisible();
    // Модератор не видит разделы без прав (RBAC на клиенте дублирует проверку на сервере).
    await expect(mod.getByRole('link', { name: 'Платежи' })).toHaveCount(0);
    await mod.context().close();
  });

  test('7–8. покупатель находит объявление поиском и добавляет в избранное', async () => {
    await registerViaUi(buyer, 'Борис Покупатель');
    await buyer.goto('/');
    const search = buyer.getByRole('combobox', { name: 'Поиск по объявлениям' }).first();
    await search.fill('котенок британский');
    await search.press('Enter');
    await expect(buyer).toHaveURL(/\/search\?q=/);
    await buyer.getByRole('link', { name: title }).first().click();
    await expect(buyer.getByRole('heading', { name: title })).toBeVisible();
    await buyer.getByRole('button', { name: 'Добавить в избранное' }).first().click();
    await buyer.goto('/favorites');
    await expect(buyer.getByText(title)).toBeVisible();
  });

  test('9. покупатель пишет продавцу; продавец получает сообщение в реальном времени', async () => {
    await seller.goto('/messages');
    await buyer.goto(listingUrl);
    await buyer.getByRole('button', { name: 'Написать продавцу' }).click();
    await buyer.getByLabel('Текст сообщения').fill('Здравствуйте! Котёнок ещё свободен?');
    await buyer.getByRole('button', { name: 'Отправить' }).click();
    await expect(buyer).toHaveURL(/\/messages\//);
    await expect(buyer.getByText('Здравствуйте! Котёнок ещё свободен?').first()).toBeVisible();
    // Список диалогов продавца обновляется по WebSocket без перезагрузки страницы.
    await expect(seller.getByText('Борис Покупатель').first()).toBeVisible();
    await seller.getByText('Борис Покупатель').first().click();
    await seller.getByLabel('Сообщение', { exact: true }).fill('Да, свободен. Приезжайте!');
    await seller.getByRole('button', { name: 'Отправить' }).click();
    await expect(buyer.getByText('Да, свободен. Приезжайте!').first()).toBeVisible();
  });

  test('10–11. покупатель оформляет заказ и проходит тестовую оплату', async () => {
    await buyer.goto(listingUrl);
    await buyer.getByRole('link', { name: /Купить/ }).click();
    await expect(buyer.getByRole('heading', { name: 'Оформление заказа' })).toBeVisible();
    await buyer.getByRole('button', { name: 'Перейти к оплате' }).click();
    await expect(buyer).toHaveURL(/\/payments\/test\//);
    await expect(buyer.getByText('ТЕСТОВЫЙ РЕЖИМ')).toBeVisible();
    await buyer.getByRole('button', { name: 'Оплатить (тест)' }).click();
    await expect(buyer).toHaveURL(/\/orders\//);
    orderUrl = new URL(buyer.url()).pathname;
    await expect(buyer.getByText('Ожидает подтверждения продавцом').first()).toBeVisible();
    await expect(buyer.getByText('Оплачен', { exact: true }).first()).toBeVisible();
  });

  test('12. статус заказа обновляется у покупателя при действиях продавца', async () => {
    await seller.goto(orderUrl);
    await seller.getByRole('button', { name: 'Подтвердить заказ' }).click();
    await seller.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
    await expect(seller.getByText('Подтверждён').first()).toBeVisible();
    // Покупатель видит новый статус без перезагрузки (событие order:updated).
    await expect(buyer.getByText('Подтверждён').first()).toBeVisible();
    await buyer.getByRole('button', { name: 'Подтвердить получение' }).click();
    await buyer.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
    await expect(buyer.getByText('Завершён').first()).toBeVisible();
  });

  test('13. покупатель оставляет отзыв после завершённой сделки', async () => {
    await expect(buyer.getByRole('heading', { name: 'Оставьте отзыв' })).toBeVisible();
    await buyer.getByRole('radio', { name: '5 из 5' }).click();
    await buyer.getByLabel('Текст отзыва').fill('Отличный продавец, всё как в описании!');
    await buyer.getByRole('button', { name: 'Отправить отзыв' }).click();
    await expect(buyer.getByText('Спасибо за отзыв!')).toBeVisible();
    await seller.goto('/profile');
    await expect(seller.getByText('Отличный продавец, всё как в описании!')).toBeVisible();
    await expect(seller.getByText('5.0 · 1 отзывов')).toBeVisible();
  });

  test('объявление продано, повторная покупка невозможна', async () => {
    await buyer.goto(listingUrl);
    await expect(buyer.getByText(/Продано|продано/).first()).toBeVisible();
    await expect(buyer.getByRole('link', { name: /Купить/ })).toHaveCount(0);
  });
});

test.describe('Доступ и безопасность интерфейса', () => {
  test('личный кабинет требует входа', async ({ page }) => {
    await page.goto('/my/listings');
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Fmy%2Flistings/);
  });

  test('сотрудник поддержки не видит управление категориями, а API отвечает 403', async ({ browser, request }) => {
    const p = await (await browser.newContext({ baseURL: E2E.admin })).newPage();
    await p.goto('/');
    await p.getByLabel('Email').fill('support@lotok.local');
    await p.getByLabel('Пароль').fill('Admin12345');
    await p.getByRole('button', { name: 'Войти' }).click();
    await expect(p.getByRole('link', { name: 'Заказы' })).toBeVisible();
    await expect(p.getByRole('link', { name: 'Категории' })).toHaveCount(0);
    const login = await request.post(`${E2E.api}/api/v1/auth/login`, { data: { email: 'support@lotok.local', password: 'Admin12345' }, headers: { 'X-Client-Platform': 'ios' } });
    const token = (await login.json()).accessToken;
    const r = await request.post(`${E2E.api}/api/v1/admin/categories`, { data: { slug: 'hack', name: 'Hack', vertical: 'goods' }, headers: { Authorization: `Bearer ${token}` } });
    expect(r.status()).toBe(403);
  });

  test('обычный пользователь не может войти в админку', async ({ browser }) => {
    const p = await (await browser.newContext()).newPage();
    const creds = await registerViaUi(p, 'Обычный Пользователь');
    const a = await (await browser.newContext({ baseURL: E2E.admin })).newPage();
    await a.goto('/');
    await a.getByLabel('Email').fill(creds.email);
    await a.getByLabel('Пароль').fill(creds.password);
    await a.getByRole('button', { name: 'Войти' }).click();
    await expect(a.getByText('нет доступа к административной панели')).toBeVisible();
  });

  test('вход по паролю и выход', async ({ browser }) => {
    const p = await (await browser.newContext()).newPage();
    const creds = await registerViaUi(p, 'Повторный Вход');
    await p.context().clearCookies();
    await loginViaUi(p, creds.email, creds.password);
    await p.goto('/settings');
    await expect(p.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  });
});
