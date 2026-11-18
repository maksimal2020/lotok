import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import argon2 from 'argon2';
import { eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { WorkerModule } from '../../app.module';
import { loadConfig } from '../../config/config';
import { DB, type Db } from '../database.module';
import { attributeOptions, attributes, categories, categoryAttributes, listings, paidServices, purchases, regions, stopWords, userRoles, userSubscriptions, users } from '../schema';
import { addDays } from '../../common/util';
import { CategoriesService } from '../../modules/catalog/categories.service';
import { RegionsService } from '../../modules/catalog/regions.service';
import { ListingsService } from '../../modules/listings/listings.service';
import { MediaService } from '../../modules/media/media.service';
import { SearchService } from '../../modules/search/search.service';
import { ATTRIBUTES, CATEGORIES, PAID_SERVICES, REGIONS, STOP_WORDS, type SeedCategory } from './catalog-data';

/**
 * Начальное наполнение (идемпотентно): справочники, категории, тарифы, служебные учётные записи.
 * Демо-объявления создаются только при SEED_DEMO=1 и только вне production.
 */
export async function seedReference(db: Db) {
  // Регионы
  const regionIds = new Map<string, number>();
  for (const r of REGIONS) {
    const parentId = r.parent ? regionIds.get(r.parent)! : null;
    const [row] = await db
      .insert(regions)
      .values({ slug: r.slug, name: r.name, type: r.type, parentId, lat: r.lat ?? null, lng: r.lng ?? null, sort: r.sort ?? 10, timezone: r.timezone ?? null })
      .onConflictDoUpdate({ target: [regions.countryCode, regions.slug], set: { name: r.name, parentId, lat: r.lat ?? null, lng: r.lng ?? null } })
      .returning({ id: regions.id });
    regionIds.set(r.slug, row.id);
  }

  // Характеристики
  const attrIds = new Map<string, number>();
  for (const a of ATTRIBUTES) {
    const [row] = await db
      .insert(attributes)
      .values({ key: a.key, name: a.name, type: a.type, unit: a.unit ?? null, minValue: a.min ?? null, maxValue: a.max ?? null })
      .onConflictDoUpdate({ target: attributes.key, set: { name: a.name, type: a.type, unit: a.unit ?? null, minValue: a.min ?? null, maxValue: a.max ?? null } })
      .returning({ id: attributes.id });
    attrIds.set(a.key, row.id);
    for (const [i, [value, label, parent]] of (a.options ?? []).entries()) {
      await db
        .insert(attributeOptions)
        .values({ attributeId: row.id, value, label, parentValue: parent ?? null, sort: i })
        .onConflictDoUpdate({ target: [attributeOptions.attributeId, attributeOptions.value], set: { label, parentValue: parent ?? null, sort: i } });
    }
  }
  for (const a of ATTRIBUTES.filter((x) => x.dependsOn)) {
    await db.update(attributes).set({ dependsOnAttributeId: attrIds.get(a.dependsOn!)! }).where(eq(attributes.key, a.key));
  }

  // Категории
  const insertCat = async (c: SeedCategory, parentId: number | null, sort: number, inherited: Partial<SeedCategory>) => {
    const eff = { allowDelivery: c.allowDelivery ?? inherited.allowDelivery ?? true, allowVideo: c.allowVideo ?? inherited.allowVideo ?? false, maxPhotos: c.maxPhotos ?? inherited.maxPhotos ?? 20 };
    const values = {
      slug: c.slug,
      name: c.name,
      vertical: c.vertical,
      icon: c.icon ?? null,
      parentId,
      sort,
      freeListingLimit: c.freeLimit ?? null,
      requiresManualModeration: c.manual ?? false,
      ...eff,
    };
    const [row] = await db
      .insert(categories)
      .values(values)
      .onConflictDoUpdate({ target: categories.slug, set: { ...values, updatedAt: new Date() } })
      .returning({ id: categories.id });
    for (const [i, spec] of (c.attrs ?? []).entries()) {
      const [key, ...flags] = spec.split(':');
      const attributeId = attrIds.get(key);
      if (!attributeId) throw new Error(`Unknown attribute ${key}`);
      await db
        .insert(categoryAttributes)
        .values({ categoryId: row.id, attributeId, isRequired: flags.includes('required'), isFilterable: !flags.includes('nofilter'), showInCard: true, sort: i })
        .onConflictDoUpdate({
          target: [categoryAttributes.categoryId, categoryAttributes.attributeId],
          set: { isRequired: flags.includes('required'), isFilterable: !flags.includes('nofilter'), sort: i },
        });
    }
    for (const [i, child] of (c.children ?? []).entries()) await insertCat(child, row.id, i, eff);
  };
  for (const [i, c] of CATEGORIES.entries()) await insertCat(c, null, i, {});

  // Тарифы
  for (const s of PAID_SERVICES) {
    const values = { ...s, durationDays: s.durationDays ?? null, quantity: 'quantity' in s ? s.quantity : null };
    await db.insert(paidServices).values(values).onConflictDoNothing({ target: paidServices.code });
  }
  for (const [word, action] of STOP_WORDS) await db.insert(stopWords).values({ word, action }).onConflictDoNothing();
  return { regionIds };
}

async function upsertUser(db: Db, email: string, password: string, displayName: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing.id;
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      displayName,
      emailVerifiedAt: now,
      termsAcceptedAt: now,
      personalDataConsentAt: now,
      ...extra,
    })
    .returning({ id: users.id });
  return u.id;
}

export async function seedStaff(db: Db) {
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin12345';
  const staff: [string, string, ('super_admin' | 'admin' | 'moderator' | 'support' | 'finance')[]][] = [
    ['admin@lotok.local', 'Суперадминистратор', ['super_admin']],
    ['moderator@lotok.local', 'Модератор', ['moderator']],
    ['support@lotok.local', 'Поддержка', ['support']],
    ['finance@lotok.local', 'Финансы', ['finance']],
  ];
  for (const [email, name, roles] of staff) {
    const id = await upsertUser(db, email, password, name);
    for (const role of roles) await db.insert(userRoles).values({ userId: id, role }).onConflictDoNothing();
  }
  return password;
}

const PALETTE = ['#0E8C76', '#F59E0B', '#2F6FDB', '#D93636', '#7C3AED', '#0EA5E9', '#16A34A', '#DB2777'];

async function placeholder(title: string, i: number): Promise<Buffer> {
  const bg = PALETTE[i % PALETTE.length];
  const safe = title.replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#121619"/></linearGradient></defs>
    <rect width="1200" height="900" fill="url(#g)"/>
    <circle cx="${200 + (i * 97) % 800}" cy="${150 + (i * 53) % 600}" r="220" fill="#ffffff" fill-opacity="0.08"/>
    <text x="80" y="780" font-family="sans-serif" font-size="64" font-weight="700" fill="#fff">${safe.slice(0, 28)}</text>
    <text x="80" y="840" font-family="sans-serif" font-size="32" fill="#fff" fill-opacity="0.7">демо-фото · Лоток</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

interface DemoListing {
  cat: string;
  title: string;
  price: number | null;
  priceType?: 'fixed' | 'negotiable' | 'free' | 'on_request';
  city: string;
  attrs: Record<string, string | number | boolean>;
  description: string;
  condition?: 'new' | 'used';
  delivery?: boolean;
}

const DEMO: DemoListing[] = [
  { cat: 'smartphones', title: 'iPhone 13 128 ГБ, отличное состояние', price: 42000_00, city: 'moskva', attrs: { phone_brand: 'apple', storage_gb: '128', color: 'blue' }, description: 'Аккумулятор 89%, без сколов, полный комплект с коробкой.', condition: 'used', delivery: true },
  { cat: 'smartphones', title: 'Samsung Galaxy S23 256 ГБ', price: 55000_00, city: 'sankt-peterburg', attrs: { phone_brand: 'samsung', storage_gb: '256', color: 'black' }, description: 'Покупал в официальном магазине, гарантия до весны.', condition: 'used', delivery: true },
  { cat: 'smartphones', title: 'Xiaomi Redmi Note 12 новый', price: 15990_00, city: 'kazan', attrs: { phone_brand: 'xiaomi', storage_gb: '128', color: 'gray' }, description: 'Новый, в плёнке. Подарили — не пригодился.', condition: 'new', delivery: true },
  { cat: 'laptops', title: 'MacBook Air M1 8/256', price: 58000_00, city: 'moskva', attrs: { laptop_brand: 'apple', ram_gb: '8', screen_inch: 13.3 }, description: 'Циклов зарядки 210. Работает идеально.', condition: 'used', delivery: true },
  { cat: 'laptops', title: 'Игровой ноутбук ASUS TUF RTX 3060', price: 74990_00, priceType: 'negotiable', city: 'ekaterinburg', attrs: { laptop_brand: 'asus', ram_gb: '16', screen_inch: 15.6 }, description: 'Не греется, чистил в сервисе месяц назад.', condition: 'used' },
  { cat: 'appliances', title: 'Холодильник Bosch двухкамерный', price: 18000_00, city: 'novosibirsk', attrs: { appliance_type: 'fridge' }, description: 'Высота 186 см, no frost. Самовывоз.', condition: 'used' },
  { cat: 'appliances', title: 'Стиральная машина LG 7 кг', price: 12500_00, city: 'moskva', attrs: { appliance_type: 'washer' }, description: 'Прямой привод, тихая. Есть доставка по городу.', condition: 'used', delivery: true },
  { cat: 'clothing', title: 'Пуховик зимний женский, размер M', price: 6500_00, city: 'sankt-peterburg', attrs: { clothing_gender: 'women', clothing_size: 'm', color: 'black' }, description: 'Носила один сезон, тёплый, капюшон с мехом.', condition: 'used', delivery: true },
  { cat: 'shoes', title: 'Кроссовки беговые, 42 размер', price: 3900_00, city: 'krasnodar', attrs: { clothing_gender: 'men', shoe_size: 42 }, description: 'Новые, не подошёл размер.', condition: 'new', delivery: true },
  { cat: 'furniture', title: 'Диван угловой раскладной', price: 21000_00, priceType: 'negotiable', city: 'moskva', attrs: { furniture_type: 'sofa', color: 'gray' }, description: 'Механизм еврокнижка, ящик для белья. Самовывоз из ЦАО.', condition: 'used' },
  { cat: 'furniture', title: 'Отдам стол письменный', price: 0, priceType: 'free', city: 'kazan', attrs: { furniture_type: 'table' }, description: 'Отдам даром при самовывозе.', condition: 'used' },
  { cat: 'tools', title: 'Перфоратор Makita HR2470', price: 7500_00, city: 'samara', attrs: {}, description: 'В кейсе, с набором буров.', condition: 'used', delivery: true },
  { cat: 'books', title: 'Собрание сочинений Чехова, 12 томов', price: 3000_00, city: 'voronezh', attrs: {}, description: 'Издание 1985 года, хорошее состояние.', condition: 'used', delivery: true },
  { cat: 'sport', title: 'Велосипед горный 29", рама L', price: 23000_00, city: 'perm', attrs: { sport_type: 'bike' }, description: 'Гидравлические тормоза, вилка с блокировкой.', condition: 'used' },
  { cat: 'toys', title: 'Конструктор LEGO Technic, полный комплект', price: 4500_00, city: 'moskva', attrs: { kids_age: '7_plus' }, description: 'Собирали один раз, все детали на месте.', condition: 'used', delivery: true },
  { cat: 'strollers', title: 'Коляска 2 в 1', price: 15000_00, city: 'ufa', attrs: {}, description: 'Люлька и прогулочный блок, дождевик в комплекте.', condition: 'used' },
  { cat: 'pet-goods', title: 'Переноска для кошки, новая', price: 1500_00, city: 'chelyabinsk', attrs: { animal_type: 'cat' }, description: 'Пластиковая, с металлической дверцей.', condition: 'new', delivery: true },
  { cat: 'flats-sale', title: '2-к. квартира, 54 м², 7/12 эт.', price: 12_900_000_00, city: 'moskva', attrs: { rooms: '2', area_total: 54, area_kitchen: 9, floor: 7, floors_total: 12, building_type: 'brick', year_built: 1985, renovation: 'euro' }, description: 'Светлая квартира, окна во двор, рядом метро 7 минут пешком. Один собственник.' },
  { cat: 'flats-sale', title: 'Студия, 26 м², 15/25 эт.', price: 5_600_000_00, city: 'sankt-peterburg', attrs: { rooms: 'studio', area_total: 26, floor: 15, floors_total: 25, building_type: 'monolith', year_built: 2021, renovation: 'cosmetic' }, description: 'Новый дом, закрытый двор, подземный паркинг.' },
  { cat: 'flats-rent', title: '1-к. квартира, 38 м², 3/9 эт.', price: 45000_00, city: 'moskva', attrs: { rooms: '1', area_total: 38, floor: 3, floors_total: 9, rent_term: 'long', renovation: 'euro' }, description: 'Сдаётся на длительный срок, есть вся техника. Без животных.' },
  { cat: 'flats-rent', title: '3-к. квартира, 78 м², 10/16 эт.', price: 38000_00, city: 'kazan', attrs: { rooms: '3', area_total: 78, floor: 10, floors_total: 16, rent_term: 'long' }, description: 'Для семьи, рядом школа и детский сад.' },
  { cat: 'daily-rent', title: 'Квартира посуточно у моря', price: 3500_00, city: 'sochi', attrs: { rooms: '1', guests: 3, area_total: 35 }, description: '5 минут до пляжа, кондиционер, Wi-Fi.' },
  { cat: 'houses', title: 'Дом 120 м² на участке 8 сот.', price: 7_800_000_00, city: 'krasnodar', attrs: { area_total: 120, area_land: 8, floors_total: 2, building_type: 'brick', year_built: 2016 }, description: 'Газ, вода, канализация центральные. Баня на участке.' },
  { cat: 'land', title: 'Участок 10 сот. ИЖС', price: 950_000_00, city: 'ekaterinburg', attrs: { area_land: 10, land_category: 'izhs' }, description: 'Электричество по границе, хороший подъезд.' },
  { cat: 'commercial', title: 'Офис 65 м² в бизнес-центре', price: 95000_00, city: 'novosibirsk', attrs: { commercial_type: 'office', area_total: 65, floor: 4 }, description: 'Аренда, отдельный вход, парковка.' },
  { cat: 'cars', title: 'LADA Vesta 1.6 MT, 2019', price: 980_000_00, city: 'samara', attrs: { car_make: 'lada', car_model: 'lada_vesta', car_year: 2019, mileage_km: 64000, engine_type: 'petrol', engine_volume: 1.6, engine_power: 106, transmission: 'manual', drive: 'front', body_type: 'sedan', vehicle_state: 'not_damaged', owners: '1', color: 'white' }, description: 'Один владелец, обслуживание у дилера, не битая.' },
  { cat: 'cars', title: 'Toyota Camry 2.5 AT, 2018', price: 2_450_000_00, city: 'moskva', attrs: { car_make: 'toyota', car_model: 'toyota_camry', car_year: 2018, mileage_km: 98000, engine_type: 'petrol', engine_volume: 2.5, engine_power: 181, transmission: 'automatic', drive: 'front', body_type: 'sedan', vehicle_state: 'not_damaged', owners: '2', color: 'black' }, description: 'Максимальная комплектация, зимняя резина в подарок.' },
  { cat: 'cars', title: 'Haval Jolion 1.5 AMT, 2022', price: 1_890_000_00, city: 'kazan', attrs: { car_make: 'haval', car_model: 'haval_jolion', car_year: 2022, mileage_km: 21000, engine_type: 'petrol', engine_volume: 1.5, engine_power: 143, transmission: 'robot', drive: 'front', body_type: 'suv', vehicle_state: 'not_damaged', owners: '1', color: 'gray' }, description: 'На гарантии, все ТО у официального дилера.' },
  { cat: 'cars', title: 'Kia Rio 1.6 AT, 2020', price: 1_390_000_00, city: 'rostov-na-donu', attrs: { car_make: 'kia', car_model: 'kia_rio', car_year: 2020, mileage_km: 55000, engine_type: 'petrol', engine_volume: 1.6, engine_power: 123, transmission: 'automatic', drive: 'front', body_type: 'sedan', vehicle_state: 'not_damaged', owners: '1', color: 'red' }, description: 'Подогрев сидений и руля, камера заднего вида.' },
  { cat: 'moto', title: 'Мотоцикл эндуро 250 куб.', price: 210_000_00, city: 'perm', attrs: { moto_type: 'enduro', car_year: 2021, mileage_km: 4000, engine_volume: 0.25 }, description: 'Обслужен, новая резина.' },
  { cat: 'parts', title: 'Комплект зимних шин R16', price: 16000_00, city: 'nizhniy-novgorod', attrs: { part_type: 'wheels' }, description: 'Шипованные, один сезон.', condition: 'used', delivery: true },
  { cat: 'vacancies', title: 'Курьер на личном авто', price: 90000_00, city: 'moskva', attrs: { job_sphere: 'logistics', employment: 'full', schedule: 'flexible', experience: 'none', salary_from: 90000, remote: false }, description: 'Доставка заказов по городу. Выплаты дважды в неделю.' },
  { cat: 'vacancies', title: 'Frontend-разработчик (React)', price: 200000_00, city: 'sankt-peterburg', attrs: { job_sphere: 'it', employment: 'full', schedule: 'flexible', experience: '3_6', salary_from: 200000, remote: true }, description: 'Продуктовая команда, TypeScript, Next.js. Удалённо или гибрид.' },
  { cat: 'resumes', title: 'Бухгалтер, опыт 8 лет', price: 70000_00, city: 'voronezh', attrs: { job_sphere: 'other', employment: 'full', experience: '6_plus', salary_from: 70000, remote: true }, description: '1С, отчётность, кадровый учёт.' },
  { cat: 'repair', title: 'Ремонт квартир под ключ', price: 3500_00, priceType: 'negotiable', city: 'moskva', attrs: { service_experience: '10_plus', service_departure: true }, description: 'Цена за м². Договор, смета, гарантия 2 года.' },
  { cat: 'transportation', title: 'Грузоперевозки, газель, грузчики', price: 1200_00, city: 'ekaterinburg', attrs: { service_experience: '3_10', service_departure: true }, description: 'Цена за час. Переезды, вывоз мусора.' },
  { cat: 'it-services', title: 'Создание сайтов и интернет-магазинов', price: null, priceType: 'on_request', city: 'novosibirsk', attrs: { service_experience: '3_10', service_online: true }, description: 'Лендинги, магазины, интеграции с CRM.' },
  { cat: 'education', title: 'Репетитор по математике, ЕГЭ', price: 1500_00, city: 'kazan', attrs: { service_experience: '10_plus', service_online: true }, description: 'Подготовка к ЕГЭ и ОГЭ, онлайн и очно.' },
  { cat: 'cleaning', title: 'Генеральная уборка квартир', price: 4000_00, city: 'sankt-peterburg', attrs: { service_experience: '1_3', service_departure: true }, description: 'Своё оборудование и средства.' },
];

async function seedDemo(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>, db: Db) {
  const sellers = [
    await upsertUser(db, 'seller@lotok.local', 'Demo12345', 'Анна Продавцова', { phone: '+79990000001', phoneVerifiedAt: new Date(), showPhone: true }),
    await upsertUser(db, 'seller2@lotok.local', 'Demo12345', 'Игорь Петров'),
  ];
  await upsertUser(db, 'buyer@lotok.local', 'Demo12345', 'Мария Покупателева');
  // Демо-продавцы созданы «давно», чтобы не попадать под ручную проверку новых аккаунтов.
  await db.update(users).set({ createdAt: sql`now() - interval '30 days'` }).where(inArray(users.id, sellers));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(listings).where(inArray(listings.userId, sellers));
  if (n > 0) return 0;
  // Демо-продавцам выдаётся PRO-подписка (без оплаты, только для демо-стенда), чтобы не упираться в лимиты.
  const [pro] = await db.select().from(paidServices).where(eq(paidServices.code, 'pro_month'));
  for (const s of sellers) {
    const [p] = await db.insert(purchases).values({ userId: s, serviceId: pro.id, price: 0, status: 'active', startsAt: new Date(), endsAt: addDays(new Date(), 365) }).returning();
    await db.insert(userSubscriptions).values({ userId: s, purchaseId: p.id, serviceType: 'pro_subscription', startsAt: new Date(), endsAt: addDays(new Date(), 365) });
  }
  const cats = app.get(CategoriesService);
  const regs = app.get(RegionsService);
  const listingsSvc = app.get(ListingsService);
  const mediaSvc = app.get(MediaService);
  const allCats = await cats.all();
  const allRegions = await regs.all();
  let created = 0;
  for (const [i, d] of DEMO.entries()) {
    const seller = sellers[i % sellers.length];
    const cat = allCats.find((c) => c.slug === d.cat)!;
    const city = allRegions.find((r) => r.slug === d.city)!;
    const photos: string[] = [];
    for (let k = 0; k < 2; k++) {
      const m = await mediaSvc.upload(seller, 'listing', { buffer: await placeholder(d.title, i + k), originalname: `demo-${i}-${k}.jpg`, size: 100_000 });
      await mediaSvc.process(m.id);
      photos.push(m.id);
    }
    const jitter = (x: number, s: number) => x + (((i * 7919) % 100) / 100 - 0.5) * s;
    const l = await listingsSvc.create(seller, {
      categoryId: cat.id,
      title: d.title,
      description: d.description,
      price: d.price,
      priceType: d.priceType ?? 'fixed',
      condition: d.condition ?? null,
      cityId: city.id,
      address: null,
      lat: city.lat ? jitter(city.lat, 0.12) : null,
      lng: city.lng ? jitter(city.lng, 0.2) : null,
      contactMethods: seller === sellers[0] ? ['chat', 'phone'] : ['chat'],
      deliveryAvailable: !!d.delivery && cat.allowDelivery,
      quantity: 1,
      attributes: d.attrs,
      mediaIds: photos,
      videoUrl: null,
      organizationId: null,
    });
    await listingsSvc.submit(seller, l.id);
    const row = await listingsSvc.getRow(l.id);
    if (row.status === 'moderation') await listingsSvc.transition(l.id, 'active', 'moderator', { reason: 'seed' });
    created++;
  }
  await app.get(SearchService).reindexAll();
  return created;
}

async function main() {
  const config = loadConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot({ ...config, QUEUE_MODE: 'inline' }), { logger: ['error', 'warn'] });
  const db = app.get<Db>(DB);
  await seedReference(db);
  const pwd = await seedStaff(db);
  await app.get(CategoriesService).invalidate();
  await app.get(RegionsService).invalidate();
  console.log('Справочники загружены. Служебные учётные записи: admin@/moderator@/support@/finance@lotok.local');
  if (!process.env.SEED_ADMIN_PASSWORD) console.log(`Пароль по умолчанию (только для разработки): ${pwd}`);
  if (process.env.SEED_DEMO === '1') {
    if (config.isProd) throw new Error('Демо-данные запрещены в production');
    const n = await seedDemo(app, db);
    console.log(`Демо-объявлений создано: ${n}. Продавец: seller@lotok.local / Demo12345, покупатель: buyer@lotok.local / Demo12345`);
  }
  await app.close();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { upsertUser };
