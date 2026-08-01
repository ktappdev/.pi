import.meta.url = "pi://@sinclair/typebox";
export const Type = {
  String: (opts = {}) => ({ type: "string", ...opts }),
  Number: (opts = {}) => ({ type: "number", ...opts }),
  Boolean: (opts = {}) => ({ type: "boolean", ...opts }),
  Array: (items, opts = {}) => ({ type: "array", items, ...opts }),
  Object: (props = {}, opts = {}) => {
    const required = [];
    const properties = {};
    for (const [k, v] of Object.entries(props)) {
      if (v && typeof v === "object" && v.__pi_optional) {
        properties[k] = v.schema;
      } else {
        properties[k] = v;
        required.push(k);
      }
    }
    const out = { type: "object", properties, ...opts };
    if (required.length) out.required = required;
    return out;
  },
  Optional: (schema) => ({ __pi_optional: true, schema }),
  Literal: (value, opts = {}) => ({ const: value, ...opts }),
  Any: (opts = {}) => ({ ...opts }),
  Union: (schemas, opts = {}) => ({ anyOf: schemas, ...opts }),
  Enum: (values, opts = {}) => ({ enum: values, ...opts }),
  Integer: (opts = {}) => ({ type: "integer", ...opts }),
  Null: (opts = {}) => ({ type: "null", ...opts }),
  Unknown: (opts = {}) => ({ ...opts }),
  Tuple: (items, opts = {}) => ({ type: "array", items, minItems: items.length, maxItems: items.length, ...opts }),
  Record: (keySchema, valueSchema, opts = {}) => ({ type: "object", additionalProperties: valueSchema, ...opts }),
  Ref: (ref, opts = {}) => ({ $ref: ref, ...opts }),
  Intersect: (schemas, opts = {}) => ({ allOf: schemas, ...opts }),
};
export default { Type };