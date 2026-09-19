import type { NodeProps } from "reactflow";

export type ClusterHaloNodeData = { color: string };

// Root Topicごとの「島」の領域を、なんとなく見える程度の薄い背景として示すための
// 非インタラクティブなnode（#12）。大きな枠線で囲むのではなく、中心が少し色づいて
// 外側にいくほど透明になるradial gradientにとどめる。クリック・ドラッグ・選択の
// 対象にはしない（UnderstandingMapView.tsx側でdraggable/selectable: falseを指定）。
export default function ClusterHaloNode({ data }: NodeProps<ClusterHaloNodeData>) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "9999px",
        background: `radial-gradient(circle, ${data.color}12 0%, ${data.color}00 70%)`,
        pointerEvents: "none",
      }}
    />
  );
}
