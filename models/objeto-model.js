const fields = foundry.data.fields;

export class ObjetoDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      tipoObjeto: new fields.StringField({
        initial: "general"
      }),

      cantidad: new fields.NumberField({
        initial: 1,
        integer: true,
        min: 0
      }),

      material: new fields.StringField({
        initial: ""
      }),

      slots: new fields.NumberField({
        initial: 0,
        integer: true,
        min: 0
      }),

      peso: new fields.NumberField({
        initial: 0,
        min: 0
      }),

      equipable: new fields.BooleanField({
        initial: false
      }),

      equipado: new fields.BooleanField({
        initial: false
      }),

      slot: new fields.StringField({
        initial: ""
      }),

      defensa: new fields.NumberField({
        initial: 0,
        integer: true,
        min: 0,
        max: 20
      }),

      defensaBase: new fields.NumberField({
        initial: 0,
        integer: true,
        min: 0,
        max: 20
      }),

      danio: new fields.StringField({
        initial: ""
      }),

      valor: new fields.NumberField({
        initial: 0,
        integer: true,
        min: 0
      }),

      descripcion: new fields.StringField({
        initial: ""
      }),

      // Legacy: los objetos rotos se eliminan; este campo queda solo por compatibilidad.
      roto: new fields.BooleanField({
        initial: false
      })
    };
  }
}
