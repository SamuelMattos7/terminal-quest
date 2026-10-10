import type { SkillsResponse } from '@terminal-quest/shared';
import { strings } from '../strings.js';

type Skill = SkillsResponse['skills'][number];

const NODE_W = 150;
const NODE_H = 64;
const COL_GAP = 90;
const ROW_GAP = 36;
const PAD = 20;
const LABEL_H = 28;

export interface GraphNode extends Skill {
  x: number;
  y: number;
}

export interface GraphEdge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  key: string;
}

/** Deterministic layered layout: one column per world, nodes stacked. */
export function layoutSkills(skills: Skill[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const byWorld = new Map<number, Skill[]>();
  for (const skill of skills) {
    const list = byWorld.get(skill.world) ?? [];
    list.push(skill);
    byWorld.set(skill.world, list);
  }
  const orderedWorlds = [...byWorld.keys()].sort((a, b) => a - b);
  const nodes: GraphNode[] = [];
  const centers = new Map<string, { x: number; y: number }>();
  orderedWorlds.forEach((world, col) => {
    const list = (byWorld.get(world) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
    list.forEach((skill, row) => {
      const x = PAD + col * (NODE_W + COL_GAP);
      const y = PAD + LABEL_H + row * (NODE_H + ROW_GAP);
      nodes.push({ ...skill, x, y });
      centers.set(skill.id, { x: x + NODE_W / 2, y: y + NODE_H / 2 });
    });
  });
  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    const to = centers.get(node.id);
    if (to === undefined) {
      continue;
    }
    for (const prereq of node.prereqs) {
      const from = centers.get(prereq);
      if (from === undefined) {
        continue;
      }
      edges.push({ from, to, key: `${prereq}->${node.id}` });
    }
  }
  return { nodes, edges };
}

/** Plain-SVG skill graph grouped by world (plan.md §9.2, no graph lib). */
export function SkillGraph({
  skills,
  worldTitles,
}: {
  skills: Skill[];
  worldTitles: Map<number, string>;
}) {
  const { nodes, edges } = layoutSkills(skills);
  const width = nodes.length === 0 ? 0 : Math.max(...nodes.map((n) => n.x)) + NODE_W + PAD;
  const height = nodes.length === 0 ? 0 : Math.max(...nodes.map((n) => n.y)) + NODE_H + PAD;
  const mastered = nodes.filter((n) => n.masteredAt !== null).length;
  const labels = new Map<number, number>();
  for (const node of nodes) {
    if (!labels.has(node.world)) {
      labels.set(node.world, node.x);
    }
  }

  return (
    <svg
      role="img"
      aria-label={`${skills.length} skills, ${mastered} mastered`}
      data-testid="skill-graph"
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="rounded-lg border border-border bg-panel"
    >
      <defs>
        <marker id="tq-edge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8" fill="none" stroke="#8aa0b5" strokeWidth="1.5" />
        </marker>
      </defs>
      {[...labels.entries()].map(([world, x]) => (
        <text
          key={world}
          x={x + NODE_W / 2}
          y={PAD}
          textAnchor="middle"
          fill="#5ccfe6"
          fontSize="12"
          fontFamily="'JetBrains Mono', monospace"
        >
          {worldTitles.get(world) ?? `World ${world}`}
        </text>
      ))}
      {edges.map((edge) => (
        <line
          key={edge.key}
          x1={edge.from.x + NODE_W / 2}
          y1={edge.from.y}
          x2={edge.to.x - NODE_W / 2}
          y2={edge.to.y}
          stroke="#8aa0b5"
          strokeWidth="1.5"
          markerEnd="url(#tq-edge-arrow)"
          data-testid={`edge-${edge.key}`}
        />
      ))}
      {nodes.map((node) => {
        const isMastered = node.masteredAt !== null;
        return (
          <g key={node.id} data-testid={`skill-node-${node.id}`}>
            <title>{`${node.title} — ${node.uses} ${strings.skillsUses}${
              isMastered ? ` — ${strings.skillsMastered}` : ''
            }${
              node.prereqs.length > 0
                ? ` — ${strings.skillsPrereqs}: ${node.prereqs.join(', ')}`
                : ''
            }`}</title>
            <rect
              x={node.x}
              y={node.y}
              width={NODE_W}
              height={NODE_H}
              rx="8"
              fill="#11171e"
              stroke={isMastered ? '#3ddc84' : '#243040'}
              strokeWidth={isMastered ? 2.5 : 1.5}
              style={isMastered ? { filter: 'drop-shadow(0 0 6px #3ddc84)' } : undefined}
            />
            <text
              x={node.x + NODE_W / 2}
              y={node.y + 26}
              textAnchor="middle"
              fill="#d7e0ea"
              fontSize="12"
              fontFamily="'JetBrains Mono', monospace"
            >
              {node.title.length > 20 ? `${node.title.slice(0, 19)}…` : node.title}
            </text>
            <text
              x={node.x + NODE_W / 2}
              y={node.y + 46}
              textAnchor="middle"
              fill={isMastered ? '#3ddc84' : '#8aa0b5'}
              fontSize="11"
            >
              {isMastered ? strings.skillsMastered : `${node.uses} ${strings.skillsUses}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
