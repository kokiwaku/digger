import { Handle, Position, type NodeProps } from "reactflow";

export type TopicNodeVariant = "root" | "sub";

export type TopicNodeData = {
  name: string;
  variant: TopicNodeVariant;
  color: string;
  size: number;
  dimmed: boolean;
  highlighted: boolean;
};

// Root TopicとSubtopicは役割は違うが見た目の作りは共通（円形・塗りつぶし）なので
// 1つのコンポーネントで扱う。ConceptやKnowledgeとは明確に見た目を変え（後述の
// ConceptNode/KnowledgeNode参照）、Root TopicはSubtopicより一段強い塗り・太い枠にして
// 「最も大きい・強い」という階層の頂点であることを視覚的に示す。
export default function TopicNode({ data }: NodeProps<TopicNodeData>) {
  const isRoot = data.variant === "root";
  const classNames = [
    "topic-hierarchy-node",
    isRoot ? "topic-hierarchy-node-root" : "topic-hierarchy-node-sub",
    data.highlighted && "topic-hierarchy-node-highlighted",
    data.dimmed && "topic-hierarchy-node-dimmed",
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
        background: isRoot ? `${data.color}26` : `${data.color}14`,
      }}
      title={data.name}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className="topic-hierarchy-node-name">{data.name}</span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
