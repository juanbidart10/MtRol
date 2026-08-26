import {
  MTROL_ORB_IDS
} from "../scripts/progression/orb-registry.js";

const { fields } = foundry.data;

export class CompetenciaDataModel extends foundry.abstract.TypeDataModel {

  static migrateData(source) {
    source ??= {};
    const hasDamageFormula =
      typeof source?.danio === "string" && source.danio.trim().length > 0;
    const legacyDamageAction =
      hasDamageFormula &&
      (
        ["attack", "basicAttack", "combatSkill", "damage"].includes(source?.actionType) ||
        source?.effect === "damage"
      );
    const legacyRequiresOpposition =
      source?.requiresOpposition === true ||
      (source?.requiresOpposition === undefined && legacyDamageAction);

    if (
      source.rol === undefined ||
      source.rol === null ||
      (typeof source.rol === "string" && source.rol.trim().length === 0)
    ) {
      source.rol = null;
    }
    source.requiresOpposition ??= legacyRequiresOpposition;
    source.damageResolution ??=
      legacyRequiresOpposition ? "onOppositionWin" : "immediate";
    source.damageMode ??=
      legacyRequiresOpposition ? "enabled" : "automatic";
    source.damageCostType ??= "none";
    source.damageType ??= null;
    source.damageElement ??= null;
    source.spellTags ??= [];

    return super.migrateData(source);
  }

  static defineSchema() {

    return {

      nivel: new fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 1,
        min: 1,
        max: 5
      }),

      categoria: new fields.StringField({
        required: false,
        nullable: false,
        initial: "competencia"
      }),

      rol: new fields.StringField({
        required: false,
        nullable: true,
        initial: null,
        choices: [
          "offensive",
          "defensive",
          "control",
          "support",
          "utility",
          "mobility"
        ]
      }),

      orbType: new fields.StringField({
        required: false,
        nullable: true,
        initial: null,
        choices: MTROL_ORB_IDS
      }),

      specialAbilityKey: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

      specialAbilityHandler: new fields.StringField({
        required: false,
        nullable: false,
        initial: "default",
        choices: ["default", "orb-contextual"]
      }),

      damageType: new fields.StringField({
        required: false,
        nullable: true,
        initial: null,
        choices: [
          "physical",
          "magical"
        ]
      }),

      damageElement: new fields.StringField({
        required: false,
        nullable: true,
        initial: null,
        choices: [
          "fire"
        ]
      }),

      spellTags: new fields.ArrayField(
        new fields.StringField({
          required: true,
          nullable: false,
          choices: [
            "sensory",
            "destructive"
          ]
        }),
        {
          required: false,
          nullable: false,
          initial: []
        }
      ),

      actionType: new fields.StringField({
        required: false,
        nullable: false,
        initial: "utility",
        choices: [
          "attack",
          "basicAttack",
          "combatSkill",
          "control",
          "damage",
          "heal",
          "buff",
          "debuff",
          "summon",
          "utility",
          "movement",
          "channel",
          "defense"
        ]
      }),

      effect: new fields.StringField({
        required: false,
        nullable: false,
        initial: "none",
        choices: [
          "none",
          "damage",
          "stunned",
          "silence",
          "fear",
          "root",
          "burn",
          "bleed",
          "freeze",
          "poison",
          "heal",
          "shield",
          "block",
          "buff",
          "debuff",
          "mpRecovery"
        ]
      }),

      requiresTarget: new fields.BooleanField({
        required: false,
        nullable: false,
        initial: false
      }),

      requiresOpposition: new fields.BooleanField({
        required: false,
        nullable: false,
        initial: false
      }),

      oppositionType: new fields.StringField({
        required: false,
        nullable: false,
        initial: "free",
        choices: [
          "free",
          "dodge",
          "shield",
          "will",
          "resistance",
          "competence",
          "custom"
        ]
      }),

      defenseType: new fields.StringField({
        required: false,
        nullable: false,
        initial: "custom",
        choices: [
          "shield",
          "dodge",
          "parry",
          "resistance",
          "will",
          "custom"
        ]
      }),

      effectDuration: new fields.NumberField({
        required: false,
        nullable: false,
        integer: true,
        initial: 1,
        min: 0
      }),

      effectIntensity: new fields.NumberField({
        required: false,
        nullable: false,
        initial: 0
      }),

      formula: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

      formulaTirada: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

      danio: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

      atributo: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

      equipadaCombate: new fields.BooleanField({
        required: false,
        nullable: false,
        initial: false
      }),

      // Deprecated: se conserva para compatibilidad, pero el motor y la UI lo ignoran.
      costeMP: new fields.NumberField({
        required: false,
        nullable: false,
        integer: true,
        initial: 1,
        min: 0
      }),

      nivelHechizo: new fields.NumberField({
        required: false,
        nullable: false,
        integer: true,
        initial: 1,
        min: 1,
        max: 5
      }),

      competenciaAsociada: new fields.StringField({
        required: false,
        nullable: false,
        initial: "magia"
      }),

      usaDanioLocalizado: new fields.BooleanField({
        required: false,
        nullable: false,
        initial: false
      }),

      ejecutaDanio: new fields.BooleanField({
        required: false,
        nullable: false,
        initial: true
      }),

      damageResolution: new fields.StringField({
        required: false,
        nullable: false,
        initial: "immediate",
        choices: [
          "immediate",
          "onOppositionWin"
        ]
      }),

      damageMode: new fields.StringField({
        required: false,
        nullable: false,
        initial: "automatic",
        choices: [
          "automatic",
          "enabled"
        ]
      }),

      damageCostType: new fields.StringField({
        required: false,
        nullable: false,
        initial: "none",
        choices: [
          "none",
          "basic"
        ]
      }),

      banner: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

      // Deprecated: se conserva para leer Items legacy, sin exponerlo en la UI.
      elemento: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

      // Deprecated: se conserva para leer Items legacy, sin exponerlo en la UI.
      rareza: new fields.StringField({
        required: false,
        nullable: false,
        initial: "comun"
      }),

      cooldown: new fields.NumberField({
        required: false,
        nullable: false,
        integer: true,
        initial: 0,
        min: 0
      }),

      fx: new fields.SchemaField({
        autocast: new fields.StringField({
          required: false,
          nullable: false,
          initial: ""
        }),

        proyectil: new fields.StringField({
          required: false,
          nullable: false,
          initial: ""
        }),

        target: new fields.StringField({
          required: false,
          nullable: false,
          initial: ""
        }),

        visual: new fields.StringField({
          required: false,
          nullable: false,
          initial: ""
        }),

        sonido: new fields.StringField({
          required: false,
          nullable: false,
          initial: ""
        }),

        duracion: new fields.NumberField({
          required: false,
          nullable: false,
          integer: true,
          initial: 5000,
          min: 0
        }),

        escala: new fields.NumberField({
          required: false,
          nullable: false,
          initial: 1,
          min: 0
        })
      }),

      tipo: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

      descripcion: new fields.HTMLField({
        required: false,
        nullable: false,
        initial: ""
      })

    };

  }

}
