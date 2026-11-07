// Thin ESM adapter; mobile bundles inject this same state dependency locally.
import createCore from '../convert/assets/resource-scene-command-core.js';
import {advanceResourceLoad} from './resource-load-state.mjs';
const api=createCore({advanceResourceLoad});
export const createResourceSceneCommand=api.createResourceSceneCommand;
