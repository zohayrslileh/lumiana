const values: Record<string, any> = {};

/** Keep the CommonJS constants object stable while adopting the connected host values. */
export function initializeConstants(snapshot: Record<string, any>): void {
  for (const key of Object.keys(values)) delete values[key];
  Object.assign(values, snapshot);
}

export default values;
