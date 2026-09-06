import { kernelCall, kernelSubscribe } from './bridge.js';
import { createNetwork } from './network.js';

export const network = createNetwork(kernelCall, kernelSubscribe);
