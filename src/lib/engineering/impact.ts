// Pure, deterministic change-impact derivation (PLAN.md Decisions 3–4).
//
// An obligation exists only because a rule in the rule pack fires for the
// proposed contract values. Its explanation is the contract change, the rule,
// and the shortest relationship path that carries the change from the
// contract's concept to the obligation's concept. Concepts the change reaches
// through relationships that no rule covers are reported 'unknown'.

import type {
  AffectedConcept,
  ChangeImpact,
  ContractChange,
  ContractDefinition,
  ContractValues,
  EngineeringConcept,
  EngineeringRelationship,
  EngineeringStatement,
  Obligation,
  PropagationStep,
  RelationKind,
  RuleCondition,
  RulePack,
} from '../../types/engineering';

/** 'forward': a change to `from` affects `to`. 'reverse': a change to `to` affects `from`. */
export const RELATION_PROPAGATION: Record<RelationKind, 'forward' | 'reverse'> = {
  requires: 'forward',
  constrains: 'forward',
  verified_by: 'forward',
  implements: 'reverse',
  depends_on: 'reverse',
  enables: 'reverse',
  supports: 'reverse',
};

export interface ImpactModel {
  concepts: EngineeringConcept[];
  statements: EngineeringStatement[];
  relationships: EngineeringRelationship[];
}

export function contractValuesOf(statement: EngineeringStatement): ContractValues {
  const values: ContractValues = {};
  for (const [key, value] of Object.entries(statement.meta ?? {})) {
    if (key.startsWith('p.') && typeof value === 'string') values[key.slice(2)] = value;
  }
  return values;
}

export function conceptOfStatement(model: Pick<ImpactModel, 'concepts'>, statementId: string): EngineeringConcept | undefined {
  return model.concepts.find((c) => c.memberObjectIds.includes(statementId));
}

function holds(condition: RuleCondition, values: ContractValues): boolean {
  return Object.entries(condition).every(([key, value]) => values[key] === value);
}

/**
 * Breadth-first propagation over accepted relationships. Neighbors are visited
 * in relationship-id order so the chosen shortest path is deterministic.
 */
export function propagate(
  relationships: EngineeringRelationship[],
  startConceptId: string
): Map<string, PropagationStep[]> {
  const edges = new Map<string, PropagationStep[]>();
  const sorted = relationships
    .filter((r) => r.reviewState === 'accepted' || r.reviewState === 'edited')
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const r of sorted) {
    const forward = RELATION_PROPAGATION[r.kind] === 'forward';
    const step: PropagationStep = forward
      ? { relationshipId: r.id, kind: r.kind, fromConceptId: r.from, toConceptId: r.to, direction: 'forward' }
      : { relationshipId: r.id, kind: r.kind, fromConceptId: r.to, toConceptId: r.from, direction: 'reverse' };
    const list = edges.get(step.fromConceptId) ?? [];
    list.push(step);
    edges.set(step.fromConceptId, list);
  }

  const paths = new Map<string, PropagationStep[]>([[startConceptId, []]]);
  const queue = [startConceptId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const base = paths.get(current)!;
    for (const step of edges.get(current) ?? []) {
      if (paths.has(step.toConceptId)) continue;
      paths.set(step.toConceptId, [...base, step]);
      queue.push(step.toConceptId);
    }
  }
  return paths;
}

export class ImpactError extends Error {}

export function deriveImpact(
  model: ImpactModel,
  change: ContractChange,
  contract: ContractDefinition,
  pack: RulePack
): ChangeImpact {
  if (pack.contractKey !== change.contractKey || contract.key !== change.contractKey) {
    throw new ImpactError(`Rule pack ${pack.id} does not apply to contract ${change.contractKey}`);
  }
  const invalid = contract.validate(change.to);
  if (invalid) throw new ImpactError(invalid);
  const concept = conceptOfStatement(model, change.statementId);
  if (!concept) throw new ImpactError(`Contract statement ${change.statementId} is not placed in any concept`);

  const paths = propagate(model.relationships, concept.id);

  const obligations: Obligation[] = [];
  for (const rule of pack.rules) {
    if (!holds(rule.when, change.to) || holds(rule.when, change.from)) continue;
    const trigger = Object.keys(rule.when)
      .filter((key) => change.from[key] !== change.to[key])
      .map((key) => `${key}: ${change.from[key] ?? '∅'} → ${change.to[key]}`);
    obligations.push({
      id: rule.id,
      ruleId: rule.id,
      conceptId: rule.conceptId,
      kind: rule.kind,
      title: rule.title,
      because: rule.because,
      trigger,
      path: paths.get(rule.conceptId) ?? null,
      ...(rule.criterionId ? { criterionId: rule.criterionId } : {}),
    });
  }

  const affectedConcepts: AffectedConcept[] = [...paths.entries()].map(([conceptId, path]) => {
    const obligationIds = obligations.filter((o) => o.conceptId === conceptId).map((o) => o.id);
    return { conceptId, path, obligationIds, status: obligationIds.length > 0 ? 'covered' : 'unknown' };
  });

  return {
    change: { ...change, from: { ...change.from }, to: { ...change.to } },
    rulePack: { id: pack.id, version: pack.version },
    contractConceptId: concept.id,
    obligations,
    affectedConcepts,
    modelGaps: obligations.filter((o) => o.path === null).map((o) => o.id),
    criterionIds: obligations.flatMap((o) => (o.criterionId ? [o.criterionId] : [])),
  };
}

/** Human-readable one-liner for a propagation step, e.g. "Worker implements Delivery guarantee". */
export function describeStep(step: PropagationStep, titleOf: (conceptId: string) => string): string {
  const relation = step.kind.replace('_', ' ');
  return step.direction === 'forward'
    ? `${titleOf(step.fromConceptId)} ${relation} ${titleOf(step.toConceptId)}`
    : `${titleOf(step.toConceptId)} ${relation} ${titleOf(step.fromConceptId)}`;
}
