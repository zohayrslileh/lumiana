import { System } from '@phreshos/node';

const system = await System.connect();

console.log(await system.program.list());
