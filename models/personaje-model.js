import {
  MTROL_ORB_IDS
} from "../scripts/progression/orb-registry.js";

const fields = foundry.data.fields;

const MTROL_ALIGNMENT_TYPES = Object.freeze([
  "tanque",
  "soporte",
  "arcano",
  "destructor",
  "dungeoner"
]);

export class PersonajeDataModel extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    source ??= {};

    // Actor.update() also runs migration against partial system sources.  Do
    // not materialize absent containers here: doing so turns an unrelated
    // update into an implicit reset. Schema initials provide legacy defaults
    // when a complete document is constructed.
    if (
      source.alignment &&
      Object.hasOwn(source.alignment, "type") &&
      (
        source.alignment.type === undefined ||
        source.alignment.type === null ||
        (typeof source.alignment.type === "string" && source.alignment.type.trim().length === 0)
      )
    ) {
      source.alignment.type = null;
    }

    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      vitales: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 10, integer: true, min: 0 }),
          max: new fields.NumberField({ initial: 10, integer: true, min: 0 }),
          temp: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        }),

        mp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 5, integer: true, min: 0 }),
          max: new fields.NumberField({ initial: 5, integer: true, min: 0 }),
          temp: new fields.NumberField({ initial: 0, integer: true, min: 0 })
        })
      }),

      atributos: new fields.SchemaField({
        resistencia: new fields.NumberField({ initial: 0 }),
        carisma: new fields.NumberField({ initial: 0 }),
        fuerza: new fields.NumberField({ initial: 0 }),
        inteligencia: new fields.NumberField({ initial: 0 }),
        voluntad: new fields.NumberField({ initial: 0 }),
        aura: new fields.NumberField({ initial: 0 }),
        percepcion: new fields.NumberField({ initial: 0 }),
        destreza: new fields.NumberField({ initial: 0 }),
        suerte: new fields.NumberField({ initial: 0 })
      }),

      identidad: new fields.SchemaField({
        titulo: new fields.StringField({ initial: "" }),
        clase: new fields.StringField({ initial: "" }),
        classId: new fields.StringField({ initial: "" }),
        classDomain: new fields.StringField({
          required: false,
          nullable: false,
          initial: "",
          blank: true,
          choices: ["", "physical", "magical", "hybrid"]
        }),
        raza: new fields.StringField({ initial: "" }),
        raceId: new fields.StringField({ initial: "" }),
        profesion: new fields.StringField({ initial: "" }),
        maestria: new fields.StringField({ initial: "" }),
        fullBodyImage: new fields.StringField({ initial: "" }),
        edad: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

      raceCreationGrant: new fields.SchemaField({
        applied: new fields.BooleanField({
          required: false,
          nullable: false,
          initial: false
        }),
        sourceRaceId: new fields.StringField({
          required: false,
          nullable: false,
          initial: ""
        })
      }),

      resourceModifiers: new fields.SchemaField({
        hp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0 }),
          label: new fields.StringField({ initial: "" })
        }),
        mp: new fields.SchemaField({
          value: new fields.NumberField({ initial: 0 }),
          label: new fields.StringField({ initial: "" })
        })
      }),

      resourceModifierEntries: new fields.ArrayField(
        new fields.SchemaField({
          id: new fields.StringField({
            required: true,
            nullable: false,
            blank: false
          }),
          hp: new fields.SchemaField({
            value: new fields.NumberField({ initial: 0 }),
            label: new fields.StringField({ initial: "" })
          }),
          mp: new fields.SchemaField({
            value: new fields.NumberField({ initial: 0 }),
            label: new fields.StringField({ initial: "" })
          })
        }),
        {
          required: false,
          nullable: false,
          initial: []
        }
      ),

      recursos: new fields.SchemaField({
        nivel: new fields.NumberField({ initial: 1 }),
        exp: new fields.NumberField({ initial: 0 }),
        doblones: new fields.NumberField({ initial: 0 }),
        dharma: new fields.NumberField({ initial: 0 }),
        karma: new fields.NumberField({ initial: 0 }),
        mvp: new fields.NumberField({ initial: 0 }),
        estres: new fields.NumberField({ initial: 0 }),
        corrupcion: new fields.NumberField({ initial: 0 }),
        iniciativa: new fields.NumberField({ initial: 0, integer: true }),
        pasiva: new fields.StringField({ initial: "" }),
        despertar: new fields.StringField({ initial: "" }),
        habilidadEspecial1: new fields.StringField({ initial: "" }),
        habilidadEspecial2: new fields.StringField({ initial: "" })
      }),

      progression: new fields.SchemaField({
        missionsCompleted: new fields.NumberField({
          required: false,
          nullable: false,
          initial: 0,
          integer: true,
          min: 0
        }),
        dungeonsCompleted: new fields.NumberField({
          required: false,
          nullable: false,
          initial: 0,
          integer: true,
          min: 0
        }),
        meritCredits: new fields.NumberField({
          required: false,
          nullable: false,
          initial: 0,
          integer: true,
          min: 0
        }),
        defeatedLevel5Enemy: new fields.BooleanField({
          required: false,
          nullable: false,
          initial: false
        }),
        dmApproval: new fields.BooleanField({
          required: false,
          nullable: false,
          initial: false
        })
      }),

      pendingAdvancement: new fields.SchemaField({
        attributePoints: new fields.NumberField({
          required: false,
          nullable: false,
          initial: 0,
          integer: true,
          min: 0
        }),
        competencePoints: new fields.NumberField({
          required: false,
          nullable: false,
          initial: 0,
          integer: true,
          min: 0
        })
      }),

      awakening: new fields.SchemaField({
        grants: new fields.ArrayField(
          new fields.SchemaField({
            grantId: new fields.StringField({ required: true, nullable: false, blank: false }),
            source: new fields.StringField({
              required: true,
              nullable: false,
              choices: ["normalNarrative", "racialPassive", "gmOverride"]
            }),
            sourcePassiveId: new fields.StringField({ required: false, nullable: true, initial: null }),
            grantedAtLevel: new fields.NumberField({ required: true, nullable: false, integer: true, min: 1 }),
            grantedBy: new fields.StringField({ required: true, nullable: false, blank: false }),
            grantedAt: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0 }),
            reason: new fields.StringField({ required: false, nullable: false, initial: "", blank: true })
          }),
          { required: false, nullable: false, initial: [] }
        ),
        selections: new fields.ArrayField(
          new fields.SchemaField({
            passiveId: new fields.StringField({ required: true, nullable: false, blank: false }),
            selectedAtLevel: new fields.NumberField({ required: true, nullable: false, integer: true, min: 1 }),
            selectedBy: new fields.StringField({ required: true, nullable: false, blank: false }),
            grantId: new fields.StringField({ required: true, nullable: false, blank: false }),
            selectedAt: new fields.NumberField({ required: true, nullable: false, integer: true, min: 0 }),
            reason: new fields.StringField({ required: false, nullable: false, initial: "", blank: true })
          }),
          { required: false, nullable: false, initial: [] }
        )
      }),

      orbs: new fields.ArrayField(
        new fields.SchemaField({
          id: new fields.StringField({
            required: true,
            nullable: false,
            blank: false
          }),
          type: new fields.StringField({
            required: true,
            nullable: false,
            choices: MTROL_ORB_IDS
          }),
          level: new fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 1,
            max: 5
          })
        }),
        {
          required: false,
          nullable: false,
          initial: []
        }
      ),

      alignment: new fields.SchemaField({
        type: new fields.StringField({
          required: false,
          nullable: true,
          initial: null,
          choices: MTROL_ALIGNMENT_TYPES
        }),
        unlocked: new fields.BooleanField({
          required: false,
          nullable: false,
          initial: false
        })
      }),

      inventarioMaxSlots: new fields.NumberField({
        initial: 20,
        integer: true,
        min: 0
      }),

      equipamiento: new fields.SchemaField({
        cabeza: new fields.StringField({ initial: "" }),
        cuello: new fields.StringField({ initial: "" }),
        hombros: new fields.StringField({ initial: "" }),
        brazos: new fields.StringField({ initial: "" }),
        pecho: new fields.StringField({ initial: "" }),
        piernas: new fields.StringField({ initial: "" }),
        pies: new fields.StringField({ initial: "" }),
        manoIzq: new fields.StringField({ initial: "" }),
        manoDer: new fields.StringField({ initial: "" }),
        extra: new fields.StringField({ initial: "" })
      })
    };
  }
}
