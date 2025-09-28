/**
 * Basic Logger
*/

const Logger = (function () {
    let verboseEnabled = false;
    const prefix = 'FTCSIM Connect:';

    chrome.storage.local.get(['verboseLogging'], function (result) {
        verboseEnabled = !!result.verboseLogging;
        if (verboseEnabled) {
            console.log(prefix, 'Logger initialized with verbose logging enabled');
        }
    });

    chrome.storage.onChanged.addListener(function (changes) {
        if (changes.verboseLogging) {
            verboseEnabled = !!changes.verboseLogging.newValue;
            console.log(prefix, `Verbose logging ${verboseEnabled ? 'enabled' : 'disabled'}`);
        }
    });

    return {
        setVerboseLogging: function (enabled) {
            verboseEnabled = !!enabled;
            if (verboseEnabled) {
                console.log(prefix, `Verbose logging ${verboseEnabled ? 'enabled' : 'disabled'}`);
            }
        },

        log: function (...args) {
            if (verboseEnabled) {
                console.log(prefix, ...args);
            }
        },

        warn: function (...args) {
            console.warn(prefix, ...args);
        },

        error: function (...args) {
            console.error(prefix, ...args);
        },

        debug: function (...args) {
            if (verboseEnabled) {
                console.debug(prefix, ...args);
            }
        },

        info: function (...args) {
            if (verboseEnabled) {
                console.info(prefix, ...args);
            } else if (args.length > 0) {
                console.info(prefix, args[0]);
            }
        },

        group: function (label) {
            if (verboseEnabled) {
                console.group(`${prefix} ${label}`);
            }
        },

        groupEnd: function () {
            if (verboseEnabled) {
                console.groupEnd();
            }
        },

        time: function (label) {
            if (verboseEnabled) {
                console.time(`${prefix} ${label}`);
            }
        },

        timeEnd: function (label) {
            if (verboseEnabled) {
                console.timeEnd(`${prefix} ${label}`);
            }
        },

        isVerboseEnabled: function () {
            return verboseEnabled;
        }
    };
})();

window.logger = Logger; //amke logger glovbal