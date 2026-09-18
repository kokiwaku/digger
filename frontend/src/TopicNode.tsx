import { Handle, Position, type NodeProps } from "reactflow";

export type TopicNodeData = {
  name: string;
  color: string;
  radius: number;
  dimmed: boolean;
  highlighted: boolean;
};

// Topic hub nodeのCustom Node実装。「Topic自体をノード化しない」旧実装では
// Topic->Conceptの親子関係がedgeとして見えず分かりにくかったため、Topicも実体として
// グラフに参加させ、配下のConceptとedgeで直接つながるようにする。
export default function TopicNode({ data }: NodeProps<TopicNodeData>) {
  const size = data.radius * 2;

  return (
    <div
      className={`topic-hub-node${data.highlighted ? " topic-hub-node-highlighted" : ""}${data.dimmed ? " topic-hub-node-dimmed" : ""}`}
      style={{
        width: size,
        height: size,
        borderColor: data.color,
        background: `${data.color}12`,
      }}
      title={data.name}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <span className="topic-hub-node-name" style={{ color: data.color }}>
        {data.name}
      </span>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
