declare module 'stream-browserify' {
  const stream: typeof import('node:stream');
  export default stream;
}
