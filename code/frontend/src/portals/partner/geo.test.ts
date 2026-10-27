import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatStoreAddress, inIndia, reverseStoreAddress, searchStorePlace } from './geo';

afterEach(() => vi.unstubAllGlobals());

describe('partner map location', () => {
  it('uses the same India bounds as the listing API', () => {
    expect(inIndia(30.34, 76.39)).toBe(true);
    expect(inIndia(0, 76.39)).toBe(false);
    expect(inIndia(30.34, 180)).toBe(false);
    expect(inIndia(NaN, 76.39)).toBe(false);
  });

  it('fills street, area and city from an Indian reverse-geocode result', () => {
    expect(formatStoreAddress({ address: {
      country_code: 'in', house_number: '12', road: 'Mall Road', neighbourhood: 'Civil Lines', city: 'Patiala',
    } })).toEqual({ address: '12 Mall Road, Civil Lines', area: 'Civil Lines', city: 'Patiala' });
    expect(formatStoreAddress({ address: { country_code: 'in', village: 'Sanaur' }, display_name: 'Bus Stand, Sanaur, Punjab, India' }))
      .toEqual({ address: 'Bus Stand, Sanaur', area: '', city: 'Sanaur' });
  });

  it('never presents a foreign or incomplete address as a verified match', () => {
    expect(formatStoreAddress({ address: { country_code: 'us', road: 'Broadway', city: 'New York' } })).toBeNull();
    expect(formatStoreAddress({ address: { country_code: 'in', city: 'Patiala' } })).toBeNull();
    expect(formatStoreAddress({ address: { country_code: 'in', road: 'Main St' } })).toBeNull();
  });

  it('searches in India without placing a pin, then reverse looks up an address', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ lat: '30.34', lon: '76.38', display_name: 'Patiala, Punjab, India' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ address: { country_code: 'in', road: 'Mall Road', city: 'Patiala' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchStorePlace('Patiala', new AbortController().signal)).toEqual({ lat: 30.34, lng: 76.38, label: 'Patiala, Punjab, India' });
    expect(await reverseStoreAddress(30.34, 76.38, new AbortController().signal)).toEqual({ address: 'Mall Road', area: '', city: 'Patiala' });
    const firstUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(firstUrl.hostname).toBe('nominatim.openstreetmap.org');
    expect(firstUrl.searchParams.get('countrycodes')).toBe('in');
    const secondUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(secondUrl.searchParams.get('lat')).toBe('30.34');
  });
});
