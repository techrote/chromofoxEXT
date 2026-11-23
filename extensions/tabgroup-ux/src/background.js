/* Firefox MV3 uses a non-persistent background event page, not a service worker. */
'use strict';
const tabGroupUX = TabGroupService.createService(browser);
tabGroupUX.start().catch(error => console.error('Tab Groups Enhanced failed to initialise:', error));
