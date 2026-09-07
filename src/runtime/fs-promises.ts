import { constants } from './fs-constants.js';
import { kernelCall } from './bridge.js';
import { createFileSystem } from './filesystem.js';

const runtime = Object.assign(createFileSystem(kernelCall), { constants });

export const {
  access,
  appendFile,
  chmod,
  chown,
  constants: exportedConstants,
  copyFile,
  cp,
  link,
  lutimes,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  symlink,
  truncate,
  unlink,
  utimes,
  writeFile,
} = runtime;

export { exportedConstants as constants };
export default runtime;
