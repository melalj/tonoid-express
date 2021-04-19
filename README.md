# @tonoid/express

[![Twitter URL](https://img.shields.io/twitter/url/http/shields.io.svg?style=social)](https://github.com/melalj/tonoid-express)
[![GitHub stars](https://img.shields.io/github/stars/melalj/tonoid-express.svg?style=social&label=Star&maxAge=2592003)]()

[![npm](https://img.shields.io/npm/dt/@tonoid/express.svg)]() [![npm](https://img.shields.io/npm/v/@tonoid/express.svg)]() [![npm](https://img.shields.io/npm/l/@tonoid/express.svg)]() [![David](https://img.shields.io/david/melalj/tonoid-express.svg)]()

Express plugin for [@tonoid/helpers](https://github.com/melalj/tonoid-helpers)

## Init options

- `port`: (defaults: `process.env.EXPRESS_PORT || 80`) Express http port.
- `endpoints`: (defaults: `[]`):
  - `endpoints[].path`: Endpoint path
  - `endpoints[].handler`: Endpoint handler (function)

## Exported context attributes

- `.close()`: Close mongo client
- `.getRouter()`: Get database instance
- `.app`: Express app instance
- `.asyncHandler()`: Async handler alias

## Usage example

```js
const { context, init } = require('@tonoid/helpers');
const express = require('@tonoid/express');

const rootHandler = () => {
  const router = context.express.getRouter();

  router.get('/', context.express.asyncHandler((req, res) => {
    return { root: true };
  }));

  router.get('/foo', context.express.asyncHandler((req, res) => {
    return { foo: true };
  }));

  return router;
};

init([
  express({
    port: 3000,
    endpoints: [
      {
        path: '/',
        handler: rootHandler,
      },
    ],
  }),
]);

```

## Credits

This module is maintained by [Simo Elalj](https://twitter.com/simoelalj) @[tonoid](https://www.tonoid.com)
