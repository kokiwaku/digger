import { Handle, Position, type NodeProps } from "reactflow";

export type ConceptNodeData = {
  name: string;
  label: string;
  knowledgeCount: number;
  color: string;
  dimmed: boolean;
  highlighted: boolean;
  selected: boolean;
  size: number;
};

// Concept nodeのCustom Node実装。KnowledgeのstatementはラベルにせずConcept名のみを表示する。
// Mapは俯瞰用のUIなので、node内には短縮済みの`label`（最大1〜2行に収まる文字数）だけを表示し、
// フルテキストの`name`はネイティブのtitle属性（hover時のtooltip）でのみ確認できるようにする
// （クリック後の詳細パネルでも全文を確認できる）。
// 階層構造ではTopic（Root/Sub）より一段小さく、Knowledge leafより一段大きい「中間の丸」として
// 描画する（サイズの主基準は階層、Knowledge数はmapLayout.tsのcomputeConceptSize()による
// 小さな補助差にとどまる）。
// hover時のhighlighted/dimmed、クリック後のselectedはUnderstandingMapView側で計算し、
// ここでは見た目に反映するだけ。NEWバッジはKnowledge nodeだけに付け、ここには付けない
// （すべてのnodeにNEWが付くと目立たせたい場所が分からなくなるため）。
export default function ConceptNode({ data }: NodeProps<ConceptNodeData>) {
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
        width: data.size,
        height: data.size,
        borderColor: data.color,
      }}
      title={data.name}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className="concept-node-name">{data.label}</span>
      {data.knowledgeCount > 1 && <span className="concept-node-count">{data.knowledgeCount}件</span>}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
