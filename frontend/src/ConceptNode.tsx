import { Handle, Position, type NodeProps } from "reactflow";

export type ConceptNodeData = {
  name: string;
  label: string;
  knowledgeCount: number;
  color: string;
  isNew: boolean;
  dimmed: boolean;
  highlighted: boolean;
  selected: boolean;
  radius: number;
};

// Concept nodeのCustom Node実装。KnowledgeのstatementはラベルにせずConcept名のみを表示する。
// Mapは俯瞰用のUIなので、node内には短縮済みの`label`（最大1〜2行に収まる文字数）だけを表示し、
// フルテキストの`name`はネイティブのtitle属性（hover時のtooltip）でのみ確認できるようにする
// （クリック後の詳細パネルでも全文を確認できる）。
// hover時のhighlighted/dimmed、クリック後のselectedはUnderstandingMapView側で計算し、
// ここでは見た目に反映するだけ。
export default function ConceptNode({ data }: NodeProps<ConceptNodeData>) {
  const size = data.radius * 2;

  const classNames = [
    "concept-node",
    data.highlighted && "concept-node-highlighted",
    data.dimmed && "concept-node-dimmed",
    data.selected && "concept-node-selected",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classNames}
      style={{
        width: size,
        height: size,
        borderColor: data.color,
      }}
      title={data.name}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {data.isNew && <span className="concept-node-badge">NEW</span>}
      <span className="concept-node-name">{data.label}</span>
      {data.knowledgeCount > 1 && <span className="concept-node-count">{data.knowledgeCount}件</span>}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
