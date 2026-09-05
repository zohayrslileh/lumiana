import { nativeCallSync, nativeConstructSync } from './bridge.js';

const call =
  (name: string) =>
  (...args: any[]) =>
    nativeCallSync('node:v8', name.split('.'), args);

export const cachedDataVersionTag = call('cachedDataVersionTag');
export const deserialize = call('deserialize');
export const getCppHeapStatistics = call('getCppHeapStatistics');
export const getHeapCodeStatistics = call('getHeapCodeStatistics');
export const getHeapSnapshot = call('getHeapSnapshot');
export const getHeapSpaceStatistics = call('getHeapSpaceStatistics');
export const getHeapStatistics = call('getHeapStatistics');
export const isStringOneByteRepresentation = call('isStringOneByteRepresentation');
export const queryObjects = call('queryObjects');
export const serialize = call('serialize');
export const setFlagsFromString = call('setFlagsFromString');
export const setHeapSnapshotNearHeapLimit = call('setHeapSnapshotNearHeapLimit');
export const stopCoverage = call('stopCoverage');
export const takeCoverage = call('takeCoverage');
export const writeHeapSnapshot = call('writeHeapSnapshot');
export const startCpuProfile = call('startCpuProfile');

const construct = (name: string) =>
  class {
    constructor(...args: any[]) {
      return nativeConstructSync('node:v8', [name], args);
    }
  };

export const Serializer = construct('Serializer');
export const Deserializer = construct('Deserializer');
export const DefaultSerializer = construct('DefaultSerializer');
export const DefaultDeserializer = construct('DefaultDeserializer');
export const GCProfiler = construct('GCProfiler');

export const promiseHooks = {
  createHook: call('promiseHooks.createHook'),
  onInit: call('promiseHooks.onInit'),
  onBefore: call('promiseHooks.onBefore'),
  onAfter: call('promiseHooks.onAfter'),
  onSettled: call('promiseHooks.onSettled'),
};
export const startupSnapshot = {
  addSerializeCallback: call('startupSnapshot.addSerializeCallback'),
  addDeserializeCallback: call('startupSnapshot.addDeserializeCallback'),
  setDeserializeMainFunction: call('startupSnapshot.setDeserializeMainFunction'),
  isBuildingSnapshot: call('startupSnapshot.isBuildingSnapshot'),
};

const runtime = {
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

export default runtime;
