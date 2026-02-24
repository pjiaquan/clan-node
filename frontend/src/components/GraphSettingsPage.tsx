import React, { useEffect, useState } from 'react';
import type { AuthUser } from '../types';
import {
  DEFAULT_GRAPH_SETTINGS,
  normalizeGraphSettings,
  type GraphSettings,
} from '../graphSettings';

type GraphSettingsPageProps = {
  currentUser: AuthUser;
  settings: GraphSettings;
  onSave: (settings: GraphSettings) => void;
  onBack: () => void;
  onLogout: () => Promise<void> | void;
};

type FieldSpec = {
  key: keyof GraphSettings;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
};

const SPACING_FIELDS: FieldSpec[] = [
  {
    key: 'repelGap',
    label: '防重叠间距',
    hint: '拖拽后自动避让的节点最小间距（px）',
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: 'spouseGap',
    label: '配偶吸附间距',
    hint: '夫妻节点吸附时保留的水平间距（px）',
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: 'expandShiftStepX',
    label: '展开偏移 X',
    hint: '展开折叠分支时，避开重叠的 X 方向步长（px）',
    min: 20,
    max: 1200,
    step: 5,
  },
  {
    key: 'expandShiftStepY',
    label: '展开偏移 Y',
    hint: '展开折叠分支时，避开重叠的 Y 方向步长（px）',
    min: 20,
    max: 1200,
    step: 5,
  },
  {
    key: 'initialOrbitBaseRadius',
    label: '初始半径',
    hint: '没有历史坐标时，围绕中心的初始半径（px）',
    min: 40,
    max: 1600,
    step: 10,
  },
  {
    key: 'initialOrbitStepRadius',
    label: '半径增量',
    hint: '初始摆放时，每个节点递增的半径（px）',
    min: 0,
    max: 500,
    step: 2,
  },
];

const SNAP_FIELDS: FieldSpec[] = [
  {
    key: 'ySnapThreshold',
    label: 'Y 吸附阈值',
    hint: '拖拽时进入水平对齐吸附的阈值（px）',
    min: 4,
    max: 200,
    step: 1,
  },
  {
    key: 'yReleaseThreshold',
    label: 'Y 释放阈值',
    hint: '拖拽离开水平吸附状态需要的阈值（px）',
    min: 4,
    max: 220,
    step: 1,
  },
  {
    key: 'xSnapThreshold',
    label: 'X 吸附阈值',
    hint: '拖拽时进入垂直对齐吸附的阈值（px）',
    min: 4,
    max: 200,
    step: 1,
  },
  {
    key: 'xReleaseThreshold',
    label: 'X 释放阈值',
    hint: '拖拽离开垂直吸附状态需要的阈值（px）',
    min: 4,
    max: 220,
    step: 1,
  },
  {
    key: 'spouseSnapThreshold',
    label: '夫妻吸附阈值',
    hint: '拖拽到配偶附近时自动对齐的阈值（px）',
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: 'spouseReleaseThreshold',
    label: '夫妻释放阈值',
    hint: '离开夫妻吸附状态需要的阈值（px）',
    min: 0,
    max: 260,
    step: 1,
  },
];

const AUTO_LINK_FIELDS: FieldSpec[] = [
  {
    key: 'minDragDistanceForAutoLink',
    label: '最小拖拽距离',
    hint: '超过该距离才触发自动连线判断（px）',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'nearGapXThreshold',
    label: '近距离 X 阈值',
    hint: '自动连线时横向邻近判定阈值（px）',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'nearCenterYThreshold',
    label: '中心 Y 阈值',
    hint: '自动连线时纵向中心对齐判定阈值（px）',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'autoSpouseMinOverlapRatio',
    label: '最小重叠比例',
    hint: '自动配偶连线的最小重叠面积比例（0~1）',
    min: 0.05,
    max: 1,
    step: 0.01,
  },
  {
    key: 'autoSpouseMinVerticalOverlapRatio',
    label: '最小纵向重叠比例',
    hint: '自动配偶连线的最小纵向重叠比例（0~1）',
    min: 0.05,
    max: 1,
    step: 0.01,
  },
];

const renderField = (
  field: FieldSpec,
  draft: GraphSettings,
  onNumberChange: (key: keyof GraphSettings, value: string) => void
) => (
  <label className="graph-settings-field" key={field.key}>
    <span className="graph-settings-field-label">{field.label}</span>
    <input
      className="graph-settings-input"
      type="number"
      min={field.min}
      max={field.max}
      step={field.step}
      value={draft[field.key]}
      onChange={(event) => onNumberChange(field.key, event.target.value)}
    />
    <small>{field.hint}</small>
  </label>
);

export const GraphSettingsPage: React.FC<GraphSettingsPageProps> = ({
  currentUser,
  settings,
  onSave,
  onBack,
  onLogout,
}) => {
  const [draft, setDraft] = useState<GraphSettings>(() => normalizeGraphSettings(settings));

  useEffect(() => {
    setDraft(normalizeGraphSettings(settings));
  }, [settings]);

  const onNumberChange = (key: keyof GraphSettings, value: string) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    setDraft((prev) => ({
      ...prev,
      [key]: next,
    }));
  };

  const handleSave = () => {
    onSave(normalizeGraphSettings(draft));
  };

  const handleReset = () => {
    setDraft(DEFAULT_GRAPH_SETTINGS);
  };

  return (
    <div className="graph-settings-page">
      <header className="graph-settings-header">
        <div className="graph-settings-header-left">
          <button type="button" className="graph-settings-btn ghost" onClick={onBack}>
            返回族谱
          </button>
          <div>
            <h1>图形设置</h1>
            <p>保存后将自动应用到节点拖拽、吸附和自动连线</p>
          </div>
        </div>
        <div className="graph-settings-header-right">
          <span className="graph-settings-user-chip">{currentUser.username}</span>
          <button type="button" className="graph-settings-btn ghost" onClick={onLogout}>
            登出
          </button>
        </div>
      </header>

      <main className="graph-settings-main">
        <section className="graph-settings-panel">
          <h2>节点间距</h2>
          <div className="graph-settings-grid">
            {SPACING_FIELDS.map((field) => renderField(field, draft, onNumberChange))}
          </div>
        </section>

        <section className="graph-settings-panel">
          <h2>粘性参数</h2>
          <div className="graph-settings-grid">
            {SNAP_FIELDS.map((field) => renderField(field, draft, onNumberChange))}
          </div>
        </section>

        <section className="graph-settings-panel">
          <h2>自动连线</h2>
          <div className="graph-settings-grid">
            {AUTO_LINK_FIELDS.map((field) => renderField(field, draft, onNumberChange))}
          </div>
        </section>

        <section className="graph-settings-actions">
          <button type="button" className="graph-settings-btn secondary" onClick={handleReset}>
            恢复默认
          </button>
          <button type="button" className="graph-settings-btn primary" onClick={handleSave}>
            保存并应用
          </button>
        </section>
      </main>
    </div>
  );
};
