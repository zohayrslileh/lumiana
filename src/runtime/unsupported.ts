export function unsupported(module: string, member: string): never {
  throw new Error(
    `Lumiana has no local ${module}.${member} runtime contract yet; the module will not be moved to the server`,
  );
}
