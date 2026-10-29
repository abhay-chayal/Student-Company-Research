const { APP_NAME, GROUPS, GENERAL } = require('../lib/domains');
const { send } = require('../lib/http');
const { STRENGTH, UNITS, CURRENCIES } = require('../lib/extras');

// What the form needs to draw itself: the app name and the domain dropdown.
module.exports = (req, res) => send(res, 200, { appName: APP_NAME, general: GENERAL, groups: GROUPS, strength: STRENGTH, units: UNITS, currencies: CURRENCIES });
