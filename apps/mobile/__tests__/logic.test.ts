import { resolveApiUrl } from '../src/config';
import { createTokenStore, type KeyValueStorage } from '../src/token-store';
import { buildListingPayload } from '../src/listing-payload';

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (k) => data.get(k) ?? null,
    setItemAsync: async (k, v) => void data.set(k, v),
    deleteItemAsync: async (k) => void data.delete(k),
  };
}

describe('API URL', () => {
  it('maps localhost to host loopback in Android emulator', () => {
    expect(resolveApiUrl('http://localhost:4000/', 'android', false)).toBe('http://10.0.2.2:4000');
    expect(resolveApiUrl('http://localhost:4000', 'android', true)).toBe('http://localhost:4000');
    expect(resolveApiUrl('https://lotok.example', 'ios', false)).toBe('https://lotok.example');
  });
});

describe('token store', () => {
  it('keeps access in memory and refresh in secure storage', async () => {
    const st = memory();
    const changes: (string | null)[] = [];
    const t = createTokenStore(st, (a) => changes.push(a));
    expect(await t.hasSession()).toBe(false);
    await t.setTokens({ accessToken: 'acc', refreshToken: 'ref' });
    expect(t.getAccessToken()).toBe('acc');
    expect(await t.getRefreshToken()).toBe('ref');
    expect([...st.data.values()]).toEqual(['ref']);
    await t.setTokens(null);
    expect(t.getAccessToken()).toBeNull();
    expect(await t.hasSession()).toBe(false);
    expect(changes).toEqual(['acc', null]);
  });
});

describe('listing payload', () => {
  const defs = [
    { id: 1, key: 'rooms', name: 'Комнаты', type: 'enum', unit: null, minValue: null, maxValue: null, isRequired: true, isFilterable: true, showInCard: true, sort: 0, dependsOn: null, options: [] },
    { id: 2, key: 'area_total', name: 'Площадь', type: 'decimal', unit: 'м²', minValue: 1, maxValue: null, isRequired: true, isFilterable: true, showInCard: true, sort: 1, dependsOn: null, options: [] },
    { id: 3, key: 'remote', name: 'Удалённо', type: 'boolean', unit: null, minValue: null, maxValue: null, isRequired: false, isFilterable: true, showInCard: true, sort: 2, dependsOn: null, options: [] },
  ] as never;
  it('converts form values to API types and kopecks', () => {
    const p = buildListingPayload({ categoryId: 5, title: 'Квартира', description: '', price: '12 500,50', cityId: 1, attributes: { rooms: '2', area_total: '54,5', remote: 'true' }, attributeDefs: defs, mediaIds: [] });
    expect(p.price).toBe(1250050);
    expect(p.attributes).toEqual({ rooms: '2', area_total: 54.5, remote: true });
    expect(p.contactMethods).toEqual(['chat']);
  });
  it('validates with the shared schema', () => {
    expect(() => buildListingPayload({ categoryId: 5, title: 'a', description: '', price: '', cityId: 1, attributes: {}, attributeDefs: [], mediaIds: [] })).toThrow();
  });
});
