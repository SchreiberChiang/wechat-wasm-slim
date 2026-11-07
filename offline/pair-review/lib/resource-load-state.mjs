// Thin ESM adapter for the unique static ES2016 implementation.
import createResourceLoadStateCore from '../convert/assets/resource-load-state-core.js';
const api=createResourceLoadStateCore();
export const initialResourceLoadState=api.initialResourceLoadState;
export const advanceResourceLoad=api.advanceResourceLoad;
