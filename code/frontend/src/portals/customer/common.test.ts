/** The default search window avoids hours when no listing is open. */
import { describe, expect, it } from 'vitest';
import { defaultWindow, toLocalInput } from './common';

const at = (isoIst: string) => new Date(`${isoIst}+05:30`);

describe('defaultWindow', () => {
  it('starts at the next half hour during the day', () => {
    const w = defaultWindow(at('2026-10-14T11:10:00'));
    expect(toLocalInput(new Date(w.start))).toBe('2026-10-14T11:30');
    expect(toLocalInput(new Date(w.end))).toBe('2026-10-14T15:30');
  });

  it('moves late evening to 10:00 the next morning', () => {
    expect(toLocalInput(new Date(defaultWindow(at('2026-10-13T23:10:00')).start))).toBe('2026-10-14T10:00');
    expect(toLocalInput(new Date(defaultWindow(at('2026-10-13T20:05:00')).start))).toBe('2026-10-14T10:00');
  });

  it('moves the early hours to 10:00 the same day', () => {
    expect(toLocalInput(new Date(defaultWindow(at('2026-10-14T02:10:00')).start))).toBe('2026-10-14T10:00');
  });
});
