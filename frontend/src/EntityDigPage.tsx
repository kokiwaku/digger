import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ConceptRelation, SavedKnowledge, Topic, UnderstandingConcept } from "./types";
import { buildConceptDigContext, buildTopicDigContext, type EntityDigContext } from "./digOrigin";
import DeepDiveSession, { MoleLoader } from "./DeepDiveSession";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type MapData = { topics: Topic[]; concepts: UnderstandingConcept[]; relations: ConceptRelation[] };

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not_found" }
  | ({ status: "success" } & EntityDigContext);

// Understanding Mapから「掘る」で遷移してきたとき、Map側の絞り込み状態（Topicフィルタ・
// 選択中Concept）を持ち越し、「理解マップへ戻る」を押したときに元の場所へ戻れるようにする。
// react-router-domのnavigate stateを使い、直接URLアクセス・リロードで失われても
// （その場合は単に「すべて」に戻るだけで）壊れないようにしている。
type NavigationState = { returnTopicId?: string | null } | null;

async function fetchMapData(): Promise<MapData> {
  const res = await fetch(`${API_BASE_URL}/api/understanding-map`);
  if (!res.ok) throw new Error(`理解マップの取得に失敗しました (HTTP ${res.status})`);
  const body = await res.json().catch(() => null);
  return { topics: body?.topics ?? [], concepts: body?.concepts ?? [], relations: body?.relations ?? [] };
}

async function fetchKnowledge(): Promise<SavedKnowledge[]> {
  const res = await fetch(`${API_BASE_URL}/api/knowledge`);
  if (!res.ok) throw new Error(`保存済みの理解の取得に失敗しました (HTTP ${res.status})`);
  const body = await res.json().catch(() => null);
  return body?.knowledge ?? [];
}

function BackToMapButton({ returnTopicId, conceptId }: { returnTopicId?: string | null; conceptId?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="link-button entity-dig-back"
      onClick={() =>
        navigate("/understanding/map", {
          state: { restoreTopicId: returnTopicId ?? null, restoreConceptId: conceptId ?? null },
        })
      }
    >
      ← 理解マップへ戻る
    </button>
  );
}

// ConceptDigPage / TopicDigPageで共通の「データ取得→Context構築→DeepDiveSession描画」の
// 流れをまとめたもの。直接URLアクセス・リロードでも動作するよう、propsで受け取るのではなく
// このコンポーネント自身がGET /api/understanding-map・GET /api/knowledgeを取得する
// （UnderstandingMapView.tsxがメモリ上に持つデータには依存しない）。
function EntityDigScreen({
  entityId,
  buildContext,
}: {
  entityId: string;
  buildContext: (data: MapData, knowledge: SavedKnowledge[]) => EntityDigContext | null;
}) {
  const location = useLocation();
  const navState = (location.state ?? null) as NavigationState;
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    Promise.all([fetchMapData(), fetchKnowledge()])
      .then(([mapData, knowledge]) => {
        if (cancelled) return;
        const context = buildContext(mapData, knowledge);
        if (!context) {
          setState({ status: "not_found" });
          return;
        }
        setState({ status: "success", ...context });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : "取得に失敗しました" });
        }
      });
    return () => {
      cancelled = true;
    };
    // entityIdが変わったら（別のConcept/Topicへ「掘る」し直した場合）取得し直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  if (state.status === "loading") {
    return (
      <div className="dig-page-inner">
        <MoleLoader label="理解を思い出しています…" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="dig-page-inner">
        <p className="error-message">エラー: {state.message}</p>
        <BackToMapButton returnTopicId={navState?.returnTopicId} />
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <div className="dig-page-inner">
        <p className="error-message">対象のConcept/Topicが見つかりませんでした（削除された可能性があります）。</p>
        <BackToMapButton returnTopicId={navState?.returnTopicId} />
      </div>
    );
  }

  return (
    <div className="dig-page-inner">
      <DeepDiveSession
        analysis={state.analysis}
        source={state.source}
        heading={state.heading}
        introMessage={state.introMessage}
        headerExtra={
          <BackToMapButton
            returnTopicId={navState?.returnTopicId}
            conceptId={state.source.type === "concept_dig" ? state.source.conceptId : undefined}
          />
        }
      />
    </div>
  );
}

export function ConceptDigPage() {
  const { conceptId } = useParams<{ conceptId: string }>();
  const buildContext = useMemo(
    () =>
      (data: MapData, knowledge: SavedKnowledge[]): EntityDigContext | null => {
        const concept = data.concepts.find((c) => c._id === conceptId && c.status === "active");
        if (!concept) return null;
        return buildConceptDigContext(concept, data.topics, data.concepts, data.relations, knowledge);
      },
    [conceptId],
  );
  if (!conceptId) return null;
  return <EntityDigScreen entityId={conceptId} buildContext={buildContext} />;
}

export function TopicDigPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const buildContext = useMemo(
    () =>
      (data: MapData, knowledge: SavedKnowledge[]): EntityDigContext | null => {
        const topic = data.topics.find((t) => t._id === topicId && t.status === "active");
        if (!topic) return null;
        return buildTopicDigContext(topic, data.topics, data.concepts, knowledge);
      },
    [topicId],
  );
  if (!topicId) return null;
  return <EntityDigScreen entityId={topicId} buildContext={buildContext} />;
}
