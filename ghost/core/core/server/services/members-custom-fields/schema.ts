import {z} from 'zod';
import type {Knex} from 'knex';
import {FieldTypeSchema} from '@tryghost/custom-field-types';
import {DbDate} from '../../lib/db-date';

// The member_custom_fields row: the single source for the read projection and the
// knex table type below. `type` is validated as the field-type enum here (the DB
// only stores registered types), so the row already carries the narrow type and
// the definition codec needs no cast.
export const DbCustomField = z.object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    type: FieldTypeSchema,
    created_at: DbDate,
    updated_at: DbDate.nullable()
});

// knex table type, derived from the schema above so the row shape has a single source.
declare module 'knex/types/tables' {
    interface Tables {
        member_custom_fields: Knex.CompositeTableType<
            z.infer<typeof DbCustomField>,
            Omit<z.input<typeof DbCustomField>, 'updated_at'>,
            Partial<z.infer<typeof DbCustomField>>
        >;
    }
}
