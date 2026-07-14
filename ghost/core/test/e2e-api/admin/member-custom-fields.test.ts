import assert from 'node:assert/strict';

const {agentProvider, fixtureManager, mockManager} = require('../../utils/e2e-framework');
const models = require('../../../core/server/models');

describe('Member Custom Fields Admin API', function () {
    let agent: {
        get: (_url: string) => any;
        put: (_url: string) => any;
        post: (_url: string) => any;
        delete: (_url: string) => any;
        loginAsOwner: () => Promise<void>;
    };

    // The key is minted server-side from the name, so callers pass just a name
    // (and optionally a type) and read the derived key off the result.
    async function createField(field: {name: string, type?: string}) {
        const {body} = await agent
            .post('members/custom_fields/')
            .body({member_custom_fields: [{type: 'short_text', ...field}]})
            .expectStatus(201);
        return body.member_custom_fields[0];
    }

    beforeAll(async function () {
        agent = await agentProvider.getAdminAPIAgent();
        await fixtureManager.init('users');
        await agent.loginAsOwner();
    });

    beforeEach(function () {
        mockManager.mockLabsEnabled('membersCustomFields');
    });

    afterEach(async function () {
        mockManager.restore();
        await models.Base.knex('member_custom_fields').del();
        await models.Base.knex('actions').where('resource_type', 'member_custom_field').del();
    });

    describe('Definitions', function () {
        it('returns an empty list when no fields exist', async function () {
            const {body} = await agent.get('members/custom_fields/').expectStatus(200);
            assert.deepEqual(body.member_custom_fields, []);
        });

        it('creates a field, minting a slug key from the name', async function () {
            const created = await createField({name: 'Favourite topic'});
            assert.equal(created.key, 'favourite-topic');
            assert.equal(created.name, 'Favourite topic');
            assert.equal(created.type, 'short_text');
            assert.ok(created.id);

            const list = (await agent.get('members/custom_fields/').expectStatus(200)).body;
            assert.equal(list.member_custom_fields.length, 1);

            const read = (await agent.get(`members/custom_fields/${created.id}/`).expectStatus(200)).body;
            assert.equal(read.member_custom_fields[0].key, 'favourite-topic');
        });

        it('mints a suffixed key when the derived slug collides', async function () {
            const first = await createField({name: 'Favourite topic'});
            const second = await createField({name: 'Favourite topic'});
            assert.equal(first.key, 'favourite-topic');
            assert.equal(second.key, 'favourite-topic-2');
        });

        it('rejects a name with no sluggable characters', async function () {
            await agent
                .post('members/custom_fields/')
                .body({member_custom_fields: [{name: '!!!', type: 'short_text'}]})
                .expectStatus(422);
        });

        it('rejects a name that exceeds the maximum length', async function () {
            await agent
                .post('members/custom_fields/')
                .body({member_custom_fields: [{name: 'a'.repeat(192), type: 'short_text'}]})
                .expectStatus(422);
        });

        it('rejects an unsupported type', async function () {
            await agent
                .post('members/custom_fields/')
                .body({member_custom_fields: [{name: 'Topic', type: 'boolean'}]})
                .expectStatus(422);
        });

        it('renames a field but keeps the key immutable', async function () {
            const created = await createField({name: 'Favourite topic'});

            const renamed = (await agent
                .put(`members/custom_fields/${created.id}/`)
                .body({member_custom_fields: [{name: 'Topic'}]})
                .expectStatus(200)).body.member_custom_fields[0];
            assert.equal(renamed.name, 'Topic');
            assert.equal(renamed.key, created.key);

            await agent
                .put(`members/custom_fields/${created.id}/`)
                .body({member_custom_fields: [{key: 'different-key'}]})
                .expectStatus(422);
        });

        it('hard-deletes a field', async function () {
            const field = await createField({name: 'Favourite topic'});

            await agent.delete(`members/custom_fields/${field.id}/`).expectStatus(204);

            const list = (await agent.get('members/custom_fields/').expectStatus(200)).body;
            assert.deepEqual(list.member_custom_fields, []);
            await agent.get(`members/custom_fields/${field.id}/`).expectStatus(404);
        });
    });

    describe('records actions in the history (via the actions API)', function () {
        let actorId: string;

        const customFieldActions = async () => {
            const {body} = await agent.get('actions/?filter=resource_type:member_custom_field').expectStatus(200);
            return body.actions;
        };

        beforeAll(async function () {
            actorId = (await agent.get('users/me/').expectStatus(200)).body.users[0].id;
        });

        it('records an "added" action when a field is created', async function () {
            const field = await createField({name: 'Favourite topic'});

            const actions = await customFieldActions();
            assert.equal(actions.length, 1);
            assert.equal(actions[0].event, 'added');
            assert.equal(actions[0].resource_id, field.id);
            assert.equal(actions[0].actor_type, 'user');
            assert.equal(actions[0].actor_id, actorId);
        });

        it('records an "edited" action when a field is renamed', async function () {
            const field = await createField({name: 'Favourite topic'});
            await agent
                .put(`members/custom_fields/${field.id}/`)
                .body({member_custom_fields: [{name: 'Topic'}]})
                .expectStatus(200);

            const edited = (await customFieldActions()).find((a: {event: string}) => a.event === 'edited');
            assert.ok(edited, 'an edited action should be recorded');
            assert.equal(edited.resource_id, field.id);
            assert.equal(edited.actor_id, actorId);
        });

        it('records a "deleted" action when a field is deleted', async function () {
            const field = await createField({name: 'Favourite topic'});
            await agent.delete(`members/custom_fields/${field.id}/`).expectStatus(204);

            const deleted = (await customFieldActions()).find((a: {event: string}) => a.event === 'deleted');
            assert.ok(deleted, 'a deleted action should be recorded');
            assert.equal(deleted.resource_id, field.id);
            assert.equal(deleted.actor_id, actorId);
        });
    });

    describe('Flag disabled', function () {
        beforeEach(function () {
            mockManager.restore();
            mockManager.mockLabsDisabled('membersCustomFields');
        });

        it('404s the definitions endpoint', async function () {
            await agent.get('members/custom_fields/').expectStatus(404);
        });
    });
});
