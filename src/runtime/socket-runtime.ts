import { kernelCall, kernelSubscribe, kernelCallSync } from './bridge.js';
import { createNetwork } from './network.js';

export const network = createNetwork(kernelCall, kernelSubscribe, kernelCallSync);
