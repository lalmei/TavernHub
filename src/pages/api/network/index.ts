import type { APIRoute } from 'astro';
import os from 'node:os';

function isPrivateIpv4(ip: string): boolean {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  const match = ip.match(/^172\.(\d+)\./);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 16 && second <= 31;
}

function detectLanIp(): string | null {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4') continue;
      if (entry.internal) continue;
      candidates.push(entry.address);
    }
  }

  const privateIp = candidates.find((ip) => isPrivateIpv4(ip));
  return privateIp ?? candidates[0] ?? null;
}

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ lanIp: detectLanIp() }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

