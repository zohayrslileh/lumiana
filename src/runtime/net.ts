import { network as runtime } from './socket-runtime.js';
import { kernelCallSync } from './bridge.js';

export const { Socket, Server, createServer, createConnection, connect } = runtime;

export function isIPv4(input: string): boolean {
  const parts = input.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
}

export function isIPv6(input: string): boolean {
  if (!input.includes(':')) return false;
  try {
    new URL(`http://[${input}]/`);
    return true;
  } catch {
    return false;
  }
}

export function isIP(input: string): 0 | 4 | 6 {
  return isIPv4(input) ? 4 : isIPv6(input) ? 6 : 0;
}

export const getDefaultAutoSelectFamily = (): boolean =>
  kernelCallSync('net.global.getDefaultAutoSelectFamily');
export const setDefaultAutoSelectFamily = (value: boolean): void =>
  kernelCallSync('net.global.setDefaultAutoSelectFamily', value);
export const getDefaultAutoSelectFamilyAttemptTimeout = (): number =>
  kernelCallSync('net.global.getDefaultAutoSelectFamilyAttemptTimeout');
export const setDefaultAutoSelectFamilyAttemptTimeout = (value: number): void =>
  kernelCallSync('net.global.setDefaultAutoSelectFamilyAttemptTimeout', value);

export default {
  Socket,
  Server,
  createServer,
  createConnection,
  connect,
  getDefaultAutoSelectFamily,
  getDefaultAutoSelectFamilyAttemptTimeout,
  isIP,
  isIPv4,
  isIPv6,
  setDefaultAutoSelectFamily,
  setDefaultAutoSelectFamilyAttemptTimeout,
};
