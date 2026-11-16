import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  Code2,
  GitBranchPlus,
  Plus,
  Trash2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  DEFAULT_FLOWCHART_MODEL,
  detectDiagramLabel,
  DIAGRAM_TEMPLATES,
  FlowchartDirection,
  FlowchartEdge,
  FlowchartEdgeStyle,
  FlowchartModel,
  FlowchartNode,
  FlowchartShape,
  parseMermaidToFlowchart,
  renderMermaidSvg,
  serializeFlowchartToMermaid,
} from '../utils/mermaidRenderer';

interface DiagramBuilderModalProps {
  isOpen: boolean;
  mode: 'insert' | 'edit';
  initialCode?: string;
  onClose: () => void;
  onSave: (mermaidCode: string) => void;
}

const SHAPE_OPTIONS: Array<{ value: FlowchartShape; label: string }> = [
  { value: 'process', label: 'Process' },
  { value: 'rounded', label: 'Start / End' },
  { value: 'decision', label: 'Decision' },
  { value: 'database', label: 'Database' },
  { value: 'circle', label: 'Circle' },
];

const EDGE_STYLE_OPTIONS: Array<{ value: FlowchartEdgeStyle; label: string }> = [
  { value: 'solid', label: 'Solid -->' },
  { value: 'dashed', label: 'Dashed -.->' },
  { value: 'thick', label: 'Thick ==>' },
];

function cloneModel(model: FlowchartModel): FlowchartModel {
  return {
    direction: model.direction,
    nodes: model.nodes.map((n) => ({ ...n })),
    edges: model.edges.map((e) => ({ ...e })),
  };
}

function nextNodeId(nodes: FlowchartNode[]): string {
  const existing = new Set(nodes.map((n) => n.id));
  let counter = nodes.length + 1;
  while (existing.has(`N${counter}`)) {
    counter += 1;
  }
  return `N${counter}`;
}

function nextEdgeId(edges: FlowchartEdge[]): string {
  const existing = new Set(edges.map((e) => e.id));
  let counter = edges.length + 1;
  while (existing.has(`E${counter}`)) {
    counter += 1;
  }
  return `E${counter}`;
}

export function DiagramBuilderModal({
  isOpen,
  mode,
  initialCode,
  onClose,
  onSave,
}: DiagramBuilderModalProps) {
  const [builderTab, setBuilderTab] = useState<'visual' | 'code'>('visual');
  const [flowModel, setFlowModel] = useState<FlowchartModel>(() =>
    cloneModel(DEFAULT_FLOWCHART_MODEL)
  );
  const [code, setCode] = useState<string>(() =>
    serializeFlowchartToMermaid(DEFAULT_FLOWCHART_MODEL)
  );
  const [visualNotice, setVisualNotice] = useState<string | null>(null);
  const [previewSvg, setPreviewSvg] = useState<string>('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState<number>(1);
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : true
  );

  // Sync dark mode class while open
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [isOpen]);

  // Initialize state whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    setVisualNotice(null);
    setPreviewZoom(1);
    setPreviewError(null);

    if (initialCode && initialCode.trim()) {
      const parsed = parseMermaidToFlowchart(initialCode);
      if (parsed) {
        setFlowModel(parsed);
        setCode(initialCode.trim());
        setBuilderTab('visual');
      } else {
        setFlowModel(cloneModel(DEFAULT_FLOWCHART_MODEL));
        setCode(initialCode.trim());
        setBuilderTab('code');
      }
    } else {
      const fresh = cloneModel(DEFAULT_FLOWCHART_MODEL);
      setFlowModel(fresh);
      setCode(serializeFlowchartToMermaid(fresh));
      setBuilderTab('visual');
    }
  }, [isOpen, initialCode]);

  // Live Mermaid SVG rendering with light debounce for typing smoothness
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const timer = window.setTimeout(() => {
      renderMermaidSvg(code, isDark)
        .then(({ svg }) => {
          if (!active) return;
          setPreviewSvg(svg);
          setPreviewError(null);
        })
        .catch((err: unknown) => {
          if (!active) return;
          const msg =
            err instanceof Error && err.message
              ? err.message.split('\n')[0]
              : 'Syntax error in Mermaid code.';
          setPreviewError(msg);
        });
    }, 110);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, code, isDark]);

  // Escape closes modal
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const detectedLabel = useMemo(() => detectDiagramLabel(code), [code]);
  const lineCount = useMemo(() => code.split('\n').length, [code]);

  if (!isOpen) return null;

  const updateFlowModel = (updater: (prev: FlowchartModel) => FlowchartModel) => {
    setVisualNotice(null);
    setFlowModel((prev) => {
      const next = updater(prev);
      setCode(serializeFlowchartToMermaid(next));
      return next;
    });
  };

  const handleSwitchTab = (target: 'visual' | 'code') => {
    if (target === builderTab) return;
    if (target === 'visual') {
      const parsed = parseMermaidToFlowchart(code);
      if (!parsed) {
        setVisualNotice(
          'This diagram uses syntax outside the simple flowchart builder (such as Sequence, ER, Mindmap, or subgraphs). Edit it in Mermaid Code or choose a Flowchart template.'
        );
        return;
      }
      setVisualNotice(null);
      setFlowModel(parsed);
    }
    setBuilderTab(target);
  };

  const handleApplyTemplate = (templateCode: string) => {
    setVisualNotice(null);
    setCode(templateCode);
    const parsed = parseMermaidToFlowchart(templateCode);
    if (parsed) {
      setFlowModel(parsed);
    } else {
      setBuilderTab('code');
    }
  };

  const handleAddNode = (shape: FlowchartShape, connectFromLast = false) => {
    updateFlowModel((prev) => {
      const newId = nextNodeId(prev.nodes);
      const defaultLabel =
        shape === 'decision'
          ? 'Condition?'
          : shape === 'database'
          ? 'Database'
          : shape === 'rounded'
          ? 'Milestone'
          : shape === 'circle'
          ? 'Event'
          : `Step ${prev.nodes.length + 1}`;
      const newNode: FlowchartNode = { id: newId, label: defaultLabel, shape };
      const nextEdges = [...prev.edges];
      if (connectFromLast && prev.nodes.length > 0) {
        const lastNode = prev.nodes[prev.nodes.length - 1];
        nextEdges.push({
          id: nextEdgeId(nextEdges),
          from: lastNode.id,
          to: newId,
          label: '',
          style: 'solid',
        });
      }
      return {
        ...prev,
        nodes: [...prev.nodes, newNode],
        edges: nextEdges,
      };
    });
  };

  const handleAddNextFromNode = (sourceNodeId: string) => {
    updateFlowModel((prev) => {
      const newId = nextNodeId(prev.nodes);
      const sourceIndex = prev.nodes.findIndex((n) => n.id === sourceNodeId);
      const newNode: FlowchartNode = {
        id: newId,
        label: `Step ${prev.nodes.length + 1}`,
        shape: 'process',
      };
      const nextNodes =
        sourceIndex >= 0
          ? [
              ...prev.nodes.slice(0, sourceIndex + 1),
              newNode,
              ...prev.nodes.slice(sourceIndex + 1),
            ]
          : [...prev.nodes, newNode];
      const nextEdge: FlowchartEdge = {
        id: nextEdgeId(prev.edges),
        from: sourceNodeId,
        to: newId,
        label: '',
        style: 'solid',
      };
      return {
        ...prev,
        nodes: nextNodes,
        edges: [...prev.edges, nextEdge],
      };
    });
  };

  const handleRemoveNode = (nodeId: string) => {
    updateFlowModel((prev) => {
      if (prev.nodes.length <= 1) return prev;
      return {
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
      };
    });
  };

  const handleAddEdge = () => {
    updateFlowModel((prev) => {
      if (prev.nodes.length < 2) return prev;
      const from = prev.nodes[0].id;
      const to = prev.nodes[Math.min(1, prev.nodes.length - 1)].id;
      return {
        ...prev,
        edges: [
          ...prev.edges,
          { id: nextEdgeId(prev.edges), from, to, label: '', style: 'solid' },
        ],
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    onSave(trimmed);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'edit' ? 'Edit diagram or flowchart' : 'Insert diagram or flowchart'}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#17171b] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <Workflow className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-[15px] font-semibold text-neutral-950 dark:text-white">
              {mode === 'edit' ? 'Edit diagram / flowchart' : 'Add diagram / flowchart'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode Switch */}
            <div
              className="flex items-center p-0.5 rounded-lg bg-neutral-100 dark:bg-white/[0.05] border border-neutral-200 dark:border-white/[0.08]"
              role="tablist"
              aria-label="Diagram builder mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={builderTab === 'visual'}
                onClick={() => handleSwitchTab('visual')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  builderTab === 'visual'
                    ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                <GitBranchPlus className="w-3.5 h-3.5" />
                <span>Visual Flowchart</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={builderTab === 'code'}
                onClick={() => handleSwitchTab('code')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[12.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  builderTab === 'code'
                    ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Mermaid Code</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close diagram builder"
              className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Starter Templates Strip */}
        <div className="px-5 py-2.5 border-b border-neutral-200/80 dark:border-white/[0.06] bg-neutral-50/80 dark:bg-white/[0.02] flex items-center gap-2 overflow-x-auto shrink-0">
          <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 shrink-0 mr-1">
            Templates:
          </span>
          {DIAGRAM_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => handleApplyTemplate(tpl.code)}
              title={tpl.description}
              className="px-2.5 py-1 rounded-md text-[12px] font-medium border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#202026] text-neutral-700 dark:text-neutral-200 hover:border-blue-400 dark:hover:border-blue-500/60 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {tpl.label}
            </button>
          ))}
        </div>

        {visualNotice && (
          <div className="px-5 py-2 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20 flex items-center justify-between gap-3 text-[12.5px] text-amber-800 dark:text-amber-300 shrink-0">
            <span>{visualNotice}</span>
            <button
              type="button"
              onClick={() => setVisualNotice(null)}
              className="text-amber-700 dark:text-amber-200 hover:underline shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main Split Workspace */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-neutral-200 dark:divide-white/[0.07] overflow-hidden">
          {/* Left Column: Builder or Code */}
          {builderTab === 'visual' ? (
            <div className="flex flex-col min-h-0 overflow-y-auto p-4 sm:p-5 space-y-5">
              {/* Layout Direction + Quick Add Nodes */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-neutral-100 dark:bg-white/[0.05] border border-neutral-200 dark:border-white/[0.07]">
                  <button
                    type="button"
                    onClick={() =>
                      updateFlowModel((prev) => ({
                        ...prev,
                        direction: 'TD' as FlowchartDirection,
                      }))
                    }
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      flowModel.direction === 'TD'
                        ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                        : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                    <span>Top to Down</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateFlowModel((prev) => ({
                        ...prev,
                        direction: 'LR' as FlowchartDirection,
                      }))
                    }
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      flowModel.direction === 'LR'
                        ? 'bg-white dark:bg-[#27272c] text-neutral-950 dark:text-white shadow-xs'
                        : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span>Left to Right</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAddNode('process', true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Step</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddNode('decision', true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium border border-neutral-200 dark:border-white/12 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Decision</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddNode('database', true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium border border-neutral-200 dark:border-white/12 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Database</span>
                  </button>
                </div>
              </div>

              {/* Nodes Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12.5px] font-semibold text-neutral-700 dark:text-neutral-300">
                    Nodes ({flowModel.nodes.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleAddNode('rounded', false)}
                    className="text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    + Unlinked node
                  </button>
                </div>

                <div className="space-y-2">
                  {flowModel.nodes.map((node) => (
                    <div
                      key={node.id}
                      className="flex items-center gap-2 p-2 rounded-lg border border-neutral-200 dark:border-white/[0.08] bg-neutral-50/70 dark:bg-white/[0.02]"
                    >
                      <span className="w-9 text-center text-[11.5px] font-mono-code text-neutral-500 dark:text-neutral-400 shrink-0 tabular-nums">
                        {node.id}
                      </span>

                      <select
                        value={node.shape}
                        onChange={(e) => {
                          const nextShape = e.target.value as FlowchartShape;
                          updateFlowModel((prev) => ({
                            ...prev,
                            nodes: prev.nodes.map((n) =>
                              n.id === node.id ? { ...n, shape: nextShape } : n
                            ),
                          }));
                        }}
                        aria-label={`Shape for node ${node.id}`}
                        className="rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#1e1e24] px-2 py-1.5 text-[12px] text-neutral-800 dark:text-neutral-200 focus:outline-none cursor-pointer shrink-0"
                      >
                        {SHAPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        value={node.label}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateFlowModel((prev) => ({
                            ...prev,
                            nodes: prev.nodes.map((n) =>
                              n.id === node.id ? { ...n, label: val } : n
                            ),
                          }));
                        }}
                        placeholder="Node label..."
                        aria-label={`Label for node ${node.id}`}
                        className="editor-prose-font flex-1 min-w-0 rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#141418] px-2.5 py-1.5 text-[13px] text-neutral-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />

                      <button
                        type="button"
                        onClick={() => handleAddNextFromNode(node.id)}
                        title="Add connected next step"
                        aria-label={`Add step after ${node.label}`}
                        className="px-2 py-1 rounded-md text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] cursor-pointer whitespace-nowrap shrink-0"
                      >
                        + Next
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemoveNode(node.id)}
                        disabled={flowModel.nodes.length <= 1}
                        title="Remove node"
                        aria-label={`Remove node ${node.id}`}
                        className={`p-1.5 rounded-md transition-colors shrink-0 ${
                          flowModel.nodes.length <= 1
                            ? 'text-neutral-300 dark:text-neutral-700 cursor-not-allowed'
                            : 'text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] cursor-pointer'
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Connections Section */}
              <div className="space-y-2 pt-1 border-t border-neutral-200/80 dark:border-white/[0.07]">
                <div className="flex items-center justify-between pt-2">
                  <h3 className="text-[12.5px] font-semibold text-neutral-700 dark:text-neutral-300">
                    Connections ({flowModel.edges.length})
                  </h3>
                  <button
                    type="button"
                    onClick={handleAddEdge}
                    disabled={flowModel.nodes.length < 2}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Connect nodes</span>
                  </button>
                </div>

                {flowModel.edges.length === 0 ? (
                  <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400 py-2">
                    No connections yet. Click "Connect nodes" to draw arrows between nodes.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {flowModel.edges.map((edge) => (
                      <div
                        key={edge.id}
                        className="flex flex-wrap sm:flex-nowrap items-center gap-2 p-2 rounded-lg border border-neutral-200 dark:border-white/[0.08] bg-neutral-50/70 dark:bg-white/[0.02]"
                      >
                        <select
                          value={edge.from}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateFlowModel((prev) => ({
                              ...prev,
                              edges: prev.edges.map((ed) =>
                                ed.id === edge.id ? { ...ed, from: val } : ed
                              ),
                            }));
                          }}
                          aria-label="Source node"
                          className="min-w-[90px] max-w-[130px] rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#1e1e24] px-2 py-1.5 text-[12px] text-neutral-800 dark:text-neutral-200 focus:outline-none cursor-pointer truncate"
                        >
                          {flowModel.nodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.id}: {n.label}
                            </option>
                          ))}
                        </select>

                        <select
                          value={edge.style}
                          onChange={(e) => {
                            const style = e.target.value as FlowchartEdgeStyle;
                            updateFlowModel((prev) => ({
                              ...prev,
                              edges: prev.edges.map((ed) =>
                                ed.id === edge.id ? { ...ed, style } : ed
                              ),
                            }));
                          }}
                          aria-label="Arrow style"
                          className="rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#1e1e24] px-1.5 py-1.5 text-[11.5px] font-mono-code text-neutral-700 dark:text-neutral-300 focus:outline-none cursor-pointer shrink-0"
                        >
                          {EDGE_STYLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>

                        <select
                          value={edge.to}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateFlowModel((prev) => ({
                              ...prev,
                              edges: prev.edges.map((ed) =>
                                ed.id === edge.id ? { ...ed, to: val } : ed
                              ),
                            }));
                          }}
                          aria-label="Target node"
                          className="min-w-[90px] max-w-[130px] rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#1e1e24] px-2 py-1.5 text-[12px] text-neutral-800 dark:text-neutral-200 focus:outline-none cursor-pointer truncate"
                        >
                          {flowModel.nodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.id}: {n.label}
                            </option>
                          ))}
                        </select>

                        <input
                          type="text"
                          value={edge.label}
                          onChange={(e) => {
                            const label = e.target.value;
                            updateFlowModel((prev) => ({
                              ...prev,
                              edges: prev.edges.map((ed) =>
                                ed.id === edge.id ? { ...ed, label } : ed
                              ),
                            }));
                          }}
                          placeholder="Label (Yes/No)..."
                          aria-label="Connection label"
                          className="editor-prose-font flex-1 min-w-[85px] rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#141418] px-2 py-1.5 text-[12px] text-neutral-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            updateFlowModel((prev) => ({
                              ...prev,
                              edges: prev.edges.filter((ed) => ed.id !== edge.id),
                            }))
                          }
                          title="Remove connection"
                          aria-label="Remove connection"
                          className="p-1.5 rounded-md text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col min-h-0 p-4 sm:p-5 space-y-2.5">
              <div className="flex items-center justify-between text-[12px] text-neutral-500 dark:text-neutral-400">
                <span>Supports Flowchart, Sequence, ER, State, Gantt, Mindmap & Pie</span>
                <span className="font-mono-code tabular-nums">{lineCount} lines</span>
              </div>
              <textarea
                value={code}
                onChange={(e) => {
                  setVisualNotice(null);
                  setCode(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const t = e.currentTarget;
                    const start = t.selectionStart;
                    const end = t.selectionEnd;
                    const next = code.slice(0, start) + '  ' + code.slice(end);
                    setCode(next);
                    window.requestAnimationFrame(() => {
                      t.setSelectionRange(start + 2, start + 2);
                    });
                  }
                }}
                spellCheck={false}
                placeholder="Write Mermaid diagram syntax here..."
                aria-label="Mermaid diagram code"
                className="editor-source-font flex-1 w-full min-h-[320px] rounded-xl border border-neutral-200 dark:border-white/[0.09] bg-neutral-50 dark:bg-[#121215] p-3.5 text-[13px] leading-[1.7] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
              />
            </div>
          )}

          {/* Right Column: Live Diagram Preview */}
          <div className="flex flex-col min-h-[300px] lg:min-h-0 bg-neutral-50/70 dark:bg-[#131317]">
            <div className="px-4 py-2.5 border-b border-neutral-200/80 dark:border-white/[0.06] flex items-center justify-between gap-2 shrink-0">
              <span className="text-[12px] font-medium text-neutral-600 dark:text-neutral-300">
                Live preview · {detectedLabel}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setPreviewZoom((s) => Math.max(0.6, Number((s - 0.15).toFixed(2))))
                  }
                  aria-label="Zoom out preview"
                  className="p-1 rounded text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewZoom(1)}
                  className="px-1.5 py-0.5 rounded text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] tabular-nums cursor-pointer"
                >
                  {Math.round(previewZoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPreviewZoom((s) => Math.min(2, Number((s + 0.15).toFixed(2))))
                  }
                  aria-label="Zoom in preview"
                  className="p-1 rounded text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-5 flex items-center justify-center">
              {previewSvg ? (
                <div
                  style={{
                    transform: `scale(${previewZoom})`,
                    transformOrigin: 'center center',
                  }}
                  className={`transition-all duration-150 [&>svg]:max-w-full [&>svg]:h-auto ${
                    previewError ? 'opacity-45' : 'opacity-100'
                  }`}
                  dangerouslySetInnerHTML={{ __html: previewSvg }}
                />
              ) : (
                <div className="text-[13px] text-neutral-400 dark:text-neutral-500">
                  Rendering diagram preview...
                </div>
              )}
            </div>

            {previewError && (
              <div className="px-4 py-2 border-t border-red-200 dark:border-red-500/20 bg-red-50/80 dark:bg-red-500/10 flex items-center gap-2 text-[12px] text-red-700 dark:text-red-300 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate font-mono-code">{previewError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-neutral-200 dark:border-white/[0.08] bg-neutral-50/60 dark:bg-white/[0.02] flex items-center justify-between gap-3 shrink-0">
          <span className="text-[12px] text-neutral-500 dark:text-neutral-400 tabular-nums">
            {builderTab === 'visual'
              ? `${flowModel.nodes.length} nodes · ${flowModel.edges.length} connections`
              : `${detectedLabel} · ${lineCount} lines`}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-white/[0.07] transition-colors cursor-pointer whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!code.trim()}
              className="px-4 py-2 rounded-lg text-[13px] font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              {mode === 'edit' ? 'Update diagram' : 'Insert diagram'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
