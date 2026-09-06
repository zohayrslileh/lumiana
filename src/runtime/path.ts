import portable from 'path-browserify-win32';
import process, { observeProcess } from './process.js';

// Parsing is local. Only resolution needs the connection's working directory.
export const posix = {
  ...portable.posix,
  resolve: (...parts: string[]) =>
    portable.posix.resolve(process.cwd().replaceAll('\\', '/'), ...parts),
  relative: (from: string, to: string) =>
    portable.posix.relative(posix.resolve(from), posix.resolve(to)),
};
export const win32 = {
  ...portable.win32,
  resolve: (...parts: string[]) =>
    portable.win32.resolve(
      ...Object.entries(process.env)
        .filter(([key]) => /^=[a-z]:$/i.test(key))
        .map(([, value]) => value!),
      process.cwd(),
      ...parts,
    ),
  relative: (from: string, to: string) =>
    portable.win32.relative(win32.resolve(from), win32.resolve(to)),
};
win32.toNamespacedPath = (value: string) =>
  typeof value === 'string' && value.length
    ? portable.win32.toNamespacedPath(win32.resolve(value))
    : value;
(win32 as any)._makeLong = win32.toNamespacedPath;
posix.posix = win32.posix = posix;
posix.win32 = win32.win32 = win32;
const current = () => (process.platform === 'win32' ? win32 : posix);
export const resolve = (...parts: string[]) => current().resolve(...parts);
export const normalize = (value: string) => current().normalize(value);
export const isAbsolute = (value: string) => current().isAbsolute(value);
export const join = (...parts: string[]) => current().join(...parts);
export const relative = (from: string, to: string) => current().relative(from, to);
export const dirname = (value: string) => current().dirname(value);
export const basename = (value: string, suffix?: string) => current().basename(value, suffix);
export const extname = (value: string) => current().extname(value);
export const parse = (value: string) => current().parse(value);
export const format = (value: import('node:path').FormatInputPathObject) => current().format(value);
export const toNamespacedPath = (value: string) => current().toNamespacedPath(value);
export const _makeLong = toNamespacedPath;
export let sep: string;
export let delimiter: string;
observeProcess(() => {
  sep = current().sep;
  delimiter = current().delimiter;
});
export default {
  resolve,
  normalize,
  isAbsolute,
  join,
  relative,
  dirname,
  basename,
  extname,
  parse,
  format,
  toNamespacedPath,
  _makeLong,
  posix,
  win32,
  get sep() {
    return current().sep;
  },
  get delimiter() {
    return current().delimiter;
  },
};
