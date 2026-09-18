import { Handle, Position, type NodeProps } from "reactflow";

export type KnowledgeNodeData = {
  label: string;
  fullText: string;
  isNew: boolean;
  color: string;
  dimmed: boolean;
  highlighted: boolean;
  selected: boolean;
};

// Map上の最終的なleaf。「Mapは内容を読む場所ではなく理解構造を見る場所」という方針のため、
// Knowledge本文（statement）は表示せず、小さなdot＋ごく短いcaptionだけにする
// （Root Topic/Subtopic/Conceptの「丸＝階層nodeの実体」とは違う、最小の末端であることが
// 一目で分かるように）。フルテキストはtitle属性（hover tooltip）と、クリック後の右
// Detail Panelで確認する。NEWバッジはMap全体で使いすぎると目立たなくなるため、このleafだけに
// （直近7日以内に追加されたKnowledgeだけに）小さな印として付ける。
export default function KnowledgeNode({ data }: NodeProps<KnowledgeNodeData>) {
  const classNames = [
    "knowledge-leaf-node",
    data.highlighted && "knowledge-leaf-node-highlighted",
    data.dimmed && "knowledge-leaf-node-dimmed",
    data.selected && "knowledge-leaf-node-selected",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} title={data.fullText}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className="knowledge-leaf-dot" style={{ background: data.color }}>
        {data.isNew && <span className="knowledge-leaf-dot-new" aria-hidden="true" />}
      </span>
      <span className="knowledge-leaf-caption">{data.label}</span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
