import { useEffect, useState } from 'react';
import { api } from '../api';
import { DEFAULT_RELATIONSHIP_TYPE_LABELS } from '../clanGraph/constants';
import type { RelationshipTypeKey } from '../types';

export function useGraphAmbientState(canManageUsers: boolean) {
  const [pendingNotificationCount, setPendingNotificationCount] = useState(0);
  const [relationshipTypeLabelMap, setRelationshipTypeLabelMap] = useState<Record<RelationshipTypeKey, string>>(
    DEFAULT_RELATIONSHIP_TYPE_LABELS
  );
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  useEffect(() => {
    if (!canManageUsers) {
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
    let cancelled = false;
    const loadRelationshipTypeLabels = async () => {
      try {
        const labels = await api.fetchRelationshipTypeLabels();
        if (cancelled) return;
        const next: Record<RelationshipTypeKey, string> = { ...DEFAULT_RELATIONSHIP_TYPE_LABELS };
        for (const item of labels) {
          if (item.label) {
            next[item.type] = item.label;
          }
        }
        setRelationshipTypeLabelMap(next);
      } catch (error) {
        if (!cancelled) {
          setRelationshipTypeLabelMap(DEFAULT_RELATIONSHIP_TYPE_LABELS);
        }
        console.warn('Failed to fetch relationship type labels:', error);
      }
    };
    void loadRelationshipTypeLabels();
    return () => {
      cancelled = true;
    };
  }, []);

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

  return {
    pendingNotificationCount: canManageUsers ? pendingNotificationCount : 0,
    relationshipTypeLabelMap,
    isShiftPressed,
    isCoarsePointer
  };
}
