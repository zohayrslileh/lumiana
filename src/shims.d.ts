declare module 'stream-browserify' {
  const stream: typeof import('node:stream');
  export default stream;
}

declare module 'process/browser' {
  const process: typeof import('node:process');
  export default process;
}

declare module 'path-browserify-win32' {
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

declare module 'url/url.js' {
  const url: {
    Url: typeof import('node:url').Url;
    parse: typeof import('node:url').parse;
    resolve: typeof import('node:url').resolve;
    resolveObject: typeof import('node:url').resolveObject;
    format: typeof import('node:url').format;
  };
  export default url;
}

declare module 'punycode/punycode.js' {
  const punycode: { decode(value: string): string };
  export default punycode;
}

declare module 'util/util.js' {
  const util: typeof import('node:util') & Record<string, any>;
  export default util;
}

declare module 'hpack.js' {
  const hpack: any;
  export default hpack;
}
