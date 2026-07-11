const { fields } = foundry.data;

export class CompetenciaDataModel extends foundry.abstract.TypeDataModel {

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

      banner: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

      elemento: new fields.StringField({
        required: false,
        nullable: false,
        initial: ""
      }),

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
