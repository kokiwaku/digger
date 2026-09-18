import type { NodeProps } from "reactflow";

export type TopicNodeData = {
  name: string;
  color: string;
  dimmed: boolean;
  highlighted: boolean;
};

// TopicはMap上のConcept nodeと同格の丸ノードにはしない。「背景cluster / group label /
// filter」としてだけ機能する、控えめな浮遊ラベルとして描画する（重いボックスやedgeは持たない。
// クリックするとそのクラスタでTopicフィルタを適用できる = navigationとしての役割）。
// 位置はmapLayout.tsのcomputeClusterLabelAnchors()が計算したクラスタ上端中央のアンカーで、
// CSS側でtranslate(-50%, -100%)して「そのクラスタの真上」に浮くようにする。
export default function TopicNode({ data }: NodeProps<TopicNodeData>) {
  const classNames = [
    "topic-cluster-label",
    data.highlighted && "topic-cluster-label-highlighted",
    data.dimmed && "topic-cluster-label-dimmed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} style={{ color: data.color, borderColor: `${data.color}55` }} title={data.name}>
      {data.name}
    </div>
  );
}
