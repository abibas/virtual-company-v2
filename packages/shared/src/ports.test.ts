import { describe, expect, it } from 'vitest';
import { PORTS, SLOT_BASE, SLOT_COUNT, slotFromPath, slotPorts } from './ports.ts';

describe('port map', () => {
  it('keeps every fixed port inside 9950–9999 and unique', () => {
    const fixed = [
      PORTS.api,
      PORTS.web,
      PORTS.postgres,
      PORTS.runnerHealth,
      PORTS.ngrokInspect,
      PORTS.webPreview,
      PORTS.drizzleStudio,
      PORTS.prodLike.api,
      PORTS.prodLike.web,
      PORTS.prodLike.postgres,
    ];
    for (const port of fixed) {
      expect(port).toBeGreaterThanOrEqual(9950);
      expect(port).toBeLessThanOrEqual(9999);
    }
    expect(new Set(fixed).size).toBe(fixed.length);
  });

  it('gives slot 0 the ports 9960/9961/9962 and slot 9 the ports 9987/9988/9989', () => {
    expect(slotPorts(0)).toEqual({ slot: 0, api: 9960, web: 9961, postgres: 9962 });
    expect(slotPorts(9)).toEqual({ slot: 9, api: 9987, web: 9988, postgres: 9989 });
  });

  it('never lets a slot overlap a fixed port or another slot', () => {
    const used = new Set<number>([
      PORTS.api,
      PORTS.web,
      PORTS.postgres,
      PORTS.runnerHealth,
      PORTS.prodLike.api,
    ]);
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const ports = slotPorts(slot);
      for (const port of [ports.api, ports.web, ports.postgres]) {
        expect(used.has(port)).toBe(false);
        used.add(port);
        expect(port).toBeLessThan(PORTS.prodLike.api);
        expect(port).toBeGreaterThanOrEqual(SLOT_BASE);
      }
    }
  });

  it('rejects slots outside the range', () => {
    expect(() => slotPorts(-1)).toThrow(RangeError);
    expect(() => slotPorts(SLOT_COUNT)).toThrow(RangeError);
    expect(() => slotPorts(1.5)).toThrow(RangeError);
  });

  it('derives a stable slot in range from a path', () => {
    const path = '/Users/someone/.cache/mwc-wip/feature-x';
    const slot = slotFromPath(path);
    expect(slot).toBe(slotFromPath(path));
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(SLOT_COUNT);
    expect(slotFromPath('/a')).not.toBe(slotFromPath('/b'));
  });
});
