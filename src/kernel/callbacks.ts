export interface NativeCallbacks {
  sync: (id: number, args: any[]) => any;
  async: (id: number, args: any[]) => Promise<any>;
}
