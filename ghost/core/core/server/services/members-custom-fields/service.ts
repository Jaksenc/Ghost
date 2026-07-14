import ObjectID from 'bson-objectid';
import errors from '@tryghost/errors';
import type {Knex} from 'knex';
import {z} from 'zod';
import {CustomField, type FieldType, FieldTypeSchema} from './models';
import {customFieldCodec} from './codec';
import {type RecordCustomFieldAction, type RequestContext} from './actions';

// @tryghost/string ships no types; slugify is the same helper tags/labels use.
const {slugify} = require('@tryghost/string') as {slugify(input: string): string};

// The name column is 191 chars; cap the input so an over-long name is a clean
// 422 rather than a database error (MySQL rejects oversized values in prod).
const MAX_NAME_LENGTH = 191;
const FieldName = z.string().trim().min(1, {message: 'Custom field name is required.'}).max(MAX_NAME_LENGTH, {message: 'Custom field name is too long.'});

// The key is minted by the backend from the name, so the create body is just a
// name and a type.
const AddFieldInput = z.object({
    name: FieldName,
    type: FieldTypeSchema
});

// Rename-only: `key` is accepted so the immutability rule can reject a change, but
// is never persisted. Absent fields are left untouched.
const EditFieldInput = z.object({
    name: FieldName.optional(),
    key: z.string().optional()
});

export class CustomFieldsService {
    private knex: Knex;
    private recordAction: RecordCustomFieldAction;

    constructor({knex, recordAction}: {knex: Knex; recordAction: RecordCustomFieldAction}) {
        this.knex = knex;
        this.recordAction = recordAction;
    }

    async browse(): Promise<CustomField[]> {
        // Insertion order for now. When the UI needs a persistent, user-defined
        // order, add a `sort_order` column and order by it here (an additive door).
        const rows = await this.knex('member_custom_fields')
            .orderBy('created_at', 'asc')
            .orderBy('id', 'asc')
            .select('*');
        return rows.map(row => z.decode(customFieldCodec, row));
    }

    async read(id: string): Promise<CustomField> {
        const row = await this.knex('member_custom_fields').where('id', id).first();
        if (!row) {
            throw new errors.NotFoundError({message: 'Custom field not found.'});
        }
        return z.decode(customFieldCodec, row);
    }

    async add(context: RequestContext, input: unknown): Promise<CustomField> {
        const parsed = AddFieldInput.safeParse(input);
        if (!parsed.success) {
            throw new errors.ValidationError({message: parsed.error.issues[0].message, property: 'custom_fields'});
        }

        const base = slugify(parsed.data.name);
        if (!base) {
            throw new errors.ValidationError({message: 'Custom field name must contain at least one usable character.', property: 'name'});
        }

        const id = new ObjectID().toHexString();
        await this.insertWithMintedKey({id, base, name: parsed.data.name, type: parsed.data.type});
        await this.recordAction({context, verb: 'create', subject: id});
        return this.read(id);
    }

    /**
     * Insert a field, minting a unique key from the base slug: the DB unique
     * constraint is the arbiter, so on a collision we retry the next suffix
     * (base, base_2, base_3, ...). Race-free — two concurrent creates deriving the
     * same base can't both win the same key.
     */
    private async insertWithMintedKey({id, base, name, type}: {id: string; base: string; name: string; type: FieldType}): Promise<void> {
        const maxAttempts = 1000;
        // Trim the base so even the longest suffix (`-1000`) keeps the key within
        // the 191-char column. Short bases (the common case) are untouched.
        const safeBase = base.slice(0, 185);
        for (let suffix = 1; suffix <= maxAttempts; suffix += 1) {
            const key = suffix === 1 ? safeBase : `${safeBase}-${suffix}`;
            try {
                await this.knex('member_custom_fields').insert({id, key, name, type, created_at: new Date()});
                return;
            } catch (err) {
                if (isUniqueConstraintViolation(err)) {
                    continue;
                }
                throw err;
            }
        }
        throw new errors.ValidationError({message: 'Could not mint a unique key for this custom field.', property: 'name'});
    }

    async edit(context: RequestContext, id: string, input: unknown): Promise<CustomField> {
        const parsed = EditFieldInput.safeParse(input);
        if (!parsed.success) {
            throw new errors.ValidationError({message: parsed.error.issues[0].message, property: 'custom_fields'});
        }
        const patch = parsed.data;

        const existing = await this.read(id);

        // Keys are immutable after creation: values are addressed by key over the
        // wire, so renaming a key would silently orphan its stored values.
        if (patch.key !== undefined && patch.key !== existing.key) {
            throw new errors.ValidationError({message: 'Custom field keys cannot be changed once created.', property: 'key'});
        }

        if (patch.name !== undefined) {
            await this.knex('member_custom_fields')
                .where('id', id)
                .update({name: patch.name, updated_at: new Date()});
            await this.recordAction({context, verb: 'rename', subject: id});
        }

        return this.read(id);
    }

    async destroy(context: RequestContext, id: string): Promise<void> {
        const deleted = await this.knex('member_custom_fields').where('id', id).del();
        if (!deleted) {
            throw new errors.NotFoundError({message: 'Custom field not found.'});
        }
        await this.recordAction({context, verb: 'delete', subject: id});
    }
}

function isUniqueConstraintViolation(error: unknown): boolean {
    const code = (error as {code?: string})?.code;
    return code === 'ER_DUP_ENTRY' || code === 'SQLITE_CONSTRAINT';
}
