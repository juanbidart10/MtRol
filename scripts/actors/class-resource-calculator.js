import {
  getResourceProfileForClass
} from "./class-registry.js";

export const MTROL_RESOURCES_PER_LEVEL = Object.freeze({
  hp: 10,
  mp: 10
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeFinite(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function readState(input = {}) {
  const system = input?.system ?? input ?? {};
  const identity = system.identidad ?? {};
  const resources = system.recursos ?? {};
  const attributes = system.atributos ?? {};
  const vitals = system.vitales ?? {};
  const modifiers = system.resourceModifiers ?? {};

  return {
    classId: input?.classId ?? identity.classId,
    classDomain: input?.classDomain ?? identity.classDomain,
    level: finiteNumber(input?.level ?? resources.nivel),
    resistance: finiteNumber(input?.resistance ?? attributes.resistencia),
    intelligence: finiteNumber(input?.intelligence ?? attributes.inteligencia),
    hpModifier: finiteNumber(input?.hpModifier ?? modifiers.hp?.value),
    mpModifier: finiteNumber(input?.mpModifier ?? modifiers.mp?.value),
    hpValue: nonNegativeFinite(input?.hpValue ?? vitals.hp?.value),
    hpMax: nonNegativeFinite(input?.hpMax ?? vitals.hp?.max),
    mpValue: nonNegativeFinite(input?.mpValue ?? vitals.mp?.value),
    mpMax: nonNegativeFinite(input?.mpMax ?? vitals.mp?.max)
  };
}

function calculateActiveMaximums(state, profile) {
  const levelBaseHp = state.level * MTROL_RESOURCES_PER_LEVEL.hp;
  const levelBaseMp = state.level * MTROL_RESOURCES_PER_LEVEL.mp;

  return {
    hpMax: nonNegativeFinite(
      levelBaseHp + (state.resistance * profile.hpPerResistance) + state.hpModifier
    ),
    mpMax: nonNegativeFinite(
      levelBaseMp + (state.intelligence * profile.mpPerIntelligence) + state.mpModifier
    )
  };
}

export function calculateActorResourceMaximums(input) {
  const state = readState(input);
  const profile = getResourceProfileForClass(state.classId, state.classDomain);

  if (!profile) {
    return {
      active: false,
      hpMax: state.hpMax,
      mpMax: state.mpMax
    };
  }

  return {
    active: true,
    ...calculateActiveMaximums(state, profile)
  };
}

export function calculateHpMax(input) {
  return calculateActorResourceMaximums(input).hpMax;
}

export function calculateMpMax(input) {
  return calculateActorResourceMaximums(input).mpMax;
}

export function calculateResourceTransition(oldInput, newInput) {
  const oldState = readState(oldInput);
  const newState = readState(newInput);
  const newMaximums = calculateActorResourceMaximums(newState);

  if (!newMaximums.active) {
    return {
      active: false,
      hp: {
        value: oldState.hpValue,
        max: oldState.hpMax,
        delta: 0
      },
      mp: {
        value: oldState.mpValue,
        max: oldState.mpMax,
        delta: 0
      }
    };
  }

  const oldMaximums = calculateActorResourceMaximums(oldState);
  const oldHpMax = oldMaximums.active ? oldMaximums.hpMax : oldState.hpMax;
  const oldMpMax = oldMaximums.active ? oldMaximums.mpMax : oldState.mpMax;
  const hpDelta = newMaximums.hpMax - oldHpMax;
  const mpDelta = newMaximums.mpMax - oldMpMax;

  return {
    active: true,
    hp: {
      value: clamp(oldState.hpValue + hpDelta, 0, newMaximums.hpMax),
      max: newMaximums.hpMax,
      delta: hpDelta
    },
    mp: {
      value: clamp(oldState.mpValue + mpDelta, 0, newMaximums.mpMax),
      max: newMaximums.mpMax,
      delta: mpDelta
    }
  };
}
