import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { layoutSkills, SkillGraph } from './SkillGraph.js';

const skills = [
  { id: 'pwd', title: 'pwd', group: 'navigation', world: 1, prereqs: [], uses: 3, masteredAt: 9 },
  { id: 'ls', title: 'ls', group: 'navigation', world: 1, prereqs: [], uses: 1, masteredAt: null },
  {
    id: 'grep',
    title: 'grep',
    group: 'search',
    world: 2,
    prereqs: ['pwd'],
    uses: 0,
    masteredAt: null,
  },
  {
    id: 'orphan',
    title: 'orphan',
    group: 'search',
    world: 2,
    prereqs: ['missing-skill'],
    uses: 0,
    masteredAt: null,
  },
];

describe('layoutSkills', () => {
  it('columns worlds and links known prereqs only', () => {
    const { nodes, edges } = layoutSkills(skills);
    expect(nodes).toHaveLength(4);
    const worlds = new Set(nodes.map((n) => n.world));
    expect(worlds).toEqual(new Set([1, 2]));
    // Same column for same world, second column further right.
    const pwd = nodes.find((n) => n.id === 'pwd');
    const grep = nodes.find((n) => n.id === 'grep');
    expect(pwd?.x).toBeLessThan(grep?.x ?? 0);
    expect(edges.map((e) => e.key)).toEqual(['pwd->grep']);
  });

  it('handles an empty skill list', () => {
    expect(layoutSkills([])).toEqual({ nodes: [], edges: [] });
  });
});

describe('SkillGraph', () => {
  it('renders nodes, edges, world labels, and mastery state', () => {
    render(<SkillGraph skills={skills} worldTitles={new Map([[1, 'The Lobby']])} />);
    expect(screen.getByTestId('skill-graph')).not.toBeNull();
    expect(screen.getByTestId('skill-node-pwd')).not.toBeNull();
    expect(screen.getByTestId('edge-pwd->grep')).not.toBeNull();
    expect(screen.queryByTestId('edge-missing-skill->orphan')).toBeNull();
    expect(screen.getByText('The Lobby')).not.toBeNull();
    expect(screen.getByText('World 2')).not.toBeNull();
    expect(screen.getByLabelText('4 skills, 1 mastered')).not.toBeNull();
  });
});
