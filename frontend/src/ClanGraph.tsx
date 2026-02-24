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
import { CreateUserModal } from './components/CreateUserModal';
import { ReportIssueModal } from './components/ReportIssueModal';
import type { GraphSettings } from './graphSettings';
import { createExactNameMatcher, createNameMatcher } from './utils/nameSearch';
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
    type: 'create_relationships';
    relationshipIds: number[];
  }
  | {
    type: 'align';
    positions: Record<string, { x: number; y: number }>;
  }
  | {
    type: 'move';
    positions: Record<string, { x: number; y: number }>;
    draggedId?: string;
  };

type Gender = Person['gender'];
type RelationshipChoiceType = 'parent_child' | 'spouse' | 'sibling';
type PendingRelationshipChoice = {
  from: string;
  to: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  suggestedType: RelationshipChoiceType;
};

const getSurname = (name?: string | null) => name?.trim().charAt(0) ?? '';

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || target.isContentEditable;
};
const CTRL_HOVER_DIM_NODE_OPACITY = 0.18;
const CTRL_HOVER_DIM_EDGE_OPACITY = 0.12;
const CTRL_HOVER_EDGE_WIDTH_BOOST = 2;
const CTRL_HOVER_MIN_EDGE_WIDTH = 4;
const COARSE_NEAR_GAP_BONUS = 6;
const COARSE_NEAR_CENTER_Y_BONUS = 6;
const COARSE_MIN_DRAG_DISTANCE_BONUS = 6;
const COARSE_Y_SNAP_BONUS = 4;
const COARSE_Y_RELEASE_BONUS = 6;
const COARSE_X_SNAP_BONUS = 10;
const COARSE_X_RELEASE_BONUS = 12;
const COARSE_SPOUSE_SNAP_BONUS = 14;
const COARSE_SPOUSE_RELEASE_BONUS = 20;

type ClanGraphProps = {
  username: string | null;
  readOnly?: boolean;
  isAdmin?: boolean;
  graphSettings: GraphSettings;
  onManageUsers?: () => void;
  onManageNotifications?: () => void;
  onManageSessions?: () => void;
  onOpenSettings?: () => void;
  onLogout: () => void;
};

export function ClanGraph({
  username,
  readOnly,
  isAdmin,
  graphSettings,
  onManageUsers,
  onManageNotifications,
  onManageSessions,
  onOpenSettings,
  onLogout
}: ClanGraphProps) {
  const isReadOnly = Boolean(readOnly);
  const canManageUsers = Boolean(isAdmin);
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
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [copiedPerson, setCopiedPerson] = useState<Person | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [lastMousePosition, setLastMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [fitViewEnabled] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [lockLoaded, setLockLoaded] = useState(false);
  const [pendingCenterId, setPendingCenterId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ id: string; zoom: number } | null>(null);
  const [pendingFocusPosition, setPendingFocusPosition] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const [dragGuideY, setDragGuideY] = useState<number | null>(null);
  const [dimFocusId, setDimFocusId] = useState<string | null>(null);
  const [dimNonRelativesId, setDimNonRelativesId] = useState<string | null>(null);
  const [dimNodeIds, setDimNodeIds] = useState<Set<string>>(new Set());
  const [dimExcludedNodeIds, setDimExcludedNodeIds] = useState<Set<string>>(new Set());
  const [collapsedMaternalRoots, setCollapsedMaternalRoots] = useState<Set<string>>(new Set());
  const [collapsedPaternalRoots, setCollapsedPaternalRoots] = useState<Set<string>>(new Set());
  const [collapsedChildRoots, setCollapsedChildRoots] = useState<Set<string>>(new Set());
  const [collapsedSiblingRoots, setCollapsedSiblingRoots] = useState<Set<string>>(new Set());
  const [centerFlashId, setCenterFlashId] = useState<string | null>(null);
  const [searchFlashId, setSearchFlashId] = useState<string | null>(null);
  const [focusHoverId, setFocusHoverId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [mobileNodeDragging, setMobileNodeDragging] = useState(false);
  const [mobileConnecting, setMobileConnecting] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [lastEditedId, setLastEditedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'warning' } | null>(null);
  const [syncingPositions, setSyncingPositions] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<{ url: string; name: string } | null>(null);
  const [avatarBlobs, setAvatarBlobs] = useState<Record<string, string>>({});
  const [pendingRelationshipChoice, setPendingRelationshipChoice] = useState<PendingRelationshipChoice | null>(null);
  const [reportIssuePersonId, setReportIssuePersonId] = useState<string | null>(null);
  const [pendingNotificationCount, setPendingNotificationCount] = useState(0);
  const pendingFocusRetryRef = useRef<number | null>(null);
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
  const baseLockStorageKey = 'clan.flowLocked';
  const lockStorageKey = useMemo(() => (
    username ? `${baseLockStorageKey}.${username}` : baseLockStorageKey
  ), [username]);
  const getInitialNodePositions = () => {
    return {};
  };
  const nodePositionMap = useRef<Record<string, { x: number; y: number }>>(getInitialNodePositions());
  const nodesRef = useRef<Node[]>([]);
  const setNodesRef = useRef<React.Dispatch<React.SetStateAction<Node[]>> | null>(null);
  const dragSnapRef = useRef<{ id: string; sourceId: string; y: number } | null>(null);
  const dragSnapXRef = useRef<{ id: string; x: number } | null>(null);
  const spouseSnapRef = useRef<{ id: string; spouseId: string; x: number; y: number } | null>(null);
  const dragStartPositions = useRef<Record<string, { x: number; y: number }> | null>(null);
  const selectedNodeIdsRef = useRef<string[]>([]);
  const expandSelectTimer = useRef<number | null>(null);
  const searchFlashTimer = useRef<number | null>(null);
  const focusHoverTimer = useRef<number | null>(null);
  const lastEditedFocusTimer = useRef<number | null>(null);
  const avatarBlobMap = useRef<Record<string, string>>({});
  const avatarFetches = useRef(new Set<string>());
  const avatarFailures = useRef(new Set<string>());
  const toastTimer = useRef<number | null>(null);
  const expandRelayoutTimer = useRef<number | null>(null);
  const canUndo = undoStack.length > 0;
  const allowNodeDragging = !isReadOnly && (!isLocked || isCoarsePointer);
  const allowNodeConnecting = !isReadOnly && (!isLocked || isCoarsePointer);
  const reportIssuePerson = useMemo(() => (
    reportIssuePersonId
      ? graphData?.nodes.find((person) => person.id === reportIssuePersonId) ?? null
      : null
  ), [graphData, reportIssuePersonId]);

  useEffect(() => {
    if (!canManageUsers) {
      setPendingNotificationCount(0);
      return;
    }

    let cancelled = false;
    const loadStats = async () => {
      try {
        const stats = await api.fetchNotificationStats();
        if (!cancelled) {
          setPendingNotificationCount(stats.unresolved);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to fetch notification stats:', error);
        }
      }
    };

    void loadStats();
    const timer = window.setInterval(() => {
      void loadStats();
    }, 10000);
    const handleFocus = () => {
      void loadStats();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
    };
  }, [canManageUsers]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(pointer: coarse)');
    const apply = () => setIsCoarsePointer(media.matches);
    apply();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey) {
        setIsShiftPressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.shiftKey) {
        setIsShiftPressed(false);
      }
    };
    const handleWindowBlur = () => {
      setIsShiftPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    avatarBlobMap.current = avatarBlobs;
  }, [avatarBlobs]);

  useEffect(() => {
    if (editingPersonId) {
      setCopiedPerson(null);
    }
  }, [editingPersonId]);

  const handleInteractiveChange = useCallback((isInteractive: boolean) => {
    setIsLocked(!isInteractive);
  }, []);

  useEffect(() => {
    setLockLoaded(false);
    try {
      let stored = localStorage.getItem(lockStorageKey);
      if (stored === null && lockStorageKey !== baseLockStorageKey) {
        stored = localStorage.getItem(baseLockStorageKey);
        if (stored !== null) {
          localStorage.setItem(lockStorageKey, stored);
        }
      }
      if (stored === null) {
        setIsLocked(true);
        setLockLoaded(true);
        return;
      }
      setIsLocked(stored === 'true');
    } catch (error) {
      console.warn('Failed to restore lock state:', error);
      setIsLocked(true);
    } finally {
      setLockLoaded(true);
    }
  }, [lockStorageKey]);

  useEffect(() => {
    if (!lockLoaded) return;
    try {
      localStorage.setItem(lockStorageKey, String(isLocked));
    } catch (error) {
      console.warn('Failed to persist lock state:', error);
    }
  }, [lockStorageKey, isLocked, lockLoaded]);


  const getSpouseId = useCallback((personId: string, gender?: 'M' | 'F') => {
    if (!graphData) return undefined;
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
  }, [graphData]);

  const collectFamilySide = useCallback((personId: string, side: 'maternal' | 'paternal') => {
    if (!graphData) return new Set<string>();
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
  }, [graphData, getSpouseId]);

  const collectChildSide = useCallback((personId: string) => {
    if (!graphData) return new Set<string>();
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
  }, [graphData]);

  const collectSiblingSide = useCallback((personId: string) => {
    if (!graphData) return new Set<string>();
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
  }, [graphData]);

  const getStoredPosition = useCallback((id: string) => {
    return graphData?.nodes.find(node => node.id === id)?.metadata?.position
      || nodePositionMap.current[id]
      || null;
  }, [graphData]);

  const collapsedNodeIds = useMemo(() => {
    if (!graphData) return new Set<string>();
    const result = new Set<string>();
    collapsedMaternalRoots.forEach((id) => {
      collectFamilySide(id, 'maternal').forEach((nodeId) => result.add(nodeId));
    });
    collapsedPaternalRoots.forEach((id) => {
      collectFamilySide(id, 'paternal').forEach((nodeId) => result.add(nodeId));
    });
    collapsedChildRoots.forEach((id) => {
      collectChildSide(id).forEach((nodeId) => result.add(nodeId));
    });
    collapsedSiblingRoots.forEach((id) => {
      collectSiblingSide(id).forEach((nodeId) => result.add(nodeId));
    });

    return result;
  }, [graphData, collapsedMaternalRoots, collapsedPaternalRoots, collapsedChildRoots, collapsedSiblingRoots, collectFamilySide, collectChildSide, collectSiblingSide]);

  const selectExpandedNodes = useCallback((ids: Set<string>) => {
    if (!ids.size) return;
    if (expandSelectTimer.current) {
      window.clearTimeout(expandSelectTimer.current);
    }
    expandSelectTimer.current = window.setTimeout(() => {
      if (!setNodesRef.current) return;
      setNodesRef.current((prev) => prev.map((node) => ({
        ...node,
        selected: ids.has(node.id),
      })));
    }, 1000);
  }, []);

  const shiftExpandedNodes = useCallback((ids: Set<string>) => {
    if (!ids.size || !setNodesRef.current) return;
    const expandedIds = new Set(ids);
    const baseNodes = nodesRef.current.filter((node) => !expandedIds.has(node.id));
    const expandedNodes = nodesRef.current.filter((node) => expandedIds.has(node.id));
    if (!expandedNodes.length || !baseNodes.length) return;

    const getSize = (node: Node) => ({
      width: node.width ?? 120,
      height: node.height ?? 120
    });

    const overlaps = (offsetX: number, offsetY: number) => {
      for (const exp of expandedNodes) {
        const size = getSize(exp);
        const ax = exp.position.x + offsetX;
        const ay = exp.position.y + offsetY;
        const aw = size.width;
        const ah = size.height;
        for (const base of baseNodes) {
          const bSize = getSize(base);
          const bx = base.position.x;
          const by = base.position.y;
          const bw = bSize.width;
          const bh = bSize.height;
          const intersects = ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
          if (intersects) return true;
        }
      }
      return false;
    };

    let offsetX = 0;
    let offsetY = 0;
    if (overlaps(0, 0)) {
      const stepX = graphSettings.expandShiftStepX;
      const stepY = graphSettings.expandShiftStepY;
      for (let i = 1; i <= 10; i += 1) {
        const tryX = stepX * i;
        const tryY = stepY * i;
        if (!overlaps(tryX, tryY)) {
          offsetX = tryX;
          offsetY = tryY;
          break;
        }
      }
      if (!offsetX && !offsetY) {
        offsetX = stepX;
        offsetY = stepY;
      }
    }

    if (!offsetX && !offsetY) return;

    setNodesRef.current((prev) => prev.map((node) => {
      if (!expandedIds.has(node.id)) return node;
      const position = { x: node.position.x + offsetX, y: node.position.y + offsetY };
      nodePositionMap.current[node.id] = position;
      if (!isReadOnly) {
        updatePersonPosition(node.id, position);
      }
      return { ...node, position };
    }));

    try {
      localStorage.setItem('clan.nodePositions', JSON.stringify(nodePositionMap.current));
    } catch (error) {
      console.warn('Failed to persist node positions:', error);
    }
  }, [graphSettings.expandShiftStepX, graphSettings.expandShiftStepY, isReadOnly, updatePersonPosition]);

  const scheduleExpandedRelayout = useCallback((ids: Set<string>) => {
    if (!ids.size) return;
    if (expandRelayoutTimer.current) {
      window.clearTimeout(expandRelayoutTimer.current);
    }
    expandRelayoutTimer.current = window.setTimeout(() => {
      shiftExpandedNodes(ids);
    }, 120);
  }, [shiftExpandedNodes]);

  useEffect(() => {
    try {
      const storedFocus = localStorage.getItem('clan.dimFocusId');
      const storedNonRelatives = localStorage.getItem('clan.dimNonRelativesId');
      const storedDimNodes = localStorage.getItem('clan.dimNodeIds');
      const storedDimExcludedNodes = localStorage.getItem('clan.dimExcludedNodeIds');
      const storedMaternal = localStorage.getItem('clan.collapsedMaternalRoots');
      const storedPaternal = localStorage.getItem('clan.collapsedPaternalRoots');
      const storedChildren = localStorage.getItem('clan.collapsedChildRoots');
      const storedSiblings = localStorage.getItem('clan.collapsedSiblingRoots');
      if (storedFocus) setDimFocusId(storedFocus);
      if (storedNonRelatives) setDimNonRelativesId(storedNonRelatives);
      if (storedDimNodes) {
        const ids = storedDimNodes.split(',').map((id) => id.trim()).filter(Boolean);
        setDimNodeIds(new Set(ids));
      }
      if (storedDimExcludedNodes) {
        const ids = storedDimExcludedNodes.split(',').map((id) => id.trim()).filter(Boolean);
        setDimExcludedNodeIds(new Set(ids));
      }
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
        'clan.dimNodeIds',
        Array.from(dimNodeIds.values()).join(',')
      );
      localStorage.setItem(
        'clan.dimExcludedNodeIds',
        Array.from(dimExcludedNodeIds.values()).join(',')
      );
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
  }, [dimFocusId, dimNonRelativesId, dimNodeIds, dimExcludedNodeIds, collapsedMaternalRoots, collapsedPaternalRoots, collapsedChildRoots, collapsedSiblingRoots]);

  useEffect(() => () => {
    if (expandSelectTimer.current) {
      window.clearTimeout(expandSelectTimer.current);
    }
    if (lastEditedFocusTimer.current) {
      window.clearInterval(lastEditedFocusTimer.current);
    }
  }, []);

  useEffect(() => {
    if (!graphData) return;
    const validIds = new Set(graphData.nodes.map((node) => node.id));
    setDimNodeIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setDimExcludedNodeIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [graphData]);

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

  const hashAvatarFile = useCallback(async (file: File) => {
    if (!window.crypto?.subtle) {
      return null;
    }
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }, []);

  const ensureEditable = useCallback(() => {
    if (!isReadOnly) return true;
    showToast('只讀模式，無法編輯', 'warning');
    return false;
  }, [isReadOnly, showToast]);

  const createRelationshipWithUndo = useCallback(async (
    from: string,
    to: string,
    sourceHandle?: string | null,
    targetHandle?: string | null,
    type: 'parent_child' | 'spouse' | 'ex_spouse' | 'sibling' | 'in_law' = 'parent_child',
    metadataOverride?: any
  ) => {
    const createdIds = await createRelationship(from, to, sourceHandle, targetHandle, type, metadataOverride);
    if (!createdIds.length) return;
    setUndoStack((prev) => [
      { type: 'create_relationships', relationshipIds: createdIds } as const,
      ...prev,
    ].slice(0, 10));
  }, [createRelationship]);

  const normalizeRelationshipChoiceType = useCallback((type: string): RelationshipChoiceType => {
    if (type === 'spouse') return 'spouse';
    if (type === 'sibling') return 'sibling';
    return 'parent_child';
  }, []);

  const requestRelationshipChoice = useCallback((choice: PendingRelationshipChoice) => {
    setPendingRelationshipChoice(choice);
  }, []);

  const confirmRelationshipChoice = useCallback((type: RelationshipChoiceType) => {
    if (!pendingRelationshipChoice) return;
    const choice = pendingRelationshipChoice;
    setPendingRelationshipChoice(null);
    void createRelationshipWithUndo(
      choice.from,
      choice.to,
      choice.sourceHandle,
      choice.targetHandle,
      type
    );
  }, [pendingRelationshipChoice, createRelationshipWithUndo]);

  const hasDirectRelationship = useCallback((aId: string, bId: string, type?: string) => {
    if (!graphData) return false;
    return graphData.edges.some((edge) => {
      const matchesPair = (
        (edge.from_person_id === aId && edge.to_person_id === bId)
        || (edge.from_person_id === bId && edge.to_person_id === aId)
      );
      if (!matchesPair) return false;
      return type ? edge.type === type : true;
    });
  }, [graphData]);

  const getAutoSpouseLinkCandidate = useCallback((
    draggedId: string,
    selectedIds: string[],
    options?: { overlapOnly?: boolean }
  ) => {
    if (!graphData) return null as { from: string; to: string } | null;
    if (selectedIds.length !== 1 || selectedIds[0] !== draggedId) return null;

    const draggedNode = nodesRef.current.find((item) => item.id === draggedId);
    const draggedPerson = graphData.nodes.find((item) => item.id === draggedId);
    if (!draggedNode || !draggedPerson) return null;
    if (!draggedPerson.gender || draggedPerson.gender === 'O') return null;

    const draggedWidth = draggedNode.width ?? 120;
    const draggedHeight = draggedNode.height ?? 120;
    const draggedArea = draggedWidth * draggedHeight;
    const nearGapXThreshold = graphSettings.nearGapXThreshold + (isCoarsePointer ? COARSE_NEAR_GAP_BONUS : 0);
    const nearCenterYThreshold = graphSettings.nearCenterYThreshold + (isCoarsePointer ? COARSE_NEAR_CENTER_Y_BONUS : 0);
    const minVerticalOverlapRatio = graphSettings.autoSpouseMinVerticalOverlapRatio;
    const minOverlapRatio = graphSettings.autoSpouseMinOverlapRatio;
    const candidates: Array<{ to: string; score: number }> = [];
    const overlapOnly = Boolean(options?.overlapOnly);

    for (const otherNode of nodesRef.current) {
      if (otherNode.id === draggedId) continue;
      const otherPerson = graphData.nodes.find((item) => item.id === otherNode.id);
      if (!otherPerson || !otherPerson.gender || otherPerson.gender === 'O') continue;
      if (otherPerson.gender === draggedPerson.gender) continue;

      if (hasDirectRelationship(draggedId, otherNode.id, 'spouse')) continue;
      if (hasDirectRelationship(draggedId, otherNode.id)) continue;

      const otherWidth = otherNode.width ?? 120;
      const otherHeight = otherNode.height ?? 120;
      const otherArea = otherWidth * otherHeight;
      const overlapWidth = Math.min(
        draggedNode.position.x + draggedWidth,
        otherNode.position.x + otherWidth
      ) - Math.max(draggedNode.position.x, otherNode.position.x);
      const overlapHeight = Math.min(
        draggedNode.position.y + draggedHeight,
        otherNode.position.y + otherHeight
      ) - Math.max(draggedNode.position.y, otherNode.position.y);
      const overlapArea = overlapWidth > 0 && overlapHeight > 0
        ? overlapWidth * overlapHeight
        : 0;
      const overlapRatio = overlapArea > 0
        ? overlapArea / Math.max(1, Math.min(draggedArea, otherArea))
        : 0;

      const gapX = Math.max(
        0,
        otherNode.position.x - (draggedNode.position.x + draggedWidth),
        draggedNode.position.x - (otherNode.position.x + otherWidth)
      );
      const gapY = Math.max(
        0,
        otherNode.position.y - (draggedNode.position.y + draggedHeight),
        draggedNode.position.y - (otherNode.position.y + otherHeight)
      );
      const centerYDragged = draggedNode.position.y + draggedHeight / 2;
      const centerYOther = otherNode.position.y + otherHeight / 2;
      const centerYDelta = Math.abs(centerYDragged - centerYOther);
      const verticalOverlapRatio = overlapHeight > 0
        ? overlapHeight / Math.max(1, Math.min(draggedHeight, otherHeight))
        : 0;

      const strongOverlap = overlapRatio >= minOverlapRatio;
      const horizontalNear = !overlapOnly && (
        gapX <= nearGapXThreshold
        && gapY <= nearCenterYThreshold
        && centerYDelta <= nearCenterYThreshold
        && verticalOverlapRatio >= minVerticalOverlapRatio
      );

      if (!strongOverlap && !horizontalNear) continue;

      const score = strongOverlap
        ? (1000000 + overlapRatio * 10000 - centerYDelta)
        : (1000 - gapX * 10 - centerYDelta);
      candidates.push({ to: otherNode.id, score });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length > 1) {
      const scoreGap = candidates[0].score - candidates[1].score;
      const ambiguousGap = candidates[0].score >= 100000 ? 800 : 10;
      if (scoreGap <= ambiguousGap) {
        return null;
      }
    }

    return { from: draggedId, to: candidates[0].to };
  }, [graphData, graphSettings, hasDirectRelationship, isCoarsePointer]);

  const syncAllPositions = useCallback(async () => {
    if (!ensureEditable()) return;
    if (!graphData) return;
    setSyncingPositions(true);
    try {
      const updates = graphData.nodes.map(async (person) => {
        const position = nodesRef.current.find(node => node.id === person.id)?.position
          || nodePositionMap.current[person.id]
          || person.metadata?.position;
        if (!position) return;
        const nextMetadata = {
          ...(person.metadata ?? {}),
          position
        };
        await api.updatePerson(person.id, { metadata: nextMetadata });
      });
      await Promise.all(updates);
      showToast('已同步全部位置', 'success');
      fetchGraph();
    } catch (error) {
      console.error('Failed to sync positions:', error);
      showToast('同步失敗', 'warning');
    } finally {
      setSyncingPositions(false);
    }
  }, [ensureEditable, graphData, fetchGraph, showToast]);

  const handleCreateUser = useCallback(async (username: string, password: string, role: 'admin' | 'readonly') => {
    try {
      await api.createUser(username, password, role);
      showToast('帳號已建立', 'success');
      setShowCreateUserModal(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '建立帳號失敗';
      showToast(message, 'warning');
      throw error;
    }
  }, [showToast]);

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
        if (!blobUrl) {
          avatarFailures.current.add(key);
          return;
        }
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
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        return;
      }
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

  const openContextMenuAt = useCallback((id: string, x: number, y: number) => {
    const openUp = y > window.innerHeight * 0.6;
    setContextMenu({
      id,
      top: openUp ? undefined : y,
      bottom: openUp ? window.innerHeight - y : undefined,
      left: x,
      openUp,
    });
  }, []);

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
  }, [reactFlowInstance, graphData, getSpouseId]);
  const handleNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    setHoveredNodeId(node.id);
  }, []);
  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

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
      requestRelationshipChoice({
        from: connection.source,
        to: connection.target,
        sourceHandle,
        targetHandle,
        suggestedType: normalizeRelationshipChoiceType(relationshipType)
      });
    }
  }, [graphData, getDefaultRelationshipType, requestRelationshipChoice, normalizeRelationshipChoiceType]);

  const onConnectStart = useCallback(() => {
    if (isCoarsePointer) {
      setMobileConnecting(true);
    }
  }, [isCoarsePointer]);

  const onConnectEnd = useCallback(() => {
    if (isCoarsePointer) {
      setMobileConnecting(false);
    }
  }, [isCoarsePointer]);

  const getDragSelectionIds = useCallback((draggedId: string, draggingNodes?: Node[]) => {
    const draggingIds = draggingNodes?.map((item) => item.id) ?? [];
    if (draggingIds.length > 1 && draggingIds.includes(draggedId)) {
      return draggingIds;
    }
    const currentSelectedIds = nodesRef.current
      .filter((item) => item.selected)
      .map((item) => item.id);
    if (currentSelectedIds.length > 1 && currentSelectedIds.includes(draggedId)) {
      return currentSelectedIds;
    }
    if (selectedNodeIdsRef.current.length > 1 && selectedNodeIdsRef.current.includes(draggedId)) {
      return selectedNodeIdsRef.current;
    }
    return [draggedId];
  }, []);

  const resolveOverlapAfterDrop = useCallback((
    selectedIds: string[],
    draggedId: string,
    options?: { ignoredNodeIds?: string[] }
  ) => {
    const draggedNode = nodesRef.current.find((item) => item.id === draggedId);
    if (!draggedNode) return;

    const selectedSet = new Set(selectedIds);
    const ignoredSet = new Set(options?.ignoredNodeIds ?? []);
    const draggedWidth = draggedNode.width ?? 120;
    const draggedHeight = draggedNode.height ?? 120;
    const repelGap = graphSettings.repelGap;
    let nextX = draggedNode.position.x;
    let nextY = draggedNode.position.y;

    for (let i = 0; i < 10; i += 1) {
      let overlappingNode: Node | null = null;
      let maxOverlapArea = 0;

      for (const other of nodesRef.current) {
        if (selectedSet.has(other.id)) continue;
        if (ignoredSet.has(other.id)) continue;
        const otherWidth = other.width ?? 120;
        const otherHeight = other.height ?? 120;
        const overlapWidth = Math.min(nextX + draggedWidth, other.position.x + otherWidth) - Math.max(nextX, other.position.x);
        const overlapHeight = Math.min(nextY + draggedHeight, other.position.y + otherHeight) - Math.max(nextY, other.position.y);
        if (overlapWidth <= 0 || overlapHeight <= 0) continue;
        const overlapArea = overlapWidth * overlapHeight;
        if (overlapArea > maxOverlapArea) {
          maxOverlapArea = overlapArea;
          overlappingNode = other;
        }
      }

      if (!overlappingNode) break;

      const otherWidth = overlappingNode.width ?? 120;
      const otherHeight = overlappingNode.height ?? 120;
      const dxRight = (overlappingNode.position.x + otherWidth + repelGap) - nextX;
      const dxLeft = (overlappingNode.position.x - repelGap) - (nextX + draggedWidth);
      const dyDown = (overlappingNode.position.y + otherHeight + repelGap) - nextY;
      const dyUp = (overlappingNode.position.y - repelGap) - (nextY + draggedHeight);
      const candidates = [
        { dx: dxLeft, dy: 0, abs: Math.abs(dxLeft), prefer: 0 },
        { dx: dxRight, dy: 0, abs: Math.abs(dxRight), prefer: 1 },
        { dx: 0, dy: dyUp, abs: Math.abs(dyUp), prefer: 2 },
        { dx: 0, dy: dyDown, abs: Math.abs(dyDown), prefer: 3 },
      ].sort((a, b) => (a.abs - b.abs) || (a.prefer - b.prefer));

      nextX += candidates[0].dx;
      nextY += candidates[0].dy;
    }

    const shiftX = nextX - draggedNode.position.x;
    const shiftY = nextY - draggedNode.position.y;
    if (!shiftX && !shiftY) return;

    const shiftedNodes = nodesRef.current.map((item) => {
      if (!selectedSet.has(item.id)) return item;
      return {
        ...item,
        position: {
          x: item.position.x + shiftX,
          y: item.position.y + shiftY,
        },
      };
    });

    nodesRef.current = shiftedNodes;
    setNodesRef.current?.(shiftedNodes);
  }, [graphSettings.repelGap]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node, draggingNodes: Node[] = []) => {
    setMobileNodeDragging(false);
    const selectedIds = getDragSelectionIds(node.id, draggingNodes);
    const startPositions = dragStartPositions.current;
    const overlapSpouseCandidate = getAutoSpouseLinkCandidate(node.id, selectedIds, { overlapOnly: true });
    if (overlapSpouseCandidate) {
      void createRelationshipWithUndo(
        overlapSpouseCandidate.from,
        overlapSpouseCandidate.to,
        undefined,
        undefined,
        'spouse'
      );
    }
    resolveOverlapAfterDrop(selectedIds, node.id, {
      ignoredNodeIds: overlapSpouseCandidate ? [overlapSpouseCandidate.to] : undefined,
    });
    nodesRef.current.forEach((item) => {
      if (!selectedIds.includes(item.id)) return;
      const start = startPositions?.[item.id];
      if (!start) return;
      if (start.x === item.position.x && start.y === item.position.y) return;
      updatePersonPosition(item.id, item.position);
    });
    setDragGuideY(null);
    dragSnapRef.current = null;
    dragSnapXRef.current = null;
    spouseSnapRef.current = null;
    if (startPositions) {
      const hiddenUpdates = new Map<string, { x: number; y: number }>();
      selectedIds.forEach((rootId) => {
        const start = startPositions[rootId];
        const current = nodesRef.current.find(item => item.id === rootId)?.position;
        if (!start || !current) return;
        const deltaX = current.x - start.x;
        const deltaY = current.y - start.y;
        if (!deltaX && !deltaY) return;

        const hiddenIds = new Set<string>();
        if (collapsedMaternalRoots.has(rootId)) {
          collectFamilySide(rootId, 'maternal').forEach((id) => hiddenIds.add(id));
        }
        if (collapsedPaternalRoots.has(rootId)) {
          collectFamilySide(rootId, 'paternal').forEach((id) => hiddenIds.add(id));
        }
        if (collapsedChildRoots.has(rootId)) {
          collectChildSide(rootId).forEach((id) => hiddenIds.add(id));
        }
        if (collapsedSiblingRoots.has(rootId)) {
          collectSiblingSide(rootId).forEach((id) => hiddenIds.add(id));
        }

        hiddenIds.forEach((hiddenId) => {
          if (selectedIds.includes(hiddenId)) return;
          if (hiddenUpdates.has(hiddenId)) return;
          const base = getStoredPosition(hiddenId);
          if (!base) return;
          hiddenUpdates.set(hiddenId, { x: base.x + deltaX, y: base.y + deltaY });
        });
      });

      if (hiddenUpdates.size) {
        hiddenUpdates.forEach((position, id) => {
          nodePositionMap.current[id] = position;
          updatePersonPosition(id, position);
        });
        try {
          localStorage.setItem('clan.nodePositions', JSON.stringify(nodePositionMap.current));
        } catch (error) {
          console.warn('Failed to persist node positions:', error);
        }
      }

      const moved = Object.entries(startPositions).some(([id, position]) => {
        const current = nodesRef.current.find(item => item.id === id)?.position;
        return current ? current.x !== position.x || current.y !== position.y : false;
      });
      if (moved) {
        setUndoStack(prev => [{ type: 'move', positions: startPositions, draggedId: node.id } as const, ...prev].slice(0, 10));
      }
    }
    const dragStart = startPositions?.[node.id];
    const dragEnd = nodesRef.current.find((item) => item.id === node.id)?.position;
    const dragDistance = (dragStart && dragEnd)
      ? Math.hypot(dragEnd.x - dragStart.x, dragEnd.y - dragStart.y)
      : 0;
    if (!overlapSpouseCandidate) {
      const minDragDistanceForAutoLink = graphSettings.minDragDistanceForAutoLink + (isCoarsePointer ? COARSE_MIN_DRAG_DISTANCE_BONUS : 0);
      const autoSpouseCandidate = dragDistance >= minDragDistanceForAutoLink
        ? getAutoSpouseLinkCandidate(node.id, selectedIds)
        : null;
      if (autoSpouseCandidate) {
        requestRelationshipChoice({
          from: autoSpouseCandidate.from,
          to: autoSpouseCandidate.to,
          suggestedType: 'spouse'
        });
      }
    }
    dragStartPositions.current = null;
  }, [updatePersonPosition, collapsedMaternalRoots, collapsedPaternalRoots, collapsedChildRoots, collapsedSiblingRoots, collectFamilySide, collectChildSide, collectSiblingSide, getStoredPosition, getDragSelectionIds, getAutoSpouseLinkCandidate, resolveOverlapAfterDrop, createRelationshipWithUndo, requestRelationshipChoice, isCoarsePointer, graphSettings.minDragDistanceForAutoLink]);

  const onNodeDrag = useCallback((_event: React.MouseEvent, node: Node, draggingNodes: Node[] = []) => {
    if (!reactFlowInstance) return;
    const viewport = (reactFlowInstance as ReactFlowInstance & { toObject?: () => { viewport?: { x: number; y: number; zoom: number } } })
      .toObject?.().viewport;
    if (!viewport) return;

    const ySnapThreshold = graphSettings.ySnapThreshold + (isCoarsePointer ? COARSE_Y_SNAP_BONUS : 0);
    const yReleaseThreshold = graphSettings.yReleaseThreshold + (isCoarsePointer ? COARSE_Y_RELEASE_BONUS : 0);
    const xSnapThreshold = graphSettings.xSnapThreshold + (isCoarsePointer ? COARSE_X_SNAP_BONUS : 0);
    const xReleaseThreshold = graphSettings.xReleaseThreshold + (isCoarsePointer ? COARSE_X_RELEASE_BONUS : 0);
    const guideThresholdY = 2000;
    const spouseSnapThreshold = graphSettings.spouseSnapThreshold + (isCoarsePointer ? COARSE_SPOUSE_SNAP_BONUS : 0);
    const spouseReleaseThreshold = graphSettings.spouseReleaseThreshold + (isCoarsePointer ? COARSE_SPOUSE_RELEASE_BONUS : 0);
    const spouseGap = graphSettings.spouseGap;
    let nearestYGuide: number | null = null;
    let nearestYGuideSourceId: string | null = null;
    let nearestYGuideDistance = Number.POSITIVE_INFINITY;
    let nearestX: number | null = null;
    let nearestXDistance = Number.POSITIVE_INFINITY;
    let spouseSnapTarget: {
      x: number;
      y: number;
      spouseId: string;
      nodeWidth: number;
      nodeHeight: number;
      spouseWidth: number;
      spouseHeight: number;
    } | null = null;
    const selectedIds = getDragSelectionIds(node.id, draggingNodes);
    const selectedSet = new Set(selectedIds);
    const nodeMap = new Map(nodesRef.current.map((item) => [item.id, item]));
    draggingNodes.forEach((item) => {
      nodeMap.set(item.id, item);
    });
    const dragNode = nodeMap.get(node.id) ?? node;
    const ySourceNodes = selectedIds.length > 1
      ? selectedIds
        .map((id) => nodeMap.get(id))
        .filter((item): item is Node => Boolean(item))
      : [dragNode];

    ySourceNodes.forEach((sourceNode) => {
      nodesRef.current.forEach((other) => {
        if (selectedSet.has(other.id)) return;
        const distanceY = Math.abs(other.position.y - sourceNode.position.y);
        if (distanceY < nearestYGuideDistance) {
          nearestYGuideDistance = distanceY;
          nearestYGuide = other.position.y;
          nearestYGuideSourceId = sourceNode.id;
        }
      });
    });

    nodesRef.current.forEach((other) => {
      if (other.id === node.id || selectedSet.has(other.id)) return;
      const distanceX = Math.abs(other.position.x - node.position.x);
      if (distanceX < nearestXDistance) {
        nearestXDistance = distanceX;
        nearestX = other.position.x;
      }
    });

    const existingSnap = dragSnapRef.current;
    if (existingSnap && existingSnap.id === node.id) {
      const snapSourceNode = nodeMap.get(existingSnap.sourceId) ?? dragNode;
      const distanceFromSnap = Math.abs(snapSourceNode.position.y - existingSnap.y);
      if (distanceFromSnap >= yReleaseThreshold) {
        dragSnapRef.current = null;
      }
    }
    if (!dragSnapRef.current && nearestYGuide !== null && nearestYGuideSourceId && nearestYGuideDistance <= ySnapThreshold) {
      dragSnapRef.current = { id: node.id, sourceId: nearestYGuideSourceId, y: nearestYGuide };
    }

    const existingSnapX = dragSnapXRef.current;
    if (existingSnapX && existingSnapX.id === node.id) {
      const distanceFromSnap = Math.abs(node.position.x - existingSnapX.x);
      if (distanceFromSnap >= xReleaseThreshold) {
        dragSnapXRef.current = null;
      }
    }
    if (!dragSnapXRef.current && nearestX !== null && nearestXDistance <= xSnapThreshold) {
      dragSnapXRef.current = { id: node.id, x: nearestX };
    }

    const isSingleDrag = selectedIds.length === 1 && selectedIds[0] === node.id;
    const spouseId = graphData && isSingleDrag ? getSpouseId(node.id) : undefined;
    const spouseNode = spouseId ? nodesRef.current.find((item) => item.id === spouseId) : undefined;
    if (spouseId && spouseNode && isSingleDrag) {
      const nodeWidth = node.width ?? 140;
      const nodeHeight = node.height ?? 100;
      const spouseWidth = spouseNode.width ?? 140;
      const spouseHeight = spouseNode.height ?? 100;
      const isLeftSide = node.position.x < spouseNode.position.x;
      const targetX = isLeftSide
        ? spouseNode.position.x - nodeWidth - spouseGap
        : spouseNode.position.x + spouseWidth + spouseGap;
      const targetY = spouseNode.position.y;
      const distanceToTarget = Math.hypot(node.position.x - targetX, node.position.y - targetY);
      const existingSpouseSnap = spouseSnapRef.current;
      if (existingSpouseSnap && existingSpouseSnap.id === node.id) {
        const distanceFromSnap = Math.hypot(node.position.x - existingSpouseSnap.x, node.position.y - existingSpouseSnap.y);
        if (distanceFromSnap <= spouseReleaseThreshold) {
          spouseSnapTarget = {
            x: existingSpouseSnap.x,
            y: existingSpouseSnap.y,
            spouseId: existingSpouseSnap.spouseId,
            nodeWidth,
            nodeHeight,
            spouseWidth,
            spouseHeight
          };
        } else {
          spouseSnapRef.current = null;
        }
      } else if (distanceToTarget <= spouseSnapThreshold) {
        spouseSnapTarget = { x: targetX, y: targetY, spouseId, nodeWidth, nodeHeight, spouseWidth, spouseHeight };
      }
    }

    const snapTarget = dragSnapRef.current?.id === node.id ? dragSnapRef.current : null;
    const snapTargetX = dragSnapXRef.current?.id === node.id ? dragSnapXRef.current.x : null;
    if (spouseSnapTarget && setNodesRef.current) {
      spouseSnapRef.current = { id: node.id, spouseId: spouseSnapTarget.spouseId, x: spouseSnapTarget.x, y: spouseSnapTarget.y };
      const deltaX = spouseSnapTarget.x - node.position.x;
      const deltaY = spouseSnapTarget.y - node.position.y;
      setNodesRef.current((prev) =>
        prev.map((item) => {
          if (item.id !== node.id) return item;
          const nextX = item.position.x + deltaX;
          const nextY = item.position.y + deltaY;
          if (nextX === item.position.x && nextY === item.position.y) return item;
          return {
            ...item,
            position: {
              x: nextX,
              y: nextY,
            },
          };
        })
      );
    } else {
      if (spouseSnapRef.current?.id === node.id) {
        spouseSnapRef.current = null;
      }
    }

    if (!spouseSnapTarget && (snapTarget !== null || snapTargetX !== null) && setNodesRef.current) {
      const snapSourceNode = snapTarget ? nodeMap.get(snapTarget.sourceId) : null;
      const snapSourceY = snapSourceNode?.position.y ?? dragNode.position.y;
      const deltaY = snapTarget !== null ? snapTarget.y - snapSourceY : 0;
      setNodesRef.current((prev) =>
        prev.map((item) => {
          const isSelected = selectedIds.includes(item.id);
          if (!isSelected && item.id !== node.id) return item;
          const nextY = snapTarget !== null && isSelected ? item.position.y + deltaY : item.position.y;
          const nextX = item.id === node.id && snapTargetX !== null ? snapTargetX : item.position.x;
          if (nextX === item.position.x && nextY === item.position.y) return item;
          return {
            ...item,
            position: {
              x: nextX,
              y: nextY,
            },
          };
        })
      );
    }

    const guideY = snapTarget?.y ?? (nearestYGuide !== null && nearestYGuideDistance <= guideThresholdY ? nearestYGuide : null);
    if (guideY !== null) {
      const screenY = guideY * viewport.zoom + viewport.y;
      setDragGuideY(screenY);
    } else {
      setDragGuideY(null);
    }
  }, [reactFlowInstance, isCoarsePointer, graphData, getSpouseId, getDragSelectionIds, graphSettings]);

  const handleEditPerson = useCallback((id: string) => {
    if (!ensureEditable()) return;
    setCopiedPerson(null);
    setEditingPersonId(id);
  }, [ensureEditable]);

  const getFocusPosition = useCallback((id: string) => {
    if (!graphData) return null;
    return nodesRef.current.find(node => node.id === id)?.position
      || nodePositionMap.current[id]
      || graphData.nodes.find(node => node.id === id)?.metadata?.position
      || null;
  }, [graphData]);

  const getViewportForNode = useCallback((id: string, zoom = 1.0) => {
    const focusPosition = getFocusPosition(id);
    if (!focusPosition) return null;
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    const width = bounds?.width || window.innerWidth;
    const height = bounds?.height || window.innerHeight;
    return {
      x: width / 2 - focusPosition.x * zoom,
      y: height / 2 - focusPosition.y * zoom,
      zoom,
    };
  }, [getFocusPosition]);

  const persistPendingViewport = useCallback((id: string, zoom = 1.0) => {
    const viewport = getViewportForNode(id, zoom);
    if (!viewport) return;
    try {
      localStorage.setItem('clan.pendingViewport', JSON.stringify(viewport));
      localStorage.setItem('clan.pendingCenterId', id);
    } catch (error) {
      console.warn('Failed to persist pending viewport:', error);
    }
  }, [getViewportForNode]);

  const handleSearch = useCallback((query: string) => {
    if (!graphData) return;
    const trimmed = query.trim();
    if (!trimmed) return;
    const exactMatch = createExactNameMatcher(trimmed);
    const fuzzyMatch = createNameMatcher(trimmed);
    const match = graphData.nodes.find((person) =>
      person.id === trimmed
      || exactMatch(person.name)
      || exactMatch(person.english_name)
      || fuzzyMatch(person.name)
      || fuzzyMatch(person.english_name)
    );
    if (!match) {
      showToast('找不到成員', 'warning');
      return;
    }
    setSelectedEdge(null);
    setSelectedNode(match.id);
    setNodesRef.current?.((prev) => prev.map((node) => ({ ...node, selected: node.id === match.id })));
    persistPendingViewport(match.id, 1.0);
    setPendingCenterId(match.id);
    if (searchFlashTimer.current) {
      window.clearTimeout(searchFlashTimer.current);
    }
    setSearchFlashId(null);
    window.setTimeout(() => setSearchFlashId(match.id), 0);
    searchFlashTimer.current = window.setTimeout(() => {
      setSearchFlashId(null);
    }, 1400);
  }, [graphData, persistPendingViewport]);

  const focusNodeById = useCallback((id: string, zoom = 1.0) => {
    if (!reactFlowInstance) return false;
    const viewport = getViewportForNode(id, zoom);
    const focusPosition = getFocusPosition(id);
    if (!viewport || !focusPosition || !reactFlowInstance.setCenter) return false;
    const instance = reactFlowInstance as ReactFlowInstance & {
      setViewport?: (viewport: { x: number; y: number; zoom: number }) => void;
      setCenter?: (x: number, y: number, opts?: { zoom?: number }) => void;
    };
    const applyFocus = () => {
      if (instance.setViewport) {
        instance.setViewport(viewport);
      } else {
        instance.setCenter?.(focusPosition.x, focusPosition.y, { zoom });
      }
    };
    requestAnimationFrame(() => {
      applyFocus();
      window.setTimeout(applyFocus, 100);
    });
    return true;
  }, [getViewportForNode, getFocusPosition, reactFlowInstance]);

  const focusMe = useCallback((options?: { highlight?: boolean; syncCenter?: boolean }) => {
    const highlight = options?.highlight ?? true;
    const syncCenter = options?.syncCenter ?? true;
    if (!graphData) return;
    const meId = graphData.center
      || graphData.nodes.find((person) => person.title === '我')?.id
      || centerId;
    if (!meId) return;

    if (syncCenter) {
      setCenterId(meId);
      persistPendingViewport(meId, 1.0);
      setPendingFocus({ id: meId, zoom: 1.0 });
    }
    focusNodeById(meId, 1.0);
    if (!highlight) {
      return;
    }
    if (searchFlashTimer.current) {
      window.clearTimeout(searchFlashTimer.current);
    }
    setSearchFlashId(null);
    window.setTimeout(() => setSearchFlashId(meId), 0);
    searchFlashTimer.current = window.setTimeout(() => {
      setSearchFlashId(null);
    }, 1400);
    if (focusHoverTimer.current) {
      window.clearTimeout(focusHoverTimer.current);
    }
    setFocusHoverId(meId);
    focusHoverTimer.current = window.setTimeout(() => {
      setFocusHoverId(null);
    }, 500);
    // Do not set pending center here to avoid overriding the zoom change.
  }, [graphData, centerId, focusNodeById, setCenterId, persistPendingViewport]);

  const handleFocusMe = useCallback(() => {
    focusMe({ highlight: true, syncCenter: true });
  }, [focusMe]);

  useEffect(() => {
    if (!graphData || !reactFlowInstance) return;
    focusMe({ highlight: false, syncCenter: false });
  }, [graphData, reactFlowInstance, focusMe]);

  const handleDeletePerson = useCallback(async (id: string) => {
    if (!ensureEditable()) return;
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
  }, [ensureEditable, graphData, deletePerson, centerId, setCenterId]);

  const handleDeleteRelations = useCallback(async (id: string) => {
    if (!ensureEditable()) return;
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
  }, [ensureEditable, graphData, deleteRelationship]);

  const handleDeleteSiblingRelations = useCallback(async (id: string) => {
    if (!ensureEditable()) return;
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
  }, [ensureEditable, graphData, deleteRelationship]);

  const handleDeleteChildRelations = useCallback(async (id: string) => {
    if (!ensureEditable()) return;
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
  }, [ensureEditable, graphData, deleteRelationship]);

  const dimIds = useMemo(() => {
    const dimSet = new Set<string>(dimNodeIds);
    if (graphData && (dimFocusId || dimNonRelativesId)) {
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
        const nonRelativeSet = new Set<string>(
          graphData.nodes
            .map(node => node.id)
            .filter(id => !focusSet.has(id))
        );
        nonRelativeSet.forEach((id) => dimSet.add(id));
      } else {
        const relativeSet = new Set<string>([...parentIds, ...siblingIds]);
        relativeSet.delete(focusId);
        relativeSet.forEach((id) => dimSet.add(id));
      }
    }

    dimExcludedNodeIds.forEach((id) => dimSet.delete(id));
    return dimSet;
  }, [graphData, dimFocusId, dimNonRelativesId, dimNodeIds, dimExcludedNodeIds]);
  const hasActiveDimming = Boolean(
    dimFocusId
    || dimNonRelativesId
    || dimNodeIds.size > 0
    || dimExcludedNodeIds.size > 0
  );
  const hasCollapsedNodes = Boolean(
    collapsedMaternalRoots.size > 0
    || collapsedPaternalRoots.size > 0
    || collapsedChildRoots.size > 0
    || collapsedSiblingRoots.size > 0
  );
  const clearAllDimming = useCallback(() => {
    setDimFocusId(null);
    setDimNonRelativesId(null);
    setDimNodeIds(new Set());
    setDimExcludedNodeIds(new Set());
  }, []);
  const expandAllCollapsed = useCallback(() => {
    setCollapsedMaternalRoots(new Set());
    setCollapsedPaternalRoots(new Set());
    setCollapsedChildRoots(new Set());
    setCollapsedSiblingRoots(new Set());
  }, []);
  const ctrlHoverFocusId = isShiftPressed ? hoveredNodeId : null;
  const { connectedNodeIds: ctrlHoverConnectedNodeIds, connectedEdgeIds: ctrlHoverConnectedEdgeIds } = useMemo(() => {
    const connectedNodeIds = new Set<string>();
    const connectedEdgeIds = new Set<string>();
    if (!graphData || !ctrlHoverFocusId) {
      return { connectedNodeIds, connectedEdgeIds };
    }
    connectedNodeIds.add(ctrlHoverFocusId);
    graphData.edges.forEach((edge) => {
      if (collapsedNodeIds.has(edge.from_person_id) || collapsedNodeIds.has(edge.to_person_id)) {
        return;
      }
      if (edge.from_person_id === ctrlHoverFocusId || edge.to_person_id === ctrlHoverFocusId) {
        connectedEdgeIds.add(`e${edge.id}`);
        connectedNodeIds.add(edge.from_person_id);
        connectedNodeIds.add(edge.to_person_id);
      }
    });
    return { connectedNodeIds, connectedEdgeIds };
  }, [graphData, collapsedNodeIds, ctrlHoverFocusId]);
  const isCtrlHoverActive = Boolean(ctrlHoverFocusId);

  const initialNodes: Node[] = useMemo(() => {
    if (!graphData) return [];

    const centerX = 500;
    const centerY = 300;
    const initialOrbitBaseRadius = graphSettings.initialOrbitBaseRadius;
    const initialOrbitStepRadius = graphSettings.initialOrbitStepRadius;

    const visibleNodes = graphData.nodes.filter((person) => !collapsedNodeIds.has(person.id));

    return visibleNodes.map((person, index) => {
      const genderColor = person.gender === 'M' ? '#3b82f6' : person.gender === 'F' ? '#ec4899' : '#8b5cf6';
      const title = person.title || '';
      const formalTitle = person.formal_title || '';
      const avatarUrl = person.avatar_url ? avatarBlobs[person.avatar_url] : null;
      const baseOpacity = dimIds.has(person.id) ? 0.35 : 1;
      const isConnectedToHoverNode = ctrlHoverConnectedNodeIds.has(person.id);
      const opacity = isCtrlHoverActive && !isConnectedToHoverNode
        ? Math.min(baseOpacity, CTRL_HOVER_DIM_NODE_OPACITY)
        : baseOpacity;

      const storedPosition = nodePositionMap.current[person.id];
      // Prefer server metadata so positions updated on other devices can be reflected after refresh.
      const position = person.metadata?.position || storedPosition || (
        person.id === graphData.center
          ? { x: centerX, y: centerY }
          : {
            x: centerX + Math.cos((index * 45) * (Math.PI / 180)) * (initialOrbitBaseRadius + (index * initialOrbitStepRadius)),
            y: centerY + Math.sin((index * 45) * (Math.PI / 180)) * (initialOrbitBaseRadius + (index * initialOrbitStepRadius))
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
          formalTitle,
          genderColor: genderColor,
          avatarUrl,
          isCenter: person.id === centerId,
          flashCenter: person.id === centerFlashId,
          flashSearch: person.id === searchFlashId,
          focusHover: person.id === focusHoverId || (isCtrlHoverActive && person.id === ctrlHoverFocusId),
          onAvatarClick: avatarUrl ? () => handleAvatarClick(person, avatarUrl) : undefined,
          onNodeDoubleTap: (clientX: number, clientY: number) => {
            openContextMenuAt(person.id, clientX, clientY);
          },
          allowNodeDoubleTap: true,
          interactionLocked: isReadOnly,
          draggableMobile: !isReadOnly,
          onMobileDragStart: (id: string) => {
            setMobileNodeDragging(true);
            // Optional: bring node to front, select it, etc.
            if (setNodesRef.current) {
              setNodesRef.current((prev) => prev.map((item) => ({ ...item, selected: item.id === id })));
            }
          },
          onMobileDrag: (id: string, dx: number, dy: number) => {
            if (!reactFlowInstance || isReadOnly) return;
            const zoom = reactFlowInstance.getZoom ? reactFlowInstance.getZoom() : 1;
            if (setNodesRef.current) {
              setNodesRef.current((prev) =>
                prev.map((item) => {
                  if (item.id === id) {
                    return {
                      ...item,
                      position: {
                        x: item.position.x + dx / zoom,
                        y: item.position.y + dy / zoom,
                      },
                    };
                  }
                  return item;
                })
              );
            }
          },
          onMobileDragEnd: (id: string) => {
            setMobileNodeDragging(false);
            if (isReadOnly) return;
            const node = nodesRef.current.find(n => n.id === id);
            if (node) {
              updatePersonPosition(id, node.position);
            }
          },
          hasCollapsedSide: collapsedMaternalRoots.has(person.id)
            || collapsedPaternalRoots.has(person.id)
            || collapsedChildRoots.has(person.id)
            || collapsedSiblingRoots.has(person.id),
        },
        style: {
          background: 'transparent',
          border: 'none',
          opacity,
        },
      };
    });
  }, [graphData, collapsedNodeIds, collapsedMaternalRoots, collapsedPaternalRoots, collapsedChildRoots, collapsedSiblingRoots, dimIds, centerId, centerFlashId, searchFlashId, focusHoverId, handleAvatarClick, avatarBlobs, openContextMenuAt, isReadOnly, reactFlowInstance, updatePersonPosition, ctrlHoverConnectedNodeIds, isCtrlHoverActive, ctrlHoverFocusId, graphSettings.initialOrbitBaseRadius, graphSettings.initialOrbitStepRadius]);

  const initialEdges: Edge[] = useMemo(() => {
    if (!graphData) return [];

    return graphData.edges
      .filter((edge) => !collapsedNodeIds.has(edge.from_person_id) && !collapsedNodeIds.has(edge.to_person_id))
      .map((edge) => {
        const edgeId = `e${edge.id}`;
        const isSelected = selectedEdge === edgeId;
        const isDimmed = dimIds.has(edge.from_person_id) || dimIds.has(edge.to_person_id);
        const isConnectedToHoverNode = ctrlHoverConnectedEdgeIds.has(edgeId);

        const getEdgeStyle = (type: string, selected: boolean) => {
          if (selected) return { stroke: '#ef4444', strokeWidth: 4 };
          switch (type) {
            case 'spouse': return { stroke: '#ec4899', strokeWidth: 2 };
            case 'ex_spouse': return { stroke: '#9ca3af', strokeWidth: 2, strokeDasharray: '6 4' };
            case 'sibling': return { stroke: '#10b981', strokeWidth: 2, strokeDasharray: '6 4' };
            case 'in_law': return { stroke: '#f59e0b', strokeWidth: 2 };
            default: return { stroke: '#6366f1', strokeWidth: 2 };
          }
        };

        const getLabel = (type: string) => {
          switch (type) {
            case 'spouse': return '夫妻';
            case 'ex_spouse': return '前配偶';
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
          type: edge.type === 'spouse' || edge.type === 'ex_spouse' || edge.type === 'sibling' || edge.type === 'in_law' ? 'step' : 'smoothstep',
          animated: edge.type === 'spouse' || edge.type === 'sibling',
          markerEnd: { type: MarkerType.ArrowClosed },
          style: (() => {
            const baseStyle = getEdgeStyle(edge.type, isSelected);
            const baseOpacity = isSelected ? 1 : (isDimmed ? 0.35 : 1);
            if (!isCtrlHoverActive) {
              return { ...baseStyle, opacity: baseOpacity };
            }
            if (!isConnectedToHoverNode) {
              return { ...baseStyle, opacity: Math.min(baseOpacity, CTRL_HOVER_DIM_EDGE_OPACITY) };
            }
            const currentWidth = typeof baseStyle.strokeWidth === 'number'
              ? baseStyle.strokeWidth
              : 2;
            return {
              ...baseStyle,
              strokeWidth: Math.max(currentWidth + CTRL_HOVER_EDGE_WIDTH_BOOST, CTRL_HOVER_MIN_EDGE_WIDTH),
              opacity: 1,
            };
          })(),
          label: getLabel(edge.type),
          zIndex: isSelected ? 1000 : (isConnectedToHoverNode ? 800 : 0),
        };
      });
  }, [graphData, collapsedNodeIds, selectedEdge, dimIds, ctrlHoverConnectedEdgeIds, isCtrlHoverActive]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const spouseHandleMap = useMemo(() => {
    if (!graphData) return {};
    const nodesById = new Map(nodes.map((item) => [item.id, item]));
    const handleMap = new Map<string, Set<string>>();
    const tolerance = 2;

    graphData.edges
      .filter((edge) => edge.type === 'spouse')
      .forEach((edge) => {
        const leftNode = nodesById.get(edge.from_person_id);
        const rightNode = nodesById.get(edge.to_person_id);
        if (!leftNode || !rightNode) return;
        const leftWidth = leftNode.width ?? 140;
        const rightWidth = rightNode.width ?? 140;
        const leftRight = leftNode.position.x + leftWidth;
        const rightRight = rightNode.position.x + rightWidth;
        const yAligned = Math.abs(leftNode.position.y - rightNode.position.y) <= tolerance;
        if (!yAligned) return;

        let leftSide: 'left' | 'right' | null = null;
        let rightSide: 'left' | 'right' | null = null;
        if (Math.abs(leftRight - rightNode.position.x) <= tolerance) {
          leftSide = 'right';
          rightSide = 'left';
        } else if (Math.abs(rightRight - leftNode.position.x) <= tolerance) {
          leftSide = 'left';
          rightSide = 'right';
        }
        if (!leftSide || !rightSide) return;

        const leftHandles = handleMap.get(leftNode.id) ?? new Set<string>();
        leftHandles.add(`${leftSide}-s`);
        leftHandles.add(`${leftSide}-t`);
        handleMap.set(leftNode.id, leftHandles);

        const rightHandles = handleMap.get(rightNode.id) ?? new Set<string>();
        rightHandles.add(`${rightSide}-s`);
        rightHandles.add(`${rightSide}-t`);
        handleMap.set(rightNode.id, rightHandles);
      });

    return Object.fromEntries(
      Array.from(handleMap.entries()).map(([id, set]) => [id, Array.from(set.values())])
    );
  }, [graphData, nodes]);
  const nodesWithHighlights = useMemo(
    () => nodes.map((node) => ({
      ...node,
      data: { ...node.data, highlightHandles: spouseHandleMap[node.id] ?? [] },
    })),
    [nodes, spouseHandleMap]
  );

  useEffect(() => {
    setNodesRef.current = setNodes;
  }, [setNodes]);

  useEffect(() => {
    if (!graphData) return;
    const nextPositions = { ...nodePositionMap.current };
    graphData.nodes.forEach((person) => {
      if (person.metadata?.position) {
        nextPositions[person.id] = { ...person.metadata.position };
      }
    });
    nodePositionMap.current = nextPositions;
    try {
      localStorage.setItem('clan.nodePositions', JSON.stringify(nodePositionMap.current));
    } catch (error) {
      console.warn('Failed to persist node positions:', error);
    }
  }, [graphData]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    if (!reactFlowInstance) return;
    try {
      const hasPendingFocus = Boolean(localStorage.getItem('clan.pendingFocus') || localStorage.getItem('clan.pendingFocusPosition'));
      if (hasPendingFocus) {
        localStorage.removeItem('clan.pendingViewport');
        return;
      }
      const raw = localStorage.getItem('clan.pendingViewport');
      if (!raw) return;
      const viewport = JSON.parse(raw) as { x: number; y: number; zoom: number };
      if (reactFlowInstance.setViewport) {
        reactFlowInstance.setViewport(viewport);
      }
      localStorage.removeItem('clan.pendingViewport');
    } catch (error) {
      console.warn('Failed to restore viewport:', error);
      localStorage.removeItem('clan.pendingViewport');
    }
  }, [reactFlowInstance]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('clan.pendingFocus');
      if (!raw) return;
      const parsed = JSON.parse(raw) as { id?: string; zoom?: number };
      if (parsed?.id) {
        setPendingFocus({ id: parsed.id, zoom: typeof parsed.zoom === 'number' ? parsed.zoom : 1.0 });
      }
    } catch (error) {
      console.warn('Failed to restore pending focus:', error);
      localStorage.removeItem('clan.pendingFocus');
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('clan.pendingFocusPosition');
      if (!raw) return;
      const parsed = JSON.parse(raw) as { x?: number; y?: number; zoom?: number };
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        setPendingFocusPosition({
          x: parsed.x,
          y: parsed.y,
          zoom: typeof parsed.zoom === 'number' ? parsed.zoom : 1.0
        });
      }
    } catch (error) {
      console.warn('Failed to restore pending focus position:', error);
      localStorage.removeItem('clan.pendingFocusPosition');
    }
  }, []);


  useEffect(() => {
    try {
      const stored = localStorage.getItem('clan.pendingCenterId');
      if (stored) {
        setPendingCenterId(stored);
        localStorage.removeItem('clan.pendingCenterId');
      }
    } catch (error) {
      console.warn('Failed to restore pending center:', error);
    }
  }, []);

  useEffect(() => {
    if (!pendingCenterId || !reactFlowInstance || pendingFocus || pendingFocusPosition) return;
    const position = nodesRef.current.find(node => node.id === pendingCenterId)?.position
      || nodePositionMap.current[pendingCenterId]
      || graphData?.nodes.find(node => node.id === pendingCenterId)?.metadata?.position;
    if (position && reactFlowInstance.setCenter) {
      requestAnimationFrame(() => {
        reactFlowInstance.setCenter(position.x, position.y, { zoom: reactFlowInstance.getZoom?.() });
        setPendingCenterId(null);
      });
    }
  }, [pendingCenterId, pendingFocus, pendingFocusPosition, reactFlowInstance, nodes, graphData]);

  useEffect(() => {
    if (!pendingFocusPosition || !reactFlowInstance?.setCenter) return;
    reactFlowInstance.setCenter(pendingFocusPosition.x, pendingFocusPosition.y, { zoom: pendingFocusPosition.zoom });
    localStorage.removeItem('clan.pendingFocusPosition');
    localStorage.removeItem('clan.pendingFocus');
    setPendingFocus(null);
    setPendingFocusPosition(null);
  }, [pendingFocusPosition, reactFlowInstance]);

  useEffect(() => {
    if (!graphData || !reactFlowInstance?.setCenter) return;
    if (pendingFocusRetryRef.current) return;
    pendingFocusRetryRef.current = window.setInterval(() => {
      const raw = localStorage.getItem('clan.pendingFocusPosition');
      const focusRaw = localStorage.getItem('clan.pendingFocus');
      if (!raw && !focusRaw) {
        if (pendingFocusRetryRef.current) {
          window.clearInterval(pendingFocusRetryRef.current);
          pendingFocusRetryRef.current = null;
        }
        return;
      }
      let handled = false;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { x?: number; y?: number; zoom?: number };
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            const zoom = typeof parsed.zoom === 'number' ? parsed.zoom : 1.0;
            const bounds = flowWrapperRef.current?.getBoundingClientRect();
            const width = bounds?.width || window.innerWidth;
            const height = bounds?.height || window.innerHeight;
            const viewport = {
              x: width / 2 - parsed.x * zoom,
              y: height / 2 - parsed.y * zoom,
              zoom
            };
            if (reactFlowInstance.setViewport) {
              reactFlowInstance.setViewport(viewport);
            } else {
              reactFlowInstance.setCenter(parsed.x!, parsed.y!, { zoom });
            }
            requestAnimationFrame(() => {
              if (reactFlowInstance.setViewport) {
                reactFlowInstance.setViewport(viewport);
              } else {
                reactFlowInstance.setCenter(parsed.x!, parsed.y!, { zoom });
              }
            });
            handled = true;
          }
        } catch {
          // Ignore invalid pending focus position.
        }
      }
      if (!handled && focusRaw) {
        try {
          const parsed = JSON.parse(focusRaw) as { id?: string; zoom?: number };
          if (parsed?.id) {
            handled = focusNodeById(parsed.id, typeof parsed.zoom === 'number' ? parsed.zoom : 1.0);
          }
        } catch {
          // Ignore invalid pending focus.
        }
      }
      if (handled) {
        localStorage.removeItem('clan.pendingFocusPosition');
        localStorage.removeItem('clan.pendingFocus');
        setPendingFocus(null);
        setPendingFocusPosition(null);
        if (pendingFocusRetryRef.current) {
          window.clearInterval(pendingFocusRetryRef.current);
          pendingFocusRetryRef.current = null;
        }
      }
    }, 120);
    return () => {
      if (pendingFocusRetryRef.current) {
        window.clearInterval(pendingFocusRetryRef.current);
        pendingFocusRetryRef.current = null;
      }
    };
  }, [graphData, reactFlowInstance, focusNodeById]);

  useEffect(() => {
    if (!pendingFocus || !reactFlowInstance) return;
    const viewport = getViewportForNode(pendingFocus.id, pendingFocus.zoom);
    const focusPosition = getFocusPosition(pendingFocus.id);
    if (!viewport || !focusPosition) return;
    if (reactFlowInstance.setViewport) {
      reactFlowInstance.setViewport(viewport);
    } else if (reactFlowInstance.setCenter) {
      reactFlowInstance.setCenter(focusPosition.x, focusPosition.y, { zoom: pendingFocus.zoom });
    }
    localStorage.removeItem('clan.pendingFocus');
    setPendingFocus(null);
  }, [pendingFocus, reactFlowInstance, getViewportForNode, getFocusPosition, nodes]);

  useEffect(() => {
    try {
      const editedId = localStorage.getItem('clan.lastEditedId');
      if (editedId) setLastEditedId(editedId);
    } catch (error) {
      console.warn('Failed to restore last edited id:', error);
    }
  }, []);

  useEffect(() => {
    if (!pendingFocus || !reactFlowInstance) return;
    let attempts = 0;
    const tryApply = () => {
      if (!pendingFocus || !reactFlowInstance) return;
      const viewport = getViewportForNode(pendingFocus.id, pendingFocus.zoom);
      const focusPosition = getFocusPosition(pendingFocus.id);
      if (viewport && focusPosition) {
        if (reactFlowInstance.setViewport) {
          reactFlowInstance.setViewport(viewport);
        } else if (reactFlowInstance.setCenter) {
          reactFlowInstance.setCenter(focusPosition.x, focusPosition.y, { zoom: pendingFocus.zoom });
        }
        localStorage.removeItem('clan.pendingFocus');
        setPendingFocus(null);
        return;
      }
      if (attempts < 20) {
        attempts += 1;
        window.setTimeout(tryApply, 80);
      }
    };
    tryApply();
    return () => {
      attempts = 999;
    };
  }, [pendingFocus, reactFlowInstance, getViewportForNode, getFocusPosition]);

  useEffect(() => {
    if (!lastEditedId) return;
    if (!graphData || !reactFlowInstance) return;
    if (lastEditedFocusTimer.current) {
      window.clearInterval(lastEditedFocusTimer.current);
    }
    let attempts = 0;
    lastEditedFocusTimer.current = window.setInterval(() => {
      attempts += 1;
      const focused = focusNodeById(lastEditedId, 1.0);
      if (focused || attempts >= 40) {
        if (lastEditedFocusTimer.current) {
          window.clearInterval(lastEditedFocusTimer.current);
          lastEditedFocusTimer.current = null;
        }
        if (focused) {
          setLastEditedId(null);
        }
      }
    }, 150);
  }, [lastEditedId, focusNodeById, graphData, reactFlowInstance]);

  useEffect(() => {
    selectedNodeIdsRef.current = nodes.filter(node => node.selected).map(node => node.id);
  }, [nodes]);

  useEffect(() => {
    const nextPositions = { ...nodePositionMap.current };
    nodes.forEach((node) => {
      nextPositions[node.id] = node.position;
    });
    nodePositionMap.current = nextPositions;
    try {
      localStorage.setItem('clan.nodePositions', JSON.stringify(nodePositionMap.current));
    } catch (error) {
      console.warn('Failed to persist node positions:', error);
    }
  }, [nodes]);

  const handleNodeClick = useCallback((event: React.MouseEvent, nodeId: string) => {
    console.log('Node: ', nodeId);
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

    if (linkMode && linkMode.from !== nodeId) {
      const relationshipType = getDefaultRelationshipType(linkMode.from, nodeId);
      requestRelationshipChoice({
        from: linkMode.from,
        to: nodeId,
        suggestedType: normalizeRelationshipChoiceType(relationshipType)
      });
      setLinkMode(null);
    }
  }, [linkMode, getDefaultRelationshipType, setNodes, selectedNode, requestRelationshipChoice, normalizeRelationshipChoiceType]);

  const selectedNodeIds = useMemo(
    () => nodes.filter(node => node.selected).map(node => node.id),
    [nodes]
  );

  const onNodeDragStart = useCallback((_event: React.MouseEvent, node: Node, draggingNodes: Node[] = []) => {
    if (isCoarsePointer) {
      setMobileNodeDragging(true);
    }
    const ids = getDragSelectionIds(node.id, draggingNodes);
    const positions = nodesRef.current.reduce<Record<string, { x: number; y: number }>>((acc, item) => {
      if (ids.includes(item.id)) {
        acc[item.id] = { ...item.position };
      }
      return acc;
    }, {});

    ids.forEach((id) => {
      if (collapsedMaternalRoots.has(id)) {
        collectFamilySide(id, 'maternal').forEach((hiddenId) => {
          if (positions[hiddenId]) return;
          const stored = getStoredPosition(hiddenId);
          if (stored) positions[hiddenId] = { ...stored };
        });
      }
      if (collapsedPaternalRoots.has(id)) {
        collectFamilySide(id, 'paternal').forEach((hiddenId) => {
          if (positions[hiddenId]) return;
          const stored = getStoredPosition(hiddenId);
          if (stored) positions[hiddenId] = { ...stored };
        });
      }
      if (collapsedChildRoots.has(id)) {
        collectChildSide(id).forEach((hiddenId) => {
          if (positions[hiddenId]) return;
          const stored = getStoredPosition(hiddenId);
          if (stored) positions[hiddenId] = { ...stored };
        });
      }
      if (collapsedSiblingRoots.has(id)) {
        collectSiblingSide(id).forEach((hiddenId) => {
          if (positions[hiddenId]) return;
          const stored = getStoredPosition(hiddenId);
          if (stored) positions[hiddenId] = { ...stored };
        });
      }
    });

    dragStartPositions.current = positions;
  }, [collapsedMaternalRoots, collapsedPaternalRoots, collapsedChildRoots, collapsedSiblingRoots, collectFamilySide, collectChildSide, collectSiblingSide, getStoredPosition, isCoarsePointer, getDragSelectionIds]);

  const onSelectionDragStart = useCallback((event: React.MouseEvent, draggingNodes: Node[]) => {
    if (!draggingNodes.length) return;
    onNodeDragStart(event, draggingNodes[0], draggingNodes);
  }, [onNodeDragStart]);

  const onSelectionDrag = useCallback((event: React.MouseEvent, draggingNodes: Node[]) => {
    if (!draggingNodes.length) return;
    onNodeDrag(event, draggingNodes[0], draggingNodes);
  }, [onNodeDrag]);

  const onSelectionDragStop = useCallback((event: React.MouseEvent, draggingNodes: Node[]) => {
    if (!draggingNodes.length) return;
    onNodeDragStop(event, draggingNodes[0], draggingNodes);
  }, [onNodeDragStop]);

  useEffect(() => {
    if (!selectedNode) return;
    if (collapsedNodeIds.has(selectedNode)) {
      setSelectedNode(null);
    }
  }, [selectedNode, collapsedNodeIds]);

  const handleUndo = useCallback(async () => {
    if (!ensureEditable()) return;
    const entry = undoStack[0];
    if (!entry) return;

    try {
      switch (entry.type) {
        case 'align':
        case 'move': {
          const nextPositions = entry.positions;
          const updates = Object.entries(nextPositions).map(([id, position]) => {
            nodePositionMap.current[id] = position;
            return updatePersonPosition(id, position, { force: true });
          });
          setNodes((prev) => prev.map((node) => {
            const position = nextPositions[node.id];
            if (!position) return node;
            return { ...node, position };
          }));
          try {
            localStorage.setItem('clan.nodePositions', JSON.stringify(nodePositionMap.current));
          } catch (error) {
            console.warn('Failed to persist node positions:', error);
          }
          await Promise.all(updates);
          const focusId = entry.type === 'move'
            ? (entry.draggedId || Object.keys(nextPositions)[0])
            : Object.keys(nextPositions)[0];
          if (focusId) {
            try {
              const focusPosition = nextPositions[focusId];
              localStorage.setItem('clan.centerId', focusId);
              localStorage.setItem('clan.pendingCenterId', focusId);
              if (focusPosition) {
                const bounds = flowWrapperRef.current?.getBoundingClientRect();
                const width = bounds?.width || window.innerWidth;
                const height = bounds?.height || window.innerHeight;
                const zoom = 1;
                const viewport = {
                  x: width / 2 - focusPosition.x * zoom,
                  y: height / 2 - focusPosition.y * zoom,
                  zoom
                };
                localStorage.setItem('clan.pendingViewport', JSON.stringify(viewport));
              }
              localStorage.removeItem('clan.pendingFocus');
              localStorage.removeItem('clan.pendingFocusPosition');
            } catch (error) {
              console.warn('Failed to persist pending focus after undo:', error);
            }
          }
          break;
        }
        case 'create_relationships': {
          const uniqueIds = Array.from(new Set(entry.relationshipIds));
          for (const relationshipId of uniqueIds) {
            try {
              await api.deleteRelationship(String(relationshipId));
            } catch (error) {
              if (error instanceof Error && error.message.includes('HTTP 404')) {
                continue;
              }
              throw error;
            }
          }
          setSelectedEdge(null);
          break;
        }
        case 'delete': {
          await api.createPerson(
            entry.person.name,
            entry.person.english_name ?? undefined,
            entry.person.gender,
            entry.person.dob ?? undefined,
            entry.person.dod ?? undefined,
            entry.person.tob ?? undefined,
            entry.person.tod ?? undefined,
            entry.person.metadata ?? undefined,
            entry.person.id,
            entry.person.avatar_url ?? undefined
          );
          for (const rel of entry.relationships) {
            await api.createRelationship(
              rel.from_person_id,
              rel.to_person_id,
              rel.metadata ?? undefined,
              rel.type as 'parent_child' | 'spouse' | 'ex_spouse' | 'sibling' | 'in_law',
              true
            );
          }
          if (entry.previousCenterId) {
            setCenterId(entry.previousCenterId);
          }
          break;
        }
      }
      setUndoStack(prev => prev.slice(1));
      fetchGraph();
    } catch (error) {
      console.error(`Failed to undo ${entry.type}:`, error);
    }
  }, [ensureEditable, undoStack, fetchGraph, setCenterId, setNodes, updatePersonPosition]);

  const handleDuplicateBottomRight = useCallback(async (id: string) => {
    if (!ensureEditable()) return;
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
      person.dob ?? undefined,
      person.dod ?? undefined,
      person.tob ?? undefined,
      person.tod ?? undefined,
      newMetadata,
      undefined,
      person.avatar_url ?? undefined,
      { skipFetch: true }
    );
  }, [ensureEditable, graphData, nodes, createPerson]);

  const alignSelectedNodes = useCallback((direction: 'horizontal' | 'vertical') => {
    if (!ensureEditable()) return;
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
  }, [ensureEditable, nodes, selectedNodeIds, setNodes, updatePersonPosition]);

  useEffect(() => {
    setNodes((prev) => {
      const selectedMap = new Map(prev.map((node) => [node.id, node.selected]));
      return initialNodes.map((node) => ({
        ...node,
        selected: selectedMap.get(node.id) ?? node.selected,
      }));
    });
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditableTarget(e.target)) {
        if (isReadOnly) {
          showToast('只讀模式，無法編輯', 'warning');
          return;
        }
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
        if (isReadOnly) {
          showToast('只讀模式，無法編輯', 'warning');
          return;
        }
        console.log('Pasting person:', copiedPerson.name);

        const fallbackPos = copiedPerson.metadata?.position || { x: 500, y: 300 };
        const position = lastMousePosition
          ? { x: lastMousePosition.x, y: lastMousePosition.y }
          : { x: fallbackPos.x + 40, y: fallbackPos.y + 40 };
        const newMetadata = {
          position
        };

        await createPerson(
          copiedPerson.name,
          undefined,
          copiedPerson.gender,
          undefined,
          undefined,
          undefined,
          undefined,
          newMetadata,
          undefined,
          undefined,
          { skipFetch: true }
        );
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isEditableTarget(e.target)) {
        e.preventDefault();
        if (isReadOnly) {
          showToast('只讀模式，無法編輯', 'warning');
          return;
        }
        handleUndo();
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        const input = document.getElementById('clan-search-input') as HTMLInputElement | null;
        input?.focus();
        input?.select();
      }

      if (!e.ctrlKey && !e.metaKey && e.shiftKey && e.key.toLowerCase() === 'd' && !isEditableTarget(e.target)) {
        e.preventDefault();
        if (hasActiveDimming) {
          clearAllDimming();
          showToast('已取消全部淡化', 'success');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEdge, selectedNode, graphData, copiedPerson, deleteRelationship, createPerson, handleUndo, lastMousePosition, handleDeletePerson, isReadOnly, showToast, hasActiveDimming, clearAllDimming]);

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
        readOnly={isReadOnly}
        isAdmin={canManageUsers}
        onManageUsers={canManageUsers ? onManageUsers : undefined}
        onManageNotifications={canManageUsers ? onManageNotifications : undefined}
        pendingNotificationCount={pendingNotificationCount}
        onManageSessions={onManageSessions}
        onOpenSettings={onOpenSettings}
        onCreateUser={() => setShowCreateUserModal(true)}
        onAddMember={() => {
          if (!ensureEditable()) return;
          setShowAddModal(true);
        }}
        onFocusMe={handleFocusMe}
        onSyncPositions={syncAllPositions}
        syncingPositions={syncingPositions}
        onClearAllDim={clearAllDimming}
        hasActiveDimming={hasActiveDimming}
        onExpandAllCollapsed={expandAllCollapsed}
        hasCollapsedNodes={hasCollapsedNodes}
        selectedNode={selectedNode}
        selectedEdge={selectedEdge}
        linkMode={linkMode}
        onUndo={handleUndo}
        canUndo={canUndo}
        onSearch={handleSearch}
        searchOptions={graphData?.nodes ?? []}
        username={username}
        onLogout={onLogout}
        onStartLink={() => {
          if (!ensureEditable()) return;
          if (selectedNode) {
            setLinkMode({ from: selectedNode });
          }
        }}
        onSetCenter={() => {
          if (selectedNode) {
            setCenterId(selectedNode);
            persistPendingViewport(selectedNode, 1.0);
            focusNodeById(selectedNode, 1.0);
            setSelectedNode(null);
          }
        }}
        onUpdateRelationship={(type) => {
          if (!ensureEditable()) return;
          if (selectedEdge) {
            updateRelationship(selectedEdge, { type });
          }
        }}
        onReverseRelationship={() => {
          if (!ensureEditable()) return;
          if (selectedEdge) {
            reverseRelationship(selectedEdge);
          }
        }}
        onDeleteRelationship={() => {
          if (!ensureEditable()) return;
          if (selectedEdge) {
            deleteRelationship(selectedEdge);
            setSelectedEdge(null);
          }
        }}
      />

      <div className="flow-container" ref={flowWrapperRef}>
        <ReactFlow
          nodes={nodesWithHighlights}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setReactFlowInstance}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={allowNodeConnecting ? onConnect : undefined}
          onConnectStart={allowNodeConnecting ? onConnectStart : undefined}
          onConnectEnd={allowNodeConnecting ? onConnectEnd : undefined}
          onNodeDragStart={allowNodeDragging ? onNodeDragStart : undefined}
          onNodeDrag={allowNodeDragging ? onNodeDrag : undefined}
          onNodeDragStop={allowNodeDragging ? onNodeDragStop : undefined}
          onSelectionDragStart={allowNodeDragging ? onSelectionDragStart : undefined}
          onSelectionDrag={allowNodeDragging ? onSelectionDrag : undefined}
          onSelectionDragStop={allowNodeDragging ? onSelectionDragStop : undefined}
          noPanClassName="nopan"
          noDragClassName="nodrag"
          connectionRadius={40}
          onNodeMouseMove={isLocked ? undefined : (event) => {
            onPaneMouseMove(event);
          }}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          onNodeClick={isLocked ? undefined : (event, node) => {
            handleNodeClick(event, node.id);
            setContextMenu(null);
            setAvatarPreview(null);
          }}
          onNodeDoubleClick={isReadOnly ? undefined : (event, node) => {
            setAvatarPreview(null);
            if (isCoarsePointer) {
              const viewport = reactFlowInstance?.getViewport?.() ?? { x: 0, y: 0, zoom: 1 };
              const fallbackX = (node.position.x + (node.width ?? 120) / 2) * viewport.zoom + viewport.x;
              const fallbackY = (node.position.y + (node.height ?? 120) / 2) * viewport.zoom + viewport.y;
              const x = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : fallbackX;
              const y = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : fallbackY;
              openContextMenuAt(node.id, x, y);
              return;
            }
            setContextMenu(null);
            handleEditPerson(node.id);
          }}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          onPaneMouseMove={onPaneMouseMove}
          onEdgeClick={isLocked ? undefined : handleEdgeClick}
          fitView={fitViewEnabled}
          minZoom={0.3}
          maxZoom={2}
          selectionKeyCode={isCoarsePointer ? null : ['Control', 'Meta']}
          nodesDraggable={allowNodeDragging}
          nodesConnectable={allowNodeConnecting}
          elementsSelectable
          panOnDrag={!mobileNodeDragging && !mobileConnecting}
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
        >
          <Background />
          <Controls showInteractive onInteractiveChange={handleInteractiveChange} />
          <MiniMap />
        </ReactFlow>
        {dragGuideY !== null && (
          <div className="drag-guide-line" style={{ top: dragGuideY }} />
        )}

        {contextMenu && (
          <ContextMenu
            {...contextMenu}
            readOnly={isReadOnly}
            title={graphData?.nodes.find(node => node.id === contextMenu.id)?.title ?? null}
            onSetCenter={setCenterId}
            onStartLink={(id) => {
              if (!ensureEditable()) return;
              setLinkMode({ from: id });
            }}
            onEdit={handleEditPerson}
            onReportIssue={(id) => {
              setReportIssuePersonId(id);
            }}
            onDelete={handleDeletePerson}
            onDeleteRelations={handleDeleteRelations}
            onDeleteSiblingRelations={handleDeleteSiblingRelations}
            onDeleteChildRelations={handleDeleteChildRelations}
            onCopyTitle={(title) => {
              const copyViaClipboard = () => navigator.clipboard.writeText(title);
              const copyViaFallback = () => {
                const textarea = document.createElement('textarea');
                textarea.value = title;
                textarea.setAttribute('readonly', 'true');
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(textarea);
                return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
              };
              const copyPromise = navigator.clipboard && window.isSecureContext
                ? copyViaClipboard()
                : copyViaFallback();
              copyPromise.then(() => {
                showToast('已複製稱呼', 'success');
              }).catch(() => {
                showToast('複製失敗', 'warning');
              });
            }}
            onDuplicateBottomRight={handleDuplicateBottomRight}
            selectedCount={selectedNodeIds.length}
            onAlignHorizontal={() => alignSelectedNodes('horizontal')}
            onAlignVertical={() => alignSelectedNodes('vertical')}
            onToggleDimSingle={(id) => {
              const isDimmed = dimIds.has(id);
              if (isDimmed) {
                setDimNodeIds((prev) => {
                  if (!prev.has(id)) return prev;
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                });
                setDimExcludedNodeIds((prev) => {
                  if (prev.has(id)) return prev;
                  const next = new Set(prev);
                  next.add(id);
                  return next;
                });
                return;
              }
              setDimExcludedNodeIds((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
              setDimNodeIds((prev) => {
                if (prev.has(id)) return prev;
                const next = new Set(prev);
                next.add(id);
                return next;
              });
            }}
            onToggleDimRelatives={(id) => {
              setDimNonRelativesId(null);
              setDimFocusId(prev => (prev === id ? null : id));
            }}
            onToggleDimNonRelatives={(id) => {
              setDimFocusId(null);
              setDimNonRelativesId(prev => (prev === id ? null : id));
            }}
            onToggleCollapseMaternal={(id) => {
              const shouldExpand = collapsedMaternalRoots.has(id);
              const expandedIds = shouldExpand ? collectFamilySide(id, 'maternal') : new Set<string>();
              setCollapsedMaternalRoots((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
              if (shouldExpand) {
                selectExpandedNodes(expandedIds);
                scheduleExpandedRelayout(expandedIds);
              }
            }}
            onToggleCollapsePaternal={(id) => {
              const shouldExpand = collapsedPaternalRoots.has(id);
              const expandedIds = shouldExpand ? collectFamilySide(id, 'paternal') : new Set<string>();
              setCollapsedPaternalRoots((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
              if (shouldExpand) {
                selectExpandedNodes(expandedIds);
                scheduleExpandedRelayout(expandedIds);
              }
            }}
            onToggleCollapseChildren={(id) => {
              const shouldExpand = collapsedChildRoots.has(id);
              const expandedIds = shouldExpand ? collectChildSide(id) : new Set<string>();
              setCollapsedChildRoots((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
              if (shouldExpand) {
                selectExpandedNodes(expandedIds);
                scheduleExpandedRelayout(expandedIds);
              }
            }}
            onToggleCollapseSiblings={(id) => {
              const shouldExpand = collapsedSiblingRoots.has(id);
              const expandedIds = shouldExpand ? collectSiblingSide(id) : new Set<string>();
              setCollapsedSiblingRoots((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
              if (shouldExpand) {
                selectExpandedNodes(expandedIds);
                scheduleExpandedRelayout(expandedIds);
              }
            }}
            dimSingleActive={dimIds.has(contextMenu.id)}
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
        <div className="modal-overlay avatar-overlay" onClick={() => setAvatarPreview(null)}>
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

      {reportIssuePerson && (
        <ReportIssueModal
          personName={reportIssuePerson.name}
          onClose={() => setReportIssuePersonId(null)}
          onSubmit={async ({ type, message }) => {
            await api.createNotification({
              type,
              message,
              target_person_id: reportIssuePerson.id,
              target_person_name: reportIssuePerson.name
            });
            showToast('已送出問題提報', 'success');
          }}
        />
      )}

      {!isReadOnly && showAddModal && (
        <AddPersonModal
          onClose={() => setShowAddModal(false)}
          onSubmit={async (name, englishName, gender, dob, dod, tob, tod) => {
            const person = await createPerson(name, englishName, gender, dob, dod, tob, tod);
            if (selectedNode) {
              const relationshipType = getDefaultRelationshipType(selectedNode, person.id, { toGender: person.gender });
              requestRelationshipChoice({
                from: selectedNode,
                to: person.id,
                suggestedType: normalizeRelationshipChoiceType(relationshipType)
              });
            }
            setShowAddModal(false);
          }}
        />
      )}

      {pendingRelationshipChoice && (
        <div className="modal-overlay" onClick={() => setPendingRelationshipChoice(null)}>
          <div className="relationship-choice-modal" onClick={(event) => event.stopPropagation()}>
            <h3>請選擇關係類型</h3>
            <p>
              {
                `${graphData?.nodes.find((node) => node.id === pendingRelationshipChoice.from)?.name || pendingRelationshipChoice.from}`
              }
              {'  ↔  '}
              {
                `${graphData?.nodes.find((node) => node.id === pendingRelationshipChoice.to)?.name || pendingRelationshipChoice.to}`
              }
            </p>
            <div className="relationship-choice-actions">
              <button
                className={`relationship-choice-btn ${pendingRelationshipChoice.suggestedType === 'sibling' ? 'is-suggested' : ''}`}
                onClick={() => confirmRelationshipChoice('sibling')}
              >
                手足
              </button>
              <button
                className={`relationship-choice-btn ${pendingRelationshipChoice.suggestedType === 'parent_child' ? 'is-suggested' : ''}`}
                onClick={() => confirmRelationshipChoice('parent_child')}
              >
                親子
              </button>
              <button
                className={`relationship-choice-btn ${pendingRelationshipChoice.suggestedType === 'spouse' ? 'is-suggested' : ''}`}
                onClick={() => confirmRelationshipChoice('spouse')}
              >
                夫妻
              </button>
            </div>
            <button className="relationship-choice-cancel" onClick={() => setPendingRelationshipChoice(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      {canManageUsers && showCreateUserModal && (
        <CreateUserModal
          onClose={() => setShowCreateUserModal(false)}
          onSubmit={handleCreateUser}
        />
      )}

      {!isReadOnly && editingPersonId && graphData && (
        <EditPersonModal
          person={graphData.nodes.find(p => p.id === editingPersonId)!}
          onClose={() => setEditingPersonId(null)}
          onUnsavedClose={() => showToast('未儲存變更', 'warning')}
          onSubmit={async (id, updates, avatarFile, removeAvatar) => {
            const nextUpdates = { ...updates } as Partial<Person> & { avatar_url?: string | null };
            const person = graphData.nodes.find(p => p.id === id);
            const existingMetadata = person?.metadata ?? {};
            let mergedMetadata = updates.metadata
              ? { ...existingMetadata, ...updates.metadata }
              : undefined;

            if (removeAvatar) {
              nextUpdates.avatar_url = null;
              if (!mergedMetadata) {
                mergedMetadata = { ...existingMetadata };
              }
              delete (mergedMetadata as any).avatarHash;
            }

            if (avatarFile) {
              const nextHash = await hashAvatarFile(avatarFile);
              const existingHash = (existingMetadata as any).avatarHash as string | undefined;
              if (!nextHash || nextHash !== existingHash) {
                const { avatar_url } = await api.uploadAvatar(id, avatarFile);
                nextUpdates.avatar_url = avatar_url;
                if (!mergedMetadata) {
                  mergedMetadata = { ...existingMetadata };
                }
                if (nextHash) {
                  (mergedMetadata as any).avatarHash = nextHash;
                } else {
                  delete (mergedMetadata as any).avatarHash;
                }
              }
            }

            if (mergedMetadata) {
              nextUpdates.metadata = mergedMetadata;
            }
            const filteredUpdates: Partial<Person> & { avatar_url?: string | null; metadata?: any } = {};
            const assignIfChanged = (key: keyof Person | 'avatar_url', value: any, current: any) => {
              if (value === undefined) return;
              const nextValue = value ?? null;
              const currentValue = current ?? null;
              if (nextValue !== currentValue) {
                (filteredUpdates as any)[key] = value;
              }
            };

            assignIfChanged('name', nextUpdates.name, person?.name);
            assignIfChanged('english_name', nextUpdates.english_name, person?.english_name ?? null);
            assignIfChanged('gender', nextUpdates.gender, person?.gender);
            assignIfChanged('dob', nextUpdates.dob, person?.dob ?? null);
            assignIfChanged('dod', nextUpdates.dod, person?.dod ?? null);
            assignIfChanged('tob', nextUpdates.tob, person?.tob ?? null);
            assignIfChanged('tod', nextUpdates.tod, person?.tod ?? null);
            assignIfChanged('avatar_url', nextUpdates.avatar_url, person?.avatar_url ?? null);

            if (nextUpdates.metadata !== undefined) {
              const currentMetadata = person?.metadata ?? {};
              const nextMetadata = nextUpdates.metadata ?? {};
              if (JSON.stringify(currentMetadata) !== JSON.stringify(nextMetadata)) {
                filteredUpdates.metadata = nextUpdates.metadata;
              }
            }

            if (Object.keys(filteredUpdates).length === 0) {
              setEditingPersonId(null);
              showToast('沒有變更', 'warning');
              return;
            }

            setLastEditedId(id);
            try {
              localStorage.setItem('clan.lastEditedId', id);
            } catch (error) {
              console.warn('Failed to persist last edited id:', error);
            }

            await updatePerson(id, filteredUpdates);
            setEditingPersonId(null);
            showToast('已儲存', 'success');
            const viewport = getViewportForNode(id, 1.0);
            if (viewport && reactFlowInstance?.setViewport) {
              reactFlowInstance.setViewport(viewport);
              localStorage.setItem('clan.pendingViewport', JSON.stringify(viewport));
            }
            setPendingCenterId(id);
            localStorage.setItem('clan.pendingCenterId', id);
            focusNodeById(id, 1.0);
          }}
        />
      )}
    </div>
  );
}
