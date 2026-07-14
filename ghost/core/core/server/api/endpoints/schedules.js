const postScheduling = require('../../services/posts/post-scheduling');

function setCacheInvalidateHeader(frame, cacheInvalidation) {
    if (cacheInvalidation === true) {
        frame.setHeader('X-Cache-Invalidate', '/*');
    } else if (cacheInvalidation.value) {
        frame.setHeader('X-Cache-Invalidate', cacheInvalidation.value);
    }
}

/** @type {import('@tryghost/api-framework').Controller} */
const controller = {
    docName: 'schedules',
    publish: {
        headers: {
            cacheInvalidate: false
        },
        options: [
            'id',
            'resource'
        ],
        data: [
            'force'
        ],
        validation: {
            options: {
                id: {
                    required: true
                },
                resource: {
                    required: true,
                    values: ['posts', 'pages']
                }
            }
        },
        permissions: {
            docName: 'posts'
        },
        async query(frame) {
            const resourceType = frame.options.resource;
            const options = {
                status: 'scheduled',
                id: frame.options.id,
                context: {
                    internal: true
                }
            };

            const {scheduledResource, preScheduledResource} = await postScheduling.publish(resourceType, frame.options.id, frame.data.force, options);

            const response = {};

            // CASE: nothing to publish (deleted/rescheduled/already handled).
            // Respond 2xx with an empty resource list so the scheduler treats
            // the job as done and does not retry.
            if (!scheduledResource) {
                response[resourceType] = [];
                return response;
            }

            setCacheInvalidateHeader(frame, postScheduling.handleCacheInvalidation(scheduledResource, preScheduledResource));

            response[resourceType] = [scheduledResource];
            return response;
        }
    }
};

module.exports = controller;
