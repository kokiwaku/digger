import { Handle, Position, type NodeProps } from "reactflow";

export type ConceptNodeData = {
  name: string;
  knowledgeCount: number;
  color: string;
  isNew: boolean;
  dimmed: boolean;
  highlighted: boolean;
  radius: number;
};

// Concept nodeのCustom Node実装。KnowledgeのstatementはラベルにせずConcept名のみを表示する。
// hover時のhighlighted/dimmedはUnderstandingMapView側で計算し、ここでは見た目に反映するだけ。
export default function ConceptNode({ data }: NodeProps<ConceptNodeData>) {
  const size = data.radius * 2;

  return (
    <div
      className={`concept-node${data.highlighted ? " concept-node-highlighted" : ""}${data.dimmed ? " concept-node-dimmed" : ""}`}
      style={{
        width: size,
        height: size,
        borderColor: data.color,
      }}
      title={data.name}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {data.isNew && <span className="concept-node-badge">NEW</span>}
      <span className="concept-node-name">{data.name}</span>
      {data.knowledgeCount > 0 && <span className="concept-node-count">{data.knowledgeCount} knowledge</span>}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
