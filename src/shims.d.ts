declare module 'stream-browserify' {
  const stream: typeof import('node:stream');
  export default stream;
}

declare module 'process/browser' {
  const process: typeof import('node:process');
  export default process;
}

declare module 'path-browserify' {
  const path: typeof import('node:path');
  export default path;
}

declare module 'querystring-es3' {
  const querystring: typeof import('node:querystring');
  export default querystring;
}

declare module 'crypto-browserify' {
  const crypto: Record<string, any>;
  export default crypto;
}

declare module 'browserify-zlib' {
  const zlib: typeof import('node:zlib');
  export = zlib;
}
