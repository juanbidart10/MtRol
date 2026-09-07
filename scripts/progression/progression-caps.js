import { resolveAttributeCap } from "../effects/attribute-cap-policy.js";
import {
  MTROL_ATTRIBUTE_CAP,
  MTROL_COMPETENCE_CAP
} from "./progression-constants.js";

export { MTROL_ATTRIBUTE_CAP, MTROL_COMPETENCE_CAP } from "./progression-constants.js";

export function getAttributeCap(actor = null, options = {}) {
  return resolveAttributeCap(actor, { baseCap: MTROL_ATTRIBUTE_CAP, ...options }).value;
}

export function getCompetenceCap(_actor = null) {
  return MTROL_COMPETENCE_CAP;
}
