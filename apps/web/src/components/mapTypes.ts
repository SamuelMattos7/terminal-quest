import type { WorldsResponse } from '@terminal-quest/shared';

export type MapWorld = WorldsResponse['worlds'][number];
export type MapLevel = MapWorld['levels'][number];
