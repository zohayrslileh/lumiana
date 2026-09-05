import { Buffer } from 'buffer';
import legacy from 'url/url.js';
import path from 'path-browserify';
import punycode from 'punycode/punycode.js';
import process from './process.js';

interface PlatformOptions {
  windows?: boolean;
}

export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export const URLPattern = (globalThis as any).URLPattern;
export const Url = legacy.Url;
export const parse = legacy.parse;
export const resolve = legacy.resolve;
export const resolveObject = legacy.resolveObject;

const error = (code: string, message: string) => {
  const value = new TypeError(message) as TypeError & { code: string };
  value.code = code;
  return value;
};

const useWindowsPaths = (options?: PlatformOptions) =>
  options?.windows ?? process.platform === 'win32';

const decodePathname = (pathname: string, windows: boolean) => {
  const forbidden = windows ? /%2f|%5c/i : /%2f/i;
  if (forbidden.test(pathname))
    throw error('ERR_INVALID_FILE_URL_PATH', 'File URL path must not include encoded separators');
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw error('ERR_INVALID_FILE_URL_PATH', 'File URL path contains invalid encoded characters');
  }
};

export function fileURLToPath(value: string | globalThis.URL, options?: PlatformOptions): string {
  const url = value instanceof globalThis.URL ? value : new globalThis.URL(value);
  if (url.protocol !== 'file:')
    throw error('ERR_INVALID_URL_SCHEME', 'The URL must use the file: scheme');

  const windows = useWindowsPaths(options);
  const pathname = decodePathname(url.pathname, windows);
  if (windows) {
    if (url.hostname) return `\\\\${url.hostname}${pathname.replaceAll('/', '\\')}`;
    if (!/^\/[a-zA-Z]:/.test(pathname))
      throw error('ERR_INVALID_FILE_URL_PATH', 'File URL path must be absolute');
    return pathname.slice(1).replaceAll('/', '\\');
  }
  if (url.hostname && url.hostname !== 'localhost')
    throw error('ERR_INVALID_FILE_URL_HOST', 'File URL host must be empty or localhost');
  return pathname;
}

export function fileURLToPathBuffer(
  value: string | globalThis.URL,
  options?: PlatformOptions,
): Buffer {
  return Buffer.from(fileURLToPath(value, options));
}

const resolveWindows = (value: string) => {
  if (/^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)) return value;
  const cwd = process.cwd();
  const base = /^[a-zA-Z]:[\\/]/.test(cwd) ? cwd : 'C:\\';
  return `${base.replace(/[\\/]+$/, '')}\\${value}`;
};

export function pathToFileURL(value: string, options?: PlatformOptions): globalThis.URL {
  if (typeof value !== 'string') throw error('ERR_INVALID_ARG_TYPE', 'The path must be a string');
  const windows = useWindowsPaths(options);
  const url = new globalThis.URL('file:///');
  if (windows) {
    const resolved = resolveWindows(value).replaceAll('\\', '/');
    if (resolved.startsWith('//')) {
      const [hostname, ...parts] = resolved.slice(2).split('/');
      url.hostname = hostname!;
      url.pathname = '/' + parts.join('/');
    } else url.pathname = '/' + resolved;
  } else url.pathname = path.resolve(value);
  return url;
}

export function domainToASCII(domain: string): string {
  try {
    return new globalThis.URL(`http://${domain}`).hostname;
  } catch {
    return '';
  }
}

export function domainToUnicode(domain: string): string {
  const ascii = domainToASCII(domain);
  if (!ascii) return '';
  try {
    return ascii
      .split('.')
      .map((label) =>
        label.toLowerCase().startsWith('xn--') ? punycode.decode(label.slice(4)) : label,
      )
      .join('.');
  } catch {
    return '';
  }
}

export function urlToHttpOptions(url: globalThis.URL): Record<string, any> {
  const options: Record<string, any> = {
    protocol: url.protocol,
    hostname: url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
    hash: url.hash,
    search: url.search,
    pathname: url.pathname,
    path: `${url.pathname}${url.search}`,
    href: url.href,
  };
  if (url.port) options.port = Number(url.port);
  if (url.username || url.password)
    options.auth = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  return options;
}

export function format(value: any, options?: any): string {
  if (!(value instanceof globalThis.URL)) return legacy.format(value);
  const url = new globalThis.URL(value.href);
  if (options?.auth === false) {
    url.username = '';
    url.password = '';
  }
  if (options?.fragment === false) url.hash = '';
  if (options?.search === false) url.search = '';
  const href = url.href;
  if (!options?.unicode) return href;
  const hostname = domainToUnicode(url.hostname);
  const authority = href.indexOf('//') + 2;
  const index = href.indexOf(url.hostname, authority);
  return index < authority
    ? href
    : `${href.slice(0, index)}${hostname}${href.slice(index + url.hostname.length)}`;
}

const runtime = {
  URL,
  URLPattern,
  URLSearchParams,
  Url,
  domainToASCII,
  domainToUnicode,
  fileURLToPath,
  fileURLToPathBuffer,
  format,
  parse,
  pathToFileURL,
  resolve,
  resolveObject,
  urlToHttpOptions,
};

export default runtime;
