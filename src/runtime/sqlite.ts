import { kernelCall, kernelCallback, kernelCallSync } from './bridge.js';

type DatabaseLocation = string | Buffer | URL;
type SQLInputValue = null | boolean | number | bigint | string | ArrayBuffer | ArrayBufferView;

const internal = Symbol('lumiana.sqlite.internal');
const databaseHandles = new WeakMap<object, number>();
const statementHandles = new WeakMap<object, number>();
const sessionHandles = new WeakMap<object, number>();

const illegalConstructor = (name: string): never => {
  const error = new TypeError(`Illegal constructor: ${name}`) as TypeError & { code: string };
  error.code = 'ERR_ILLEGAL_CONSTRUCTOR';
  throw error;
};

const databaseHandle = (database: DatabaseSync): number => {
  const handle = databaseHandles.get(database);
  if (handle === undefined) throw new TypeError('Expected a DatabaseSync instance');
  return handle;
};

const statementHandle = (statement: StatementSync): number => {
  const handle = statementHandles.get(statement);
  if (handle === undefined) throw new TypeError('Expected a StatementSync instance');
  return handle;
};

const callbackReference = (callback: Function) => ({
  id: kernelCallback(callback),
  length: callback.length,
});

const callbackOptions = (options: Record<string, any>, names: string[]) => {
  const result = { ...options };
  for (const name of names)
    if (typeof result[name] === 'function') result[name] = callbackReference(result[name]);
  return result;
};

const location = (value: DatabaseLocation) => (value instanceof URL ? { url: value.href } : value);

class StatementIterator<T = any> implements IterableIterator<T> {
  constructor(
    private handle: number,
    private release?: () => void,
  ) {}

  next(): IteratorResult<T> {
    const result = kernelCallSync('sqlite.iterator.next', this.handle);
    if (result.done) this.finish();
    return result;
  }

  return(): IteratorResult<T> {
    const result = kernelCallSync('sqlite.iterator.return', this.handle);
    this.finish();
    return result;
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this;
  }

  private finish() {
    this.release?.();
    this.release = undefined;
  }
}

export class StatementSync {
  constructor(token?: symbol, handle?: number) {
    if (token !== internal || handle === undefined) illegalConstructor('StatementSync');
    const nativeHandle = handle as number;
    statementHandles.set(this, nativeHandle);
    Object.defineProperties(this, {
      sourceSQL: {
        enumerable: true,
        get: () => kernelCallSync('sqlite.statement.property', nativeHandle, 'sourceSQL'),
      },
      expandedSQL: {
        enumerable: true,
        get: () => kernelCallSync('sqlite.statement.property', nativeHandle, 'expandedSQL'),
      },
    });
  }

  declare readonly sourceSQL: string;
  declare readonly expandedSQL: string;

  all(...params: any[]): any[] {
    return kernelCallSync('sqlite.statement.call', statementHandle(this), 'all', params);
  }

  get(...params: any[]): any {
    return kernelCallSync('sqlite.statement.call', statementHandle(this), 'get', params);
  }

  run(...params: any[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  } {
    return kernelCallSync('sqlite.statement.call', statementHandle(this), 'run', params);
  }

  iterate(...params: any[]): IterableIterator<any> {
    const { handle } = kernelCallSync('sqlite.statement.iterate', statementHandle(this), params);
    return new StatementIterator(handle);
  }

  columns(): Array<{
    column: string | null;
    database: string | null;
    name: string;
    table: string | null;
    type: string | null;
  }> {
    return kernelCallSync('sqlite.statement.call', statementHandle(this), 'columns', []);
  }

  setAllowBareNamedParameters(enabled: boolean): void {
    kernelCallSync(
      'sqlite.statement.configure',
      statementHandle(this),
      'setAllowBareNamedParameters',
      enabled,
    );
  }

  setAllowUnknownNamedParameters(enabled: boolean): void {
    kernelCallSync(
      'sqlite.statement.configure',
      statementHandle(this),
      'setAllowUnknownNamedParameters',
      enabled,
    );
  }

  setReadBigInts(enabled: boolean): void {
    kernelCallSync('sqlite.statement.configure', statementHandle(this), 'setReadBigInts', enabled);
  }

  setReturnArrays(enabled: boolean): void {
    kernelCallSync('sqlite.statement.configure', statementHandle(this), 'setReturnArrays', enabled);
  }
}

export class Session {
  constructor(token?: symbol, handle?: number) {
    if (token !== internal || handle === undefined) illegalConstructor('Session');
    sessionHandles.set(this, handle as number);
  }

  changeset(): Uint8Array {
    return kernelCallSync('sqlite.session.changeset', sessionHandles.get(this));
  }

  patchset(): Uint8Array {
    return kernelCallSync('sqlite.session.patchset', sessionHandles.get(this));
  }

  close(): void {
    kernelCallSync('sqlite.session.close', sessionHandles.get(this));
  }

  [Symbol.dispose](): void {
    kernelCallSync('sqlite.session.dispose', sessionHandles.get(this));
  }
}

class SQLTagStore {
  readonly capacity: number;
  readonly db: DatabaseSync;
  private statements = new Map<string, StatementSync>();

  constructor(token?: symbol, database?: DatabaseSync, capacity = 1000) {
    if (token !== internal || !database) illegalConstructor('SQLTagStore');
    this.db = database as DatabaseSync;
    this.capacity = Number.isNaN(Number(capacity)) ? 1000 : Math.trunc(Number(capacity));
    Object.defineProperties(this, {
      capacity: { enumerable: true, value: this.capacity },
      db: { enumerable: true, value: this.db },
      size: { enumerable: true, get: () => this.statements.size },
    });
  }

  declare readonly size: number;

  private query(strings: TemplateStringsArray): StatementSync {
    if (!Array.isArray(strings) || !Object.hasOwn(strings, 'raw'))
      throw new TypeError('SQLTagStore methods must be used as template tags');
    const key = JSON.stringify([...strings]);
    const existing = this.statements.get(key);
    if (existing) {
      this.statements.delete(key);
      this.statements.set(key, existing);
      return existing;
    }
    const statement = this.db.prepare(strings.join('?'));
    if (this.capacity > 0) {
      this.statements.set(key, statement);
      while (this.statements.size > this.capacity) {
        const first = this.statements.keys().next().value;
        if (first === undefined) break;
        this.release(this.statements.get(first)!);
        this.statements.delete(first);
      }
    }
    return statement;
  }

  private release(statement: StatementSync) {
    kernelCallSync('sqlite.statement.release', statementHandle(statement));
  }

  all(strings: TemplateStringsArray, ...values: SQLInputValue[]): any[] {
    const statement = this.query(strings);
    try {
      return statement.all(...values);
    } finally {
      if (this.capacity <= 0) this.release(statement);
    }
  }

  get(strings: TemplateStringsArray, ...values: SQLInputValue[]): any {
    const statement = this.query(strings);
    try {
      return statement.get(...values);
    } finally {
      if (this.capacity <= 0) this.release(statement);
    }
  }

  run(strings: TemplateStringsArray, ...values: SQLInputValue[]) {
    const statement = this.query(strings);
    try {
      return statement.run(...values);
    } finally {
      if (this.capacity <= 0) this.release(statement);
    }
  }

  iterate(strings: TemplateStringsArray, ...values: SQLInputValue[]): IterableIterator<any> {
    const statement = this.query(strings);
    const { handle } = kernelCallSync(
      'sqlite.statement.iterate',
      statementHandle(statement),
      values,
    );
    return new StatementIterator(
      handle,
      this.capacity <= 0 ? () => this.release(statement) : undefined,
    );
  }

  clear(): void {
    for (const statement of this.statements.values()) this.release(statement);
    this.statements.clear();
  }
}

const limitNames = [
  'length',
  'sqlLength',
  'column',
  'exprDepth',
  'compoundSelect',
  'vdbeOp',
  'functionArg',
  'attach',
  'likePatternLength',
  'variableNumber',
  'triggerDepth',
] as const;

const limits = (handle: number) => {
  const result = Object.create(null);
  for (const name of limitNames)
    Object.defineProperty(result, name, {
      enumerable: true,
      configurable: false,
      get: () => kernelCallSync('sqlite.database.limit.get', handle, name),
      set: (value) => kernelCallSync('sqlite.database.limit.set', handle, name, value),
    });
  return result;
};

export class DatabaseSync {
  declare readonly isOpen: boolean;
  declare readonly isTransaction: boolean;
  declare readonly limits: Record<(typeof limitNames)[number], number>;

  constructor(path: DatabaseLocation, options?: Record<string, any>) {
    const { handle } = kernelCallSync('sqlite.database.create', location(path), options);
    databaseHandles.set(this, handle);
    const databaseLimits = limits(handle);
    Object.defineProperties(this, {
      isOpen: {
        enumerable: true,
        get: () => kernelCallSync('sqlite.database.property', handle, 'isOpen'),
      },
      isTransaction: {
        enumerable: true,
        get: () => kernelCallSync('sqlite.database.property', handle, 'isTransaction'),
      },
      limits: { enumerable: true, get: () => databaseLimits },
    });
  }

  open(): void {
    kernelCallSync('sqlite.database.open', databaseHandle(this));
  }

  close(): void {
    kernelCallSync('sqlite.database.close', databaseHandle(this));
  }

  prepare(sql: string, options?: Record<string, any>): StatementSync {
    const { handle } = kernelCallSync(
      'sqlite.database.prepare',
      databaseHandle(this),
      sql,
      options,
    );
    return new StatementSync(internal, handle);
  }

  exec(sql: string): void {
    kernelCallSync('sqlite.database.exec', databaseHandle(this), sql);
  }

  function(name: string, options: Record<string, any> | Function, fn?: Function): void {
    if (typeof options === 'function') [fn, options] = [options, {}];
    if (typeof fn !== 'function') throw new TypeError('The SQLite function callback is required');
    kernelCallSync(
      'sqlite.database.function',
      databaseHandle(this),
      name,
      options,
      callbackReference(fn),
    );
  }

  aggregate(name: string, options: Record<string, any>): void {
    kernelCallSync(
      'sqlite.database.aggregate',
      databaseHandle(this),
      name,
      callbackOptions(options, ['start', 'step', 'inverse', 'result']),
    );
  }

  setAuthorizer(callback: Function | null): void {
    kernelCallSync(
      'sqlite.database.authorizer',
      databaseHandle(this),
      callback === null ? null : callbackReference(callback),
    );
  }

  createSession(options?: { table?: string; db?: string }): Session {
    const { handle } = kernelCallSync(
      'sqlite.database.createSession',
      databaseHandle(this),
      options,
    );
    return new Session(internal, handle);
  }

  applyChangeset(changeset: Uint8Array, options: Record<string, any> = {}): boolean {
    return kernelCallSync(
      'sqlite.database.applyChangeset',
      databaseHandle(this),
      changeset,
      callbackOptions(options, ['filter', 'onConflict']),
    );
  }

  createTagStore(maxSize = 1000): SQLTagStore {
    return new SQLTagStore(internal, this, maxSize);
  }

  location(databaseName?: string): string | null {
    return kernelCallSync('sqlite.database.location', databaseHandle(this), databaseName);
  }

  enableLoadExtension(allow: boolean): void {
    kernelCallSync('sqlite.database.enableLoadExtension', databaseHandle(this), allow);
  }

  enableDefensive(active: boolean): void {
    kernelCallSync('sqlite.database.enableDefensive', databaseHandle(this), active);
  }

  loadExtension(path: string, entryPoint?: string): void {
    kernelCallSync('sqlite.database.loadExtension', databaseHandle(this), path, entryPoint);
  }

  serialize(databaseName?: string): Uint8Array {
    return kernelCallSync('sqlite.database.serialize', databaseHandle(this), databaseName);
  }

  deserialize(data: Uint8Array, options?: Record<string, any>): void {
    kernelCallSync('sqlite.database.deserialize', databaseHandle(this), data, options);
  }

  [Symbol.dispose](): void {
    kernelCallSync('sqlite.database.dispose', databaseHandle(this));
  }
}

export function backup(
  sourceDb: DatabaseSync,
  path: string | URL,
  options: Record<string, any> = {},
): Promise<number> {
  return kernelCall(
    'sqlite.backup',
    databaseHandle(sourceDb),
    location(path),
    callbackOptions(options, ['progress']),
  );
}

const defineConstants = <T extends Record<string, number>>(values: T): Readonly<T> =>
  Object.defineProperties(
    {},
    Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        { value, enumerable: true, configurable: false, writable: false },
      ]),
    ),
  ) as Readonly<T>;

export const constants = defineConstants({
  SQLITE_CHANGESET_OMIT: 0,
  SQLITE_CHANGESET_REPLACE: 1,
  SQLITE_CHANGESET_ABORT: 2,
  SQLITE_CHANGESET_DATA: 1,
  SQLITE_CHANGESET_NOTFOUND: 2,
  SQLITE_CHANGESET_CONFLICT: 3,
  SQLITE_CHANGESET_CONSTRAINT: 4,
  SQLITE_CHANGESET_FOREIGN_KEY: 5,
  SQLITE_OK: 0,
  SQLITE_DENY: 1,
  SQLITE_IGNORE: 2,
  SQLITE_CREATE_INDEX: 1,
  SQLITE_CREATE_TABLE: 2,
  SQLITE_CREATE_TEMP_INDEX: 3,
  SQLITE_CREATE_TEMP_TABLE: 4,
  SQLITE_CREATE_TEMP_TRIGGER: 5,
  SQLITE_CREATE_TEMP_VIEW: 6,
  SQLITE_CREATE_TRIGGER: 7,
  SQLITE_CREATE_VIEW: 8,
  SQLITE_DELETE: 9,
  SQLITE_DROP_INDEX: 10,
  SQLITE_DROP_TABLE: 11,
  SQLITE_DROP_TEMP_INDEX: 12,
  SQLITE_DROP_TEMP_TABLE: 13,
  SQLITE_DROP_TEMP_TRIGGER: 14,
  SQLITE_DROP_TEMP_VIEW: 15,
  SQLITE_DROP_TRIGGER: 16,
  SQLITE_DROP_VIEW: 17,
  SQLITE_INSERT: 18,
  SQLITE_PRAGMA: 19,
  SQLITE_READ: 20,
  SQLITE_SELECT: 21,
  SQLITE_TRANSACTION: 22,
  SQLITE_UPDATE: 23,
  SQLITE_ATTACH: 24,
  SQLITE_DETACH: 25,
  SQLITE_ALTER_TABLE: 26,
  SQLITE_REINDEX: 27,
  SQLITE_ANALYZE: 28,
  SQLITE_CREATE_VTABLE: 29,
  SQLITE_DROP_VTABLE: 30,
  SQLITE_FUNCTION: 31,
  SQLITE_SAVEPOINT: 32,
  SQLITE_COPY: 0,
  SQLITE_RECURSIVE: 33,
});

for (const constructor of [DatabaseSync, StatementSync, Session, SQLTagStore]) {
  for (const key of [
    ...Object.getOwnPropertyNames(constructor.prototype),
    ...Object.getOwnPropertySymbols(constructor.prototype),
  ]) {
    if (key === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, key)!;
    Object.defineProperty(constructor.prototype, key, { ...descriptor, enumerable: true });
  }
}

export default { DatabaseSync, StatementSync, Session, constants, backup };
