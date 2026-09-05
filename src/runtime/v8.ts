import { Buffer } from 'buffer';
import { encodePacket, decodePacket } from '../protocol.js';
import { encodeValue, decodeValue } from '../values.js';
import { unsupported } from './unsupported.js';

export const serialize = (value: any): Buffer => Buffer.from(encodePacket(encodeValue(value)));
export const deserialize = (value: ArrayBuffer | ArrayBufferView): any => {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return decodeValue(decodePacket(bytes));
};

const unavailable =
  (name: string) =>
  (..._args: any[]) =>
    unsupported('node:v8', name);

export const cachedDataVersionTag = unavailable('cachedDataVersionTag');
export const getCppHeapStatistics = unavailable('getCppHeapStatistics');
export const getHeapCodeStatistics = unavailable('getHeapCodeStatistics');
export const getHeapSnapshot = unavailable('getHeapSnapshot');
export const getHeapSpaceStatistics = unavailable('getHeapSpaceStatistics');
export const getHeapStatistics = unavailable('getHeapStatistics');
export const isStringOneByteRepresentation = unavailable('isStringOneByteRepresentation');
export const queryObjects = unavailable('queryObjects');
export const setFlagsFromString = unavailable('setFlagsFromString');
export const setHeapSnapshotNearHeapLimit = unavailable('setHeapSnapshotNearHeapLimit');
export const stopCoverage = unavailable('stopCoverage');
export const takeCoverage = unavailable('takeCoverage');
export const writeHeapSnapshot = unavailable('writeHeapSnapshot');
export const startCpuProfile = unavailable('startCpuProfile');

class UnsupportedSerializer {
  constructor() {
    unsupported('node:v8', new.target.name);
  }
}

export class Serializer extends UnsupportedSerializer {}
export class Deserializer extends UnsupportedSerializer {}
export class DefaultSerializer extends UnsupportedSerializer {}
export class DefaultDeserializer extends UnsupportedSerializer {}
export class GCProfiler extends UnsupportedSerializer {}

export const promiseHooks = {
  createHook: unavailable('promiseHooks.createHook'),
  onInit: unavailable('promiseHooks.onInit'),
  onBefore: unavailable('promiseHooks.onBefore'),
  onAfter: unavailable('promiseHooks.onAfter'),
  onSettled: unavailable('promiseHooks.onSettled'),
};
export const startupSnapshot = {
  addSerializeCallback: unavailable('startupSnapshot.addSerializeCallback'),
  addDeserializeCallback: unavailable('startupSnapshot.addDeserializeCallback'),
  setDeserializeMainFunction: unavailable('startupSnapshot.setDeserializeMainFunction'),
  isBuildingSnapshot: unavailable('startupSnapshot.isBuildingSnapshot'),
};

export default {
  cachedDataVersionTag,
  DefaultDeserializer,
  DefaultSerializer,
  deserialize,
  Deserializer,
  getCppHeapStatistics,
  getHeapCodeStatistics,
  getHeapSnapshot,
  getHeapSpaceStatistics,
  getHeapStatistics,
  isStringOneByteRepresentation,
  promiseHooks,
  queryObjects,
  serialize,
  Serializer,
  setFlagsFromString,
  setHeapSnapshotNearHeapLimit,
  startCpuProfile,
  startupSnapshot,
  stopCoverage,
  takeCoverage,
  writeHeapSnapshot,
};
