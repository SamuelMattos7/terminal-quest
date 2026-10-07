// Static world catalog (plan.md §11.2). Levels attach from the loader;
// worlds without content yet simply list no levels.

export interface WorldInfo {
  id: number;
  title: string;
  blurb: string;
}

export const WORLDS: WorldInfo[] = [
  {
    id: 1,
    title: 'The Lobby',
    blurb: 'New hire orientation: terminal basics, files, and the manual.',
  },
  {
    id: 2,
    title: 'The Filing Room',
    blurb: 'Find anything: search, pipes, text surgery, and permissions.',
  },
  {
    id: 3,
    title: 'The Engine Room',
    blurb: 'Power tools: users, processes, archives, and the network.',
  },
  {
    id: 4,
    title: 'The Automation Lab',
    blurb: 'Stop clicking: scripts, sed, awk, cron, and SERVICES.',
  },
  {
    id: 5,
    title: 'The War Room',
    blurb: 'Production is on fire: debug it like a senior engineer.',
  },
];
