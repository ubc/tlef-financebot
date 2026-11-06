import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dgram from 'node:dgram';

/** Installed before importing PDF.js. This audit has no HTTP exception. */
export function installFileOnlyFence(): { attempts: () => number } {
  let attempts = 0;
  const deny = () => { attempts++; throw new Error('visual-audit-network-forbidden'); };
  net.Socket.prototype.connect = deny as typeof net.Socket.prototype.connect;
  tls.connect = deny as typeof tls.connect;
  http.request = deny as typeof http.request; http.get = deny as typeof http.get;
  https.request = deny as typeof https.request; https.get = deny as typeof https.get;
  dns.lookup = deny as unknown as typeof dns.lookup; dns.resolve = deny as unknown as typeof dns.resolve;
  dns.promises.lookup = deny as typeof dns.promises.lookup;
  dns.promises.resolve = deny as typeof dns.promises.resolve;
  dgram.createSocket = deny as typeof dgram.createSocket;
  globalThis.fetch = (async () => deny()) as typeof fetch;
  return { attempts: () => attempts };
}
