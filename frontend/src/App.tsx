import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import type { Person, Relationship } from './types';
import { api } from './api';
import PersonNode from './PersonNode';
import { useClanGraph } from './hooks/useClanGraph';
import { ContextMenu } from './components/ContextMenu';
import { AddPersonModal } from './components/AddPersonModal';
import { Header } from './components/Header';
import { EditPersonModal } from './components/EditPersonModal';
import 'reactflow/dist/style.css';
import './App.css';

const nodeTypes = {
  person: PersonNode,
};

type UndoEntry = {
  person: Person;
  relationships: Relationship[];
  previousCenterId?: string;
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || target.isContentEditable;
};

function App() {
  const {
    graphData,
    loading,
    error,
    fetchGraph,
    updatePersonPosition,
    updatePerson,
    createRelationship,
    updateRelationship,
    reverseRelationship,
    deleteRelationship,
    createPerson,
    deletePerson,
    setCenterId,
    centerId
  } = useClanGraph();

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [linkMode, setLinkMode] = useState<{ from: string } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [copiedPerson, setCopiedPerson] = useState<Person | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [lastMousePosition, setLastMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [dimFocusId, setDimFocusId] = useState<string | null>(null);
  const [centerFlashId, setCenterFlashId] = useState<string | null>(null);
  const canUndo = undoStack.length > 0;

  useEffect(() => {
    if (!centerId) return;
    setCenterFlashId(centerId);
    const timer = window.setTimeout(() => {
      setCenterFlashId((prev) => (prev === centerId ? null : prev));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [centerId]);

  // Handle node click
  const handleNodeClick = useCallback((nodeId: string) => {
    console.log('Node clicked:', nodeId);
    setSelectedNode(nodeId);
    setSelectedEdge(null); // Clear edge selection

    if (linkMode) {
      createRelationship(linkMode.from, nodeId);
      setLinkMode(null);
    }
  }, [linkMode, createRelationship]);


  // Handle edge click
  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    console.log('Edge clicked:', edge.id);
    setSelectedEdge(edge.id);
    setSelectedNode(null); // Clear node selection
  }, []);

  // Handle node context menu
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setContextMenu({
        id: node.id,
        top: event.clientY,
        left: event.clientX,
      });
    },
    []
  );

  const onPaneClick = useCallback(() => setContextMenu(null), []);

  const onPaneMouseMove = useCallback((event: React.MouseEvent) => {
    if (!reactFlowInstance) return;
    const screenPoint = { x: event.clientX, y: event.clientY };
    const instance = reactFlowInstance as ReactFlowInstance & {
      screenToFlowPosition?: (point: { x: number; y: number }) => { x: number; y: number };
      project?: (point: { x: number; y: number }) => { x: number; y: number };
    };
    const flowPoint = instance.screenToFlowPosition
      ? instance.screenToFlowPosition(screenPoint)
      : instance.project
        ? instance.project(screenPoint)
        : null;
    if (flowPoint) {
      setLastMousePosition(flowPoint);
    }
  }, [reactFlowInstance]);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) {
      const horizontalHandles = new Set(['left-s', 'left-t', 'right-s', 'right-t']);
      const sourceHandle = connection.sourceHandle ?? undefined;
      const targetHandle = connection.targetHandle ?? undefined;
      let isHorizontal = false;
      if (sourceHandle && targetHandle) {
        isHorizontal = horizontalHandles.has(sourceHandle) && horizontalHandles.has(targetHandle);
      }
      const relationshipType = isHorizontal ? 'sibling' : 'parent_child';
      createRelationship(
        connection.source, 
        connection.target, 
        sourceHandle, 
        targetHandle,
        relationshipType
      );
    }
  }, [createRelationship]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    updatePersonPosition(node.id, node.position);
  }, [updatePersonPosition]);

  const handleEditPerson = useCallback((id: string) => {
    setCopiedPerson(null);
    setEditingPersonId(id);
  }, []);

  const handleDeletePerson = useCallback(async (id: string) => {
    if (!graphData) return;
    const person = graphData.nodes.find(p => p.id === id);
    if (!person) return;

    const relationships = graphData.edges.filter(
      rel => rel.from_person_id === id || rel.to_person_id === id
    );
    const previousCenterId = id === centerId ? centerId : undefined;
    const nextCenterId = id === centerId
      ? graphData.nodes.find(p => p.id !== id)?.id
      : undefined;

    try {
      const skipRefresh = Boolean(nextCenterId);
      if (skipRefresh && nextCenterId) {
        setCenterId(nextCenterId);
      }
      await deletePerson(id, skipRefresh);
      setUndoStack(prev => [{ person, relationships, previousCenterId }, ...prev].slice(0, 10));
      setSelectedNode(null);
      setSelectedEdge(null);
    } catch (error) {
      console.error('Failed to delete person:', error);
    }
  }, [graphData, deletePerson, centerId, setCenterId]);

  const handleUndo = useCallback(async () => {
    const entry = undoStack[0];
    if (!entry) return;

    try {
      await api.createPerson(
        entry.person.name,
        entry.person.gender,
        entry.person.dob,
        entry.person.dod,
        entry.person.tob,
        entry.person.tod,
        entry.person.metadata ?? undefined,
        entry.person.id,
        entry.person.avatar_url
      );
      for (const rel of entry.relationships) {
        await api.createRelationship(
          rel.from_person_id,
          rel.to_person_id,
          rel.metadata ?? undefined,
          rel.type as 'parent_child' | 'spouse' | 'sibling' | 'in_law',
          true
        );
      }
      if (entry.previousCenterId) {
        setCenterId(entry.previousCenterId);
      }
      setUndoStack(prev => prev.slice(1));
      fetchGraph();
    } catch (error) {
      console.error('Failed to undo delete:', error);
    }
  }, [undoStack, fetchGraph, setCenterId]);

  // Convert graph data to ReactFlow nodes
  const dimIds = useMemo(() => {
    if (!graphData || !dimFocusId) return new Set<string>();
    const parentIds = graphData.edges
      .filter(edge => edge.type === 'parent_child' && edge.to_person_id === dimFocusId)
      .map(edge => edge.from_person_id);

    const siblingIds = new Set<string>();
    parentIds.forEach(parentId => {
      graphData.edges
        .filter(edge => edge.type === 'parent_child' && edge.from_person_id === parentId)
        .forEach(edge => {
          if (edge.to_person_id !== dimFocusId) siblingIds.add(edge.to_person_id);
        });
    });

    graphData.edges
      .filter(edge => edge.type === 'sibling')
      .forEach(edge => {
        if (edge.from_person_id === dimFocusId) siblingIds.add(edge.to_person_id);
        if (edge.to_person_id === dimFocusId) siblingIds.add(edge.from_person_id);
      });

    const dimSet = new Set<string>([...parentIds, ...siblingIds]);
    dimSet.delete(dimFocusId);
    return dimSet;
  }, [graphData, dimFocusId]);

  const initialNodes: Node[] = useMemo(() => {
    if (!graphData) return [];

    const centerX = 500;
    const centerY = 300;

    return graphData.nodes.map((person, index) => {
      const genderColor = person.gender === 'M' ? '#3b82f6' : person.gender === 'F' ? '#ec4899' : '#8b5cf6';
      const title = person.title || '';
      
      const position = person.metadata?.position || (
        person.id === graphData.center 
          ? { x: centerX, y: centerY }
          : {
              x: centerX + Math.cos((index * 45) * (Math.PI / 180)) * (150 + (index * 30)),
              y: centerY + Math.sin((index * 45) * (Math.PI / 180)) * (150 + (index * 30))
            }
      );

      return {
        id: person.id,
        type: 'person',
        position: position,
        data: {
          name: person.name,
          initial: person.name.charAt(0),
          title: title,
          genderColor: genderColor,
          isCenter: person.id === centerId,
          flashCenter: person.id === centerFlashId,
        },
        style: {
          background: 'transparent',
          border: 'none',
          opacity: dimIds.has(person.id) ? 0.35 : 1,
        },
      };
    });
  }, [graphData, dimIds, centerId, centerFlashId]);

  // Convert graph data to ReactFlow edges
  const initialEdges: Edge[] = useMemo(() => {
    if (!graphData) return [];

    return graphData.edges.map((edge) => {
      const edgeId = `e${edge.id}`;
      const isSelected = selectedEdge === edgeId;
      const isDimmed = dimIds.has(edge.from_person_id) || dimIds.has(edge.to_person_id);
      
      const getEdgeStyle = (type: string, selected: boolean) => {
        if (selected) return { stroke: '#ef4444', strokeWidth: 4 };
        switch (type) {
          case 'spouse': return { stroke: '#ec4899', strokeWidth: 2 }; // Pink
          case 'sibling': return { stroke: '#10b981', strokeWidth: 2 }; // Green
          case 'in_law': return { stroke: '#f59e0b', strokeWidth: 2 }; // Amber
          default: return { stroke: '#6366f1', strokeWidth: 2 }; // Blue (parent_child)
        }
      };

      const getLabel = (type: string) => {
        switch (type) {
          case 'spouse': return '配偶';
          case 'sibling': return '手足';
          case 'in_law': return '姻親';
          default: return '親子';
        }
      };

      return {
        id: edgeId,
        source: edge.from_person_id,
        target: edge.to_person_id,
        sourceHandle: edge.metadata?.sourceHandle,
        targetHandle: edge.metadata?.targetHandle,
        type: edge.type === 'spouse' || edge.type === 'sibling' || edge.type === 'in_law' ? 'step' : 'smoothstep',
        animated: edge.type === 'spouse',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { ...getEdgeStyle(edge.type, isSelected), opacity: isSelected ? 1 : (isDimmed ? 0.35 : 1) },
        label: getLabel(edge.type),
        zIndex: isSelected ? 1000 : 0,
      };
    });
  }, [graphData, selectedEdge, dimIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync state with React Flow
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Keyboard listener for delete, copy, paste
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // DELETE/BACKSPACE
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdge) {
        deleteRelationship(selectedEdge);
      }

      // COPY (Ctrl+C)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedNode && graphData) {
        const person = graphData.nodes.find(p => p.id === selectedNode);
        if (person) {
          console.log('Copied person:', person.name);
          setCopiedPerson(person);
        }
      }

      // PASTE (Ctrl+V)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && copiedPerson) {
        console.log('Pasting person:', copiedPerson.name);
        
        const fallbackPos = copiedPerson.metadata?.position || { x: 500, y: 300 };
        const position = lastMousePosition
          ? { x: lastMousePosition.x + 20, y: lastMousePosition.y + 20 }
          : { x: fallbackPos.x + 40, y: fallbackPos.y + 40 };
        const newMetadata = {
          ...copiedPerson.metadata,
          position
        };

        await createPerson(
          copiedPerson.name,
          copiedPerson.gender,
          copiedPerson.dob,
          copiedPerson.dod,
          copiedPerson.tob,
          copiedPerson.tod,
          newMetadata
        );
      }

      // UNDO (Ctrl+Z)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isEditableTarget(e.target)) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEdge, selectedNode, graphData, copiedPerson, deleteRelationship, createPerson, handleUndo, lastMousePosition]);

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>載入中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <div className="loading">
          <p style={{ color: '#ef4444' }}>錯誤: {error}</p>
          <button onClick={fetchGraph} className="btn-primary" style={{ marginTop: '1rem' }}>
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header 
        onAddMember={() => setShowAddModal(true)}
        selectedNode={selectedNode}
        selectedEdge={selectedEdge}
        linkMode={linkMode}
        onUndo={handleUndo}
        canUndo={canUndo}
        onStartLink={() => selectedNode && setLinkMode({ from: selectedNode })}
        onSetCenter={() => {
          if (selectedNode) {
            setCenterId(selectedNode);
            setSelectedNode(null);
          }
        }}
        onUpdateRelationship={(type) => selectedEdge && updateRelationship(selectedEdge, { type })}
        onReverseRelationship={() => selectedEdge && reverseRelationship(selectedEdge)}
        onDeleteRelationship={() => selectedEdge && deleteRelationship(selectedEdge)}
      />

      <div className="flow-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setReactFlowInstance}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_e, node) => {
            handleNodeClick(node.id);
            setContextMenu(null);
          }}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          onPaneMouseMove={onPaneMouseMove}
          onEdgeClick={handleEdgeClick}
          fitView
          minZoom={0.3}
          maxZoom={2}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
        
        {contextMenu && (
          <ContextMenu 
            {...contextMenu}
            onSetCenter={setCenterId}
            onStartLink={(id) => setLinkMode({ from: id })}
            onEdit={handleEditPerson}
            onDelete={handleDeletePerson}
            onToggleDimRelatives={(id) => setDimFocusId(prev => (prev === id ? null : id))}
            dimRelativesActive={dimFocusId === contextMenu.id}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>

      {linkMode && (
        <div className="link-indicator">
          點擊另一個節點以建立關係
          <button onClick={() => setLinkMode(null)}>取消</button>
        </div>
      )}

      {showAddModal && (
        <AddPersonModal 
          onClose={() => setShowAddModal(false)}
          onSubmit={async (name, gender, dob, dod, tob, tod) => {
            const person = await createPerson(name, gender, dob, dod, tob, tod);
            if (selectedNode) {
              await createRelationship(selectedNode, person.id);
            }
            setShowAddModal(false);
          }}
        />
      )}

      {editingPersonId && graphData && (
        <EditPersonModal
          person={graphData.nodes.find(p => p.id === editingPersonId)!}
          onClose={() => setEditingPersonId(null)}
          onSubmit={async (id, updates) => {
            await updatePerson(id, updates);
            setEditingPersonId(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
