const fields = foundry.data.fields;

export class PersonajeDataModel extends foundry.abstract.TypeDataModel {
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
        raza: new fields.StringField({ initial: "" }),
        profesion: new fields.StringField({ initial: "" }),
        maestria: new fields.StringField({ initial: "" }),
        edad: new fields.NumberField({ initial: 0, integer: true, min: 0 })
      }),

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