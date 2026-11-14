Automated tests use Node.js v18+ and its built-in `node:test` framework; no dependencies or network requests.

    node --test tests/*.test.cjs

The background tests run the extension's event scripts in an isolated JavaScript VM with mocked Firefox APIs. UI layout and Firefox integration must be tested in a Firefox browser.
