const {addTable} = require('../../utils');

// The custom field definitions table. Member values are stored separately and
// added in a later migration alongside the value read/write path.
module.exports = addTable('member_custom_fields', {
    id: {type: 'string', maxlength: 24, nullable: false, primary: true},
    key: {type: 'string', maxlength: 191, nullable: false, unique: true},
    name: {type: 'string', maxlength: 191, nullable: false},
    type: {type: 'string', maxlength: 50, nullable: false, defaultTo: 'short_text', validations: {isIn: [['short_text', 'long_text', 'address']]}},
    created_at: {type: 'dateTime', nullable: false},
    updated_at: {type: 'dateTime', nullable: true}
});
