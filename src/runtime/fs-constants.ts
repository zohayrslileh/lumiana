// Stable values from Node's filesystem contract. Platform-only flags remain on
// the native compatibility path until the runtime can obtain them at startup.
export const constants = Object.freeze({
  F_OK: 0,
  X_OK: 1,
  W_OK: 2,
  R_OK: 4,
  COPYFILE_EXCL: 1,
  COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE_FORCE: 4,
  UV_DIRENT_UNKNOWN: 0,
  UV_DIRENT_FILE: 1,
  UV_DIRENT_DIR: 2,
  UV_DIRENT_LINK: 3,
  UV_DIRENT_FIFO: 4,
  UV_DIRENT_SOCKET: 5,
  UV_DIRENT_CHAR: 6,
  UV_DIRENT_BLOCK: 7,
});
