import net from './net.js';
import tls from './tls.js';
import { httpRuntime } from './http.js';
import { createHttp2 } from './http2-core.js';
import { constants } from './http2-constants.js';
import {
  defaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
} from './http2-codec.js';

const runtime = createHttp2(net, tls, httpRuntime);
export const {
  connect,
  createServer,
  createSecureServer,
  Http2ServerRequest,
  Http2ServerResponse,
} = runtime;
export { constants, getPackedSettings, getUnpackedSettings, sensitiveHeaders };
export const getDefaultSettings = () => ({ ...defaultSettings });
export default {
  ...runtime,
  constants,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
};
