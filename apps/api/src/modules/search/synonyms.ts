/**
 * Синонимы и русские написания брендов. Применяются к поисковому запросу в обоих движках.
 * Словарь детерминированный; при необходимости выносится в управляемый справочник админки.
 */
const GROUPS: string[][] = [
  ['айфон', 'iphone', 'apple'],
  ['эпл', 'apple'],
  ['макбук', 'macbook'],
  ['самсунг', 'samsung'],
  ['сяоми', 'ксиоми', 'xiaomi'],
  ['редми', 'redmi'],
  ['хонор', 'honor'],
  ['хуавей', 'huawei'],
  ['леново', 'lenovo'],
  ['асус', 'asus'],
  ['тойота', 'toyota'],
  ['камри', 'camry'],
  ['королла', 'corolla'],
  ['киа', 'kia'],
  ['рио', 'rio'],
  ['хендай', 'хундай', 'хёндай', 'hyundai'],
  ['солярис', 'solaris'],
  ['фольксваген', 'volkswagen', 'vw'],
  ['бмв', 'bmw'],
  ['лада', 'ваз', 'lada'],
  ['веста', 'vesta'],
  ['хавал', 'haval'],
  ['чери', 'chery'],
  ['джили', 'geely'],
  ['рено', 'renault'],
  ['бош', 'bosch'],
  ['лджи', 'lg'],
  ['макита', 'makita'],
  ['лего', 'lego'],
  ['комп', 'компьютер'],
  ['ноут', 'ноутбук'],
  ['телефон', 'смартфон'],
  ['тв', 'телевизор'],
  ['однушка', '1-к'],
  ['двушка', '2-к'],
  ['трешка', 'трёшка', '3-к'],
];

const INDEX = new Map<string, string[]>();
for (const g of GROUPS) for (const w of g) INDEX.set(w, [...new Set([...(INDEX.get(w) ?? []), ...g.filter((x) => x !== w)])]);

/** Варианты запроса: исходный + с заменой слов на синонимы (не более 4 вариантов). */
export function expandQuery(q: string): string[] {
  const words = q.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  const variants = new Set<string>([q]);
  words.forEach((w, i) => {
    for (const syn of INDEX.get(w) ?? []) {
      const copy = [...words];
      copy[i] = syn;
      variants.add(copy.join(' '));
    }
  });
  return [...variants].slice(0, 4);
}
