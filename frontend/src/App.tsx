import { useCallback, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import PersonNode from './PersonNode';
import { useClanGraph } from './hooks/useClanGraph';
import { ContextMenu } from './components/ContextMenu';
import { AddPersonModal } from './components/AddPersonModal';
import { Header } from './components/Header';
import 'reactflow/dist/style.css';
import './App.css';

const nodeTypes = {
  person: PersonNode,
};

function App() {
  const {
    graphData,
    loading,
    error,
    fetchGraph,
    updatePersonPosition,
    createRelationship,
    updateRelationshipType,
    deleteRelationship,
    createPerson,
    setCenterId
  } = useClanGraph();

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [linkMode, setLinkMode] = useState<{ from: string } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

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

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) {
      createRelationship(
        connection.source, 
        connection.target, 
        connection.sourceHandle, 
        connection.targetHandle
      );
    }
  }, [createRelationship]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    updatePersonPosition(node.id, node.position);
  }, [updatePersonPosition]);

  // Convert graph data to ReactFlow nodes
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
        },
        style: {
          background: 'transparent',
          border: 'none',
        },
      };
    });
  }, [graphData]);

  // Convert graph data to ReactFlow edges
  const initialEdges: Edge[] = useMemo(() => {
    if (!graphData) return [];

    return graphData.edges.map((edge) => {
      const edgeId = `e${edge.id}`;
      const isSelected = selectedEdge === edgeId;
      
      return {
        id: edgeId,
        source: edge.from_person_id,
        target: edge.to_person_id,
        sourceHandle: edge.metadata?.sourceHandle,
        targetHandle: edge.metadata?.targetHandle,
        type: edge.type === 'spouse' ? 'step' : 'smoothstep',
        animated: edge.type === 'spouse',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke: isSelected ? '#ef4444' : (edge.type === 'spouse' ? '#ec4899' : '#6366f1'),
          strokeWidth: isSelected ? 4 : 2,
        },
        label: edge.type === 'spouse' ? '配偶' : '親子',
        zIndex: isSelected ? 1000 : 0,
      };
    });
  }, [graphData, selectedEdge]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync state with React Flow
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Keyboard listener for delete
  useMemo(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdge) {
        deleteRelationship(selectedEdge);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEdge, deleteRelationship]);

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
        onStartLink={() => selectedNode && setLinkMode({ from: selectedNode })}
        onSetCenter={() => {
          if (selectedNode) {
            setCenterId(selectedNode);
            setSelectedNode(null);
          }
        }}
        onUpdateRelationship={(type) => selectedEdge && updateRelationshipType(selectedEdge, type)}
        onDeleteRelationship={() => selectedEdge && deleteRelationship(selectedEdge)}
      />

      <div className="flow-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
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
          onSubmit={async (name, gender) => {
            const person = await createPerson(name, gender);
            if (selectedNode) {
              await createRelationship(selectedNode, person.id);
            }
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
}

export default App;