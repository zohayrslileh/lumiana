import * as native from 'node:sqlite';
import type { NativeCallbacks } from './callbacks.js';

type Database = InstanceType<typeof native.DatabaseSync>;
type Statement = ReturnType<Database['prepare']>;
type Session = ReturnType<Database['createSession']>;
type Iterator = ReturnType<Statement['iterate']>;

interface CallbackReference {
  id: number;
  length: number;
}

const callback = (callbacks: NativeCallbacks, reference: CallbackReference) => {
  const invoke = (...args: any[]) => callbacks.sync(reference.id, args);
  Object.defineProperty(invoke, 'length', { value: reference.length });
  return invoke;
};

/** Per-connection ownership of SQLite's native database, statement and session resources. */
export class SQLiteKernel {
  private databases = new Map<number, Database>();
  private statements = new Map<number, Statement>();
  private sessions = new Map<number, Session>();
  private iterators = new Map<number, Iterator>();

  constructor(
    private allocate: () => number,
    private callbacks: NativeCallbacks,
  ) {}

  private database(handle: number): Database {
    const value = this.databases.get(handle);
    if (!value) throw new ReferenceError(`Unknown SQLite database handle ${handle}`);
    return value;
  }

  private statement(handle: number): Statement {
    const value = this.statements.get(handle);
    if (!value) throw new ReferenceError(`Unknown SQLite statement handle ${handle}`);
    return value;
  }

  private session(handle: number): Session {
    const value = this.sessions.get(handle);
    if (!value) throw new ReferenceError(`Unknown SQLite session handle ${handle}`);
    return value;
  }

  private iterator(handle: number): Iterator {
    const value = this.iterators.get(handle);
    if (!value) throw new ReferenceError(`Unknown SQLite iterator handle ${handle}`);
    return value;
  }

  close(): void {
    for (const iterator of this.iterators.values()) {
      try {
        iterator.return?.();
      } catch {}
    }
    for (const session of this.sessions.values()) {
      try {
        session.close();
      } catch {}
    }
    for (const database of this.databases.values()) {
      try {
        if (database.isOpen) database.close();
      } catch {}
    }
    this.iterators.clear();
    this.statements.clear();
    this.sessions.clear();
    this.databases.clear();
  }

  async execute(operation: string, args: any[]): Promise<any> {
    if (operation !== 'sqlite.backup') return this.executeSync(operation, args);
    const [handle, destinationInput, input = {}] = args;
    const destination = destinationInput?.url ? new URL(destinationInput.url) : destinationInput;
    const options = { ...input };
    let progress = Promise.resolve();
    if (options.progress && typeof options.progress.id === 'number') {
      const id = options.progress.id;
      options.progress = (state: any) => {
        progress = progress.then(() => this.callbacks.async(id, [state]));
      };
    }
    const pages = await native.backup(this.database(handle), destination, options);
    await progress;
    return pages;
  }

  executeSync(operation: string, args: any[]): any {
    switch (operation) {
      case 'sqlite.database.create': {
        const handle = this.allocate();
        const location = args[0]?.url ? new URL(args[0].url) : args[0];
        this.databases.set(
          handle,
          args[1] === undefined
            ? new native.DatabaseSync(location)
            : new native.DatabaseSync(location, args[1]),
        );
        return { handle };
      }
      case 'sqlite.database.open':
        return this.database(args[0]).open();
      case 'sqlite.database.close':
        return this.database(args[0]).close();
      case 'sqlite.database.dispose':
        return this.database(args[0])[Symbol.dispose]();
      case 'sqlite.database.property':
        return (this.database(args[0]) as any)[args[1]];
      case 'sqlite.database.location':
        return args[1] === undefined
          ? this.database(args[0]).location()
          : this.database(args[0]).location(args[1]);
      case 'sqlite.database.exec':
        return this.database(args[0]).exec(args[1]);
      case 'sqlite.database.prepare': {
        const statement =
          args[2] === undefined
            ? this.database(args[0]).prepare(args[1])
            : (this.database(args[0]).prepare as any)(args[1], args[2]);
        const handle = this.allocate();
        this.statements.set(handle, statement);
        return { handle };
      }
      case 'sqlite.database.function': {
        const [handle, name, options, id] = args;
        return this.database(handle).function(name, options, callback(this.callbacks, id));
      }
      case 'sqlite.database.aggregate': {
        const [handle, name, input] = args;
        const options = { ...input };
        for (const key of ['start', 'step', 'inverse', 'result'] as const)
          if (options[key] && typeof options[key].id === 'number')
            options[key] = callback(this.callbacks, options[key]);
        return this.database(handle).aggregate(name, options);
      }
      case 'sqlite.database.authorizer':
        return this.database(args[0]).setAuthorizer(
          args[1] === null ? null : callback(this.callbacks, args[1]),
        );
      case 'sqlite.database.applyChangeset': {
        const [handle, changeset, input = {}] = args;
        const options = { ...input };
        for (const key of ['filter', 'onConflict'] as const)
          if (options[key] && typeof options[key].id === 'number')
            options[key] = callback(this.callbacks, options[key]);
        return this.database(handle).applyChangeset(changeset, options);
      }
      case 'sqlite.database.createSession': {
        const session =
          args[1] === undefined
            ? this.database(args[0]).createSession()
            : this.database(args[0]).createSession(args[1]);
        const handle = this.allocate();
        this.sessions.set(handle, session);
        return { handle };
      }
      case 'sqlite.database.enableLoadExtension':
        return this.database(args[0]).enableLoadExtension(args[1]);
      case 'sqlite.database.enableDefensive':
        return this.database(args[0]).enableDefensive(args[1]);
      case 'sqlite.database.loadExtension':
        return args[2] === undefined
          ? this.database(args[0]).loadExtension(args[1])
          : this.database(args[0]).loadExtension(args[1], args[2]);
      case 'sqlite.database.serialize':
        return args[1] === undefined
          ? this.database(args[0]).serialize()
          : this.database(args[0]).serialize(args[1]);
      case 'sqlite.database.deserialize':
        return args[2] === undefined
          ? this.database(args[0]).deserialize(args[1])
          : this.database(args[0]).deserialize(args[1], args[2]);
      case 'sqlite.database.limit.get':
        return (this.database(args[0]).limits as any)[args[1]];
      case 'sqlite.database.limit.set':
        return ((this.database(args[0]).limits as any)[args[1]] = args[2]);
      case 'sqlite.statement.property':
        return (this.statement(args[0]) as any)[args[1]];
      case 'sqlite.statement.call': {
        const [handle, method, values] = args;
        if (!['all', 'get', 'run', 'columns'].includes(method))
          throw new TypeError(`Unknown SQLite statement method ${method}`);
        return (this.statement(handle) as any)[method](...values);
      }
      case 'sqlite.statement.configure': {
        const [handle, method, value] = args;
        if (
          ![
            'setAllowBareNamedParameters',
            'setAllowUnknownNamedParameters',
            'setReadBigInts',
            'setReturnArrays',
          ].includes(method)
        )
          throw new TypeError(`Unknown SQLite statement setting ${method}`);
        return (this.statement(handle) as any)[method](value);
      }
      case 'sqlite.statement.iterate': {
        const iterator = this.statement(args[0]).iterate(...args[1]);
        const handle = this.allocate();
        this.iterators.set(handle, iterator);
        return { handle };
      }
      case 'sqlite.statement.release':
        this.statements.delete(args[0]);
        return undefined;
      case 'sqlite.iterator.next': {
        const result = this.iterator(args[0]).next();
        if (result.done) this.iterators.delete(args[0]);
        return result;
      }
      case 'sqlite.iterator.return': {
        const iterator = this.iterator(args[0]);
        this.iterators.delete(args[0]);
        return iterator.return?.() ?? { done: true, value: undefined };
      }
      case 'sqlite.session.changeset':
        return this.session(args[0]).changeset();
      case 'sqlite.session.patchset':
        return this.session(args[0]).patchset();
      case 'sqlite.session.close':
        return this.session(args[0]).close();
      case 'sqlite.session.dispose':
        return this.session(args[0])[Symbol.dispose]();
      default:
        throw new TypeError(`Unknown SQLite operation ${operation}`);
    }
  }
}
