import type { Person, Relationship } from './types';
import {
  type BatchKinshipCalculationContext,
  BreadthFirstKinshipCalculator,
  type KinshipCalculationContext,
  type KinshipCalculationResult,
  type KinshipCalculator,
} from './kinship/calculator';

const defaultKinshipCalculator = new BreadthFirstKinshipCalculator();

export type { BatchKinshipCalculationContext, KinshipCalculationContext, KinshipCalculationResult, KinshipCalculator };
export { BreadthFirstKinshipCalculator };

export function calculateKinship(ctx: KinshipCalculationContext): KinshipCalculationResult;
export function calculateKinship(
  centerId: string,
  targetId: string,
  relationships: Relationship[],
  people: Person[],
  centerPerson: Person,
): KinshipCalculationResult;
export function calculateKinship(
  centerIdOrContext: string | KinshipCalculationContext,
  targetId?: string,
  relationships?: Relationship[],
  people?: Person[],
  centerPerson?: Person,
): KinshipCalculationResult {
  const context = typeof centerIdOrContext === 'string'
    ? {
      centerId: centerIdOrContext,
      targetId: targetId!,
      relationships: relationships!,
      people: people!,
      centerPerson: centerPerson!,
    }
    : centerIdOrContext;

  return defaultKinshipCalculator.calculate(context);
}

export const calculateKinshipMany = (ctx: BatchKinshipCalculationContext): Map<string, KinshipCalculationResult> => (
  defaultKinshipCalculator.calculateMany(ctx)
);
