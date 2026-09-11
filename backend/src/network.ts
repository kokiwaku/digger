import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { ArticleFetchError } from "./errors.js";

// SSRF対策: localhost / private / link-local(メタデータエンドポイント含む) への
// アクセスを拒否する。ホスト名はDNS解決した実IPまでチェックし、DNSリバインディングを防ぐ。

const PRIVATE_IPV4_RANGES: [base: string, bits: number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // 169.254.169.254 のクラウドメタデータもここに含まれる
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]!);

  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // 解釈できないものは安全側で拒否
}

export async function assertPublicHost(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new ArticleFetchError(`アクセスが許可されていないホストです: ${hostname}`, 400);
  }

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new ArticleFetchError(`アクセスが許可されていないホストです: ${hostname}`, 400);
    }
    return;
  }

  let resolvedIps: string[];
  try {
    resolvedIps = (await lookup(hostname, { all: true })).map((a) => a.address);
  } catch {
    throw new ArticleFetchError(`ホスト名を解決できませんでした: ${hostname}`, 502);
  }

  if (resolvedIps.length === 0 || resolvedIps.some(isBlockedIp)) {
    throw new ArticleFetchError(`アクセスが許可されていないホストです: ${hostname}`, 400);
  }
}
