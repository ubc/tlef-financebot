// Unit test — the academic-api COMPONENT with the global fetch mocked. Verifies
// the Basic auth header, the hasNextPage pagination loop, batched person
// lookups, and error mapping — no FakeAcademicAPI needed.
const fetchMock = jest.fn();
const realFetch = global.fetch;

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});
beforeEach(() => {
  fetchMock.mockReset();
});

import { env } from '../../server/src/config/env';
import {
  AcademicApiError,
  academicPeriods,
  findPersonByPuid,
  findPersonsByStudentIds,
  pingAcademicApi,
  registrationsBySectionId,
  sectionsByIds,
} from '../../server/src/components/academic-api';

/** A fetch Response stub carrying one page of the API's envelope. */
function page(items: unknown[], hasNextPage = false) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ page: 1, pageSize: 500, hasNextPage, pageItems: items }),
  };
}

const expectedAuth = `Basic ${Buffer.from(
  `${env.academicApiClientId}:${env.academicApiClientSecret}`,
).toString('base64')}`;

describe('academic-api component', () => {
  it('sends Basic auth and the query params', async () => {
    fetchMock.mockResolvedValue(page([{ puid: '12345678' }]));

    await findPersonByPuid('12345678');

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/person/v2/persons');
    expect(url.searchParams.get('puid')).toBe('12345678');
    expect((init.headers as Record<string, string>).authorization).toBe(expectedAuth);
  });

  it('follows hasNextPage until all pages are read', async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ studentId: 'a' }], true))
      .mockResolvedValueOnce(page([{ studentId: 'b' }], false));

    const regs = await registrationsBySectionId('SEC-1');

    expect(regs.map((r) => (r as { studentId: string }).studentId)).toEqual(['a', 'b']);
    const pages = fetchMock.mock.calls.map(([u]) => (u as URL).searchParams.get('page'));
    expect(pages).toEqual(['1', '2']);
  });

  it('returns null when no person matches the PUID', async () => {
    fetchMock.mockResolvedValue(page([]));
    expect(await findPersonByPuid('00000000')).toBeNull();
  });

  it('chunks batch person lookups (100 ids per request)', async () => {
    fetchMock.mockResolvedValue(page([]));
    const ids = Array.from({ length: 250 }, (_, i) => String(i));

    await findPersonsByStudentIds(ids);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstUrl = fetchMock.mock.calls[0][0] as URL;
    expect(firstUrl.searchParams.getAll('student_id')).toHaveLength(100);
  });

  it('short-circuits empty id lists without a request', async () => {
    expect(await sectionsByIds([])).toEqual([]);
    expect(await findPersonsByStudentIds([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps network failure to AcademicApiError with status 502', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const failure = academicPeriods();

    await expect(failure).rejects.toBeInstanceOf(AcademicApiError);
    await expect(failure).rejects.toMatchObject({ status: 502, upstreamStatus: undefined });
  });

  it('maps an upstream non-2xx to AcademicApiError keeping the upstream status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(academicPeriods()).rejects.toMatchObject({ status: 502, upstreamStatus: 500 });
  });

  it('pingAcademicApi reports reachability and never throws', async () => {
    fetchMock.mockResolvedValueOnce(page([]));
    expect(await pingAcademicApi()).toBe(true);

    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await pingAcademicApi()).toBe(false);
  });
});
