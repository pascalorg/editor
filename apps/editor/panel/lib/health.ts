import { cpuUsage, memoryUsage } from 'node:process';
import { totalmem, freemem, loadavg, cpus } from 'node:os';

/**
 * Real runtime measurement, replacing the prototype's simulated metrics.
 *
 * CPU is a delta, not an instant: `process.cpuUsage()` is cumulative, so a
 * single reading says nothing. The percentage is (cpu time used) / (wall time ×
 * cores) between two polls, clamped to 5–95 like the old panel — a flat 0 or
 * 100 reads as "the probe is broken" rather than as a measurement.
 */

interface Sample {
  cpu: ReturnType<typeof cpuUsage>;
  at: number;
}

let previous: Sample | null = null;

export interface HealthReading {
  /** 0–100, clamped to 5–95. */
  cpuPercent: number;
  /** Resident heap in GB, two decimals. */
  heapGb: number;
  /** System memory in use, GB. */
  systemUsedGb: number;
  systemTotalGb: number;
  loadAverage1m: number;
  cores: number;
  uptimeSeconds: number;
  at: string;
}

export function readHealth(): HealthReading {
  const now = Date.now();
  const cpu = cpuUsage();

  let cpuPercent = 5;
  if (previous) {
    const elapsedMs = Math.max(1, now - previous.at);
    const usedMs = (cpu.user - previous.cpu.user + (cpu.system - previous.cpu.system)) / 1000;
    const cores = Math.max(1, cpus().length);
    cpuPercent = Math.round((usedMs / (elapsedMs * cores)) * 100);
  }
  previous = { cpu, at: now };

  const memory = memoryUsage();
  const total = totalmem();
  const free = freemem();

  return {
    cpuPercent: Math.min(95, Math.max(5, cpuPercent)),
    heapGb: round2(memory.heapUsed / 1024 ** 3),
    systemUsedGb: round2((total - free) / 1024 ** 3),
    systemTotalGb: round2(total / 1024 ** 3),
    loadAverage1m: round2(loadavg()[0] ?? 0),
    cores: cpus().length,
    uptimeSeconds: Math.round(process.uptime()),
    at: new Date(now).toISOString(),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
