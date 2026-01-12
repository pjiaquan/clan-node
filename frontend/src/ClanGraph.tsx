import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
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

type UndoEntry =
  | {
      type: 'delete';
      person: Person;
      relationships: Relationship[];
      previousCenterId?: string;
    }
  | {
      type: 'align';
      positions: Record<string, { x: number; y: number }>;
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
  const [contextMenu, setContextMenu] = useState<{ id: string; top?: number; bottom?: number; left: number; openUp: boolean } | null>(null);
  const [linkMode, setLinkMode] = useState<{ from: string } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [copiedPerson, setCopiedPerson] = useState<Person | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [lastMousePosition, setLastMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [dragGuideY, setDragGuideY] = useState<number | null>(null);
  const [dimFocusId, setDimFocusId] = useState<string | null>(null);
  const [dimNonRelativesId, setDimNonRelativesId] = useState<string | null>(null);
  const [collapsedMaternalRoots, setCollapsedMaternalRoots] = useState<Set<string>>(new Set());
  const [collapsedPaternalRoots, setCollapsedPaternalRoots] = useState<Set<string>>(new Set());
  const [collapsedChildRoots, setCollapsedChildRoots] = useState<Set<string>>(new Set());
  const [collapsedSiblingRoots, setCollapsedSiblingRoots] = useState<Set<string>>(new Set());
  const [centerFlashId, setCenterFlashId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'warning' } | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<{ url: string; name: string } | null>(null);
  const [avatarBlobs, setAvatarBlobs] = useState<Record<string, string>>({});
  const nodePositionMap = useRef<Record<string, { x: number; y: number }>>({});
  const nodesRef = useRef<Node[]>([]);
  const setNodesRef = useRef<React.Dispatch<React.SetStateAction<Node[]>> | null>(null);
  const dragSnapRef = useRef<{ id: string; y: number } | null>(null);
  const avatarBlobMap = useRef<Record<string, string>>({});
  const avatarFetches = useRef(new Set<string>());
  const avatarFailures = useRef(new Set<string>());
  const toastTimer = useRef<number | null>(null);
  const canUndo = undoStack.length > 0;

  useEffect(() => {
    avatarBlobMap.current = avatarBlobs;
  }, [avatarBlobs]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('clan.nodePositions');
      if (raw) {
        nodePositionMap.current = JSON.parse(raw);
      }
    } catch (error) {
      console.warn('Failed to restore node positions:', error);
    }
  }, []);

  const collapsedNodeIds = useMemo(() => {
    if (!graphData) return new Set<string>();

    const getSpouseId = (personId: string, gender?: 'M' | 'F') => {
      const spouseIds = graphData.edges
        .filter(edge =>
          edge.type === 'spouse' &&
          (edge.from_person_id === personId || edge.to_person_id === personId)
        )
        .map(edge => edge.from_person_id === personId ? edge.to_person_id : edge.from_person_id);
      if (gender) {
        const matched = spouseIds.find(id => graphData.nodes.find(node => node.id === id)?.gender === gender);
        if (matched) return matched;
      }
      return spouseIds[0];
    };

    const collectFamilySide = (personId: string, side: 'maternal' | 'paternal') => {
      const person = graphData.nodes.find(node => node.id === personId);
      if (!person) return new Set<string>();
      const shouldUseSelf = (side === 'maternal' && person.gender === 'F')
        || (side === 'paternal' && person.gender === 'M');
      const startId = shouldUseSelf
        ? personId
        : side === 'maternal'
          ? getSpouseId(personId, 'F')
          : getSpouseId(personId, 'M');
      if (!startId) return new Set<string>();

      const blockedIds = new Set<string>();
      const oppositeSpouseId = getSpouseId(personId);
      if (startId === personId) {
        if (oppositeSpouseId) blockedIds.add(oppositeSpouseId);
      } else {
        blockedIds.add(personId);
      }
      const visited = new Set<string>();
      const queue: string[] = [startId];
      const skipEdgesFromSelf = startId === personId;

      while (queue.length) {
        const current = queue.shift()!;
        if (visited.has(current) || blockedIds.has(current)) continue;
        visited.add(current);
        graphData.edges.forEach((edge) => {
          if (edge.type === 'in_law') return;
          if (skipEdgesFromSelf && current === personId) {
            if (edge.type === 'spouse') return;
            if (edge.type === 'parent_child' && edge.from_person_id === personId) return;
          }
          const neighbor = edge.from_person_id === current
            ? edge.to_person_id
            : edge.to_person_id === current
              ? edge.from_person_id
              : null;
          if (!neighbor || visited.has(neighbor) || blockedIds.has(neighbor)) return;
          queue.push(neighbor);
        });
      }

      visited.delete(personId);
      return visited;
    };

    const result = new Set<string>();
    collapsedMaternalRoots.forEach((id) => {
      collectFamilySide(id, 'maternal').forEach((nodeId) => result.add(nodeId));
    });
    collapsedPaternalRoots.forEach((id) => {
      collectFamilySide(id, 'paternal').forEach((nodeId) => result.add(nodeId));
    });
    const collectChildSide = (personId: string) => {
      const childIds = graphData.edges
        .filter(edge => edge.type === 'parent_child' && edge.from_person_id === personId)
        .map(edge => edge.to_person_id);
      if (!childIds.length) return new Set<string>();

      const visited = new Set<string>();
      const queue: string[] = [...childIds];

      while (queue.length) {
        const current = queue.shift()!;
        if (visited.has(current) || current === personId) continue;
        visited.add(current);
        const parentIds = graphData.edges
          .filter(edge => edge.type === 'parent_child' && edge.to_person_id === current)
          .map(edge => edge.from_person_id);

        graphData.edges.forEach((edge) => {
          if (edge.type === 'in_law') return;
          const neighbor = edge.from_person_id === current
            ? edge.to_person_id
            : edge.to_person_id === current
              ? edge.from_person_id
              : null;
          if (!neighbor || visited.has(neighbor) || neighbor === personId || parentIds.includes(neighbor)) return;
          queue.push(neighbor);
        });
      }

      return visited;
    };

    const collectSiblingSide = (personId: string) => {
      const siblingIds = graphData.edges
        .filter(edge => edge.type === 'sibling' && (edge.from_person_id === personId || edge.to_person_id === personId))
        .map(edge => edge.from_person_id === personId ? edge.to_person_id : edge.from_person_id);
      if (!siblingIds.length) return new Set<string>();

      const parentIds = graphData.edges
        .filter(edge => edge.type === 'parent_child' && edge.to_person_id === personId)
        .map(edge => edge.from_person_id);

      const blockedIds = new Set<string>([personId, ...parentIds]);
      const visited = new Set<string>();
      const queue: string[] = [...siblingIds];

      while (queue.length) {
        const current = queue.shift()!;
        if (visited.has(current) || blockedIds.has(current)) continue;
        visited.add(current);
        graphData.edges.forEach((edge) => {
          if (edge.type === 'in_law') return;
          const neighbor = edge.from_person_id === current
            ? edge.to_person_id
            : edge.to_person_id === current
              ? edge.from_person_id
              : null;
          if (!neighbor || visited.has(neighbor) || blockedIds.has(neighbor)) return;
          queue.push(neighbor);
        });
      }

      return visited;
    };

    collapsedChildRoots.forEach((id) => {
      collectChildSide(id).forEach((nodeId) => result.add(nodeId));
    });
    collapsedSiblingRoots.forEach((id) => {
      collectSiblingSide(id).forEach((nodeId) => result.add(nodeId));
    });

    return result;
  }, [graphData, collapsedMaternalRoots, collapsedPaternalRoots, collapsedChildRoots, collapsedSiblingRoots]);

  useEffect(() => {
    try {
      const storedFocus = localStorage.getItem('clan.dimFocusId');
      const storedNonRelatives = localStorage.getItem('clan.dimNonRelativesId');
      const storedMaternal = localStorage.getItem('clan.collapsedMaternalRoots');
      const storedPaternal = localStorage.getItem('clan.collapsedPaternalRoots');
      const storedChildren = localStorage.getItem('clan.collapsedChildRoots');
      const storedSiblings = localStorage.getItem('clan.collapsedSiblingRoots');
      if (storedFocus) setDimFocusId(storedFocus);
      if (storedNonRelatives) setDimNonRelativesId(storedNonRelatives);
      if (storedMaternal) {
        const ids = storedMaternal.split(',').map((id) => id.trim()).filter(Boolean);
        setCollapsedMaternalRoots(new Set(ids));
      }
      if (storedPaternal) {
        const ids = storedPaternal.split(',').map((id) => id.trim()).filter(Boolean);
        setCollapsedPaternalRoots(new Set(ids));
      }
      if (storedChildren) {
        const ids = storedChildren.split(',').map((id) => id.trim()).filter(Boolean);
        setCollapsedChildRoots(new Set(ids));
      }
      if (storedSiblings) {
        const ids = storedSiblings.split(',').map((id) => id.trim()).filter(Boolean);
        setCollapsedSiblingRoots(new Set(ids));
      }
    } catch (error) {
      console.warn('Failed to restore dim state:', error);
    }
  }, []);

  useEffect(() => {
    try {
      if (dimFocusId) {
        localStorage.setItem('clan.dimFocusId', dimFocusId);
      } else {
        localStorage.removeItem('clan.dimFocusId');
      }
      if (dimNonRelativesId) {
        localStorage.setItem('clan.dimNonRelativesId', dimNonRelativesId);
      } else {
        localStorage.removeItem('clan.dimNonRelativesId');
      }
      localStorage.setItem(
        'clan.collapsedMaternalRoots',
        Array.from(collapsedMaternalRoots.values()).join(',')
      );
      localStorage.setItem(
        'clan.collapsedPaternalRoots',
        Array.from(collapsedPaternalRoots.values()).join(',')
      );
      localStorage.setItem(
        'clan.collapsedChildRoots',
        Array.from(collapsedChildRoots.values()).join(',')
      );
      localStorage.setItem(
        'clan.collapsedSiblingRoots',
        Array.from(collapsedSiblingRoots.values()).join(',')
      );
    } catch (error) {
      console.warn('Failed to persist dim state:', error);
    }
  }, [dimFocusId, dimNonRelativesId, collapsedMaternalRoots, collapsedPaternalRoots, collapsedChildRoots, collapsedSiblingRoots]);

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

  const showToast = useCallback((message: string, tone: 'success' | 'warning') => {
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    setToast({ message, tone });
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
    }, 1400);
  }, []);

  useEffect(() => {
    if (!graphData) return;

    const desired = new Set<string>();
    for (const person of graphData.nodes) {
      if (collapsedNodeIds.has(person.id)) continue;
      if (person.avatar_url) {
        desired.add(person.avatar_url);
      }
    }

    setAvatarBlobs((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (!desired.has(key)) {
          URL.revokeObjectURL(next[key]);
          delete next[key];
          avatarFetches.current.delete(key);
          avatarFailures.current.delete(key);
        }
      }
      return next;
    });

    desired.forEach(async (key) => {
      if (avatarFetches.current.has(key) || avatarFailures.current.has(key)) return;
      if (avatarBlobMap.current[key]) return;
      avatarFetches.current.add(key);
      try {
        const blobUrl = await api.fetchAvatarBlobUrl(key);
        setAvatarBlobs((prev) => ({ ...prev, [key]: blobUrl }));
      } catch (error) {
        avatarFailures.current.add(key);
        console.error('Failed to load avatar:', error);
      } finally {
        avatarFetches.current.delete(key);
      }
    });
  }, [graphData, collapsedNodeIds]);

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

  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    console.log('Edge clicked:', edge.id);
    if (!graphData) {
      setSelectedEdge(edge.id);
      setSelectedNode(null);
      return;
    }
    const candidates = graphData.edges.filter((item) => {
      const sameForward = item.from_person_id === edge.source && item.to_person_id === edge.target;
      const sameReverse = item.from_person_id === edge.target && item.to_person_id === edge.source;
      return sameForward || sameReverse;
    }).map((item) => ({ id: `e${item.id}` }));
    if (candidates.length > 1) {
      const currentIndex = candidates.findIndex((item) => item.id === selectedEdge);
      const nextIndex = currentIndex === -1 ? candidates.findIndex((item) => item.id === edge.id) : currentIndex + 1;
      const nextEdge = candidates[nextIndex % candidates.length] || { id: edge.id };
      setSelectedEdge(nextEdge.id);
    } else {
      setSelectedEdge(edge.id);
    }
    setSelectedNode(null);
  }, [graphData, selectedEdge]);

  const handleAvatarClick = useCallback((person: Person, avatarUrl: string) => {
    setSelectedNode(person.id);
    setSelectedEdge(null);
    setContextMenu(null);
    setAvatarPreview({ url: avatarUrl, name: person.name });
  }, []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const openUp = event.clientY > window.innerHeight * 0.6;
      setContextMenu({
        id: node.id,
        top: openUp ? undefined : event.clientY,
        bottom: openUp ? window.innerHeight - event.clientY : undefined,
        left: event.clientX,
        openUp,
      });
    },
    []
  );

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
    setSelectedEdge(null);
  }, []);

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
      const sourceSurname = getSurname(sourcePerson?.name);
      const targetSurname = getSurname(targetPerson?.name);
      const sameSurname = Boolean(sourceSurname && targetSurname && sourceSurname === targetSurname);
      const gendersDifferent = Boolean(
        sourcePerson?.gender &&
        targetPerson?.gender &&
        sourcePerson.gender !== 'O' &&
        targetPerson.gender !== 'O' &&
        sourcePerson.gender !== targetPerson.gender
      );
      const relationshipType = isHorizontal
        ? (sameSurname ? 'sibling' : (gendersDifferent ? 'spouse' : 'sibling'))
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
    setDragGuideY(null);
    dragSnapRef.current = null;
  }, [updatePersonPosition]);

  const onNodeDrag = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!reactFlowInstance) return;
    const viewport = (reactFlowInstance as ReactFlowInstance & { toObject?: () => { viewport?: { x: number; y: number; zoom: number } } })
      .toObject?.().viewport;
    if (!viewport) return;

    const threshold = 12;
    const releaseThreshold = 24;
    let nearestY: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    nodesRef.current.forEach((other) => {
      if (other.id === node.id) return;
      const distance = Math.abs(other.position.y - node.position.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestY = other.position.y;
      }
    });

    const existingSnap = dragSnapRef.current;
    if (existingSnap && existingSnap.id === node.id) {
      const distanceFromSnap = Math.abs(node.position.y - existingSnap.y);
      if (distanceFromSnap >= releaseThreshold) {
        dragSnapRef.current = null;
      }
    }
    if (!dragSnapRef.current && nearestY !== null && nearestDistance <= threshold) {
      dragSnapRef.current = { id: node.id, y: nearestY };
    }

    const snapTarget = dragSnapRef.current?.id === node.id ? dragSnapRef.current.y : null;
    if (snapTarget !== null && node.position.y !== snapTarget && setNodesRef.current) {
      setNodesRef.current((prev) =>
        prev.map((item) => item.id === node.id ? { ...item, position: { ...item.position, y: snapTarget } } : item)
      );
    }

    if (snapTarget !== null) {
      const screenY = snapTarget * viewport.zoom + viewport.y;
      setDragGuideY(screenY);
    } else {
      setDragGuideY(null);
    }
  }, [reactFlowInstance]);

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
      setUndoStack(prev => [{ type: 'delete', person, relationships, previousCenterId } as const, ...prev].slice(0, 10));
      setSelectedNode(null);
      setSelectedEdge(null);
    } catch (error) {
      console.error('Failed to delete person:', error);
    }
  }, [graphData, deletePerson, centerId, setCenterId]);

  const handleDeleteRelations = useCallback(async (id: string) => {
    if (!graphData) return;
    const relatedEdges = graphData.edges.filter(
      (edge) => edge.from_person_id === id || edge.to_person_id === id
    );
    if (!relatedEdges.length) return;

    try {
      for (const edge of relatedEdges) {
        await deleteRelationship(`e${edge.id}`);
      }
      setSelectedEdge(null);
    } catch (error) {
      console.error('Failed to delete relations:', error);
    }
  }, [graphData, deleteRelationship]);

  const handleDeleteSiblingRelations = useCallback(async (id: string) => {
    if (!graphData) return;
    const relatedEdges = graphData.edges.filter(
      (edge) =>
        edge.type === 'sibling' &&
        (edge.from_person_id === id || edge.to_person_id === id)
    );
    if (!relatedEdges.length) return;

    try {
      for (const edge of relatedEdges) {
        await deleteRelationship(`e${edge.id}`);
      }
      setSelectedEdge(null);
    } catch (error) {
      console.error('Failed to delete sibling relations:', error);
    }
  }, [graphData, deleteRelationship]);

  const handleDeleteChildRelations = useCallback(async (id: string) => {
    if (!graphData) return;
    const relatedEdges = graphData.edges.filter(
      (edge) => edge.type === 'parent_child' && edge.from_person_id === id
    );
    if (!relatedEdges.length) return;

    try {
      for (const edge of relatedEdges) {
        await deleteRelationship(`e${edge.id}`);
      }
      setSelectedEdge(null);
    } catch (error) {
      console.error('Failed to delete child relations:', error);
    }
  }, [graphData, deleteRelationship]);

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

    const visibleNodes = graphData.nodes.filter((person) => !collapsedNodeIds.has(person.id));

    return visibleNodes.map((person, index) => {
      const genderColor = person.gender === 'M' ? '#3b82f6' : person.gender === 'F' ? '#ec4899' : '#8b5cf6';
      const title = person.title || '';
      const avatarUrl = person.avatar_url ? avatarBlobs[person.avatar_url] : null;

      const storedPosition = nodePositionMap.current[person.id];
      const position = storedPosition || person.metadata?.position || (
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
          hasCollapsedSide: collapsedMaternalRoots.has(person.id)
            || collapsedPaternalRoots.has(person.id)
            || collapsedChildRoots.has(person.id)
            || collapsedSiblingRoots.has(person.id),
        },
        style: {
          background: 'transparent',
          border: 'none',
          opacity: dimIds.has(person.id) ? 0.35 : 1,
        },
      };
    });
  }, [graphData, collapsedNodeIds, collapsedMaternalRoots, collapsedPaternalRoots, collapsedChildRoots, collapsedSiblingRoots, dimIds, centerId, centerFlashId, handleAvatarClick, avatarBlobs]);

  const initialEdges: Edge[] = useMemo(() => {
    if (!graphData) return [];

    return graphData.edges
      .filter((edge) => !collapsedNodeIds.has(edge.from_person_id) && !collapsedNodeIds.has(edge.to_person_id))
      .map((edge) => {
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
  }, [graphData, collapsedNodeIds, selectedEdge, dimIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodesRef.current = setNodes;
  }, [setNodes]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    nodePositionMap.current = nodes.reduce<Record<string, { x: number; y: number }>>((acc, node) => {
      acc[node.id] = node.position;
      return acc;
    }, {});
    try {
      localStorage.setItem('clan.nodePositions', JSON.stringify(nodePositionMap.current));
    } catch (error) {
      console.warn('Failed to persist node positions:', error);
    }
  }, [nodes]);

  const handleNodeClick = useCallback((event: React.MouseEvent, nodeId: string) => {
    console.log('Node clicked:', nodeId);
    const isMultiSelect = event.ctrlKey || event.metaKey;
    if (!isMultiSelect) {
      setNodes((prev) =>
        prev.map((node) => {
          const isTarget = node.id === nodeId;
          const nextSelected = selectedNode === nodeId ? false : isTarget;
          return node.selected === nextSelected ? node : { ...node, selected: nextSelected };
        })
      );
    }
    setSelectedNode((prev) => (prev === nodeId && !isMultiSelect ? null : nodeId));
    setSelectedEdge(null);

    if (linkMode) {
      const relationshipType = getDefaultRelationshipType(linkMode.from, nodeId);
      createRelationship(linkMode.from, nodeId, undefined, undefined, relationshipType);
      setLinkMode(null);
    }
  }, [linkMode, createRelationship, getDefaultRelationshipType, setNodes, selectedNode]);

  const selectedNodeIds = useMemo(
    () => nodes.filter(node => node.selected).map(node => node.id),
    [nodes]
  );

  useEffect(() => {
    if (!selectedNode) return;
    if (collapsedNodeIds.has(selectedNode)) {
      setSelectedNode(null);
    }
  }, [selectedNode, collapsedNodeIds]);

  const handleUndo = useCallback(async () => {
    const entry = undoStack[0];
    if (!entry) return;

    try {
      if (entry.type === 'align') {
        const nextPositions = entry.positions;
        setNodes((prev) => prev.map((node) => {
          const position = nextPositions[node.id];
          if (!position) return node;
          updatePersonPosition(node.id, position);
          return { ...node, position };
        }));
      } else {
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
      }
      setUndoStack(prev => prev.slice(1));
      fetchGraph();
    } catch (error) {
      console.error('Failed to undo delete:', error);
    }
  }, [undoStack, fetchGraph, setCenterId, setNodes, updatePersonPosition]);

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
      person.english_name || undefined,
      person.gender,
      person.dob,
      person.dod,
      person.tob,
      person.tod,
      newMetadata,
      undefined,
      person.avatar_url ?? undefined,
      { skipFetch: true }
    );
  }, [graphData, nodes, createPerson]);

  const alignSelectedNodes = useCallback((direction: 'horizontal' | 'vertical') => {
    const ids = selectedNodeIds.length > 1 ? selectedNodeIds : [];
    if (ids.length < 2) return;

    const selectedNodes = nodes.filter(node => ids.includes(node.id));
    const previousPositions = selectedNodes.reduce<Record<string, { x: number; y: number }>>((acc, node) => {
      acc[node.id] = { ...node.position };
      return acc;
    }, {});
    const sorted = [...selectedNodes].sort((a, b) => {
      return direction === 'horizontal'
        ? a.position.x - b.position.x
        : a.position.y - b.position.y;
    });

    const min = direction === 'horizontal'
      ? sorted[0].position.x
      : sorted[0].position.y;
    const max = direction === 'horizontal'
      ? sorted[sorted.length - 1].position.x
      : sorted[sorted.length - 1].position.y;
    const gap = sorted.length > 1 ? (max - min) / (sorted.length - 1) : 0;
    const alignValue = direction === 'horizontal'
      ? sorted.reduce((sum, node) => sum + node.position.y, 0) / sorted.length
      : sorted.reduce((sum, node) => sum + node.position.x, 0) / sorted.length;

    setNodes((prev) => prev.map((node) => {
      const index = sorted.findIndex(item => item.id === node.id);
      if (index === -1) return node;
      const position = direction === 'horizontal'
        ? { x: min + gap * index, y: alignValue }
        : { x: alignValue, y: min + gap * index };
      updatePersonPosition(node.id, position);
      return { ...node, position };
    }));
    setUndoStack(prev => [{ type: 'align', positions: previousPositions } as const, ...prev].slice(0, 10));
  }, [nodes, selectedNodeIds, setNodes, updatePersonPosition]);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditableTarget(e.target)) {
        if (selectedEdge) {
          deleteRelationship(selectedEdge);
          setSelectedEdge(null);
        } else if (selectedNode && !editingPersonId && !showAddModal) {
          handleDeletePerson(selectedNode);
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedNode && graphData) {
        const person = graphData.nodes.find(p => p.id === selectedNode);
        if (person) {
          console.log('Copied person:', person.name);
          setCopiedPerson(person);
          showToast('已複製節點', 'success');
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && copiedPerson) {
        console.log('Pasting person:', copiedPerson.name);

        const fallbackPos = copiedPerson.metadata?.position || { x: 500, y: 300 };
        const position = lastMousePosition
          ? { x: lastMousePosition.x, y: lastMousePosition.y }
          : { x: fallbackPos.x + 40, y: fallbackPos.y + 40 };
        const newMetadata = {
          ...copiedPerson.metadata,
          position
        };

        await createPerson(
          copiedPerson.name,
          copiedPerson.english_name || undefined,
          copiedPerson.gender,
          copiedPerson.dob,
          copiedPerson.dod,
          copiedPerson.tob,
          copiedPerson.tod,
          newMetadata,
          undefined,
          undefined,
          { skipFetch: true }
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
        onDeleteRelationship={() => {
          if (selectedEdge) {
            deleteRelationship(selectedEdge);
            setSelectedEdge(null);
          }
        }}
      />

      <div className="flow-container">
        {dragGuideY !== null && (
          <div className="drag-guide-line" style={{ top: dragGuideY }} />
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setReactFlowInstance}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          connectionRadius={40}
          onNodeClick={(event, node) => {
            handleNodeClick(event, node.id);
            setContextMenu(null);
            setAvatarPreview(null);
          }}
          onNodeMouseMove={(event) => {
            onPaneMouseMove(event);
          }}
          onNodeDoubleClick={(_e, node) => {
            setContextMenu(null);
            setAvatarPreview(null);
            handleEditPerson(node.id);
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
            onDeleteRelations={handleDeleteRelations}
            onDeleteSiblingRelations={handleDeleteSiblingRelations}
            onDeleteChildRelations={handleDeleteChildRelations}
            onCopyTitle={(title) => {
              navigator.clipboard.writeText(title).then(() => {
                showToast('已複製稱呼', 'success');
              }).catch(() => {
                showToast('複製失敗', 'warning');
              });
            }}
            onDuplicateBottomRight={handleDuplicateBottomRight}
            selectedCount={selectedNodeIds.length}
            onAlignHorizontal={() => alignSelectedNodes('horizontal')}
            onAlignVertical={() => alignSelectedNodes('vertical')}
            onToggleDimRelatives={(id) => {
              setDimNonRelativesId(null);
              setDimFocusId(prev => (prev === id ? null : id));
            }}
            onToggleDimNonRelatives={(id) => {
              setDimFocusId(null);
              setDimNonRelativesId(prev => (prev === id ? null : id));
            }}
            onToggleCollapseMaternal={(id) => {
              setCollapsedMaternalRoots((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
            }}
            onToggleCollapsePaternal={(id) => {
              setCollapsedPaternalRoots((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
            }}
            onToggleCollapseChildren={(id) => {
              setCollapsedChildRoots((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
            }}
            onToggleCollapseSiblings={(id) => {
              setCollapsedSiblingRoots((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
            }}
            dimRelativesActive={dimFocusId === contextMenu.id}
            dimNonRelativesActive={dimNonRelativesId === contextMenu.id}
            maternalCollapsed={collapsedMaternalRoots.has(contextMenu.id)}
            paternalCollapsed={collapsedPaternalRoots.has(contextMenu.id)}
            childrenCollapsed={collapsedChildRoots.has(contextMenu.id)}
            siblingsCollapsed={collapsedSiblingRoots.has(contextMenu.id)}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>

      {toast && (
        <div
          className={`toast toast-${toast.tone}`}
          style={{ bottom: '2.5rem' }}
        >
          {toast.message}
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
          onUnsavedClose={() => showToast('未儲存變更', 'warning')}
          onSubmit={async (id, updates, avatarFile, removeAvatar) => {
            const nextUpdates = { ...updates } as Partial<Person> & { avatar_url?: string | null };
            const shouldRefreshAfterAvatar = Boolean(avatarFile || removeAvatar);
            if (removeAvatar) {
              nextUpdates.avatar_url = null;
            }
            if (avatarFile) {
              const { avatar_url } = await api.uploadAvatar(id, avatarFile);
              nextUpdates.avatar_url = avatar_url;
            }
            await updatePerson(id, nextUpdates);
            setEditingPersonId(null);
            showToast('已儲存', 'success');
            if (shouldRefreshAfterAvatar) {
              try {
                localStorage.setItem('clan.nodePositions', JSON.stringify(nodePositionMap.current));
              } catch (error) {
                console.warn('Failed to persist node positions:', error);
              }
              window.setTimeout(() => window.location.reload(), 300);
            }
          }}
        />
      )}
    </div>
  );
}
