const _ = require('lodash');
const errors = require('@tryghost/errors');
const moment = require('moment');
const config = require('../../../shared/config');
const urlUtils = require('../../../shared/url-utils');
const api = require('../../api').endpoints;

const messages = {
    jobPublishInThePast: 'Use the force flag to publish a post in the past.'
};

// A scheduler firing our publish URL has done its job by reaching us. When the
// job fires ahead of the scheduled time — e.g. the post was rescheduled to a
// later time and the scheduler still holds the old, earlier job — there is
// nothing to publish yet. That is a no-op, not an error. Returning it lets the
// caller respond 2xx so the scheduler treats the job as done instead of
// retrying a publish that will never happen at this time.
const NO_OP = {scheduledResource: null, preScheduledResource: null};

/**
 * Publishes scheduled resource (a post or a page at the moment of writing)
 *
 * @param {string} resourceType one of 'post' or 'page' resources
 * @param {string} id resource id
 * @param {boolean} force force publish flag
 * @param {Object} options api query options
 * @returns {Promise<Object, Object>} the published resource, or a no-op with
 *   `scheduledResource: null` when there was nothing to publish yet
 */
exports.publish = async (resourceType, id, force, options) => {
    const publishAPostBySchedulerToleranceInMinutes = config.get('times').publishAPostBySchedulerToleranceInMinutes;

    const result = await api[resourceType].read({id}, options);
    const preScheduledResource = result[resourceType][0];

    const publishedAtMoment = moment(preScheduledResource.published_at);

    // CASE: firing ahead of the scheduled time — nothing to publish yet
    if (publishedAtMoment.diff(moment(), 'minutes') > publishAPostBySchedulerToleranceInMinutes) {
        return NO_OP;
    }

    // CASE: firing well after the scheduled time without a force flag — this is
    // a dropped publish, so keep it loud rather than silently skipping it
    if (publishedAtMoment.diff(moment(), 'minutes') < publishAPostBySchedulerToleranceInMinutes * -1 && force !== true) {
        return Promise.reject(new errors.NotFoundError({message: messages.jobPublishInThePast}));
    }

    const editedResource = {};
    editedResource[resourceType] = [{
        status: 'published',
        updated_at: moment(preScheduledResource.updated_at).toISOString(true)
    }];

    const editResult = await api[resourceType].edit(
        editedResource,
        _.pick(options, ['context', 'id', 'transacting', 'forUpdate'])
    );
    const scheduledResource = editResult[resourceType][0];

    return {scheduledResource, preScheduledResource};
};

/**
 * @param {Object} scheduledResource post or page resource object
 * @param {Object} preScheduledResource post or page resource object in state before publishing
 * @returns {boolean|{value: string}}
 */
exports.handleCacheInvalidation = (scheduledResource, preScheduledResource) => {
    if (
        (scheduledResource.status === 'published' && preScheduledResource.status !== 'published') ||
        (scheduledResource.status === 'draft' && preScheduledResource.status === 'published')
    ) {
        return true;
    } else if (
        (scheduledResource.status === 'draft' && preScheduledResource.status !== 'published') ||
        (scheduledResource.status === 'scheduled' && preScheduledResource.status !== 'scheduled')
    ) {
        return {
            value: urlUtils.urlFor({
                relativeUrl: urlUtils.urlJoin('/p', scheduledResource.uuid, '/')
            })
        };
    } else {
        return false;
    }
};
