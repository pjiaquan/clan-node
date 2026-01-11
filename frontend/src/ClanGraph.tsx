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

const nodeTypes = {
  person: PersonNode,
};

type UndoEntry = {
  person: Person;
  relationships: Relationship[];
  previousCenterId?: string;
};

type Gender = Person['gender'];

const getSurname = (name?: string | null) => name?.trim().charAt(0) ?? '';

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || target.isContentEditable;
};

type ClanGraphProps = {
  username: string | null;
  onLogout: () => void;
};

export function ClanGraph({ username, onLogout }: ClanGraphProps) {
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
  const [dimNonRelativesId, setDimNonRelativesId] = useState<string | null>(null);
  const [centerFlashId, setCenterFlashId] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<{ url: string; name: string } | null>(null);
  const canUndo = undoStack.length > 0;

  const isInLawParentConnection = useCallback((fromId: string, toId: string) => {
    if (!graphData) return false;
    const fromPerson = graphData.nodes.find(node => node.id === fromId);
    const toPerson = graphData.nodes.find(node => node.id === toId);
    if (!fromPerson || !toPerson) return false;

    const spouseEdge = graphData.edges.find(edge =>
      edge.type === 'spouse' &&
      (edge.from_person_id === toId || edge.to_person_id === toId)
    );
    if (!spouseEdge) return false;

    const spouseId = spouseEdge.from_person_id === toId
      ? spouseEdge.to_person_id
      : spouseEdge.from_person_id;

    const isParentOfSpouse = graphData.edges.some(edge =>
      edge.type === 'parent_child' &&
      edge.from_person_id === fromId &&
      edge.to_person_id === spouseId
    );
    if (!isParentOfSpouse) return false;

    const toSurname = getSurname(toPerson.name);
    const spouseSurname = getSurname(graphData.nodes.find(node => node.id === spouseId)?.name);
    const fromSurname = getSurname(fromPerson.name);
    const surnamesDiffer = Boolean(
      (toSurname && spouseSurname && toSurname !== spouseSurname) ||
      (toSurname && fromSurname && toSurname !== fromSurname)
    );
    return surnamesDiffer;
  }, [graphData]);

  const getDefaultRelationshipType = useCallback((
    fromId: string,
    toId: string,
    overrides?: { fromGender?: Gender; toGender?: Gender },
    options?: { allowSpouse?: boolean }
  ) => {
    if (isInLawParentConnection(fromId, toId)) {
      return 'in_law';
    }
    const fromGender = overrides?.fromGender ?? graphData?.nodes.find(node => node.id === fromId)?.gender;
    const toGender = overrides?.toGender ?? graphData?.nodes.find(node => node.id === toId)?.gender;
    const gendersDifferent = Boolean(
      fromGender &&
      toGender &&
      fromGender !== 'O' &&
      toGender !== 'O' &&
      fromGender !== toGender
    );
    if (options?.allowSpouse === false) {
      return 'parent_child';
    }
    return gendersDifferent ? 'spouse' : 'parent_child';
  }, [graphData, isInLawParentConnection]);

  useEffect(() => {
    if (!centerId) return;
    setCenterFlashId(centerId);
    const timer = window.setTimeout(() => {
      setCenterFlashId((prev) => (prev === centerId ? null : prev));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [centerId]);

  useEffect(() => {
    if (!avatarPreview) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAvatarPreview(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [avatarPreview]);

  const handleNodeClick = useCallback((nodeId: string) => {
    console.log('Node clicked:', nodeId);
    setSelectedNode(nodeId);
    setSelectedEdge(null);

    if (linkMode) {
      const relationshipType = getDefaultRelationshipType(linkMode.from, nodeId);
      createRelationship(linkMode.from, nodeId, undefined, undefined, relationshipType);
      setLinkMode(null);
    }
  }, [linkMode, createRelationship, getDefaultRelationshipType]);

  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    console.log('Edge clicked:', edge.id);
    setSelectedEdge(edge.id);
    setSelectedNode(null);
  }, []);

  const handleAvatarClick = useCallback((person: Person, avatarUrl: string) => {
    setSelectedNode(person.id);
    setSelectedEdge(null);
    setContextMenu(null);
    setAvatarPreview({ url: avatarUrl, name: person.name });
  }, []);

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
      const sourcePerson = graphData?.nodes.find(node => node.id === connection.source);
      const targetPerson = graphData?.nodes.find(node => node.id === connection.target);
      const gendersDifferent = Boolean(
        sourcePerson?.gender &&
        targetPerson?.gender &&
        sourcePerson.gender !== 'O' &&
        targetPerson.gender !== 'O' &&
        sourcePerson.gender !== targetPerson.gender
      );
      const relationshipType = isHorizontal
        ? (gendersDifferent ? 'spouse' : 'sibling')
        : getDefaultRelationshipType(connection.source, connection.target, undefined, { allowSpouse: false });
      createRelationship(
        connection.source,
        connection.target,
        sourceHandle,
        targetHandle,
        relationshipType
      );
    }
  }, [createRelationship, graphData, getDefaultRelationshipType]);

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
        entry.person.english_name ?? undefined,
        entry.person.gender,
        entry.person.dob,
        entry.person.dod,
        entry.person.tob,
        entry.person.tod,
        entry.person.metadata ?? undefined,
        entry.person.id,
        entry.person.avatar_url ?? undefined
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

  const dimIds = useMemo(() => {
    if (!graphData || (!dimFocusId && !dimNonRelativesId)) return new Set<string>();
    const focusId = dimNonRelativesId ?? dimFocusId!;
    const parentIds = new Set(
      graphData.edges
        .filter(edge => edge.type === 'parent_child' && edge.to_person_id === focusId)
        .map(edge => edge.from_person_id)
    );

    const visited = new Set<string>();
    const queue: string[] = [focusId];
    while (queue.length) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      graphData.edges
        .filter(edge => edge.type === 'sibling')
        .forEach(edge => {
          if (edge.from_person_id === currentId && !visited.has(edge.to_person_id)) {
            queue.push(edge.to_person_id);
          } else if (edge.to_person_id === currentId && !visited.has(edge.from_person_id)) {
            queue.push(edge.from_person_id);
          }
        });

      const currentParentIds = graphData.edges
        .filter(edge => edge.type === 'parent_child' && edge.to_person_id === currentId)
        .map(edge => edge.from_person_id);
      currentParentIds.forEach(parentId => {
        graphData.edges
          .filter(edge => edge.type === 'parent_child' && edge.from_person_id === parentId)
          .forEach(edge => {
            if (!visited.has(edge.to_person_id)) {
              queue.push(edge.to_person_id);
            }
          });
      });
    }

    visited.delete(focusId);
    const siblingIds = visited;

    const focusSet = new Set<string>([focusId, ...parentIds, ...siblingIds]);

    if (dimNonRelativesId) {
      const dimSet = new Set<string>(
        graphData.nodes
          .map(node => node.id)
          .filter(id => !focusSet.has(id))
      );
      return dimSet;
    }

    const dimSet = new Set<string>([...parentIds, ...siblingIds]);
    dimSet.delete(focusId);
    return dimSet;
  }, [graphData, dimFocusId, dimNonRelativesId]);

  const initialNodes: Node[] = useMemo(() => {
    if (!graphData) return [];

    const centerX = 500;
    const centerY = 300;

    return graphData.nodes.map((person, index) => {
      const genderColor = person.gender === 'M' ? '#3b82f6' : person.gender === 'F' ? '#ec4899' : '#8b5cf6';
      const title = person.title || '';
      const avatarUrl = api.resolveAvatarUrl(person.avatar_url);

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
          avatarUrl,
          isCenter: person.id === centerId,
          flashCenter: person.id === centerFlashId,
          onAvatarClick: avatarUrl ? () => handleAvatarClick(person, avatarUrl) : undefined,
        },
        style: {
          background: 'transparent',
          border: 'none',
          opacity: dimIds.has(person.id) ? 0.35 : 1,
        },
      };
    });
  }, [graphData, dimIds, centerId, centerFlashId, handleAvatarClick]);

  const initialEdges: Edge[] = useMemo(() => {
    if (!graphData) return [];

    return graphData.edges.map((edge) => {
      const edgeId = `e${edge.id}`;
      const isSelected = selectedEdge === edgeId;
      const isDimmed = dimIds.has(edge.from_person_id) || dimIds.has(edge.to_person_id);

      const getEdgeStyle = (type: string, selected: boolean) => {
        if (selected) return { stroke: '#ef4444', strokeWidth: 4 };
        switch (type) {
          case 'spouse': return { stroke: '#ec4899', strokeWidth: 2 };
          case 'sibling': return { stroke: '#10b981', strokeWidth: 2 };
          case 'in_law': return { stroke: '#f59e0b', strokeWidth: 2 };
          default: return { stroke: '#6366f1', strokeWidth: 2 };
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

  const handleDuplicateBottomRight = useCallback(async (id: string) => {
    if (!graphData) return;
    const person = graphData.nodes.find(node => node.id === id);
    if (!person) return;

    const nodePosition = nodes.find(node => node.id === id)?.position
      ?? person.metadata?.position
      ?? { x: 500, y: 300 };
    const position = { x: nodePosition.x + 160, y: nodePosition.y + 140 };
    const newMetadata = {
      ...(person.metadata ?? {}),
      position,
    };

    await createPerson(
      person.name,
      person.english_name ?? undefined,
      person.gender,
      person.dob,
      person.dod,
      person.tob,
      person.tod,
      newMetadata,
      undefined,
      person.avatar_url ?? undefined
    );
  }, [graphData, nodes, createPerson]);

  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdge) {
        deleteRelationship(selectedEdge);
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedNode && graphData) {
        const person = graphData.nodes.find(p => p.id === selectedNode);
        if (person) {
          console.log('Copied person:', person.name);
          setCopiedPerson(person);
        }
      }

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
          copiedPerson.english_name ?? undefined,
          copiedPerson.gender,
          copiedPerson.dob,
          copiedPerson.dod,
          copiedPerson.tob,
          copiedPerson.tod,
          newMetadata
        );
      }

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
        username={username}
        onLogout={onLogout}
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
            setAvatarPreview(null);
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
            title={graphData?.nodes.find(node => node.id === contextMenu.id)?.title ?? null}
            onSetCenter={setCenterId}
            onStartLink={(id) => setLinkMode({ from: id })}
            onEdit={handleEditPerson}
            onDelete={handleDeletePerson}
            onCopyTitle={(title) => {
              navigator.clipboard.writeText(title).then(() => {
                setCopyNotice('已複製稱呼');
                window.setTimeout(() => setCopyNotice(null), 1200);
              }).catch(() => {
                setCopyNotice('複製失敗');
                window.setTimeout(() => setCopyNotice(null), 1200);
              });
            }}
            onDuplicateBottomRight={handleDuplicateBottomRight}
            onToggleDimRelatives={(id) => {
              setDimNonRelativesId(null);
              setDimFocusId(prev => (prev === id ? null : id));
            }}
            onToggleDimNonRelatives={(id) => {
              setDimFocusId(null);
              setDimNonRelativesId(prev => (prev === id ? null : id));
            }}
            dimRelativesActive={dimFocusId === contextMenu.id}
            dimNonRelativesActive={dimNonRelativesId === contextMenu.id}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>

      {copyNotice && (
        <div className="link-indicator" style={{ bottom: '6.5rem' }}>
          {copyNotice}
        </div>
      )}

      {avatarPreview && (
        <div className="modal-overlay" onClick={() => setAvatarPreview(null)}>
          <div className="avatar-modal" onClick={(event) => event.stopPropagation()}>
            <img src={avatarPreview.url} alt={`${avatarPreview.name} avatar`} />
            <div className="avatar-modal-name">{avatarPreview.name}</div>
          </div>
        </div>
      )}

      {linkMode && (
        <div className="link-indicator">
          點擊另一個節點以建立關係
          <button onClick={() => setLinkMode(null)}>取消</button>
        </div>
      )}

      {showAddModal && (
        <AddPersonModal
          onClose={() => setShowAddModal(false)}
          onSubmit={async (name, englishName, gender, dob, dod, tob, tod) => {
            const person = await createPerson(name, englishName, gender, dob, dod, tob, tod);
            if (selectedNode) {
              const relationshipType = getDefaultRelationshipType(selectedNode, person.id, { toGender: person.gender });
              await createRelationship(selectedNode, person.id, undefined, undefined, relationshipType);
            }
            setShowAddModal(false);
          }}
        />
      )}

      {editingPersonId && graphData && (
        <EditPersonModal
          person={graphData.nodes.find(p => p.id === editingPersonId)!}
          onClose={() => setEditingPersonId(null)}
          onSubmit={async (id, updates, avatarFile, removeAvatar) => {
            const nextUpdates = { ...updates } as Partial<Person> & { avatar_url?: string | null };
            if (removeAvatar) {
              nextUpdates.avatar_url = null;
            }
            if (avatarFile) {
              const { avatar_url } = await api.uploadAvatar(id, avatarFile);
              nextUpdates.avatar_url = avatar_url;
            }
            await updatePerson(id, nextUpdates);
            setEditingPersonId(null);
          }}
        />
      )}
    </div>
  );
}
