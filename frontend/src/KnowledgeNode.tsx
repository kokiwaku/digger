import { Handle, Position, type NodeProps } from "reactflow";

export type KnowledgeNodeData = {
  label: string;
  fullText: string;
  isNew: boolean;
  color: string;
  dimmed: boolean;
  highlighted: boolean;
};

// Map上の最終的なleaf。Knowledge本文（statement）全文を表示するとMapが読みにくくなるため、
// 1〜2行に短縮したタイトルだけを角丸カード（pill）で表示する。フルテキストはtitle属性
// （hover tooltip）と、クリック後の右Detail Panelで確認できる。
// 丸nodeにはせず、Root Topic/Subtopic/Conceptの「丸＝階層nodeの実体」という見た目とは
// はっきり区別する。NEWバッジはMap全体で使いすぎると目立たなくなるため、このleafだけに
// （直近7日以内に追加されたKnowledgeだけに）付ける。
export default function KnowledgeNode({ data }: NodeProps<KnowledgeNodeData>) {
  const classNames = [
    "knowledge-leaf-node",
    data.highlighted && "knowledge-leaf-node-highlighted",
    data.dimmed && "knowledge-leaf-node-dimmed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} style={{ borderColor: data.color }} title={data.fullText}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      {data.isNew && <span className="knowledge-leaf-node-badge">NEW</span>}
      <span className="knowledge-leaf-node-label">{data.label}</span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
