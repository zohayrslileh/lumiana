import stream from 'stream-browserify';

export function pipeline(...streams: any[]): Promise<void> {
  return new Promise((resolve, reject) => {
    (stream.pipeline as any)(...streams, (error?: Error | null) =>
      error ? reject(error) : resolve(),
    );
  });
}

export function finished(value: any, options?: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error | null) => (error ? reject(error) : resolve());
    if (options === undefined) stream.finished(value, done);
    else stream.finished(value, options, done);
  });
}

export default { finished, pipeline };
