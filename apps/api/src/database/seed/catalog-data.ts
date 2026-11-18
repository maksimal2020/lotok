/**
 * Справочные данные для начального наполнения: регионы, дерево категорий, характеристики, тарифы.
 * Это стартовая конфигурация — далее всё управляется через административную панель.
 */

export interface SeedRegion {
  slug: string;
  name: string;
  type: 'country' | 'region' | 'city' | 'district';
  parent?: string;
  lat?: number;
  lng?: number;
  sort?: number;
  timezone?: string;
}

const city = (slug: string, name: string, parent: string, lat: number, lng: number, sort = 10, timezone = 'Europe/Moscow'): SeedRegion => ({
  slug,
  name,
  type: 'city',
  parent,
  lat,
  lng,
  sort,
  timezone,
});

export const REGIONS: SeedRegion[] = [
  { slug: 'russia', name: 'Россия', type: 'country', lat: 61.52, lng: 105.31, sort: 0 },
  { slug: 'moskva-region', name: 'Москва', type: 'region', parent: 'russia', sort: 1 },
  { slug: 'moskovskaya-oblast', name: 'Московская область', type: 'region', parent: 'russia', sort: 2 },
  { slug: 'spb-region', name: 'Санкт-Петербург', type: 'region', parent: 'russia', sort: 3 },
  { slug: 'leningradskaya-oblast', name: 'Ленинградская область', type: 'region', parent: 'russia', sort: 4 },
  { slug: 'sverdlovskaya-oblast', name: 'Свердловская область', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'novosibirskaya-oblast', name: 'Новосибирская область', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'tatarstan', name: 'Республика Татарстан', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'nizhegorodskaya-oblast', name: 'Нижегородская область', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'krasnodarskiy-kray', name: 'Краснодарский край', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'samarskaya-oblast', name: 'Самарская область', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'rostovskaya-oblast', name: 'Ростовская область', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'bashkortostan', name: 'Республика Башкортостан', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'chelyabinskaya-oblast', name: 'Челябинская область', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'permskiy-kray', name: 'Пермский край', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'voronezhskaya-oblast', name: 'Воронежская область', type: 'region', parent: 'russia', sort: 10 },
  { slug: 'krasnoyarskiy-kray', name: 'Красноярский край', type: 'region', parent: 'russia', sort: 10 },
  city('moskva', 'Москва', 'moskva-region', 55.7558, 37.6173, 1),
  city('podolsk', 'Подольск', 'moskovskaya-oblast', 55.4242, 37.5547, 50),
  city('balashikha', 'Балашиха', 'moskovskaya-oblast', 55.7963, 37.9382, 50),
  city('khimki', 'Химки', 'moskovskaya-oblast', 55.8887, 37.4304, 50),
  city('mytishchi', 'Мытищи', 'moskovskaya-oblast', 55.9116, 37.7308, 50),
  city('sankt-peterburg', 'Санкт-Петербург', 'spb-region', 59.9343, 30.3351, 2),
  city('gatchina', 'Гатчина', 'leningradskaya-oblast', 59.5653, 30.1281, 60),
  city('ekaterinburg', 'Екатеринбург', 'sverdlovskaya-oblast', 56.8389, 60.6057, 4, 'Asia/Yekaterinburg'),
  city('novosibirsk', 'Новосибирск', 'novosibirskaya-oblast', 55.0084, 82.9357, 3, 'Asia/Novosibirsk'),
  city('kazan', 'Казань', 'tatarstan', 55.7961, 49.1064, 5),
  city('nizhniy-novgorod', 'Нижний Новгород', 'nizhegorodskaya-oblast', 56.2965, 43.9361, 6),
  city('krasnodar', 'Краснодар', 'krasnodarskiy-kray', 45.0355, 38.9753, 7),
  city('sochi', 'Сочи', 'krasnodarskiy-kray', 43.5855, 39.7231, 20),
  city('samara', 'Самара', 'samarskaya-oblast', 53.1959, 50.1002, 8, 'Europe/Samara'),
  city('rostov-na-donu', 'Ростов-на-Дону', 'rostovskaya-oblast', 47.2357, 39.7015, 9),
  city('ufa', 'Уфа', 'bashkortostan', 54.7388, 55.9721, 10, 'Asia/Yekaterinburg'),
  city('chelyabinsk', 'Челябинск', 'chelyabinskaya-oblast', 55.1644, 61.4368, 11, 'Asia/Yekaterinburg'),
  city('perm', 'Пермь', 'permskiy-kray', 58.0105, 56.2502, 12, 'Asia/Yekaterinburg'),
  city('voronezh', 'Воронеж', 'voronezhskaya-oblast', 51.6608, 39.2003, 13),
  city('krasnoyarsk', 'Красноярск', 'krasnoyarskiy-kray', 56.0153, 92.8932, 14, 'Asia/Krasnoyarsk'),
  { slug: 'moskva-tsao', name: 'ЦАО', type: 'district', parent: 'moskva', lat: 55.7539, lng: 37.6208 },
  { slug: 'moskva-sao', name: 'САО', type: 'district', parent: 'moskva', lat: 55.8384, lng: 37.5249 },
  { slug: 'moskva-yuao', name: 'ЮАО', type: 'district', parent: 'moskva', lat: 55.6223, lng: 37.6782 },
  { slug: 'moskva-zao', name: 'ЗАО', type: 'district', parent: 'moskva', lat: 55.7083, lng: 37.4436 },
  { slug: 'moskva-vao', name: 'ВАО', type: 'district', parent: 'moskva', lat: 55.7871, lng: 37.7756 },
];

type AttrType = 'string' | 'integer' | 'decimal' | 'boolean' | 'enum' | 'multi_enum' | 'year';
export interface SeedAttribute {
  key: string;
  name: string;
  type: AttrType;
  unit?: string;
  min?: number;
  max?: number;
  dependsOn?: string;
  options?: [string, string, string?][];
}

const opts = (...labels: [string, string][]) => labels.map(([v, l]) => [v, l] as [string, string]);

const CAR_MAKES: Record<string, [string, string][]> = {
  lada: opts(['vesta', 'Vesta'], ['granta', 'Granta'], ['niva', 'Niva Travel'], ['largus', 'Largus'], ['xray', 'XRAY']),
  toyota: opts(['camry', 'Camry'], ['corolla', 'Corolla'], ['rav4', 'RAV4'], ['land_cruiser', 'Land Cruiser']),
  kia: opts(['rio', 'Rio'], ['sportage', 'Sportage'], ['ceed', 'Ceed'], ['k5', 'K5']),
  hyundai: opts(['solaris', 'Solaris'], ['creta', 'Creta'], ['tucson', 'Tucson'], ['santa_fe', 'Santa Fe']),
  volkswagen: opts(['polo', 'Polo'], ['tiguan', 'Tiguan'], ['passat', 'Passat']),
  bmw: opts(['3_series', '3 серии'], ['5_series', '5 серии'], ['x5', 'X5']),
  haval: opts(['jolion', 'Jolion'], ['f7', 'F7'], ['h6', 'H6']),
  chery: opts(['tiggo_4', 'Tiggo 4'], ['tiggo_7', 'Tiggo 7 Pro'], ['tiggo_8', 'Tiggo 8 Pro']),
  geely: opts(['coolray', 'Coolray'], ['monjaro', 'Monjaro'], ['atlas', 'Atlas']),
  renault: opts(['logan', 'Logan'], ['duster', 'Duster'], ['sandero', 'Sandero']),
};
const MAKE_LABELS: Record<string, string> = {
  lada: 'LADA (ВАЗ)',
  toyota: 'Toyota',
  kia: 'Kia',
  hyundai: 'Hyundai',
  volkswagen: 'Volkswagen',
  bmw: 'BMW',
  haval: 'Haval',
  chery: 'Chery',
  geely: 'Geely',
  renault: 'Renault',
};

export const ATTRIBUTES: SeedAttribute[] = [
  { key: 'condition_note', name: 'Комплектация и состояние', type: 'string' },
  { key: 'phone_brand', name: 'Производитель', type: 'enum', options: [['apple', 'Apple'], ['samsung', 'Samsung'], ['xiaomi', 'Xiaomi'], ['honor', 'Honor'], ['huawei', 'Huawei'], ['realme', 'realme'], ['tecno', 'TECNO'], ['other', 'Другой']] },
  { key: 'storage_gb', name: 'Встроенная память', type: 'enum', options: [['32', '32 ГБ'], ['64', '64 ГБ'], ['128', '128 ГБ'], ['256', '256 ГБ'], ['512', '512 ГБ'], ['1024', '1 ТБ']] },
  { key: 'color', name: 'Цвет', type: 'enum', options: [['black', 'Чёрный'], ['white', 'Белый'], ['gray', 'Серый'], ['silver', 'Серебристый'], ['blue', 'Синий'], ['red', 'Красный'], ['green', 'Зелёный'], ['gold', 'Золотой'], ['other', 'Другой']] },
  { key: 'laptop_brand', name: 'Производитель', type: 'enum', options: [['apple', 'Apple'], ['lenovo', 'Lenovo'], ['asus', 'ASUS'], ['hp', 'HP'], ['acer', 'Acer'], ['msi', 'MSI'], ['huawei', 'Huawei'], ['other', 'Другой']] },
  { key: 'ram_gb', name: 'Оперативная память', type: 'enum', options: [['4', '4 ГБ'], ['8', '8 ГБ'], ['16', '16 ГБ'], ['32', '32 ГБ'], ['64', '64 ГБ']] },
  { key: 'screen_inch', name: 'Диагональ экрана', type: 'decimal', unit: '″', min: 5, max: 100 },
  { key: 'appliance_type', name: 'Вид техники', type: 'enum', options: [['fridge', 'Холодильник'], ['washer', 'Стиральная машина'], ['dishwasher', 'Посудомоечная машина'], ['stove', 'Плита'], ['microwave', 'Микроволновая печь'], ['vacuum', 'Пылесос'], ['other', 'Другое']] },
  { key: 'clothing_gender', name: 'Для кого', type: 'enum', options: [['women', 'Женская'], ['men', 'Мужская'], ['unisex', 'Унисекс']] },
  { key: 'clothing_size', name: 'Размер', type: 'enum', options: [['xs', 'XS (42)'], ['s', 'S (44)'], ['m', 'M (46)'], ['l', 'L (48)'], ['xl', 'XL (50)'], ['xxl', 'XXL (52+)']] },
  { key: 'shoe_size', name: 'Размер обуви', type: 'integer', min: 15, max: 50 },
  { key: 'furniture_type', name: 'Вид мебели', type: 'enum', options: [['sofa', 'Диван'], ['bed', 'Кровать'], ['wardrobe', 'Шкаф'], ['table', 'Стол'], ['chair', 'Стул, кресло'], ['kitchen', 'Кухонный гарнитур'], ['other', 'Другое']] },
  { key: 'kids_age', name: 'Возраст ребёнка', type: 'enum', options: [['0_1', 'До 1 года'], ['1_3', '1–3 года'], ['3_7', '3–7 лет'], ['7_plus', 'Старше 7 лет']] },
  { key: 'animal_type', name: 'Вид животного', type: 'enum', options: [['dog', 'Собака'], ['cat', 'Кошка'], ['bird', 'Птица'], ['fish', 'Рыбы'], ['rodent', 'Грызун'], ['other', 'Другое']] },
  { key: 'sport_type', name: 'Вид спорта', type: 'enum', options: [['bike', 'Велосипеды'], ['fitness', 'Фитнес и тренажёры'], ['winter', 'Зимние виды'], ['tourism', 'Туризм'], ['water', 'Водный спорт'], ['other', 'Другое']] },
  // Недвижимость
  { key: 'rooms', name: 'Количество комнат', type: 'enum', options: [['studio', 'Студия'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5_plus', '5 и более'], ['free', 'Свободная планировка']] },
  { key: 'area_total', name: 'Общая площадь', type: 'decimal', unit: 'м²', min: 1, max: 100000 },
  { key: 'area_kitchen', name: 'Площадь кухни', type: 'decimal', unit: 'м²', min: 1, max: 500 },
  { key: 'area_land', name: 'Площадь участка', type: 'decimal', unit: 'сот.', min: 0.1, max: 100000 },
  { key: 'floor', name: 'Этаж', type: 'integer', min: -3, max: 150 },
  { key: 'floors_total', name: 'Этажей в доме', type: 'integer', min: 1, max: 150 },
  { key: 'building_type', name: 'Тип дома', type: 'enum', options: [['brick', 'Кирпичный'], ['panel', 'Панельный'], ['monolith', 'Монолитный'], ['block', 'Блочный'], ['wood', 'Деревянный']] },
  { key: 'year_built', name: 'Год постройки', type: 'year', min: 1800 },
  { key: 'renovation', name: 'Ремонт', type: 'enum', options: [['none', 'Требует ремонта'], ['cosmetic', 'Косметический'], ['euro', 'Евро'], ['designer', 'Дизайнерский']] },
  { key: 'rent_term', name: 'Срок аренды', type: 'enum', options: [['long', 'На длительный срок'], ['few_months', 'На несколько месяцев']] },
  { key: 'guests', name: 'Количество гостей', type: 'integer', min: 1, max: 50 },
  { key: 'commercial_type', name: 'Назначение', type: 'enum', options: [['office', 'Офис'], ['retail', 'Торговая площадь'], ['warehouse', 'Склад'], ['production', 'Производство'], ['free', 'Свободного назначения']] },
  { key: 'land_category', name: 'Категория земель', type: 'enum', options: [['izhs', 'ИЖС'], ['snt', 'СНТ, ДНП'], ['agro', 'Сельхозназначения'], ['industrial', 'Промназначения']] },
  { key: 'completion_year', name: 'Срок сдачи', type: 'year', min: 2000, max: 2040 },
  // Транспорт
  { key: 'car_make', name: 'Марка', type: 'enum', options: Object.entries(MAKE_LABELS).map(([v, l]) => [v, l]) },
  {
    key: 'car_model',
    name: 'Модель',
    type: 'enum',
    dependsOn: 'car_make',
    options: Object.entries(CAR_MAKES).flatMap(([make, models]) => models.map(([v, l]) => [`${make}_${v}`, l, make] as [string, string, string])),
  },
  { key: 'car_year', name: 'Год выпуска', type: 'year', min: 1950 },
  { key: 'mileage_km', name: 'Пробег', type: 'integer', unit: 'км', min: 0, max: 5_000_000 },
  { key: 'engine_type', name: 'Двигатель', type: 'enum', options: [['petrol', 'Бензин'], ['diesel', 'Дизель'], ['hybrid', 'Гибрид'], ['electric', 'Электро'], ['gas', 'Газ']] },
  { key: 'engine_volume', name: 'Объём двигателя', type: 'decimal', unit: 'л', min: 0.1, max: 10 },
  { key: 'engine_power', name: 'Мощность', type: 'integer', unit: 'л.с.', min: 1, max: 2000 },
  { key: 'transmission', name: 'Коробка передач', type: 'enum', options: [['manual', 'Механика'], ['automatic', 'Автомат'], ['robot', 'Робот'], ['cvt', 'Вариатор']] },
  { key: 'drive', name: 'Привод', type: 'enum', options: [['front', 'Передний'], ['rear', 'Задний'], ['full', 'Полный']] },
  { key: 'body_type', name: 'Тип кузова', type: 'enum', options: [['sedan', 'Седан'], ['hatchback', 'Хетчбэк'], ['wagon', 'Универсал'], ['suv', 'Внедорожник'], ['coupe', 'Купе'], ['minivan', 'Минивэн'], ['pickup', 'Пикап']] },
  { key: 'vehicle_state', name: 'Состояние', type: 'enum', options: [['not_damaged', 'Не битый'], ['damaged', 'Битый']] },
  { key: 'owners', name: 'Владельцев по ПТС', type: 'enum', options: [['1', '1'], ['2', '2'], ['3_plus', '3 и более']] },
  { key: 'moto_type', name: 'Вид мототехники', type: 'enum', options: [['road', 'Дорожный'], ['sport', 'Спортивный'], ['enduro', 'Эндуро'], ['scooter', 'Скутер'], ['atv', 'Квадроцикл'], ['snowmobile', 'Снегоход']] },
  { key: 'part_type', name: 'Вид запчасти', type: 'enum', options: [['body', 'Кузов'], ['engine', 'Двигатель'], ['suspension', 'Подвеска'], ['electrics', 'Электрооборудование'], ['wheels', 'Шины и диски'], ['other', 'Другое']] },
  // Работа
  { key: 'employment', name: 'Тип занятости', type: 'enum', options: [['full', 'Полная'], ['part', 'Частичная'], ['project', 'Проектная'], ['internship', 'Стажировка']] },
  { key: 'schedule', name: 'График работы', type: 'enum', options: [['full_day', 'Полный день'], ['shift', 'Сменный'], ['flexible', 'Гибкий'], ['watch', 'Вахта']] },
  { key: 'experience', name: 'Опыт работы', type: 'enum', options: [['none', 'Без опыта'], ['1_3', '1–3 года'], ['3_6', '3–6 лет'], ['6_plus', 'Более 6 лет']] },
  { key: 'salary_from', name: 'Зарплата от', type: 'integer', unit: '₽', min: 0, max: 100_000_000 },
  { key: 'remote', name: 'Удалённая работа', type: 'boolean' },
  { key: 'job_sphere', name: 'Сфера деятельности', type: 'enum', options: [['it', 'IT, интернет'], ['sales', 'Продажи'], ['logistics', 'Транспорт, логистика'], ['construction', 'Строительство'], ['retail', 'Розничная торговля'], ['production', 'Производство'], ['education', 'Образование'], ['medicine', 'Медицина'], ['other', 'Другое']] },
  // Услуги
  { key: 'service_online', name: 'Работа онлайн', type: 'boolean' },
  { key: 'service_experience', name: 'Опыт', type: 'enum', options: [['lt1', 'Менее года'], ['1_3', '1–3 года'], ['3_10', '3–10 лет'], ['10_plus', 'Более 10 лет']] },
  { key: 'service_departure', name: 'Выезд к клиенту', type: 'boolean' },
];

export interface SeedCategory {
  slug: string;
  name: string;
  vertical: 'goods' | 'realty' | 'auto' | 'jobs' | 'services';
  icon?: string;
  freeLimit?: number | null;
  manual?: boolean;
  allowDelivery?: boolean;
  allowVideo?: boolean;
  maxPhotos?: number;
  /** key[:required][:nofilter] */
  attrs?: string[];
  children?: SeedCategory[];
}

const goods = (slug: string, name: string, attrs: string[] = [], children?: SeedCategory[], icon?: string): SeedCategory => ({ slug, name, vertical: 'goods', attrs, children, icon });

export const CATEGORIES: SeedCategory[] = [
  {
    slug: 'goods',
    name: 'Товары',
    vertical: 'goods',
    icon: 'bag',
    children: [
      goods('electronics', 'Электроника', [], [
        goods('smartphones', 'Смартфоны', ['phone_brand:required', 'storage_gb', 'color']),
        goods('computers', 'Компьютеры', [], [goods('laptops', 'Ноутбуки', ['laptop_brand:required', 'ram_gb', 'screen_inch']), goods('desktops', 'Настольные компьютеры', ['ram_gb']), goods('components', 'Комплектующие')]),
        goods('tv-audio', 'Телевизоры и аудио', ['screen_inch']),
        goods('photo-video', 'Фото- и видеотехника'),
        goods('games-consoles', 'Игры и приставки'),
      ], 'device'),
      goods('appliances', 'Бытовая техника', ['appliance_type:required'], undefined, 'fridge'),
      goods('clothes', 'Одежда и обувь', [], [goods('clothing', 'Одежда', ['clothing_gender:required', 'clothing_size', 'color']), goods('shoes', 'Обувь', ['clothing_gender:required', 'shoe_size']), goods('accessories', 'Аксессуары')], 'shirt'),
      goods('furniture', 'Мебель', ['furniture_type:required', 'color'], undefined, 'sofa'),
      goods('home', 'Товары для дома', [], [goods('kitchenware', 'Посуда и товары для кухни'), goods('textile', 'Текстиль'), goods('decor', 'Декор и интерьер')], 'home'),
      goods('construction-goods', 'Строительство и ремонт', [], [goods('tools', 'Инструменты'), goods('materials', 'Стройматериалы'), goods('plumbing', 'Сантехника')], 'hammer'),
      goods('hobby', 'Хобби и отдых', [], [goods('books', 'Книги и журналы'), goods('music-instruments', 'Музыкальные инструменты'), goods('collecting', 'Коллекционирование'), goods('tickets', 'Билеты и путешествия')], 'guitar'),
      goods('sport', 'Спорт', ['sport_type:required'], undefined, 'ball'),
      goods('kids', 'Детские товары', [], [goods('kids-clothes', 'Детская одежда', ['kids_age']), goods('toys', 'Игрушки', ['kids_age']), goods('strollers', 'Коляски и автокресла')], 'kids'),
      {
        slug: 'animals',
        name: 'Животные и зоотовары',
        vertical: 'goods',
        icon: 'paw',
        manual: true,
        children: [
          { slug: 'pets', name: 'Животные', vertical: 'goods', allowDelivery: false, attrs: ['animal_type:required'], manual: true },
          goods('pet-goods', 'Товары для животных', ['animal_type']),
        ],
      },
      goods('other-goods', 'Другие товары', [], undefined, 'box'),
    ],
  },
  {
    slug: 'realty',
    name: 'Недвижимость',
    vertical: 'realty',
    icon: 'building',
    freeLimit: 2,
    allowDelivery: false,
    maxPhotos: 40,
    allowVideo: true,
    children: [
      { slug: 'flats-sale', name: 'Продажа квартир', vertical: 'realty', allowDelivery: false, allowVideo: true, maxPhotos: 40, attrs: ['rooms:required', 'area_total:required', 'area_kitchen', 'floor:required', 'floors_total', 'building_type', 'year_built', 'renovation'] },
      { slug: 'flats-rent', name: 'Аренда квартир', vertical: 'realty', allowDelivery: false, allowVideo: true, maxPhotos: 40, attrs: ['rooms:required', 'area_total:required', 'floor', 'floors_total', 'rent_term:required', 'renovation'] },
      { slug: 'rooms', name: 'Комнаты', vertical: 'realty', allowDelivery: false, maxPhotos: 30, attrs: ['area_total:required', 'floor', 'floors_total', 'rent_term'] },
      { slug: 'houses', name: 'Дома, дачи, коттеджи', vertical: 'realty', allowDelivery: false, allowVideo: true, maxPhotos: 40, attrs: ['area_total:required', 'area_land', 'floors_total', 'building_type', 'year_built'] },
      { slug: 'land', name: 'Земельные участки', vertical: 'realty', allowDelivery: false, attrs: ['area_land:required', 'land_category:required'] },
      { slug: 'commercial', name: 'Коммерческая недвижимость', vertical: 'realty', allowDelivery: false, allowVideo: true, attrs: ['commercial_type:required', 'area_total:required', 'floor'] },
      { slug: 'new-buildings', name: 'Новостройки', vertical: 'realty', allowDelivery: false, allowVideo: true, maxPhotos: 40, attrs: ['rooms:required', 'area_total:required', 'floor', 'floors_total', 'completion_year'] },
      { slug: 'daily-rent', name: 'Посуточная аренда', vertical: 'realty', allowDelivery: false, maxPhotos: 40, attrs: ['rooms:required', 'guests', 'area_total'] },
    ],
  },
  {
    slug: 'transport',
    name: 'Транспорт',
    vertical: 'auto',
    icon: 'car',
    allowDelivery: false,
    allowVideo: true,
    maxPhotos: 30,
    children: [
      {
        slug: 'cars',
        name: 'Легковые автомобили',
        vertical: 'auto',
        allowDelivery: false,
        allowVideo: true,
        maxPhotos: 30,
        freeLimit: 1,
        attrs: ['car_make:required', 'car_model:required', 'car_year:required', 'mileage_km:required', 'engine_type', 'engine_volume', 'engine_power', 'transmission', 'drive', 'body_type', 'vehicle_state', 'owners', 'color'],
      },
      { slug: 'moto', name: 'Мотоциклы и мототехника', vertical: 'auto', allowDelivery: false, allowVideo: true, attrs: ['moto_type:required', 'car_year', 'mileage_km', 'engine_volume'] },
      { slug: 'trucks', name: 'Грузовики и коммерческий транспорт', vertical: 'auto', allowDelivery: false, allowVideo: true, attrs: ['car_year', 'mileage_km', 'engine_type', 'transmission'] },
      { slug: 'special', name: 'Спецтехника', vertical: 'auto', allowDelivery: false, allowVideo: true, attrs: ['car_year'] },
      { slug: 'parts', name: 'Запчасти и аксессуары', vertical: 'auto', allowDelivery: true, attrs: ['part_type:required'] },
      { slug: 'water', name: 'Водный транспорт', vertical: 'auto', allowDelivery: false, allowVideo: true, attrs: ['car_year', 'engine_power'] },
    ],
  },
  {
    slug: 'jobs',
    name: 'Работа',
    vertical: 'jobs',
    icon: 'briefcase',
    allowDelivery: false,
    maxPhotos: 5,
    children: [
      { slug: 'vacancies', name: 'Вакансии', vertical: 'jobs', allowDelivery: false, maxPhotos: 5, freeLimit: 3, attrs: ['job_sphere:required', 'employment:required', 'schedule', 'experience', 'salary_from', 'remote'] },
      { slug: 'resumes', name: 'Резюме', vertical: 'jobs', allowDelivery: false, maxPhotos: 3, attrs: ['job_sphere:required', 'employment', 'schedule', 'experience', 'salary_from', 'remote'] },
    ],
  },
  {
    slug: 'services',
    name: 'Услуги',
    vertical: 'services',
    icon: 'tools',
    allowDelivery: false,
    freeLimit: 5,
    children: [
      ['repair', 'Ремонт и отделка'],
      ['building', 'Строительство'],
      ['transportation', 'Перевозки и грузчики'],
      ['it-services', 'IT, интернет, телеком'],
      ['education', 'Обучение, курсы'],
      ['beauty', 'Красота и здоровье'],
      ['cleaning', 'Уборка'],
      ['legal', 'Юридические услуги'],
      ['other-services', 'Другие услуги'],
    ].map(([slug, name]) => ({
      slug,
      name,
      vertical: 'services' as const,
      allowDelivery: false,
      attrs: ['service_experience', 'service_departure', 'service_online'],
      manual: slug === 'legal' || slug === 'beauty',
    })),
  },
];

export const PAID_SERVICES = [
  { code: 'bump_1', type: 'bump', name: 'Поднятие в выдаче', description: 'Объявление поднимается наверх результатов при сортировке по дате.', price: 99_00, durationDays: null, sort: 1, bonusAllowed: true },
  { code: 'bump_7', type: 'bump', name: 'Поднятие ×7', description: 'Ежедневное поднятие в течение 7 дней.', price: 349_00, durationDays: 7, sort: 2, bonusAllowed: true },
  { code: 'highlight_7', type: 'highlight', name: 'Выделение цветом', description: 'Объявление выделяется в выдаче на 7 дней.', price: 149_00, durationDays: 7, sort: 3, bonusAllowed: true },
  { code: 'premium_7', type: 'premium', name: 'Премиум-размещение', description: 'Показ в отдельном блоке «Премиум» над результатами поиска на 7 дней.', price: 590_00, durationDays: 7, sort: 4, bonusAllowed: false },
  { code: 'listing_slot', type: 'listing_slot', name: 'Дополнительная публикация', description: 'Одна публикация сверх бесплатного лимита категории.', price: 79_00, durationDays: null, quantity: 1, sort: 10, bonusAllowed: true },
  { code: 'listing_package_10', type: 'listing_package', name: 'Пакет 10 публикаций', description: '10 публикаций сверх лимита, действует 30 дней.', price: 590_00, durationDays: 30, quantity: 10, sort: 11, bonusAllowed: false },
  { code: 'pro_month', type: 'pro_subscription', name: 'Профессиональный аккаунт (30 дней)', description: 'Без лимитов публикаций, расширенная статистика, отметка PRO. Для компаний и профессиональных продавцов.', price: 1990_00, durationDays: 30, sort: 20, bonusAllowed: false },
  { code: 'analytics_month', type: 'analytics', name: 'Расширенная статистика (30 дней)', description: 'Статистика просмотров и контактов за 90 дней.', price: 290_00, durationDays: 30, sort: 21, bonusAllowed: true },
] as const;

export const STOP_WORDS: [string, 'reject' | 'flag'][] = [
  ['наркотик', 'reject'],
  ['спайс', 'reject'],
  ['боевое оружие', 'reject'],
  ['поддельные документы', 'reject'],
  ['купить диплом', 'reject'],
  ['фальшивые деньги', 'reject'],
  ['реплика', 'flag'],
  ['копия бренда', 'flag'],
  ['предоплата 100%', 'flag'],
  ['только предоплата', 'flag'],
  ['заработок без вложений', 'flag'],
];
